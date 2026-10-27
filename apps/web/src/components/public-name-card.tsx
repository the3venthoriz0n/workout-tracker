import { ValidationError } from '@workout/shared'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { displayNameError } from '@/lib/community'
import { notifyError } from '@/lib/notify'
import { useProfile, useUpdateProfile } from '@/repo/hooks'

/** Settings: the public name shown on shared plans (signed in only). It can be changed, not removed. */
export function PublicNameCard() {
  const saved = useProfile().data?.display_name ?? ''
  const update = useUpdateProfile()
  const [name, setName] = useState(saved)
  const [seen, setSeen] = useState(saved)
  const [error, setError] = useState<string | null>(null)
  if (seen !== saved) {
    setSeen(saved)
    setName(saved)
  }

  function save(e: React.FormEvent) {
    e.preventDefault()
    const msg = displayNameError(name)
    if (msg) return setError(msg)
    setError(null)
    const next = name.trim()
    if (next === saved) return
    update.mutate(
      { display_name: next },
      {
        onSuccess: () => toast.success('Public name saved'),
        onError: (err) => {
          if (err instanceof ValidationError) setError('Check the public name.')
          else notifyError(err, "Couldn't save your public name")
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <label htmlFor="public-name">Public name</label>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={save} noValidate className="flex flex-col gap-3">
          <p id="public-name-help" className="text-muted-foreground text-sm">
            Shown on plans you share in Community. Your email is never shown.
          </p>
          <div className="flex gap-2">
            <Input
              id="public-name"
              className="flex-1"
              autoComplete="nickname"
              maxLength={30}
              placeholder="e.g. Sam Lifts"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={!!error}
              aria-describedby={error ? 'public-name-error public-name-help' : 'public-name-help'}
            />
            <Button type="submit" className="h-12 px-5" aria-label="Save public name" disabled={update.isPending}>
              Save
            </Button>
          </div>
          {error && (
            <p id="public-name-error" role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
        </form>
      </CardContent>
    </Card>
  )
}
