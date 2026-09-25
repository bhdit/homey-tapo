/**
 * Turns the raw errors thrown by tp-link-tapo-connect / axios into a small set
 * of kinds the device code can act on, plus a message a user can act on.
 *
 * The library throws plain `Error`s with free-text messages (and sometimes
 * wraps an axios error inside the message string), so classification is
 * message-based by necessity.
 */
export type TapoErrorKind =
  | 'credentials' // wrong Tapo username/password — retrying will not help
  | 'unreachable' // nothing answering at that IP (moved, powered off, timeout)
  | 'session' // session expired / rejected — a fresh login fixes it
  | 'not_tapo' // something answered, but it is not a KLAP/passthrough Tapo device
  | 'unknown';

export class TapoError extends Error {

  constructor(public kind: TapoErrorKind, message: string, public cause?: unknown) {
    super(message);
    this.name = 'TapoError';
  }

}

const NETWORK = /ETIMEDOUT|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|EHOSTDOWN|ECONNRESET|ECONNABORTED|timeout of \d+ms exceeded|socket hang up/i;
const CREDENTIALS = /email or password incorrect|Invalid credentials|Incorrect email or password|Login failed/i;
const SESSION = /Session Timeout|Session params error|Rate limit exceeded|status code 40[13]|AES Decode Fail|Handshake failed/i;
// The KLAP handshake reads `set-cookie[0]`; a non-Tapo HTTP server makes that undefined.
const NOT_TAPO = /Cannot read propert(?:y|ies) of undefined|Unexpected token|Klap protocol not supported|Transport not available/i;

export function classifyError(error: unknown, ip?: string): TapoError {
  if (error instanceof TapoError) return error;
  const raw = error instanceof Error ? error.message : String(error);
  const where = ip ? ` at ${ip}` : '';

  // A plain HTTP error to the very first handshake means something answered on :80
  // that isn't a Tapo plug/bulb (router, NAS, camera...). Checked before SESSION,
  // which would otherwise read a 401/403 here as an expired session.
  if (/handshake1 failed: .*status code \d{3}/.test(raw)) {
    return new TapoError('not_tapo', `The device${where} did not respond like a Tapo device.`, error);
  }
  if (NETWORK.test(raw)) {
    return new TapoError('unreachable', `Device not reachable${where}. It may be off or have a new IP address.`, error);
  }
  if (CREDENTIALS.test(raw)) {
    return new TapoError('credentials', 'The device rejected the Tapo login. Check the username and password in the app settings.', error);
  }
  if (SESSION.test(raw)) {
    return new TapoError('session', `Session with the device${where} expired.`, error);
  }
  if (NOT_TAPO.test(raw)) {
    return new TapoError('not_tapo', `The device${where} did not respond like a Tapo device.`, error);
  }
  return new TapoError('unknown', raw, error);
}
