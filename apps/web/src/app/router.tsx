import { createBrowserRouter, type RouteObject } from 'react-router'
import { HistoryScreen } from '@/screens/history'
import { HistoryDetailScreen } from '@/screens/history-detail'
import { LibraryScreen } from '@/screens/library'
import { PlanDetailScreen } from '@/screens/plan-detail'
import { PlansScreen } from '@/screens/plans'
import { SettingsScreen } from '@/screens/settings'
import { TodayScreen } from '@/screens/today'
import { Layout } from './layout'

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <TodayScreen /> },
      { path: '/plans', element: <PlansScreen /> },
      { path: '/plans/:id', element: <PlanDetailScreen /> },
      { path: '/library', element: <LibraryScreen /> },
      { path: '/history', element: <HistoryScreen /> },
      { path: '/history/:id', element: <HistoryDetailScreen /> },
      { path: '/settings', element: <SettingsScreen /> },
    ],
  },
]

export const createRouter = () => createBrowserRouter(routes)
