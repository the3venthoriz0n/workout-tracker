import type { DayColor } from '@workout/shared'
import { Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { DayBar } from '@/components/plan-bits'
import { cn } from '@/lib/utils'

// Settings lives in the header on every screen, not in the tab bar.
export function SettingsLink() {
  return (
    <NavLink
      to="/settings"
      aria-label="Settings"
      className={({ isActive }) =>
        cn(
          'flex size-11 shrink-0 items-center justify-center rounded-md',
          isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        )
      }
    >
      <Settings className="size-6" aria-hidden />
    </NavLink>
  )
}

// Sticky screen header: condensed title left, the screen's action and Settings right.
// `accent`: a plan-day colour bar before the title (the title still names the day).
export function ScreenHeader({ title, action, accent }: { title: ReactNode; action?: ReactNode; accent?: DayColor | null }) {
  return (
    <header className="bg-background sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
      <div className="flex min-h-14 items-center gap-2 py-1.5 pr-2 pl-4">
        <DayBar color={accent} className="my-1 w-2" />
        <h1 className="font-heading min-w-0 flex-1 text-[30px] leading-tight font-bold break-words">
          {title}
        </h1>
        <div className="flex shrink-0 items-center gap-2">
          {action}
          <SettingsLink />
        </div>
      </div>
    </header>
  )
}

// `noteAccent`: a plan-day colour bar before the note (History detail, where the note names the day).
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
        <p className="text-muted-foreground -mt-1 flex items-stretch gap-2 px-4 pb-3 text-sm">
          <DayBar color={noteAccent} className="w-1.5" />
          <span>{note}</span>
        </p>
      )}
      {!note && <div className="h-2" />}
    </>
  )
}
