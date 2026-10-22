import { expect, test } from 'vitest'
import { formatDate, formatWeight, pluralize } from '../src/lib/format'

test('formatWeight drops trailing zeros and float noise', () => {
  expect(formatWeight(62.5)).toBe('62.5')
  expect(formatWeight(135)).toBe('135')
  expect(formatWeight(0.1 + 0.2)).toBe('0.3')
  expect(formatWeight(61.2)).toBe('61.2')
})

test('pluralize', () => {
  expect(pluralize(1, 'set')).toBe('1 set')
  expect(pluralize(3, 'set')).toBe('3 sets')
  expect(pluralize(0, 'set')).toBe('0 sets')
  expect(pluralize(2, 'child', 'children')).toBe('2 children')
})

test('formatDate includes the year', () => {
  expect(formatDate('2026-10-22T12:00:00.000Z')).toMatch(/2026/)
})
