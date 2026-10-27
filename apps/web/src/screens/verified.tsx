import { Link, useSearchParams } from 'react-router'
import { Screen } from '@/app/screen'
import { EmailLinkForm } from '@/components/forgot-password-form'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

// The API redirects here after a confirmation link is opened; a bad link adds ?error=...
export function VerifiedScreen() {
  const [params] = useSearchParams()
  const error = params.get('error')
  return (
    <div>
      <Screen title={error ? 'Link problem' : 'Email confirmed'} />
      <div className="flex flex-col gap-4 px-4 pb-6">
        <Card>
          <CardContent className="flex flex-col gap-3">
            {error ? (
              <>
                <p role="alert" className="text-destructive text-sm">
                  {error === 'TOKEN_EXPIRED'
                    ? 'This link has expired. Request a new one.'
                    : "This link isn't valid or was already used. Request a new one."}
                </p>
                <EmailLinkForm kind="verify" />
              </>
            ) : (
              <>
                <p>Email confirmed. Sign in to continue.</p>
                <Button asChild className="min-h-11">
                  <Link to="/settings">Sign in</Link>
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
