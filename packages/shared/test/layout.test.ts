import { describe, expect, it } from 'vitest'
import { compareSetLogs, planSessionSets } from '../src/layout.js'

const G = '11111111-1111-4111-8111-111111111111'
const H = '22222222-2222-4222-8222-222222222222'
const item = (id: string, position: number, sets: number, superset_group: string | null = null) => ({
  id,
  position,
  sets,
  superset_group,
})
const order = (rows: ReturnType<typeof planSessionSets>) =>
  [...rows].sort((a, b) => a.seq - b.seq).map((r) => `${r.plan_item_id}${r.set_no}`)

describe('planSessionSets', () => {
  it('keeps per-item order without supersets', () => {
    const rows = planSessionSets([item('b', 1, 2), item('a', 0, 2)])
    expect(order(rows)).toEqual(['a1', 'a2', 'b1', 'b2'])
    expect(rows.every((r) => r.superset_group === null && r.superset_label === null)).toBe(true)
    expect(rows.map((r) => r.seq).sort((x, y) => x - y)).toEqual([0, 1, 2, 3])
  })

  it('interleaves superset members and continues the longer one', () => {
    const rows = planSessionSets([item('x', 0, 1), item('a', 1, 3, G), item('b', 2, 2, G), item('y', 3, 1)])
    expect(order(rows)).toEqual(['x1', 'a1', 'b1', 'a2', 'b2', 'a3', 'y1'])
    const label = (id: string) => rows.find((r) => r.plan_item_id === id)?.superset_label
    expect([label('a'), label('b'), label('x')]).toEqual(['A1', 'A2', null])
    expect(rows.filter((r) => r.superset_group === G)).toHaveLength(5)
  })

  it('pulls non-adjacent members to the first member and letters groups by order', () => {
    const rows = planSessionSets([
      item('a', 0, 2, G),
      item('m', 1, 1),
      item('c', 2, 1, H),
      item('b', 3, 2, G),
      item('d', 4, 1, H),
      item('e', 5, 1, H),
    ])
    expect(order(rows)).toEqual(['a1', 'b1', 'a2', 'b2', 'm1', 'c1', 'd1', 'e1'])
    const label = (id: string) => rows.find((r) => r.plan_item_id === id)?.superset_label
    expect(['a', 'b', 'c', 'd', 'e'].map(label)).toEqual(['A1', 'A2', 'B1', 'B2', 'B3'])
  })

  it('treats a group with a single member as a normal item', () => {
    const rows = planSessionSets([item('a', 0, 2, G), item('b', 1, 1)])
    expect(order(rows)).toEqual(['a1', 'a2', 'b1'])
    expect(rows.every((r) => r.superset_group === null && r.superset_label === null)).toBe(true)
  })
})

describe('compareSetLogs', () => {
  it('orders by seq when both have one, else by position then set_no', () => {
    const s = (position: number, set_no: number, seq: number | null) => ({ position, set_no, seq })
    expect([s(1, 1, 1), s(0, 2, 2), s(0, 1, 0)].sort(compareSetLogs)).toEqual([s(0, 1, 0), s(1, 1, 1), s(0, 2, 2)])
    expect([s(1, 1, null), s(0, 2, null), s(0, 1, null)].sort(compareSetLogs)).toEqual([
      s(0, 1, null),
      s(0, 2, null),
      s(1, 1, null),
    ])
  })
})
