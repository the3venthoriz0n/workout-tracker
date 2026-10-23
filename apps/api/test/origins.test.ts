import { describe, expect, it } from 'vitest'
import { isTrustedOrigin, type OriginEnv } from '../src/origins.js'

function envOf(nodeEnv: OriginEnv['NODE_ENV'], extra: string[] = []): OriginEnv {
  return {
    NODE_ENV: nodeEnv,
    BETTER_AUTH_URL: nodeEnv === 'production' ? 'https://app.example.com' : 'http://localhost:3000',
    TRUSTED_ORIGINS: extra,
  }
}

const prod = envOf('production', ['https://other.example.org'])
const dev = envOf('development', ['https://other.example.org'])
const test = envOf('test')

describe('isTrustedOrigin: always', () => {
  for (const [name, env] of [
    ['production', prod],
    ['development', dev],
    ['test', test],
  ] as const) {
    it(`${name}: rejects missing, empty, null and junk`, () => {
      for (const o of [undefined, '', 'null', 'NULL', ' ', 'undefined', '*', 'about:blank', 'file://', 'app.example.com']) {
        expect(isTrustedOrigin(o, env), String(o)).toBe(false)
      }
    })

    it(`${name}: rejects look-alike, userinfo, trailing-slash, path and case variants of the base origin`, () => {
      const base = env.BETTER_AUTH_URL
      const u = new URL(base)
      for (const o of [
        `${base}/`,
        `${base}/path`,
        `${base}?x=1`,
        `${base}#frag`,
        `${u.protocol}//${u.host.toUpperCase()}`,
        `${u.protocol}//evil@${u.host}`,
        `${u.protocol}//${u.host}@evil.example`,
        `${u.protocol}//${u.host}.evil.example`,
        `${u.protocol}//evil.${u.host}`,
        `${u.protocol}//${u.host}\\@evil.example`,
        `${u.protocol}//${u.host} `,
        ` ${u.protocol}//${u.host}`,
        `${u.protocol}//${u.host}, https://evil.example`,
        `javascript://${u.host}`,
      ]) {
        expect(isTrustedOrigin(o, env), o).toBe(false)
      }
    })

    it(`${name}: accepts the exact base origin`, () => {
      expect(isTrustedOrigin(env.BETTER_AUTH_URL, env)).toBe(true)
    })

    it(`${name}: accepts exactly the extra TRUSTED_ORIGINS, not their look-alikes`, () => {
      expect(isTrustedOrigin('https://other.example.org', env)).toBe(env.TRUSTED_ORIGINS.length > 0)
      expect(isTrustedOrigin('https://other.example.org.evil.example', env)).toBe(false)
      expect(isTrustedOrigin('http://other.example.org', env)).toBe(false)
      expect(isTrustedOrigin('https://other.example.org:8443', env)).toBe(false)
    })
  }
})

describe('isTrustedOrigin: production and test have no development allowances', () => {
  for (const [name, env] of [
    ['production', prod],
    ['test', test],
  ] as const) {
    it(`${name}: localhost, loopback and LAN origins are rejected`, () => {
      for (const o of [
        'http://localhost:5173',
        'http://localhost:3001',
        'http://localhost',
        'http://127.0.0.1:5173',
        'http://10.0.0.5:5173',
        'http://172.16.0.1:5173',
        'http://172.31.255.255:5173',
        'http://192.168.1.20:5173',
      ]) {
        // test env's own base origin is http://localhost:3000, which is allowed exactly
        expect(isTrustedOrigin(o, env), o).toBe(false)
      }
    })
  }

  it('test: only the exact configured base origin of localhost is allowed', () => {
    expect(isTrustedOrigin('http://localhost:3000', test)).toBe(true)
    expect(isTrustedOrigin('http://localhost:3001', test)).toBe(false)
  })
})

