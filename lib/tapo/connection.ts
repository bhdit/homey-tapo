import { loginDeviceByIp } from 'tp-link-tapo-connect';
import { classifyError, TapoError } from './errors';

export type TapoApi = Awaited<ReturnType<typeof loginDeviceByIp>>;

const REQUEST_TIMEOUT_MS = 5000;

/**
 * tp-link-tapo-connect calls axios with no timeout, so a device that is off
 * holds a login open until the OS gives up on TCP (2+ minutes observed).
 * Set a default on the axios instance *the library* resolves — resolving from
 * the library's own path keeps this correct even if npm stops hoisting axios.
 */
(function setLibraryAxiosTimeout() {
  try {
    const libEntry = require.resolve('tp-link-tapo-connect');
    // eslint-disable-next-line global-require, import/no-dynamic-require, @typescript-eslint/no-var-requires, node/no-extraneous-require
    const axios = require(require.resolve('axios', { paths: [libEntry] }));
    axios.defaults.timeout = REQUEST_TIMEOUT_MS;
  } catch {
    // Not fatal: `withTimeout` below still bounds every call we make.
  }
}());

export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout of ${ms}ms exceeded (${label})`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export type Credentials = { username: string, password: string };

/** Read at call time, so changing credentials in settings needs no app restart. */
export function getCredentials(settings: { get(key: string): unknown }): Credentials {
  const username = String(settings.get('username') ?? '').trim();
  const password = String(settings.get('password') ?? '');
  if (!username || !password) {
    throw new TapoError('credentials', 'Tapo username and password are not set. Add them in the app settings.');
  }
  return { username, password };
}

export async function login(credentials: Credentials, ip: string): Promise<TapoApi> {
  try {
    // A KLAP login is two round trips, plus a legacy fallback when KLAP is unsupported.
    return await withTimeout(loginDeviceByIp(credentials.username, credentials.password, ip), REQUEST_TIMEOUT_MS * 3, `login ${ip}`);
  } catch (error) {
    throw classifyError(error, ip);
  }
}
