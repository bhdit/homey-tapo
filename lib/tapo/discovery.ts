import dgram from 'dgram';
import crypto from 'crypto';

/**
 * Local discovery over TP-Link's discovery protocol ("TDP", UDP 20002) — the
 * same probe the Tapo app and python-kasa use. Every Tapo device on the subnet
 * answers with its model, type, MAC and IP *without* needing a login, which is
 * what lets us (a) find devices to pair and (b) find a paired device again
 * after DHCP hands it a new address.
 */
export type DiscoveredDevice = {
  ip: string,
  mac: string, // normalised: lowercase hex, no separators
  model: string, // raw, e.g. "L930-5(EU)"
  baseModel: string, // e.g. "L930"
  deviceType: string, // e.g. "SMART.TAPOPLUG"
  encryptType?: string, // "KLAP" | "AES" | undefined (cameras)
};

const PORT = 20002;
const CACHE_MS = 20_000;

export const normalizeMac = (mac: string | undefined): string => (mac ?? '').replace(/[^0-9a-f]/gi, '').toLowerCase();

/** "L930-5(EU)" → "L930", "P110M(EU)" → "P110M", "P110" → "P110" */
export const baseModel = (model: string | undefined): string => (model ?? '')
  .replace(/\(.*?\)/g, '')
  .split('-')[0]
  .trim()
  .toUpperCase();

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

// zlib.crc32 only exists on newer Node versions than Homey guarantees.
const crc32 = (buf: Buffer): number => {
  let crc = 0xFFFFFFFF;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
};

let probePacket: Buffer | undefined;
const buildProbe = (): Buffer => {
  if (probePacket) return probePacket;
  // The device encrypts part of its reply to this key; we only read the
  // plaintext fields, but a valid key is required for devices to answer.
  const { publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 1024 });
  const payload = Buffer.from(JSON.stringify({
    params: { rsa_key: publicKey.export({ type: 'spki', format: 'pem' }) },
  }));
  const header = Buffer.alloc(16);
  header.writeUInt8(2, 0); // TDP version
  header.writeUInt8(0, 1); // message type
  header.writeUInt16BE(1, 2); // op code: probe
  header.writeUInt16BE(payload.length, 4);
  header.writeUInt8(17, 6); // flags
  header.writeUInt8(0, 7);
  header.writeUInt32BE(crypto.randomBytes(4).readUInt32BE(0), 8); // serial
  header.writeUInt32BE(0x5A6B7C8D, 12); // CRC seed, replaced below
  probePacket = Buffer.concat([header, payload]);
  probePacket.writeUInt32BE(crc32(probePacket), 12);
  return probePacket;
};

const parseReply = (msg: Buffer, address: string): DiscoveredDevice | undefined => {
  try {
    const result = JSON.parse(msg.subarray(16).toString('utf8'))?.result;
    if (!result?.mac) return undefined;
    return {
      ip: result.ip || address,
      mac: normalizeMac(result.mac),
      model: result.device_model ?? '',
      baseModel: baseModel(result.device_model),
      deviceType: result.device_type ?? '',
      encryptType: result.mgt_encrypt_schm?.encrypt_type,
    };
  } catch {
    return undefined;
  }
};

const scan = (timeoutMs: number, target: string): Promise<DiscoveredDevice[]> => new Promise((resolve, reject) => {
  const found = new Map<string, DiscoveredDevice>();
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  const timers: NodeJS.Timeout[] = [];
  const finish = () => {
    timers.forEach(clearTimeout);
    try {
      socket.close();
    } catch {
      // already closed
    }
    resolve([...found.values()]);
  };

  socket.on('error', (error) => {
    timers.forEach(clearTimeout);
    try {
      socket.close();
    } catch {
      // already closed
    }
    reject(error);
  });
  socket.on('message', (msg, rinfo) => {
    const device = parseReply(msg, rinfo.address);
    if (device) found.set(device.mac, device);
  });
  socket.bind(() => {
    socket.setBroadcast(true);
    const packet = buildProbe();
    // UDP is lossy and devices occasionally miss one probe; send three.
    [0, 400, 1000].forEach((delay) => timers.push(setTimeout(() => {
      socket.send(packet, PORT, target, () => { /* errors surface via 'error' */ });
    }, delay)));
    timers.push(setTimeout(finish, timeoutMs));
  });
});

let cache: { at: number, devices: DiscoveredDevice[] } | undefined;
let inFlight: Promise<DiscoveredDevice[]> | undefined;

/**
 * Broadcasts a probe and returns every Tapo device that answered.
 * Concurrent callers share one scan, and results are cached briefly so ten
 * devices reconnecting at once cause one broadcast, not ten.
 */
export async function discoverTapoDevices({ timeoutMs = 3000, maxAgeMs = CACHE_MS } = {}): Promise<DiscoveredDevice[]> {
  if (cache && Date.now() - cache.at < maxAgeMs) return cache.devices;
  if (!inFlight) {
    inFlight = scan(timeoutMs, '255.255.255.255')
      .then((devices) => {
        cache = { at: Date.now(), devices };
        return devices;
      })
      .finally(() => {
        inFlight = undefined;
      });
  }
  return inFlight;
}

export async function findDeviceByMac(mac: string, opts?: { maxAgeMs?: number }): Promise<DiscoveredDevice | undefined> {
  const wanted = normalizeMac(mac);
  if (!wanted) return undefined;
  const devices = await discoverTapoDevices(opts);
  return devices.find((device) => device.mac === wanted);
}

/** Cameras and hubs answer the probe too, but they don't speak the plug/bulb API. */
export const isSupportedType = (device: DiscoveredDevice): boolean => /^SMART\.TAPO(PLUG|BULB)$/.test(device.deviceType);
