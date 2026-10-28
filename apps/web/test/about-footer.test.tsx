import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { AboutFooter } from '../src/components/about-footer'

test('dev build: plain version text, no links', () => {
  render(<AboutFooter info={{ version: 'dev', commit: '', repo: '' }} />)
  expect(screen.getByText(/Workout Tracker/)).toBeTruthy()
  expect(screen.getByText('dev')).toBeTruthy()
  expect(screen.queryAllByRole('link')).toHaveLength(0)
})

test('release build: version and GitHub links open in a new tab safely', () => {
  render(<AboutFooter info={{ version: 'v0.1.0', commit: '52cf637a1b2c', repo: 'o/r' }} />)
  const v = screen.getByRole('link', { name: 'v0.1.0' })
  expect(v.getAttribute('href')).toBe('https://github.com/o/r/releases/tag/v0.1.0')
  const g = screen.getByRole('link', { name: 'GitHub' })
  expect(g.getAttribute('href')).toBe('https://github.com/o/r')
  for (const a of [v, g]) {
    expect(a.getAttribute('target')).toBe('_blank')
    expect(a.getAttribute('rel')).toBe('noopener noreferrer')
  }
})
