import { cn } from "@/lib/utils"

// Visual "Step X of Y" indicator for the sequential-reading flow. Purely
// display — the actual can't-skip-ahead enforcement lives server-side
// (current_step only moves forward via GREATEST(), server.js ~4489) and in
// SecureFormRenderer only ever calling onAdvance with currentStep + 1.
export function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between text-xs font-medium text-muted-foreground">
        <span>Step {Math.min(current + 1, total)} of {total}</span>
        <span>{Math.round((Math.min(current, total) / total) * 100)}% read</span>
      </div>
      <div className="flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i < current ? "bg-success" : i === current ? "bg-primary" : "bg-muted"
            )}
          />
        ))}
      </div>
    </div>
  )
}
