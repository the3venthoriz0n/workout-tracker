import {
  CalendarCheck,
  ClipboardList,
  Dumbbell,
  History,
  Settings,
  TrendingUp,
} from 'lucide-react'
import { NavLink, Outlet } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { cn } from '@/lib/utils'

const tabs = [
  { to: '/', label: 'Today', icon: CalendarCheck, end: true },
  { to: '/plans', label: 'Plans', icon: ClipboardList, end: false },
  { to: '/library', label: 'Library', icon: Dumbbell, end: false },
  { to: '/progression', label: 'Progression', icon: TrendingUp, end: false },
  { to: '/history', label: 'History', icon: History, end: false },
  { to: '/settings', label: 'Settings', icon: Settings, end: false },
]

// One nav element: a bottom bar below md, a left sidebar from md up.
export function Layout() {
  return (
    <div className="bg-background text-foreground min-h-dvh md:flex">
      <nav
        aria-label="Main"
        className="bg-card fixed inset-x-0 bottom-0 z-40 flex border-t pb-[env(safe-area-inset-bottom)] md:static md:inset-auto md:min-h-dvh md:w-56 md:flex-col md:gap-1 md:border-t-0 md:border-r md:p-3 md:pb-3"
      >
        {tabs.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-0.5 text-[11px] font-medium tracking-tight transition-colors',
                'md:min-h-11 md:flex-none md:flex-row md:justify-start md:gap-3 md:rounded-md md:px-3 md:text-sm md:[&>span]:max-w-none',
                isActive
                  ? 'text-primary md:bg-accent'
                  : 'text-muted-foreground hover:text-foreground md:hover:bg-accent/50',
              )
            }
          >
            <Icon className="size-5" aria-hidden />
            <span className="max-w-full truncate">{label}</span>
          </NavLink>
        ))}
      </nav>
      <main className="mx-auto w-full max-w-3xl flex-1 pb-20 md:pb-0">
        <Outlet />
      </main>
      <Toaster />
    </div>
  )
}
