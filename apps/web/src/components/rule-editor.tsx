import { defaultRule, ruleInputSchema, type RuleInput } from '@workout/shared'
import { NumberField } from '@/components/number-field'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { formatWeight } from '@/lib/format'
import { notifyError } from '@/lib/notify'
import { useProfile } from '@/repo/hooks'

// Validates, saves and reports failure. Resolves false when invalid or the write fails,
// so a NumberField reverts its text; the stored value stays the source of truth.
function useSaveRule<T extends RuleInput | null>(onSave: (rule: T) => Promise<void>) {
  return async (next: T): Promise<boolean> => {
    let value = next
    if (value !== null) {
      const parsed = ruleInputSchema.safeParse(value)
      if (!parsed.success) return false
      value = parsed.data as T
    }
    try {
      await onSave(value)
      return true
    } catch (err) {
      notifyError(err)
      return false
    }
  }
}

type FieldsProps = {
  rule: RuleInput
  onSave: (rule: RuleInput) => Promise<void>
  idPrefix: string
  // Hint under the amount (it points at the Progression tab, so hide it on that tab)
  showStepHint?: boolean
}

// Action, amount, fail limit, deload % and rep ceiling (no "No progression" switch)
export function RuleFields({ rule, onSave, idPrefix, showStepHint = true }: FieldsProps) {
  const profile = useProfile().data
  const units = profile?.units ?? 'lb'
  const step = profile?.weight_increment ?? 5
  const save = useSaveRule<RuleInput>(onSave)
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-action`}>On success</Label>
        <select
          id={`${idPrefix}-action`}
          className="border-input bg-background min-h-11 rounded-md border px-3 text-sm"
          value={rule.success_action}
          onChange={(e) => {
            const success_action = e.target.value as RuleInput['success_action']
            if (success_action === rule.success_action) return
            void save({
              ...rule,
              success_action,
              success_amount: success_action === 'add_reps' ? 1 : step,
            })
          }}
        >
          <option value="add_weight">Add weight</option>
          <option value="add_reps">Add reps</option>
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField
          label={rule.success_action === 'add_weight' ? `Add (${units})` : 'Add (reps)'}
          kind={rule.success_action === 'add_weight' ? 'weight' : 'reps'}
          value={rule.success_amount}
          onCommit={(v) => (v === null || v <= 0 ? false : save({ ...rule, success_amount: v }))}
        />
        {showStepHint && rule.success_action === 'add_weight' && (
          <p className="text-muted-foreground col-span-2 -mt-1 text-xs">
            Steps snap to your {formatWeight(step)} {units} progression step (change it in the
            Progression tab).
          </p>
        )}
        <NumberField
          label="Fail streak limit"
          kind="reps"
          value={rule.fail_streak_limit}
          onCommit={(v) => (v === null || v < 1 ? false : save({ ...rule, fail_streak_limit: v }))}
        />
        <NumberField
          label="Deload %"
          kind="reps"
          value={rule.deload_pct}
          suffix="%"
          onCommit={(v) =>
            v === null || v < 1 || v > 100 ? false : save({ ...rule, deload_pct: v })
          }
        />
        <NumberField
          label="Rep ceiling"
          kind="reps"
          allowEmpty
          value={rule.rep_ceiling}
          placeholder="None"
          onCommit={(v) => save({ ...rule, rep_ceiling: v })}
        />
      </div>
    </>
  )
}

type Props = {
  rule: RuleInput | null
  onSave: (rule: RuleInput | null) => Promise<void>
  itemName: string
  idPrefix: string
}

// The expandable body: "No progression" switch plus the fields when a rule exists
export function RuleEditor({ rule, onSave, itemName, idPrefix }: Props) {
  const step = useProfile().data?.weight_increment ?? 5
  const save = useSaveRule<RuleInput | null>(onSave)
  return (
    <div className="flex flex-col gap-3">
      <label className="flex min-h-11 items-center justify-between gap-3 text-sm font-medium">
        No progression
        <Switch
          checked={rule === null}
          aria-label={`No progression for ${itemName}`}
          onCheckedChange={(off) => void save(off ? null : defaultRule(step))}
        />
      </label>
      {rule && <RuleFields rule={rule} onSave={onSave} idPrefix={idPrefix} />}
    </div>
  )
}
