import {
  COMMUNITY,
  LEVELS,
  ValidationError,
  listingMetaSchema,
  sharedSnapshotSchema,
  snapshotFromPlanTree,
  type Level,
  type PlanTree,
  type SharedListing,
} from '@workout/shared'
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { useSignedIn } from '@/auth/context'
import { Chip } from '@/components/community-filters'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { SkeletonRows } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { LEVEL_NAMES, LINK_MESSAGE, displayNameError, publishErrors, type PublishErrors } from '@/lib/community'
import { notifyError } from '@/lib/notify'
import { responsiveSheet } from '@/lib/sheet-classes'
import { confirmBox } from '@/lib/styles'
import { Counts } from '@/screens/community'
import {
  useCommunityPlan,
  useGear,
  useMyShared,
  useProfile,
  usePublishPlan,
  useUnpublishPlan,
  useUpdateProfile,
} from '@/repo/hooks'

const settingsLink = 'text-brand inline-flex min-h-11 items-center font-medium underline underline-offset-4'

export function ShareSheet({ tree, open, onOpenChange }: { tree: PlanTree; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className={responsiveSheet}>
        <SheetHeader className="shrink-0 pr-14">
          <SheetTitle>Share plan</SheetTitle>
          <SheetDescription>Publish a copy to Community. Later edits stay private until you publish an update.</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 pb-5">
          {open && <ShareBody tree={tree} />}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ShareBody({ tree }: { tree: PlanTree }) {
  const signedIn = useSignedIn()
  const profile = useProfile()
  const pub = tree.published
  const mine = useMyShared(signedIn && pub !== null)
  const [editing, setEditing] = useState(false)

  if (!signedIn) {
    return (
      <div className={confirmBox}>
        <p className="text-[15px] font-medium">Create an account to share plans</p>
        <p className="text-muted-foreground text-sm">Shared plans show your public name. Accounts are free.</p>
        <Link to="/settings" className={settingsLink}>
          Go to Settings
        </Link>
      </div>
    )
  }
  if (profile.isPending) return <SkeletonRows rows={2} />
  if (!profile.data?.display_name) return <NameStep />

  const listing = pub ? mine.data?.find((l) => l.id === pub.shared_plan_id) : undefined
  if (pub?.status === 'hidden') {
    return (
      <p className="text-sm">
        This plan was removed from Community by the service owner. Copies people made are theirs to keep.
      </p>
    )
  }
  if (pub?.status === 'published' && !editing) {
    return <PublishedStatus tree={tree} version={pub.version} sharedPlanId={pub.shared_plan_id} listing={listing} onUpdate={() => setEditing(true)} />
  }
  if (pub && mine.isPending) return <SkeletonRows rows={2} />
  const update = pub?.status === 'published'
  return (
    <PublishForm
      key={update ? 'update' : 'new'}
      tree={tree}
      initial={listing ? { title: listing.title, description: listing.description, level: listing.level } : { title: tree.name.slice(0, 60), description: '', level: null }}
      submitLabel={update ? `Publish v${pub.version + 1}` : 'Publish'}
      note={pub?.status === 'unpublished' ? 'Not shared right now. Publishing again makes it public as a new version.' : undefined}
      onCancel={update ? () => setEditing(false) : undefined}
      onDone={() => setEditing(false)}
    />
  )
}

/** Asks for the public name inline; publishing needs one. */
function NameStep() {
  const update = useUpdateProfile()
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  function save(e: React.FormEvent) {
    e.preventDefault()
    const msg = displayNameError(name)
    if (msg) return setError(msg)
    setError(null)
    update.mutate(
      { display_name: name.trim() },
      {
        onError: (err) => {
          if (err instanceof ValidationError) setError('Check the public name.')
          else notifyError(err, "Couldn't save your public name")
        },
      },
    )
  }
  return (
    <form onSubmit={save} noValidate className="flex flex-col gap-3">
      <p className="text-[15px]">First, pick a public name. It is shown on plans you share; your email never is.</p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="share-name">Public name</Label>
        <Input
          id="share-name"
          autoComplete="nickname"
          maxLength={30}
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-invalid={!!error}
          aria-describedby={error ? 'share-name-error' : undefined}
        />
        {error && (
          <p id="share-name-error" role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
      <Button type="submit" size="big" disabled={update.isPending}>
        Save name
      </Button>
      <p className="text-muted-foreground text-sm">
        You can change it later in{' '}
        <Link to="/settings" className="text-brand font-medium underline underline-offset-4">
          Settings
        </Link>
        .
      </p>
    </form>
  )
}

/** The plan as it would be published now (null when it cannot be shared). */
function useLocalSnapshot(tree: PlanTree) {
  const units = useProfile().data?.units
  const gear = useGear().data
  if (!units || !gear) return undefined
  try {
    return snapshotFromPlanTree(tree, units, gear)
  } catch {
    return null
  }
}

function PublishedStatus({
  tree,
  version,
  sharedPlanId,
  listing,
  onUpdate,
}: {
  tree: PlanTree
  version: number
  sharedPlanId: string
  listing: SharedListing | undefined
  onUpdate: () => void
}) {
  const unpublish = useUnpublishPlan()
  const [confirming, setConfirming] = useState(false)
  const local = useLocalSnapshot(tree)
  const remote = useCommunityPlan(sharedPlanId)
  // Changed since the last publish? Unknown (offline, unshareable now) leaves the update allowed.
  let changed: boolean | null = null
  if (local && remote.data && remote.data.version === version) {
    const published = sharedSnapshotSchema.safeParse(remote.data.snapshot)
    if (published.success) changed = JSON.stringify(published.data) !== JSON.stringify(local)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="surface flex flex-col gap-2 rounded-card p-4 [--field:var(--background)]">
        <p className="text-[17px] font-semibold">Shared · v{version}</p>
        {listing && <p className="text-muted-foreground text-sm break-words">{listing.title}</p>}
        {listing && <Counts upvotes={listing.upvotes} downloads={listing.downloads} />}
        {changed !== null && (
          <p className="text-sm">{changed ? `Changed since v${version}.` : `No changes since v${version}.`}</p>
        )}
        <Link to={`/plans/community/${sharedPlanId}`} className={settingsLink}>
          View in Community
        </Link>
      </div>
      <Button size="big" variant={changed === false ? 'secondary' : 'default'} onClick={onUpdate}>
        Publish update
      </Button>
      {confirming ? (
        <div role="alertdialog" aria-label="Confirm unpublish" className={confirmBox}>
          <p className="text-sm">
            Unpublish? It disappears from Community. Copies people already made stay theirs.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="destructive"
              className="min-h-11"
              disabled={unpublish.isPending}
              onClick={() =>
                unpublish.mutate(tree.id, {
                  onSuccess: () => {
                    toast.success('Unpublished')
                    setConfirming(false)
                  },
                  onError: (err) => notifyError(err, "Couldn't unpublish. Try again."),
                })
              }
            >
              Confirm unpublish
            </Button>
            <Button variant="outline" className="min-h-11" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="ghost" className="text-destructive hover:text-destructive min-h-11" onClick={() => setConfirming(true)}>
          Unpublish
        </Button>
      )}
    </div>
  )
}

type Meta = { title: string; description: string; level: Level | null }

function PublishForm({
  tree,
  initial,
  submitLabel,
  note,
  onCancel,
  onDone,
}: {
  tree: PlanTree
  initial: Meta
  submitLabel: string
  note?: string
  onCancel?: () => void
  onDone: () => void
}) {
  const publish = usePublishPlan()
  const profile = useProfile().data
  const gear = useGear().data
  const [meta, setMeta] = useState<Meta>(initial)
  const [errors, setErrors] = useState<PublishErrors>({})
  const busy = useRef(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy.current) return
    const parsed = listingMetaSchema.safeParse(meta)
    if (!parsed.success) {
      const next: PublishErrors = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path[0]
        const link = issue.message === LINK_MESSAGE
        if (key === 'title') next.title ??= link ? "Links aren't allowed." : `Title must be ${COMMUNITY.titleMin} to ${COMMUNITY.titleMax} characters.`
        if (key === 'description') next.description ??= link ? "Links aren't allowed." : `Keep it under ${COMMUNITY.descriptionMax} characters.`
        if (key === 'level') next.level ??= 'Pick a level or leave it empty.'
      }
      return setErrors(next)
    }
    // Same check the server runs, so an unshareable plan gets a readable reason first.
    if (profile && gear) {
      try {
        snapshotFromPlanTree(tree, profile.units, gear)
      } catch (err) {
        return setErrors(publishErrors(err))
      }
    }
    setErrors({})
    busy.current = true
    publish.mutate(
      { planId: tree.id, meta: parsed.data },
      {
        onSuccess: ({ version }) => {
          toast.success(`Published v${version}`)
          onDone()
        },
        onError: (err) => {
          console.error(err)
          setErrors(publishErrors(err))
        },
        onSettled: () => {
          busy.current = false
        },
      },
    )
  }

  const field = (id: keyof PublishErrors) => ({
    'aria-invalid': !!errors[id],
    'aria-describedby': errors[id] ? `share-${id}-error` : undefined,
  })
  const fieldError = (id: keyof PublishErrors) =>
    errors[id] ? (
      <p id={`share-${id}-error`} className="text-destructive text-sm">
        {errors[id]}
      </p>
    ) : null

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      {note && <p className="text-muted-foreground text-sm">{note}</p>}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="share-title">Title</Label>
        <Input
          id="share-title"
          autoComplete="off"
          maxLength={80}
          value={meta.title}
          onChange={(e) => setMeta({ ...meta, title: e.target.value })}
          {...field('title')}
        />
        {fieldError('title')}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="share-description">
          Description <span className="text-muted-foreground font-normal">(optional)</span>
        </Label>
        <Textarea
          id="share-description"
          maxLength={600}
          placeholder="Who it's for, how often, what to expect"
          value={meta.description}
          onChange={(e) => setMeta({ ...meta, description: e.target.value })}
          {...field('description')}
        />
        {fieldError('description')}
      </div>
      <div className="flex flex-col gap-1.5">
        <span id="share-level" className="text-sm font-medium">
          Level
        </span>
        <div role="radiogroup" aria-labelledby="share-level" className="flex flex-wrap gap-2">
          {[null, ...LEVELS].map((l) => (
            <Chip key={l ?? 'any'} on={meta.level === l} onClick={() => setMeta({ ...meta, level: l })}>
              {l ? LEVEL_NAMES[l] : 'Any'}
            </Chip>
          ))}
        </div>
        {fieldError('level')}
      </div>
      <p className="text-muted-foreground text-sm">
        Shared: plan name, days and exercises with sets, reps, weights and progression. Not shared: your notes, videos,
        history and email.
      </p>
      {errors.form && (
        <p role="alert" className="text-destructive text-sm">
          {errors.form}
        </p>
      )}
      {errors.display_name && (
        <p role="alert" className="text-destructive text-sm">
          {errors.display_name}
        </p>
      )}
      <div className="flex gap-2">
        {onCancel && (
          <Button type="button" variant="outline" size="big" className="flex-1" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" size="big" className="flex-[2]" disabled={publish.isPending}>
          {publish.isPending ? 'Publishing...' : submitLabel}
        </Button>
      </div>
    </form>
  )
}
