import { Link } from 'react-router'
import { Screen } from '@/app/screen'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

export function NotFoundScreen() {
  return (
    <div>
      <Screen title="Page not found" />
      <div className="flex flex-col gap-4 px-4 pb-6">
        <Card>
          <CardContent className="flex flex-col gap-3">
            <p>This page doesn&apos;t exist. If you came from an email link, request a new one from Settings.</p>
            <Button asChild className="min-h-11">
              <Link to="/">Go to Today</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
