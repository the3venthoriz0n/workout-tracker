import { describe, expect, it } from 'vitest'
import { AppDb } from '../src/repo/db'
import { LocalRepo } from '../src/repo/local-repo'

async function setup() {
  const repo = new LocalRepo(new AppDb(crypto.randomUUID()))
  await repo.init()
  return repo
}

describe('LocalRepo library', () => {
  it('init is idempotent, also when called concurrently', async () => {
    const db = new AppDb(crypto.randomUUID())
    const repo = new LocalRepo(db)
    await Promise.all([repo.init(), repo.init()])
    await repo.init()
    expect(await db.profile.count()).toBe(1)
    expect(await repo.listGear()).toHaveLength(8)
    const gearNames = (await repo.listGear()).map((g) => g.name)
    expect(gearNames).toEqual([...gearNames].sort((a, b) => a.localeCompare(b)))
    expect(await repo.listExercises()).toHaveLength(16)
    expect(await repo.getProfile()).toMatchObject({ plan: 'free', units: 'lb', weight_increment: 5 })
  })

  it('lists exercises sorted by name', async () => {
    const repo = await setup()
    const names = (await repo.listExercises()).map((e) => e.name)
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)))
  })

  it('saveExercise creates, then updates and bumps updated_at', async () => {
    const repo = await setup()
    const profile = await repo.getProfile()
    const input = {
      name: 'Curl',
      notes: '',
      video_url: null,
      required_gear_ids: [],
      active: true,
      default_sets: 3,
      default_reps: 10,
      default_weight: 20,
    }
    const created = await repo.saveExercise(input)
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(created.user_id).toBe(profile.user_id)
    await new Promise((r) => setTimeout(r, 5))
    const updated = await repo.saveExercise({ ...input, id: created.id, name: 'Hammer Curl' })
    expect(updated.id).toBe(created.id)
    expect(updated.name).toBe('Hammer Curl')
    expect(updated.created_at).toBe(created.created_at)
    expect(updated.updated_at > created.updated_at).toBe(true)
    expect(await repo.listExercises()).toHaveLength(17)
  })

  it('saveExercise rejects a non-http video_url', async () => {
    const repo = await setup()
    await expect(
      repo.saveExercise({
        name: 'X',
        notes: '',
        video_url: 'javascript:x',
        required_gear_ids: [],
        active: true,
        default_sets: 3,
        default_reps: 5,
        default_weight: 0,
      }),
    ).rejects.toThrow()
  })

  it('saveGear persists owned changes', async () => {
    const repo = await setup()
    const [gear] = await repo.listGear()
    await repo.saveGear({ id: gear!.id, name: gear!.name, owned: false })
    expect((await repo.listGear()).find((g) => g.id === gear!.id)?.owned).toBe(false)
    const added = await repo.saveGear({ name: 'Sled', owned: true })
    expect(await repo.listGear()).toHaveLength(9)
    expect(added.id).toBeTruthy()
  })

  it('deleteExercise removes an unused exercise', async () => {
    const repo = await setup()
    const [first] = await repo.listExercises()
    await repo.deleteExercise(first!.id)
    const rest = await repo.listExercises()
    expect(rest).toHaveLength(15)
    expect(rest.some((e) => e.id === first!.id)).toBe(false)
  })
})
