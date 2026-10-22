import { expect, test } from 'vitest'
import { isHttpUrl } from '../src/lib/links'

test.each([
  ['javascript:alert(1)', false],
  ['data:text/html,<b>x</b>', false],
  ['ftp://x.y', false],
  ['', false],
  ['https://x.y', true],
  ['http://x.y', true],
])('isHttpUrl(%j) is %s', (url, expected) => expect(isHttpUrl(url)).toBe(expected))
