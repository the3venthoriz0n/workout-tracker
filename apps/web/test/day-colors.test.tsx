import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test } from 'vitest'
import { freshRepo, renderAt } from './helpers'

async function twoDays() {
  const { repo, byName } = await freshRepo('colors')
  const plan = await repo.savePlan({ name: 'PPL' })
  const push = await repo.savePlanDay({ plan_id: plan.id, name: 'Push' })
  const pull = await repo.savePlanDay({ plan_id: plan.id, name: 'Pull' })
  await repo.addPlanItem(push.id, byName('Bench Press').id)
  await repo.addPlanItem(pull.id, byName('Barbell Row').id)
  return { repo, plan, push, pull }
}

const barOf = (el: HTMLElement) => el.querySelector('[data-day-color]')?.getAttribute('data-day-color')

test('plan detail: days without a colour derive one from their position', async () => {
  const { repo, plan } = await twoDays()
  renderAt(repo, `/plans/${plan.id}`)
  const push = await screen.findByRole('region', { name: 'Day Push' })
  const pull = screen.getByRole('region', { name: 'Day Pull' })
  expect(barOf(push)).toBe('blue')
  expect(barOf(pull)).toBe('red')
})

test('plan detail: the swatch picker saves a named colour and Automatic goes back to null', async () => {
  const user = userEvent.setup()
  const { repo, plan, push } = await twoDays()
  renderAt(repo, `/plans/${plan.id}`)
  const region = await screen.findByRole('region', { name: 'Day Push' })
  await user.click(within(region).getByRole('button', { name: 'Colour for Push: Blue' }))
  const group = within(region).getByRole('radiogroup', { name: 'Colour for Push' })
  const radios = within(group).getAllByRole('radio')
  expect(radios.map((r) => r.getAttribute('aria-label'))).toEqual([
    'Automatic (Blue)',
    'Blue',
    'Red',
    'Green',
    'Amber',
    'Violet',
    'Teal',
    'Pink',
    'Slate',
  ])
  expect((within(group).getByRole('radio', { name: 'Automatic (Blue)' }) as HTMLInputElement).checked).toBe(true)

  await user.click(within(group).getByRole('radio', { name: 'Green' }))
  await waitFor(async () => expect((await repo.getPlan(plan.id))!.days.find((d) => d.id === push.id)!.color).toBe('green'))
  await waitFor(() => expect(barOf(screen.getByRole('region', { name: 'Day Push' }))).toBe('green'))
  // The day name is still shown: colour is never the only signal
  expect((within(region).getByLabelText('Day name') as HTMLInputElement).value).toBe('Push')

  await user.click(within(region).getByRole('radio', { name: 'Automatic (Blue)' }))
  await waitFor(async () => expect((await repo.getPlan(plan.id))!.days.find((d) => d.id === push.id)!.color).toBeNull())
})

test('Today: the day chooser shows each day with its colour, and the active header carries it', async () => {
  const user = userEvent.setup()
  const { repo, plan, pull } = await twoDays()
  await repo.savePlanDay({ id: pull.id, plan_id: plan.id, name: 'Pull', color: 'teal' })
  renderAt(repo, '/')
  const chooser = await screen.findByRole('radiogroup', { name: 'Day' })
  const pushRadio = within(chooser).getByRole('radio', { name: 'Push' })
  const pullRadio = within(chooser).getByRole('radio', { name: 'Pull' })
  expect(barOf(pushRadio.closest('label')!)).toBe('blue')
  expect(barOf(pullRadio.closest('label')!)).toBe('teal')
  expect((pushRadio as HTMLInputElement).checked).toBe(true)

  await user.click(pullRadio)
  await user.click(screen.getByRole('button', { name: 'Start workout' }))
  const heading = await screen.findByRole('heading', { level: 1, name: /PPL · Pull/ })
  expect(barOf(heading.closest('header')!)).toBe('teal')
})

test('History entries show the day colour next to the day name', async () => {
  const { repo, plan, push } = await twoDays()
  await repo.savePlanDay({ id: push.id, plan_id: plan.id, name: 'Push', color: 'amber' })
  const s = await repo.startSession(push.id)
  await repo.finishSession(s.id)
  renderAt(repo, '/history')
  const link = await screen.findByRole('link', { name: /PPL · Push/ })
  await waitFor(() => expect(barOf(link)).toBe('amber'))
})
