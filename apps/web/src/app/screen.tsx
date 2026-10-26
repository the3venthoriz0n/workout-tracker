import type { DayColor } from '@workout/shared'
import { Settings } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { NavLink } from 'react-router'
import { DayDot } from '@/components/plan-bits'
import { cn } from '@/lib/utils'

// Round soft button used for header actions (Settings, back).
export const headerIconButton =
  'bg-secondary text-secondary-foreground flex size-11 shrink-0 items-center justify-center rounded-full hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)]'

// Settings lives in the header on every screen, not in the tab bar.
export function SettingsLink() {
  return (
    <NavLink
      to="/settings"
      aria-label="Settings"
      className={({ isActive }) =>
        cn(headerIconButton, isActive && 'bg-primary text-primary-foreground hover:bg-primary/85')
      }
    >
      <Settings className="size-5" aria-hidden />
    </NavLink>
  )
}

// True once the page has scrolled, so the sticky header can show its hairline.
function useScrolled() {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 4)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  return scrolled
}

// Calm sticky header: a hairline appears only once the page scrolls under it.
export function StickyBar({ children, className }: { children: ReactNode; className?: string }) {
  const scrolled = useScrolled()
  return (
    <header
      data-scrolled={scrolled || undefined}
      className={cn(
        'bg-background sticky top-0 z-30 border-b border-transparent pt-[env(safe-area-inset-top)] data-scrolled:border-border',
        className,
      )}
    >
      {children}
    </header>
  )
}

// Large title left; the screen's action and Settings right.
// `accent`: a plan-day colour dot before the title (the title still names the day).
export function ScreenHeader({ title, action, accent }: { title: ReactNode; action?: ReactNode; accent?: DayColor | null }) {
  return (
    <StickyBar>
      <div className="flex min-h-16 items-center gap-2.5 py-2 pr-3 pl-4">
        <DayDot color={accent} className="size-3" />
        <h1 className="min-w-0 flex-1 text-[28px] leading-tight font-semibold tracking-[-0.025em] break-words">
          {title}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <SettingsLink />
        </div>
      </div>
    </StickyBar>
  )
}

// `noteAccent`: a plan-day colour dot before the note (History detail, where the note names the day).
export function Screen({
  title,
  note,
  action,
  accent,
  noteAccent,
}: {
  title: string
  note?: string
  action?: ReactNode
  accent?: DayColor | null
  noteAccent?: DayColor | null
}) {
  return (
    <>
      <ScreenHeader title={title} action={action} accent={accent} />
      {note && (
        <p className="text-muted-foreground -mt-1 flex items-center gap-2 px-4 pb-4 text-[15px]">
          <DayDot color={noteAccent} />
          <span>{note}</span>
        </p>
      )}
      {!note && <div className="h-2" />}
    </>
  )
}
