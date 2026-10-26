import { cn } from '@/lib/utils'

// Placeholder rows shown while a list loads; announced once as "Loading".
export function SkeletonRows({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('flex flex-col gap-2', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="bg-card h-16 rounded-row" />
      ))}
    </div>
  )
}
