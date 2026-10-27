import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { guestRepo, json, listing, renderApp, requestedUrls, stubFetch } from './community-helpers'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const page = (items = [listing()], next_cursor: string | null = null) => json({ items, next_cursor })

test('the Plans toggle opens Community without a session and keeps five tabs', async () => {
  const user = userEvent.setup()
  stubFetch((u) => (u.pathname === '/api/public/plans' ? page() : undefined))
  const { router } = renderApp(await guestRepo(), '/plans')
  const toggle = await screen.findByRole('navigation', { name: 'Plans view' })
  expect(within(toggle).getByRole('link', { name: 'My plans' }).getAttribute('aria-current')).toBe('page')
  await user.click(within(toggle).getByRole('link', { name: 'Community' }))
  expect(router.state.location.pathname).toBe('/plans/community')
  expect(await screen.findByRole('link', { name: /Strong Start/ })).toBeTruthy()
  expect(within(screen.getByRole('navigation', { name: 'Main' })).getAllByRole('link')).toHaveLength(5)
})

test('cards show title, author, days, level, upvotes and downloads; untrusted text stays text', async () => {
  stubFetch((u) =>
    u.pathname === '/api/public/plans'
      ? page([listing(), listing({ id: '00000000-0000-4000-8000-0000000000bb', title: '<b>Bold</b> plan', author: 'x<img src=x>', level: null, day_count: 1 })])
      : undefined,
  )
  renderApp(await guestRepo(), '/plans/community')
  const card = await screen.findByRole('link', { name: /Strong Start/ })
  expect(within(card).getByText('by Sam Lifts')).toBeTruthy()
  expect(within(card).getByText('2 days')).toBeTruthy()
  expect(within(card).getByText('Beginner')).toBeTruthy()
  expect(within(card).getByLabelText('12 upvotes')).toBeTruthy()
  expect(within(card).getByLabelText('40 downloads')).toBeTruthy()
  const odd = screen.getByRole('link', { name: /Bold/ })
  expect(within(odd).getByText('<b>Bold</b> plan')).toBeTruthy()
  expect(within(odd).getByText('by x<img src=x>')).toBeTruthy()
  expect(odd.querySelector('b, img')).toBeNull()
  expect(within(odd).getByText('1 day')).toBeTruthy()
})

test('search, filters and sort change the request; Load more follows the cursor', async () => {
  const user = userEvent.setup()
  const spy = stubFetch((u) => {
    if (u.pathname !== '/api/public/plans') return undefined
    if (u.searchParams.get('cursor') === 'c2') return page([listing({ id: '00000000-0000-4000-8000-0000000000cc', title: 'Second page' })])
    return page([listing()], u.searchParams.has('q') ? null : 'c2')
  })
  renderApp(await guestRepo(), '/plans/community')
  await screen.findByRole('link', { name: /Strong Start/ })

  await user.click(screen.getByRole('button', { name: 'Load more' }))
  expect(await screen.findByRole('link', { name: /Second page/ })).toBeTruthy()
  expect(requestedUrls(spy).some((u) => u.searchParams.get('cursor') === 'c2')).toBe(true)

  await user.click(screen.getByRole('radio', { name: 'New' }))
  await waitFor(() => expect(requestedUrls(spy).at(-1)!.searchParams.get('sort')).toBe('new'))

  await user.type(screen.getByRole('searchbox', { name: 'Search community plans' }), 'squat')
  await waitFor(() => expect(requestedUrls(spy).at(-1)!.searchParams.get('q')).toBe('squat'))
  // debounced: no request per keystroke
  expect(requestedUrls(spy).filter((u) => ['s', 'sq', 'squ', 'squa'].includes(u.searchParams.get('q') ?? ''))).toHaveLength(0)

  await user.click(screen.getByRole('button', { name: /Filters/ }))
  const sheet = await screen.findByRole('dialog', { name: 'Filters' })
  await user.click(within(sheet).getByRole('radio', { name: '3 days' }))
  await user.click(within(sheet).getByRole('radio', { name: 'Intermediate' }))
  await user.click(within(sheet).getByRole('switch', { name: 'No gear needed' }))
  await user.click(within(sheet).getByRole('button', { name: 'Show plans' }))
  await waitFor(() => {
    const last = requestedUrls(spy).at(-1)!.searchParams
    expect([last.get('days'), last.get('level'), last.get('gear'), last.get('sort'), last.get('q')]).toEqual(['3', 'intermediate', 'none', 'new', 'squat'])
  })
  expect(screen.getByRole('button', { name: /Filters/ }).textContent).toContain('3')
})

test('empty community points to publishing; a failed load can retry', async () => {
  const user = userEvent.setup()
  let fail = true
  stubFetch((u) => {
    if (u.pathname !== '/api/public/plans') return undefined
    if (fail) return json({ error: 'internal_error' }, 500)
    return page([])
  })
  renderApp(await guestRepo(), '/plans/community')
  expect(await screen.findByText(/Couldn.t load community plans/)).toBeTruthy()
  fail = false
  await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(await screen.findByText('Nothing shared yet. Publish one of your plans.')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Go to My plans' }).getAttribute('href')).toBe('/plans')
})

test('an offline list load says so', async () => {
  stubFetch(() => undefined)
  renderApp(await guestRepo(), '/plans/community')
  expect(await screen.findByText("You're offline. Reconnect and try again.")).toBeTruthy()
})