describe('isTrustedOrigin: development', () => {
  it('accepts localhost and 127.0.0.1 on any port, over http', () => {
    for (const o of [
      'http://localhost:5173',
      'http://localhost:3000',
      'http://localhost:8080',
      'http://localhost',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:1',
      'http://127.0.0.1',
    ]) {
      expect(isTrustedOrigin(o, dev), o).toBe(true)
    }
  })

  it('rejects https localhost and look-alike hosts', () => {
    for (const o of [
      'https://localhost:5173',
      'http://localhost.evil.com',
      'http://localhost.evil.com:5173',
      'http://evil-localhost:5173',
      'http://localhost@evil.com',
      'http://localhost:5173@evil.com',
      'http://evil.com@localhost:5173',
      'http://localhost:abc',
      'http://localhost:99999',
      'http://127.0.0.1.evil.com:5173',
      'http://127.0.0.2:5173',
      'http://0.0.0.0:5173',
      'http://[::1]:5173',
      'http://localhost:5173/',
      'HTTP://LOCALHOST:5173',
      'http://LOCALHOST:5173',
    ]) {
      expect(isTrustedOrigin(o, dev), o).toBe(false)
    }
  })

  it('accepts private-network origins over http on port 5173 only', () => {
    for (const o of [
      'http://10.0.0.1:5173',
      'http://10.255.255.255:5173',
      'http://172.16.0.1:5173',
      'http://172.20.10.5:5173',
      'http://172.31.255.254:5173',
      'http://192.168.0.1:5173',
      'http://192.168.255.255:5173',
    ]) {
      expect(isTrustedOrigin(o, dev), o).toBe(true)
    }
  })

  it('rejects private-network origins on other ports, without a port, or over https', () => {
    for (const o of [
      'http://10.0.0.1',
      'http://10.0.0.1:80',
      'http://10.0.0.1:3000',
      'http://10.0.0.1:51730',
      'http://10.0.0.1:517',
      'https://10.0.0.1:5173',
      'http://192.168.1.1:5174',
    ]) {
      expect(isTrustedOrigin(o, dev), o).toBe(false)
    }
  })

  it('rejects public addresses, out-of-range private blocks and look-alike hosts', () => {
    for (const o of [
      'http://10.0.0.1.evil.com:5173',
      'http://10.0.0.1.evil.com',
      'http://evil.com:5173',
      'http://11.0.0.1:5173',
      'http://9.255.255.255:5173',
      'http://172.15.0.1:5173',
      'http://172.32.0.1:5173',
      'http://172.160.0.1:5173',
      'http://192.167.1.1:5173',
      'http://192.169.1.1:5173',
      'http://193.168.1.1:5173',
      'http://1.10.0.1:5173',
      'http://10.0.0.256:5173',
      'http://10.0.0:5173',
      'http://10.0.0.1.1:5173',
      'http://010.0.0.1:5173',
      'http://0xA.0.0.1:5173',
      'http://167772161:5173',
      'http://10.0.0.1@evil.com:5173',
      'http://evil.com@10.0.0.1:5173',
      'http://10.0.0.1:5173@evil.com',
      'http://10.0.0.1:5173/',
      'http://10.0.0.1:5173/x',
      'http://[::ffff:10.0.0.1]:5173',
      'http://169.254.1.1:5173',
      'http://100.64.0.1:5173',
    ]) {
      expect(isTrustedOrigin(o, dev), o).toBe(false)
    }
  })

  it('still honours the configured origins', () => {
    expect(isTrustedOrigin('https://other.example.org', dev)).toBe(true)
    expect(isTrustedOrigin('http://localhost:3000', dev)).toBe(true)
  })
})

describe('isTrustedOrigin: production policy', () => {
  it('is exactly BETTER_AUTH_URL plus TRUSTED_ORIGINS', () => {
    expect(isTrustedOrigin('https://app.example.com', prod)).toBe(true)
    expect(isTrustedOrigin('https://other.example.org', prod)).toBe(true)
    expect(isTrustedOrigin('https://evil.example', prod)).toBe(false)
    expect(isTrustedOrigin('http://app.example.com', prod)).toBe(false)
    expect(isTrustedOrigin('https://www.app.example.com', prod)).toBe(false)
    expect(isTrustedOrigin('https://app.example.com:443', prod)).toBe(false)
  })

  it('normalises configured values that carry a path or trailing slash', () => {
    const env: OriginEnv = {
      NODE_ENV: 'production',
      BETTER_AUTH_URL: 'https://app.example.com/',
      TRUSTED_ORIGINS: ['https://x.example.com/some/path'],
    }
    expect(isTrustedOrigin('https://app.example.com', env)).toBe(true)
    expect(isTrustedOrigin('https://x.example.com', env)).toBe(true)
  })

  it('never treats wildcard characters as patterns', () => {
    expect(isTrustedOrigin('https://*.example.com', prod)).toBe(false)
    expect(isTrustedOrigin('https://anything.example.com', prod)).toBe(false)
  })
})
