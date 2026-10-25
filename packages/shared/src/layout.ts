// Session set order (spec §6 "Supersets"): computed once at session start and snapshotted onto
// each set_log as `seq`, `superset_group` and `superset_label`, so Today and History never need
// the plan to render it.

export type LayoutItem = { id: string; position: number; sets: number; superset_group: string | null }
export type LayoutSet = {
  plan_item_id: string
  set_no: number
  seq: number
  superset_group: string | null
  superset_label: string | null
}

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/**
 * Normal items keep per-item order (all sets of one item, then the next). The members of a
 * superset are pulled together at the first member's position and interleaved round by round
 * (A1 set 1, A2 set 1, A1 set 2, ...); a member with more sets carries on alone. Groups are
 * lettered A, B, ... in day order and members numbered by position. A group with fewer than two
 * members here is treated as normal items.
 */
export function planSessionSets(items: LayoutItem[]): LayoutSet[] {
  const sorted = [...items].sort((a, b) => a.position - b.position)
  const members = new Map<string, LayoutItem[]>()
  for (const item of sorted) {
    if (item.superset_group === null) continue
    const list = members.get(item.superset_group)
    if (list) list.push(item)
    else members.set(item.superset_group, [item])
  }
  const out: LayoutSet[] = []
  const placed = new Set<string>()
  let groupNo = 0
  const push = (item: LayoutItem, set_no: number, group: string | null, label: string | null) =>
    out.push({ plan_item_id: item.id, set_no, seq: out.length, superset_group: group, superset_label: label })

  for (const item of sorted) {
    if (placed.has(item.id)) continue
    const group = item.superset_group === null ? undefined : members.get(item.superset_group)
    if (!group || group.length < 2) {
      placed.add(item.id)
      for (let n = 1; n <= item.sets; n++) push(item, n, null, null)
      continue
    }
    const letter = LETTERS[groupNo % LETTERS.length]
    groupNo++
    const rounds = Math.max(...group.map((m) => m.sets))
    for (let n = 1; n <= rounds; n++) {
      group.forEach((m, i) => {
        if (n <= m.sets) push(m, n, item.superset_group, `${letter}${i + 1}`)
      })
    }
    for (const m of group) placed.add(m.id)
  }
  return out
}

/** Display order of set logs: `seq` when both have it, else (position, set_no) for older sessions. */
export function compareSetLogs(
  a: { seq: number | null; position: number; set_no: number },
  b: { seq: number | null; position: number; set_no: number },
): number {
  if (a.seq !== null && b.seq !== null) return a.seq - b.seq
  return a.position - b.position || a.set_no - b.set_no
}
