import { aboutLinks, buildInfo, type BuildInfo } from '@/lib/about'

const link = 'inline-flex min-h-11 items-center underline underline-offset-2'

// Quiet footer at the end of Settings. `info` is only overridden in tests.
export function AboutFooter({ info = buildInfo }: { info?: BuildInfo }) {
  const { label, versionHref, repoHref } = aboutLinks(info)
  return (
    <footer className="text-muted-foreground flex flex-wrap items-center justify-center gap-x-2 text-[13px]">
      <span>Workout Tracker</span>
      <span aria-hidden="true">·</span>
      {versionHref ? (
        <a href={versionHref} target="_blank" rel="noopener noreferrer" className={link}>
          {label}
        </a>
      ) : (
        <span>{label}</span>
      )}
      {repoHref && (
        <>
          <span aria-hidden="true">·</span>
          <a href={repoHref} target="_blank" rel="noopener noreferrer" className={link}>
            GitHub
          </a>
        </>
      )}
    </footer>
  )
}
