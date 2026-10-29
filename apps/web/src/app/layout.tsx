import { CalendarCheck, ClipboardList, Dumbbell, History, TrendingUp } from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'

// Settings is reached from the gear in each screen header (see screen.tsx).
const tabs = [
  { to: '/', label: 'Today', icon: CalendarCheck, end: true },
  { to: '/plans', label: 'Plans', icon: ClipboardList, end: false },
  { to: '/library', label: 'Library', icon: Dumbbell, end: false },
  { to: '/progression', label: 'Progress', icon: TrendingUp, end: false },
  { to: '/history', label: 'History', icon: History, end: false },
]

// One nav element: a tab bar docked to the bottom edge below md (padded for the home indicator),
// a left sidebar from md up.
export function Layout() {
  return (
    <div className="bg-background text-foreground min-h-dvh md:flex">
      <nav
        aria-label="Main"
        className={cn(
          'fixed inset-x-0 bottom-0 z-40 flex gap-0.5 border-t border-border bg-background px-[calc(6px+env(safe-area-inset-left))] pt-1.5 pb-[calc(6px+env(safe-area-inset-bottom))]',
          'md:sticky md:top-0 md:bottom-auto md:h-dvh md:w-60 md:shrink-0 md:flex-col md:gap-1 md:border-t-0 md:p-4',
        )}
      >
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                // Active: a filled pill with icon and label (not colour alone: shape and weight change too)
                'flex min-h-13 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-full px-0.5 text-[11px] leading-none',
                'md:min-h-11 md:flex-none md:flex-row md:justify-start md:gap-3 md:px-4 md:text-sm',
                isActive
                  ? 'bg-primary text-primary-foreground font-semibold'
                  : 'text-muted-foreground hover:text-foreground hover:bg-accent font-medium',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon aria-hidden className="size-5 shrink-0" strokeWidth={isActive ? 2.25 : 1.75} />
                <span className="max-w-full truncate">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <main className="mx-auto w-full max-w-3xl min-w-0 flex-1 pb-(--nav-space) md:pb-10">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}
