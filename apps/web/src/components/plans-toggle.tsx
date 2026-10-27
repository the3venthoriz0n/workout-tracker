import { NavLink } from 'react-router'
import { segmentedItem, segmentedTrack } from '@/lib/styles'
import { cn } from '@/lib/utils'

/** "My plans | Community" pill toggle at the top of the Plans tab (two routes, so each view has its own URL). */
export function PlansToggle() {
  return (
    <nav aria-label="Plans view" className={segmentedTrack}>
      {[
        { to: '/plans', label: 'My plans' },
        { to: '/plans/community', label: 'Community' },
      ].map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end
          className={({ isActive }) => cn(segmentedItem(isActive), 'flex items-center justify-center')}
        >
          {label}
        </NavLink>
      ))}
    </nav>
  )
}
