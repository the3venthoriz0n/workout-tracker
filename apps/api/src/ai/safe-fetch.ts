// A user-supplied AI address makes the server call out, so it must never reach the server's own network:
// https only, no credentials or custom port, and every address the host resolves to must be public.
// Redirects are refused. (A host that changes its answer between this check and the request is not
// covered; the request itself still goes only to the name that passed.)
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

export class UnsafeUrlError extends Error {}

function privateV4(ip: string): boolean {
  const [a = 0, b = 0] = ip.split('.').map(Number)
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

/** The 16 bytes of an IPv6 address (any spelling, including a dotted IPv4 tail), or null if it is not one. */
function v6Bytes(text: string): number[] | null {
  if (isIP(text) !== 6) return null
  let t = text.split('%')[0]!
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(t)
  if (tail) {
    const o = tail[1]!.split('.').map(Number)
    t = t.slice(0, -tail[1]!.length) + ((o[0]! << 8) | o[1]!).toString(16) + ':' + ((o[2]! << 8) | o[3]!).toString(16)
  }
  const [head = '', rest] = t.split('::')
  const h = head ? head.split(':') : []
  const r = rest === undefined ? [] : rest ? rest.split(':') : []
  const groups = rest === undefined ? h : [...h, ...Array<string>(8 - h.length - r.length).fill('0'), ...r]
  if (groups.length !== 8) return null
  return groups.flatMap((g) => [parseInt(g, 16) >> 8, parseInt(g, 16) & 0xff])
}

export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^\[|\]$/g, '')
  if (isIP(v) === 4) return privateV4(v)
  const b = v6Bytes(v)
  if (!b) return true // anything that is not a clean address is refused
  const v4 = (at: number) => privateV4(b.slice(at, at + 4).join('.'))
  const zero = (to: number) => b.slice(0, to).every((x) => x === 0)
  if (zero(10) && b[10] === 0xff && b[11] === 0xff) return v4(12) // ::ffff:a.b.c.d (IPv4-mapped), however spelled
  // Default deny: only global unicast (2000::/3) can be public. That leaves out ::, ::1, IPv4-compatible and
  // IPv4-translated (::ffff:0:a.b.c.d), NAT64 (64:ff9b::/96 and 64:ff9b:1::/48), unique-local, link-local and multicast.
  if ((b[0]! & 0xe0) !== 0x20) return true
  if (b[0] === 0x20 && b[1] === 0x02) return v4(2) // 6to4 2002::/16 embeds an IPv4 address
  if (b[0] === 0x20 && b[1] === 0x01 && (b[2] === 0 || (b[2] === 0x0d && b[3] === 0xb8))) return true // Teredo 2001::/32, documentation 2001:db8::/32
  return false
}

export async function assertPublicUrl(raw: string): Promise<void> {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    throw new UnsafeUrlError('Not a valid address')
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) throw new UnsafeUrlError('Use a plain https address')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
    throw new UnsafeUrlError('That address is not public')
  }
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address)
  if (addrs.length === 0 || addrs.some(isPrivateAddress)) throw new UnsafeUrlError('That address is not public')
}

export const safeFetch: typeof fetch = async (input, init) => {
  await assertPublicUrl(input instanceof Request ? input.url : String(input))
  return fetch(input, { ...init, redirect: 'error' })
}
