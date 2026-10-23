import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'

// One header-level Add button shared by every Library section.
export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" className="min-h-11 min-w-11 px-4" aria-label={label} onClick={onClick}>
      <Plus aria-hidden /> Add
    </Button>
  )
}
