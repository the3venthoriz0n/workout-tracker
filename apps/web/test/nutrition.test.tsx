import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  AiFailedError,
  AiLimitError,
  AiUnavailableError,
  OfflineError,
  newId,
  nutritionSettingsSchema,
} from '@workout/shared'
import type { MealDraft, NutritionEntry, NutritionSettings } from '@workout/shared'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { canGoNext, canGoPrev, dateLabel, localDate, shiftDate } from '../src/lib/nutrition-date'
import { longDate } from '../src/lib/nutrition-calendar'
import { guestRepo, renderApp } from './community-helpers'

const today = localDate()
const day = (offset: number) => shiftDate(today, offset)

const draft = (name: string, calories: number, protein_g: number | null, quantity = '1'): MealDraft => ({
  name,
  quantity,
  calories,
  protein_g,
  carbs_g: null,
  fat_g: null,
  fiber_g: null,
  sugar_g: null,
  sodium_mg: null,
})

const entryOf = (over: Partial<NutritionEntry> = {}): NutritionEntry => ({
  id: newId(),
  date: today,
  name: 'Chicken burrito',
  quantity: '1 burrito',
  calories: 680,
  protein_g: 32,
  carbs_g: null,
  fat_g: null,
  fiber_g: null,
  sugar_g: null,
  sodium_mg: null,
  source: 'ai',
  user_id: 'u',
  created_at: '2026-11-16T00:00:00.000Z',
  updated_at: '2026-11-16T00:00:00.000Z',
  deleted_at: null,
  ...over,
})

/** A guest LocalRepo dressed as a signed-in repo with an in-memory nutrition store. */
async function setup(opts: { entries?: NutritionEntry[]; settings?: NutritionSettings; parse?: (text: string) => Promise<{ items: MealDraft[]; remaining_today: number }> } = {}) {
  const repo = await guestRepo('nutrition')
  const entries = [...(opts.entries ?? [])]
  let settings = opts.settings
  const baseProfile = repo.getProfile.bind(repo)
  const api = {
    getProfile: vi.fn(async () => ({ ...(await baseProfile()), ...(settings ? { nutrition: settings } : {}) })),
    updateProfile: vi.fn(async (patch: { nutrition?: unknown }) => {
      if (patch.nutrition) settings = nutritionSettingsSchema.parse(patch.nutrition)
      return api.getProfile()
    }),
    listNutrition: vi.fn(async (from: string, to: string) => entries.filter((e) => e.date >= from && e.date <= to)),
    saveNutritionEntry: vi.fn(async (input: Omit<NutritionEntry, 'id' | 'user_id' | 'created_at' | 'updated_at' | 'deleted_at'> & { id?: string }) => {
      const saved = entryOf({ ...input, id: input.id ?? newId() })
      const i = entries.findIndex((e) => e.id === saved.id)
      if (i >= 0) entries[i] = saved
      else entries.push(saved)
      return saved
    }),
    deleteNutritionEntry: vi.fn(async (id: string) => {
      const i = entries.findIndex((e) => e.id === id)
      if (i >= 0) entries.splice(i, 1)
    }),
    parseMeal: vi.fn(opts.parse ?? (async () => ({ items: [draft('Chicken burrito', 680, 32, '1 burrito'), draft('Yogurt', 150, 12, '1 cup')], remaining_today: 28 }))),
  }
  Object.assign(repo, api)
  return { repo, api, entries }
}

afterEach(() => vi.restoreAllMocks())

describe('dates', () => {
  it('shiftDate and the window: a year back to two days ahead', () => {
    expect(shiftDate('2026-11-16', -1)).toBe('2026-11-15')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(canGoPrev(shiftDate(today, -364), today)).toBe(true)
    expect(canGoPrev(shiftDate(today, -365), today)).toBe(false)
    expect(canGoNext(shiftDate(today, 1), today)).toBe(true)
    expect(canGoNext(shiftDate(today, 2), today)).toBe(false)
  })
  it('labels today, yesterday and tomorrow in words', () => {
    expect(dateLabel(today, today)).toBe('Today')
    expect(dateLabel(day(-1), today)).toBe('Yesterday')
    expect(dateLabel(day(1), today)).toBe('Tomorrow')
    expect(dateLabel(day(-5), today)).not.toBe('Today')
  })
})

