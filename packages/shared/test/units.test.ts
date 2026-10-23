import { describe, expect, it } from 'vitest'
import { DEFAULT_INCREMENT, convertWeight, parseReps, parseWeight, roundToIncrement } from '../src/index.js'

describe('roundToIncrement', () => {
  it('rounds to the nearest multiple, never below 0, float-safe', () => {
    expect(roundToIncrement(137.4, 5)).toBe(135)
    expect(roundToIncrement(61.3, 2.5)).toBe(62.5)
    expect(roundToIncrement(-3, 5)).toBe(0)
    expect(roundToIncrement(0.3 * 3, 0.1)).toBe(0.9)
  })
})
describe('convertWeight', () => {
  it('converts and rounds to 0.1', () => {
    expect(convertWeight(135, 'lb', 'kg')).toBe(61.2)
    expect(convertWeight(60, 'kg', 'lb')).toBe(132.3)
    expect(convertWeight(100, 'kg', 'kg')).toBe(100)
  })
})
describe('parsing', () => {
  it('parses weights', () => {
    expect(parseWeight('62.5')).toBe(62.5)
    expect(parseWeight('62,5')).toBe(62.5)
    expect(parseWeight(' 62.5 ')).toBe(62.5)
    expect(parseWeight('')).toBeNull()
    expect(parseWeight('abc')).toBeUndefined()
    expect(parseWeight('-5')).toBeUndefined()
  })
  it('parses reps', () => {
    expect(parseReps('8')).toBe(8)
    expect(parseReps('0')).toBe(0)
    expect(parseReps('8.5')).toBeUndefined()
    expect(parseReps('')).toBeNull()
  })
  it('has default increments', () => {
    expect(DEFAULT_INCREMENT).toEqual({ lb: 5, kg: 2.5 })
  })
})

describe('convertWeight cap', () => {
  it('clamps to 100000 so a conversion cannot leave the valid range', () => {
    expect(convertWeight(100000, 'kg', 'lb')).toBe(100000)
    expect(convertWeight(60000, 'kg', 'lb')).toBe(100000)
  })
})
