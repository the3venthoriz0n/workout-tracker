import { Settings } from 'lucide-react'
import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
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
export function ScreenHeader({ title, action }: { title: ReactNode; action?: ReactNode }) {
  return (
    <header className="bg-background sticky top-0 z-30 pt-[env(safe-area-inset-top)]">
      <div className="flex min-h-14 items-center gap-2 py-1.5 pr-2 pl-4">
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

export function Screen({ title, note, action }: { title: string; note?: string; action?: ReactNode }) {
  return (
    <>
      <ScreenHeader title={title} action={action} />
      {note && <p className="text-muted-foreground -mt-1 px-4 pb-3 text-sm">{note}</p>}
      {!note && <div className="h-2" />}
    </>
  )
}