describe('signed out', () => {
  it('a guest sees the sign-in prompt and no add box', async () => {
    const { repo, api } = await setup()
    renderApp(repo, '/nutrition', { signedIn: false })
    expect(await screen.findByText('Create an account to track nutrition')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Go to Settings' }).getAttribute('href')).toBe('/settings')
    expect(screen.queryByLabelText('What did you eat?')).toBeNull()
    expect(api.listNutrition).not.toHaveBeenCalled()
  })
})

describe('Track', () => {
  it('shows only tracked nutrients; a goal adds "of goal" and what is left; over a goal is said in words', async () => {
    const settings = nutritionSettingsSchema.parse({ tracked: ['calories', 'protein_g'], goals: { calories: 2400 } })
    const { repo } = await setup({ settings, entries: [entryOf(), entryOf({ id: newId(), name: 'Yogurt', calories: 150, protein_g: 12 })] })
    renderApp(repo, '/nutrition', { signedIn: true })
    expect(await screen.findByRole('group', { name: 'Calories: 830 of 2400 kcal, 1570 kcal left' })).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Protein: 44 g' })).toBeTruthy()
    expect(screen.queryByRole('group', { name: /Carbs/ })).toBeNull()
  })

  it('over the goal says how far over', async () => {
    const settings = nutritionSettingsSchema.parse({ tracked: ['calories'], goals: { calories: 2400 } })
    const { repo } = await setup({ settings, entries: [entryOf({ calories: 2600 })] })
    renderApp(repo, '/nutrition', { signedIn: true })
    expect(await screen.findByRole('group', { name: 'Calories: 2600 of 2400 kcal, 200 kcal over' })).toBeTruthy()
  })

  it('an entry without a value for a nutrient shows a dash there and is not counted in its total', async () => {
    const { repo } = await setup({ entries: [entryOf(), entryOf({ id: newId(), name: 'Toast', calories: 80, protein_g: null })] })
    renderApp(repo, '/nutrition', { signedIn: true })
    expect(await screen.findByText('80 kcal · – protein')).toBeTruthy()
    expect(screen.getByText('680 kcal · 32 g protein')).toBeTruthy()
    expect(screen.getByRole('group', { name: 'Protein: 32 g, 1 of 2 entries counted' })).toBeTruthy()
  })

  it('typing a meal and tapping Add saves what the AI returned; a double tap makes one parse', async () => {
    const user = userEvent.setup()
    let release!: (v: { items: MealDraft[]; remaining_today: number }) => void
    const { repo, api } = await setup({ parse: () => new Promise((r) => (release = r)) })
    renderApp(repo, '/nutrition', { signedIn: true })
    await user.type(await screen.findByLabelText('What did you eat?'), '1 chicken burrito, 1 yogurt')
    const add = screen.getByRole('button', { name: 'Add' })
    await user.click(add)
    await user.click(add)
    expect(api.parseMeal).toHaveBeenCalledTimes(1)
    expect(api.parseMeal).toHaveBeenCalledWith('1 chicken burrito, 1 yogurt')
    expect(add.hasAttribute('disabled') || add.getAttribute('aria-disabled') === 'true').toBe(true)
    release({ items: [draft('Chicken burrito', 680, 32, '1 burrito'), draft('Yogurt', 150, 12, '1 cup')], remaining_today: 28 })
    expect(await screen.findByText('Chicken burrito')).toBeTruthy()
    expect(screen.getByText('Yogurt')).toBeTruthy()
    expect(api.saveNutritionEntry).toHaveBeenCalledTimes(2)
    expect(api.saveNutritionEntry.mock.calls[0]![0]).toMatchObject({ date: today, name: 'Chicken burrito', source: 'ai', calories: 680, protein_g: 32 })
    expect((screen.getByLabelText('What did you eat?') as HTMLInputElement).value).toBe('')
    expect(await screen.findByText('28 AI estimates left today')).toBeTruthy()
    expect(screen.getAllByText('estimate').length).toBe(2)
  })

  it('an empty result says nothing was found and saves nothing', async () => {
    const user = userEvent.setup()
    const { repo, api } = await setup({ parse: async () => ({ items: [], remaining_today: 29 }) })
    renderApp(repo, '/nutrition', { signedIn: true })
    await user.type(await screen.findByLabelText('What did you eat?'), 'asdf')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect((await screen.findByRole('alert')).textContent).toBe('Nothing found. Try describing the food.')
    expect(api.saveNutritionEntry).not.toHaveBeenCalled()
  })

  it.each([
    ['the daily limit', () => new AiLimitError(), 'AI limit reached. Try again later.'],
    ['no provider', () => new AiUnavailableError(), "AI isn't set up yet. Check your key in Settings."],
    ['a failed read', () => new AiFailedError(), "Couldn't read that. Try describing it differently."],
    ['being offline', () => new OfflineError(), 'Needs a connection.'],
  ])('%s shows its own message and the log stays usable', async (_n, make, message) => {
    const user = userEvent.setup()
    const { repo } = await setup({
      entries: [entryOf()],
      parse: async () => {
        throw make()
      },
    })
    renderApp(repo, '/nutrition', { signedIn: true })
    await user.type(await screen.findByLabelText('What did you eat?'), 'toast')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect((await screen.findByRole('alert')).textContent).toBe(message)
    expect(screen.getByText('Chicken burrito')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete Chicken burrito' })).toBeTruthy()
  })

  it('editing an entry updates the totals and marks it as hand-edited; the estimate mark goes away', async () => {
    const user = userEvent.setup()
    const { repo, api } = await setup({ entries: [entryOf()] })
    renderApp(repo, '/nutrition', { signedIn: true })
    expect(await screen.findByText('estimate')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Edit Chicken burrito' }))
    const dialog = await screen.findByRole('dialog')
    const kcal = within(dialog).getByLabelText('Calories (kcal)')
    await user.clear(kcal)
    await user.type(kcal, '720')
    await user.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(api.saveNutritionEntry).toHaveBeenCalled())
    expect(api.saveNutritionEntry.mock.calls[0]![0]).toMatchObject({ calories: 720, source: 'manual', name: 'Chicken burrito' })
    expect(await screen.findByText('720 kcal · 32 g protein')).toBeTruthy()
    await waitFor(() => expect(screen.queryByText('estimate')).toBeNull())
  })

  it('delete asks first and then removes the entry', async () => {
    const user = userEvent.setup()
    const { repo, api } = await setup({ entries: [entryOf()] })
    renderApp(repo, '/nutrition', { signedIn: true })
    await user.click(await screen.findByRole('button', { name: 'Delete Chicken burrito' }))
    expect(api.deleteNutritionEntry).not.toHaveBeenCalled()
    const confirm = screen.getByRole('group', { name: 'Confirm delete Chicken burrito' })
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(api.deleteNutritionEntry).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByText('Chicken burrito')).toBeNull())
  })

  it('the arrows move between days and each day lists its own entries', async () => {
    const user = userEvent.setup()
    const { repo, api } = await setup({ entries: [entryOf(), entryOf({ id: newId(), date: day(-1), name: 'Last night pasta' })] })
    renderApp(repo, '/nutrition', { signedIn: true })
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy()
    expect(await screen.findByText('Chicken burrito')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Previous day' }))
    expect(await screen.findByRole('heading', { name: 'Yesterday' })).toBeTruthy()
    expect(await screen.findByText('Last night pasta')).toBeTruthy()
    expect(api.listNutrition).toHaveBeenCalledWith(day(-1), day(-1))
    await user.click(screen.getByRole('button', { name: 'Next day' }))
    expect(await screen.findByRole('heading', { name: 'Today' })).toBeTruthy()
  })

  it('a new entry goes on the day being viewed', async () => {
    const user = userEvent.setup()
    const { repo, api } = await setup({ parse: async () => ({ items: [draft('Pasta', 600, 20)], remaining_today: 20 }) })
    renderApp(repo, '/nutrition', { signedIn: true })
    await user.click(await screen.findByRole('button', { name: 'Previous day' }))
    await user.type(await screen.findByLabelText('What did you eat?'), 'pasta')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(api.saveNutritionEntry).toHaveBeenCalled())
    expect(api.saveNutritionEntry.mock.calls[0]![0]).toMatchObject({ date: day(-1), name: 'Pasta' })
  })
})

