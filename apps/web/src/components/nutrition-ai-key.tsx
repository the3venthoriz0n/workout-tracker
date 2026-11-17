import { AiKeyBody } from '@workout/shared'
import type { AiKeyInput } from '@workout/shared'
import { ChevronDown, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { notifyError } from '@/lib/notify'
import { confirmBox, segmentedItem, segmentedTrack } from '@/lib/styles'
import { cn } from '@/lib/utils'
import { useAiKey, useDeleteAiKey, useSaveAiKey } from '@/repo/hooks'

const PROVIDERS = [
  { id: 'openai', label: 'OpenAI-compatible' },
  { id: 'anthropic', label: 'Claude' },
] as const

/**
 * Bring your own AI key. The key is write-only: it goes to the server, is stored sealed, and is never
 * shown again, so this card only ever says whether one is saved and which service it points to. While
 * one is saved, estimates use it and do not count against the daily allowance.
 */
export function NutritionAiKey() {
  const saved = useAiKey()
  const save = useSaveAiKey()
  const remove = useDeleteAiKey()
  const [open, setOpen] = useState(false) // closed until asked for
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [provider, setProvider] = useState<AiKeyInput['provider']>('openai')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [error, setError] = useState<string | null>(null)

  if (saved.isPending || saved.isError) return null
  const info = saved.data
  const showForm = editing || !info.configured

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const parsed = AiKeyBody.safeParse({
      provider,
      ...(provider === 'openai' ? { base_url: baseUrl.trim() } : {}),
      model,
      api_key: apiKey,
    })
    if (!parsed.success) {
      setError(provider === 'openai' ? 'Check the address, model and key.' : 'Check the model and key.')
      return
    }
    setError(null)
    save.mutate(parsed.data, {
      onSuccess: () => {
        setApiKey('') // never kept in the page once sent
        setEditing(false)
      },
      onError: (err) => notifyError(err, "Couldn't save your key"),
    })
  }

  return (
    <section aria-label="Your own AI key" className="flex flex-col gap-3 py-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="ai-key-panel"
        className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="flex min-w-0 flex-col">
          <span className="text-[15px] font-semibold">Use your own key</span>
          <span className="text-muted-foreground text-sm">
            {info.configured
              ? `Using your ${info.provider === 'anthropic' ? 'Claude' : 'OpenAI-compatible'} key (${info.model}). No daily limit from us.`
              : 'Optional. Your own provider and key instead of ours.'}
          </span>
        </span>
        <ChevronDown aria-hidden className={cn('text-muted-foreground size-5 shrink-0 transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-180')} />
      </button>
      {open && (
        <div id="ai-key-panel" className="flex flex-col gap-3">
          {!info.configured && <p className="text-muted-foreground text-sm">Your meal text goes to that service.</p>}
      {showForm ? (
        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <div role="group" aria-label="Provider" className={segmentedTrack}>
            {PROVIDERS.map((p) => (
              <button key={p.id} type="button" aria-pressed={provider === p.id} className={segmentedItem(provider === p.id)} onClick={() => setProvider(p.id)}>
                {p.label}
              </button>
            ))}
          </div>
          {provider === 'openai' && (
            <div className="flex flex-col gap-1">
              <Label htmlFor="ai-base-url">Address</Label>
              <Input id="ai-base-url" inputMode="url" autoComplete="off" placeholder="https://api.groq.com/openai/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <Label htmlFor="ai-model">Model</Label>
            <Input id="ai-model" autoComplete="off" autoCapitalize="none" placeholder={provider === 'anthropic' ? 'claude-haiku-5-5' : 'model name'} value={model} onChange={(e) => setModel(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="ai-key">API key</Label>
            <Input id="ai-key" type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} value={apiKey} onChange={(e) => setApiKey(e.target.value)} />
          </div>
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="submit" className="h-12 flex-1" disabled={save.isPending}>
              Save key
            </Button>
            {info.configured && (
              <Button type="button" variant="outline" className="h-12" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            )}
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="h-12 flex-1" onClick={() => setEditing(true)}>
              Replace key
            </Button>
            {!confirming && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-destructive focus-visible:text-destructive min-h-11 min-w-11"
                aria-label="Remove your key"
                onClick={() => setConfirming(true)}
              >
                <Trash2 aria-hidden />
              </Button>
            )}
          </div>
          {confirming && (
            <div role="group" aria-label="Remove your key?" className={confirmBox}>
              <p className="text-sm">Estimates go back to our daily limit. You can add a key again any time.</p>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="h-12 flex-1" onClick={() => setConfirming(false)}>
                  Keep key
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  className="h-12 flex-1"
                  disabled={remove.isPending}
                  onClick={() =>
                    remove.mutate(undefined, {
                      onSuccess: () => setConfirming(false),
                      onError: (err) => notifyError(err, "Couldn't remove your key"),
                    })
                  }
                >
                  Remove key
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
        </div>
      )}
    </section>
  )
}
