// One origin policy, used by BOTH Better Auth (`trustedOrigins`) and our CSRF guard.
//
//   production / test : exactly the origin of BETTER_AUTH_URL plus TRUSTED_ORIGINS.
//   development       : the same, plus
//                         http://localhost[:any port], http://127.0.0.1[:any port]
//                         http://<10.x | 172.16-31.x | 192.168.x>.x.x:5173   (phone on the LAN via Vite's proxy)
//
// The input must already be a canonical serialized origin (what browsers send in `Origin`):
// anything that does not survive a `new URL(o).origin === o` round trip (trailing slash, path,
// userinfo, upper case, default port, "null", lists) is rejected. No wildcards, no suffix matching.
import type { Env } from './env.js'

export type OriginEnv = Pick<Env, 'NODE_ENV' | 'BETTER_AUTH_URL' | 'TRUSTED_ORIGINS'>

const DEV_LAN_PORT = '5173'

function canonicalOrigin(value: string): string | null {
  try {
    const origin = new URL(value).origin
    return origin === 'null' ? null : origin
  } catch {
    return null
  }
}

/** Configured origins (BETTER_AUTH_URL + TRUSTED_ORIGINS), normalised to scheme://host[:port]. */
export function configuredOrigins(env: OriginEnv): string[] {
  return [env.BETTER_AUTH_URL, ...env.TRUSTED_ORIGINS]
    .map(canonicalOrigin)
    .filter((o): o is string => o !== null)
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

function isPrivateLanIPv4(hostname: string): boolean {
  const m = IPV4.exec(hostname)
  if (!m) return false
  const [a, b, c, d] = m.slice(1).map(Number) as [number, number, number, number]
  if ([a, b, c, d].some((n) => n > 255)) return false
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}

export function isTrustedOrigin(origin: string | undefined, env: OriginEnv): boolean {
  if (typeof origin !== 'string' || origin === '') return false
  let url: URL
  try {
    url = new URL(origin)
  } catch {
    return false
  }
  // Only the exact serialized form a browser sends.
  if (url.origin !== origin) return false

  if (configuredOrigins(env).includes(origin)) return true

  if (env.NODE_ENV !== 'development') return false
  if (url.protocol !== 'http:') return false
  if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') return true
  return isPrivateLanIPv4(url.hostname) && url.port === DEV_LAN_PORT
}
