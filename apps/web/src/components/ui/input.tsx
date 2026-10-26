import * as React from "react"
import { cn } from "@/lib/utils"

// Filled field, no outline: the fill comes from --field (page colour inside a surface), and
// focus shows the accent ring. Shared with native <select>s.
export const fieldClass =
  "w-full min-w-0 rounded-field border border-transparent bg-field px-3.5 text-base text-foreground outline-none placeholder:text-muted-foreground hover:border-border-strong focus-visible:border-transparent focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        fieldClass,
        "h-12 py-1 file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export { Input }