describe('Goals', () => {
  it('is a second tab, with one row per nutrient: calories and protein on by default', async () => {
    const user = userEvent.setup()
    const { repo } = await setup()
    renderApp(repo, '/nutrition', { signedIn: true })
    await user.click(await screen.findByRole('tab', { name: 'Goals' }))
    expect(screen.getByRole('tab', { name: 'Goals' }).getAttribute('aria-selected')).toBe('true')
    for (const [label, on] of [['Calories', true], ['Protein', true], ['Carbs', false], ['Fat', false], ['Fiber', false], ['Sugar', false], ['Sodium', false]] as const) {
      expect(screen.getByRole('switch', { name: `Track ${label}` }).getAttribute('aria-checked'), label).toBe(String(on))
    }
    expect(screen.getByLabelText('Calories goal (kcal)')).toBeTruthy()
    expect(screen.queryByLabelText('Carbs goal (g)')).toBeNull()
  })

  it('turning a nutrient on shows its goal field and saves; at least one stays on', async () => {
    const user = userEvent.setup()
    const { repo, api } = await setup({ settings: nutritionSettingsSchema.parse({ tracked: ['calories'], goals: {} }) })
    renderApp(repo, '/nutrition?section=goals', { signedIn: true })
    expect(((await screen.findByRole('switch', { name: 'Track Calories' })) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('Keep at least one nutrient on.')).toBeTruthy()
    await user.click(screen.getByRole('switch', { name: 'Track Carbs' }))
    await waitFor(() => expect(api.updateProfile).toHaveBeenCalled())
    expect(api.updateProfile.mock.calls.at(-1)![0]).toEqual({ nutrition: { tracked: ['calories', 'carbs_g'], goals: {} } })
    expect(await screen.findByLabelText('Carbs goal (g)')).toBeTruthy()
  })

  it('a goal saves when typed, a blank clears it and an impossible one is refused', async () => {
    const user = userEvent.setup()
    const { repo, api } = await setup()
    renderApp(repo, '/nutrition?section=goals', { signedIn: true })
    const goal = await screen.findByLabelText('Calories goal (kcal)')
    await user.type(goal, '2400{Enter}')
    await waitFor(() => expect(api.updateProfile.mock.calls.at(-1)![0]).toEqual({ nutrition: { tracked: ['calories', 'protein_g'], goals: { calories: 2400 } } }))
    await user.clear(goal)
    await user.type(goal, '0{Enter}')
    await waitFor(() => expect((goal as HTMLInputElement).value).toBe('2400'))
    await user.clear(goal)
    await user.tab()
    await waitFor(() => expect(api.updateProfile.mock.calls.at(-1)![0]).toEqual({ nutrition: { tracked: ['calories', 'protein_g'], goals: {} } }))
  })

  it('turning a nutrient off hides it in Track but keeps what was stored', async () => {
    const user = userEvent.setup()
    const { repo, entries } = await setup({ entries: [entryOf()] })
    renderApp(repo, '/nutrition?section=goals', { signedIn: true })
    await user.click(await screen.findByRole('switch', { name: 'Track Protein' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Track Protein' }).getAttribute('aria-checked')).toBe('false'))
    await user.click(screen.getByRole('tab', { name: 'Track' }))
    expect(await screen.findByText('680 kcal')).toBeTruthy()
    expect(screen.queryByRole('group', { name: /Protein/ })).toBeNull()
    expect(screen.queryByText(/protein/)).toBeNull()
    expect(entries[0]!.protein_g).toBe(32)
  })
})

describe('review fixes', () => {
  it('a failed save keeps the estimates: retrying saves only what failed, under the same id, without another parse', async () => {
    const user = userEvent.setup()
    const { repo, api } = await setup({ parse: async () => ({ items: [draft('Alpha', 1, 1), draft('Bravo', 2, 2), draft('Charlie', 3, 3)], remaining_today: 20 }) })
    const real = api.saveNutritionEntry.getMockImplementation()!
    let blip = true
    api.saveNutritionEntry.mockImplementation(async (input) => {
      if (input.name === 'Charlie' && blip) {
        blip = false
        throw new Error('blip')
      }
      return real(input)
    })
    renderApp(repo, '/nutrition', { signedIn: true })
    await user.type(await screen.findByLabelText('What did you eat?'), 'three things')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect((await screen.findByRole('alert')).textContent).toBe("Couldn't save the estimates. Try again.")
    const firstId = api.saveNutritionEntry.mock.calls.find((c) => c[0].name === 'Charlie')![0].id
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('Charlie')).toBeTruthy()
    expect(api.parseMeal).toHaveBeenCalledTimes(1)
    expect(api.saveNutritionEntry).toHaveBeenCalledTimes(4)
    expect(api.saveNutritionEntry.mock.calls.filter((c) => c[0].name === 'Charlie').map((c) => c[0].id)).toEqual([firstId, firstId])
    expect(screen.getAllByText('Alpha')).toHaveLength(1)
    expect((screen.getByLabelText('What did you eat?') as HTMLInputElement).value).toBe('')
  })

  it('clicking outside the edit sheet closes it and does not reopen it', async () => {
    const user = userEvent.setup({ pointerEventsCheck: 0 })
    const { repo } = await setup({ entries: [entryOf()] })
    renderApp(repo, '/nutrition', { signedIn: true })
    await user.click(await screen.findByRole('button', { name: 'Edit Chicken burrito' }))
    await screen.findByRole('dialog')
    await user.click(document.querySelector('[data-slot="sheet-overlay"]') as HTMLElement)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await new Promise((r) => setTimeout(r, 80))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('quick successive goal changes do not lose an update', async () => {
    const user = userEvent.setup()
    const { repo, api } = await setup()
    const real = api.updateProfile.getMockImplementation()!
    api.updateProfile.mockImplementation(async (patch) => {
      await new Promise((r) => setTimeout(r, 60))
      return real(patch)
    })
    renderApp(repo, '/nutrition?section=goals', { signedIn: true })
    await user.click(await screen.findByRole('switch', { name: 'Track Carbs' }))
    await user.click(screen.getByRole('switch', { name: 'Track Fat' }))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Track Carbs' }).getAttribute('aria-checked')).toBe('true'))
    await waitFor(() => expect(screen.getByRole('switch', { name: 'Track Fat' }).getAttribute('aria-checked')).toBe('true'))
    expect(api.updateProfile.mock.calls.at(-1)![0]).toEqual({ nutrition: { tracked: ['calories', 'protein_g', 'carbs_g', 'fat_g'], goals: {} } })
  })

  it.each([['Track', '/nutrition'], ['Goals', '/nutrition?section=goals']])('%s shows a retry when the profile cannot be loaded', async (_n, path) => {
    const { repo, api } = await setup()
    api.getProfile.mockRejectedValue(new Error('down'))
    renderApp(repo, path, { signedIn: true })
    expect((await screen.findByRole('alert')).textContent).toMatch(/Couldn't load/)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
  })

  it('a logged food is announced with its estimate mark and its numbers', async () => {
    const { repo } = await setup({ entries: [entryOf()] })
    renderApp(repo, '/nutrition', { signedIn: true })
    expect(await screen.findByRole('button', { name: /Chicken burrito.*estimate.*680 kcal · 32 g protein/ })).toBeTruthy()
  })
})

describe('Calendar', () => {
  it('opens on the month of the day you are on, marks days with food, jumps to one and back to today', async () => {
    const user = userEvent.setup()
    const target = day(-40)
    const { repo } = await setup({ entries: [entryOf({ date: target, name: 'Old lunch' })] })
    renderApp(repo, '/nutrition', { signedIn: true })

    await user.click(await screen.findByRole('button', { name: 'Choose a day' }))
    const dialog = await screen.findByRole('dialog', { name: 'Jump to a day' })
    // Today is in view and named as such; nothing but the pressed day is selected
    expect(within(dialog).getByRole('button', { name: new RegExp(`${longDate(today)}, today`) }).getAttribute('aria-pressed')).toBe('true')

    // Walk back until the old day is on screen (it is one or two months away)
    const name = (d: string) => new RegExp(`^${longDate(d)}`)
    for (let i = 0; i < 3 && !within(dialog).queryByRole('button', { name: name(target) }); i++) {
      await user.click(within(dialog).getByRole('button', { name: 'Previous month' }))
    }
    const cell = await within(dialog).findByRole('button', { name: name(target) })
    await waitFor(() => expect(cell.getAttribute('aria-label')).toMatch(/food logged/)) // the marked day says so in words
    expect(within(dialog).getByRole('button', { name: name(day(-39)) }).getAttribute('aria-label')).not.toMatch(/food logged/)

    await user.click(cell)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('heading', { name: dateLabel(target, today) })).toBeTruthy()
    expect(await screen.findByText('Old lunch')).toBeTruthy()

    // Reopen: the day you chose is the selected one, and there is a way straight back to today
    await user.click(screen.getByRole('button', { name: 'Choose a day' }))
    const again = await screen.findByRole('dialog', { name: 'Jump to a day' })
    expect(within(again).getByRole('button', { name: name(target) }).getAttribute('aria-pressed')).toBe('true')
    await user.click(within(again).getByRole('button', { name: 'Go to today' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy()
  })

  it('days outside the log window cannot be picked, and the calendar stops at a year back', async () => {
    const user = userEvent.setup()
    const { repo } = await setup()
    renderApp(repo, '/nutrition', { signedIn: true })
    await user.click(await screen.findByRole('button', { name: 'Choose a day' }))
    const dialog = await screen.findByRole('dialog', { name: 'Jump to a day' })
    // Walk back to the oldest month: the last step is refused
    for (let i = 0; i < 14; i++) {
      const prev = within(dialog).getByRole('button', { name: 'Previous month' })
      if ((prev as HTMLButtonElement).disabled) break
      await user.click(prev)
    }
    expect((within(dialog).getByRole('button', { name: 'Previous month' }) as HTMLButtonElement).disabled).toBe(true)
    const oldest = shiftDate(today, -366)
    const before = within(dialog).queryByRole('button', { name: new RegExp(`^${longDate(oldest)}`) })
    if (before) expect((before as HTMLButtonElement).disabled).toBe(true)
  })

  it('arrow keys move between days; Escape closes without changing the day', async () => {
    const user = userEvent.setup()
    const { repo } = await setup()
    renderApp(repo, '/nutrition', { signedIn: true })
    await user.click(await screen.findByRole('button', { name: 'Choose a day' }))
    const dialog = await screen.findByRole('dialog', { name: 'Jump to a day' })
    const here = within(dialog).getByRole('button', { name: new RegExp(`^${longDate(today)}`) })
    here.focus()
    await user.keyboard('{ArrowLeft}')
    const yesterday = shiftDate(today, -1)
    if (yesterday.slice(0, 7) === today.slice(0, 7)) {
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: new RegExp(`^${longDate(yesterday)}`) }))
    }
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy()
  })
})
