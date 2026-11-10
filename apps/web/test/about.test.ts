import { describe, expect, test } from 'vitest'
import { aboutLinks } from '../src/lib/about'

const sha = '52cf637a1b2c3d4e5f60718293a4b5c6d7e8f901'

describe('aboutLinks', () => {
  test('release tag links to the release', () => {
    expect(aboutLinks({ version: 'v1.2.3', commit: sha, repo: 'o/r' })).toEqual({
      label: 'v1.2.3',
      versionHref: 'https://github.com/o/r/releases/tag/v1.2.3',
      repoHref: 'https://github.com/o/r',
    })
  })
  test('staging build shows a short sha and links to the commit', () => {
    expect(aboutLinks({ version: 'staging', commit: sha, repo: 'o/r' })).toMatchObject({
      label: 'staging · 52cf637',
      versionHref: `https://github.com/o/r/commit/${sha}`,
    })
  })
  test('staging build also shows the latest release tag', () => {
    expect(aboutLinks({ version: 'staging', release: 'v0.1.2', commit: sha, repo: 'o/r' })).toMatchObject({
      label: 'v0.1.2 · staging · 52cf637',
      versionHref: `https://github.com/o/r/commit/${sha}`,
    })
    expect(aboutLinks({ version: 'staging', release: 'v0.1.2', commit: '', repo: '' })).toMatchObject({
      label: 'v0.1.2 · staging',
      versionHref: null,
    })
  })
  test('a missing or invalid release tag is ignored', () => {
    for (const release of ['', 'latest', 'v1.2', '<b>v1.2.3</b>']) {
      expect(aboutLinks({ version: 'staging', release, commit: sha, repo: 'o/r' }).label).toBe('staging · 52cf637')
    }
  })
  test('a release build ignores the extra release value', () => {
    expect(aboutLinks({ version: 'v1.2.3', release: 'v0.0.1', commit: sha, repo: 'o/r' }).label).toBe('v1.2.3')
  })
  test('local dev has no version link and no repo link', () => {
    expect(aboutLinks({ version: 'dev', commit: '', repo: '' })).toEqual({ label: 'dev', versionHref: null, repoHref: null })
  })
  test('no repo means no links at all', () => {
    expect(aboutLinks({ version: 'v1.2.3', commit: sha, repo: '' })).toEqual({ label: 'v1.2.3', versionHref: null, repoHref: null })
  })
  test('invalid inputs are treated as unset', () => {
    expect(aboutLinks({ version: 'v1.2', commit: 'xyz', repo: 'a/b/c' })).toEqual({ label: 'dev', versionHref: null, repoHref: null })
    expect(aboutLinks({ version: 'staging', commit: 'XYZ', repo: 'o/r' })).toMatchObject({ label: 'staging', versionHref: null })
    expect(aboutLinks({ version: 'v1.2.3', commit: '', repo: 'o r' }).repoHref).toBeNull()
    expect(aboutLinks({ version: 'v1.2.3', commit: '', repo: '../x' }).repoHref).toBeNull()
  })
})
