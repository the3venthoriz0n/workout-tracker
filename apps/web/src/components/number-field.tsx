import { parseReps, parseWeight } from '@workout/shared'
import { useEffect, useId, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type Props = {
  label: string
  value: number | null
  // Return false (or a promise of false) to reject the value; the field then shows `value` again
  onCommit: (value: number | null) => boolean | void | Promise<boolean | void>
  kind: 'weight' | 'reps'
  allowEmpty?: boolean
  placeholder?: string
  suffix?: string
  className?: string
  id?: string
}

const show = (v: number | null) => (v === null ? '' : String(v))

// Text is local until blur/Enter; invalid input reverts to the last committed value.
export function NumberField({
  label,
  value,
  onCommit,
  kind,
  allowEmpty = false,
  placeholder,
  suffix,
  className,
  id,
}: Props) {
  const autoId = useId()
  const inputId = id ?? autoId
  const [text, setText] = useState(show(value))
  const [seen, setSeen] = useState(value)
  const [focused, setFocused] = useState(false)
  const dirty = useRef(false)
  const focusedRef = useRef(false)
  const latest = useRef(value)
  useEffect(() => {
    latest.current = value
  })

  // Re-sync when the value changes from outside, but never while the user is typing
  if (seen !== value) {
    setSeen(value)
    if (!focused) setText(show(value))
  }

  async function commit() {
    setFocused(false)
    focusedRef.current = false
    const wasDirty = dirty.current
    dirty.current = false
    if (!wasDirty) {
      setText(show(value))
      return
    }
    const parsed = (kind === 'weight' ? parseWeight : parseReps)(text)
    if (parsed === undefined || (parsed === null && !allowEmpty)) {
      setText(show(value))
      return
    }
    setText(show(parsed))
    let result: boolean | void = undefined
    try {
      result = await onCommit(parsed)
    } catch {
      result = false
    }
    // Let the parent's new value arrive, then show whatever it actually holds
    // Skip if the user has already started typing again
    setTimeout(
      () => {
        if (!dirty.current && !focusedRef.current) setText(show(latest.current))
      },
      result === false ? 0 : 50,
    )
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={inputId}>{label}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          className="min-h-11 tabular-nums"
          inputMode={kind === 'weight' ? 'decimal' : 'numeric'}
          enterKeyHint="done"
          autoComplete="off"
          placeholder={placeholder}
          value={text}
          onChange={(e) => {
            dirty.current = true
            setText(e.target.value)
          }}
          onFocus={() => {
            focusedRef.current = true
            setFocused(true)
          }}
          onBlur={() => void commit()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              e.currentTarget.blur()
            }
          }}
        />
        {suffix && <span className="text-muted-foreground text-sm">{suffix}</span>}
      </div>
    </div>
  )
}
