import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ApiError, NotFoundError } from '@workout/shared'
import { toast } from 'sonner'
import { afterEach, expect, test, vi } from 'vitest'
import { GONE_TEXT } from '@/lib/community'
import { LISTING_ID, detail, guestRepo, json, renderApp, stubFetch } from './community-helpers'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const path = `/plans/community/${LISTING_ID}`
const servePlan = (d = detail()) =>
  stubFetch((u) => (u.pathname === `/api/public/plans/${LISTING_ID}` ? json(d) : undefined))

test('a listing with a link in its text is rejected, not rendered', async () => {
  servePlan(detail({ description: 'see https://x.invalid' }))
  renderApp(await guestRepo(), path)
  expect(await screen.findByText("Couldn't load this plan.")).toBeTruthy()
  expect(document.querySelector('a[href*="x.invalid"]')).toBeNull()
})

test('a malformed plan id shows the not-shared state without a request', async () => {
  const fetchSpy = vi.fn()
  vi.stubGlobal('fetch', fetchSpy)
  renderApp(await guestRepo(), '/plans/community/..')
  expect(await screen.findByText(GONE_TEXT)).toBeTruthy()
  expect(fetchSpy).not.toHaveBeenCalled()
})

test('detail shows description, author, version, counts and a text-only preview', async () => {
  servePlan(detail({ description: 'Line one\n<b>bold</b> <img src=x onerror=alert(1)>' }))
  renderApp(await guestRepo(), path)
  expect(await screen.findByRole('heading', { level: 1, name: 'Strong Start' })).toBeTruthy()
  expect(screen.getByText(/by Sam Lifts/)).toBeTruthy()
  expect(screen.getByText(/v2/)).toBeTruthy()
  expect(screen.getByText(/<b>bold<\/b>/)).toBeTruthy()
  expect(document.querySelector('b, img')).toBeNull()
  const dayA = screen.getByRole('region', { name: 'Day A' })
  expect(within(dayA).getByText('Back Squat')).toBeTruthy()
  expect(within(dayA).getByText(/5 × 5\+ · 135 lb/)).toBeTruthy()
  expect(within(dayA).getByText('Incline')).toBeTruthy()
  const dayB = screen.getByRole('region', { name: 'Day B' })
  expect(within(dayB).getByText('A1')).toBeTruthy()
  expect(within(dayB).getByText('A2')).toBeTruthy()
  expect(screen.getByLabelText('40 downloads')).toBeTruthy()
})

test('guests see "Sign in to upvote" linking to Settings and never call setVote', async () => {
  servePlan()
  const repo = await guestRepo()
  const vote = vi.spyOn(repo, 'setVote')
  const voted = vi.spyOn(repo, 'hasVoted')
  renderApp(repo, path)
  const link = await screen.findByRole('link', { name: 'Sign in to upvote' })
  expect(link.getAttribute('href')).toBe('/settings')
  expect(screen.queryByRole('button', { name: /Upvote/ })).toBeNull()
  expect(vote).not.toHaveBeenCalled()
  expect(voted).not.toHaveBeenCalled()
})

test('guest "Use this plan" copies the fetched snapshot locally once and opens the copy', async () => {
  const user = userEvent.setup()
  servePlan()
  const repo = await guestRepo()
  const adopt = vi.spyOn(repo, 'adoptSharedPlan')
  const ok = vi.spyOn(toast, 'success')
  const { router } = renderApp(repo, path)
  const use = await screen.findByRole('button', { name: 'Use this plan' })
  await user.dblClick(use)
  await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/plans\/(?!community)/))
  expect(adopt).toHaveBeenCalledTimes(1)
  expect(adopt.mock.calls[0]![0]).toMatchObject({ shared_plan_id: LISTING_ID, version: 2, title: 'Strong Start', author: 'Sam Lifts', snapshot: { name: 'Strong Start' } })
  expect(ok).toHaveBeenCalledWith('Added to your plans')
  const plans = await repo.listPlans()
  expect(plans).toHaveLength(1)
  expect(plans[0]!.source).toEqual({ shared_plan_id: LISTING_ID, version: 2, title: 'Strong Start', author: 'Sam Lifts' })
  expect(router.state.location.pathname).toBe(`/plans/${plans[0]!.id}`)
})

test('signed in: adopt by id, hasVoted on load, optimistic upvote with rollback', async () => {
  const user = userEvent.setup()
  servePlan()
  const repo = await guestRepo()
  const hasVoted = vi.fn(async () => false)
  let fail = false
  const setVote = vi.fn(async (_id: string, v: boolean) => {
    if (fail) throw new ApiError(500)
    return { upvotes: v ? 13 : 12 }
  })
  const local = repo.adoptSharedPlan.bind(repo)
  const adopt = vi.fn(async () => {
    const { plan_id } = await local({ shared_plan_id: LISTING_ID, version: 2, snapshot: detail().snapshot, title: 'Strong Start', author: 'Sam Lifts' })
    return { plan_id }
  })
  Object.assign(repo, { hasVoted, setVote, adoptSharedPlan: adopt })
  const err = vi.spyOn(toast, 'error')
  const { router } = renderApp(repo, path, { signedIn: true })

  const up = await screen.findByRole('button', { name: /Upvote/ })
  expect(hasVoted).toHaveBeenCalledWith(LISTING_ID)
  expect(up.getAttribute('aria-pressed')).toBe('false')
  await user.click(up)
  await waitFor(() => expect(up.getAttribute('aria-pressed')).toBe('true'))
  expect(within(up).getByText('13')).toBeTruthy()
  expect(setVote).toHaveBeenCalledWith(LISTING_ID, true)

  fail = true
  await user.click(up)
  await waitFor(() => expect(err).toHaveBeenCalled())
  expect(up.getAttribute('aria-pressed')).toBe('true')
  expect(within(up).getByText('13')).toBeTruthy()

  await user.click(screen.getByRole('button', { name: 'Use this plan' }))
  await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/plans\/(?!community)/))
  expect(adopt).toHaveBeenCalledWith({ shared_plan_id: LISTING_ID, version: 2 })
})

test('adopt errors show a clear toast and stay on the page', async () => {
  const user = userEvent.setup()
  servePlan()
  const repo = await guestRepo()
  vi.spyOn(repo, 'adoptSharedPlan').mockRejectedValueOnce(new NotFoundError())
  const err = vi.spyOn(toast, 'error')
  const { router } = renderApp(repo, path)
  await user.click(await screen.findByRole('button', { name: 'Use this plan' }))
  await waitFor(() => expect(err).toHaveBeenCalledWith("This plan isn't shared anymore."))
  expect(router.state.location.pathname).toBe(path)
  expect(screen.getByRole('button', { name: 'Use this plan' }).hasAttribute('disabled')).toBe(false)
})

test('a missing listing and an offline load have their own messages', async () => {
  stubFetch(() => json({ error: 'not_found' }, 404))
  renderApp(await guestRepo(), path)
  expect(await screen.findByText("This plan isn't shared anymore.")).toBeTruthy()
})

test('offline detail load says so', async () => {
  stubFetch(() => undefined)
  renderApp(await guestRepo(), path)
  expect(await screen.findByText(/You're offline/)).toBeTruthy()
})
