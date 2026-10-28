import { createBrowserRouter, type RouteObject } from 'react-router'
import { CommunityScreen } from '@/screens/community'
import { CommunityPlanScreen } from '@/screens/community-plan'
import { HistoryScreen } from '@/screens/history'
import { HistoryDetailScreen } from '@/screens/history-detail'
import { LibraryScreen } from '@/screens/library'
import { PlanDetailScreen } from '@/screens/plan-detail'
import { PlansScreen } from '@/screens/plans'
import { ProgressionScreen } from '@/screens/progression'
import { ResetPasswordScreen } from '@/screens/reset-password'
import { SettingsScreen } from '@/screens/settings'
import { TodayScreen } from '@/screens/today'
import { NotFoundScreen } from '@/screens/not-found'
import { Layout } from './layout'

export const routes: RouteObject[] = [
  {
    element: <Layout />,
    children: [
      { path: '/', element: <TodayScreen /> },
      { path: '/plans', element: <PlansScreen /> },
      { path: '/plans/community', element: <CommunityScreen /> },
      { path: '/plans/community/:id', element: <CommunityPlanScreen /> },
      { path: '/plans/:id', element: <PlanDetailScreen /> },
      { path: '/library', element: <LibraryScreen /> },
      { path: '/progression', element: <ProgressionScreen /> },
      { path: '/history', element: <HistoryScreen /> },
      { path: '/history/:id', element: <HistoryDetailScreen /> },
      { path: '/settings', element: <SettingsScreen /> },
      { path: '/reset-password', element: <ResetPasswordScreen /> },
      // Unknown paths, including the retired /verified landing page of old confirmation mails.
      { path: '*', element: <NotFoundScreen /> },
    ],
  },
]

export const createRouter = () => createBrowserRouter(routes)
