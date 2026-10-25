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

// One nav element: a bottom bar below md, a left sidebar from md up.
export function Layout() {
  return (
    <div className="bg-background text-foreground min-h-dvh md:flex">
      <nav
        aria-label="Main"
        className="bg-card fixed inset-x-0 bottom-0 z-40 flex border-t pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] md:sticky md:top-0 md:h-dvh md:w-56 md:flex-col md:gap-1 md:border-t-0 md:border-r md:p-3"
      >
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'group flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 pt-1 text-xs',
                'md:min-h-11 md:flex-none md:flex-row md:justify-start md:gap-3 md:rounded-md md:px-3 md:pt-0 md:text-sm',
                isActive
                  ? 'text-foreground font-semibold md:bg-accent'
                  : 'text-muted-foreground font-medium hover:text-foreground md:hover:bg-accent/60',
              )
            }
          >
            {({ isActive }) => (
              <>
                {/* Active pill behind the icon: the indicator doesn't rely on colour alone */}
                <span
                  aria-hidden
                  className={cn(
                    'flex h-7 w-14 items-center justify-center rounded-full md:h-auto md:w-auto',
                    isActive && 'bg-primary text-primary-foreground md:bg-transparent md:text-primary',
                  )}
                >
                  <Icon className="size-5" strokeWidth={isActive ? 2.5 : 2} />
                </span>
                <span className="max-w-full truncate">{label}</span>
              </>
            )}
          </NavLink>
        ))}
      </nav>
      <main className="mx-auto w-full max-w-3xl flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] md:pb-8">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}
