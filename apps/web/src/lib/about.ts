// Build-time version info for the Settings "About" footer. The values are injected by Vite
// `define` (see vite.config.ts) from APP_VERSION / APP_COMMIT / APP_REPO; nothing is fetched
// at runtime. They are build inputs, but are validated anyway before they become links.

export type BuildInfo = { version: string; commit: string; repo: string }

export type AboutLinks = {
  label: string
  versionHref: string | null
  repoHref: string | null
}

const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/
const TAG_RE = /^v\d+\.\d+\.\d+$/
const SHA_RE = /^[0-9a-f]{7,40}$/

export const buildInfo: BuildInfo = {
  version: __APP_VERSION__,
  commit: __APP_COMMIT__,
  repo: __APP_REPO__,
}

export function aboutLinks(info: BuildInfo): AboutLinks {
  // The pattern allows dots, so also refuse path segments made only of dots (`../x`).
  const repo = REPO_RE.test(info.repo) && !info.repo.split('/').some((p) => /^\.+$/.test(p)) ? info.repo : null
  const base = repo ? `https://github.com/${repo}` : null
  const sha = SHA_RE.test(info.commit) ? info.commit : null

  if (TAG_RE.test(info.version)) {
    return {
      label: info.version,
      versionHref: base ? `${base}/releases/tag/${info.version}` : null,
      repoHref: base,
    }
  }
  if (info.version === 'staging') {
    return {
      label: sha ? `staging · ${sha.slice(0, 7)}` : 'staging',
      versionHref: base && sha ? `${base}/commit/${sha}` : null,
      repoHref: base,
    }
  }
  return { label: 'dev', versionHref: null, repoHref: base }
}
