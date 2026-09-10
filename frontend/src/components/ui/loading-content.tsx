import { cn } from '@/lib/utils'

export function LoadingContent({ label, className }: { label: string; className?: string }) {
  return (
    <div role="status" className={cn('space-y-3 py-4', className)}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <div aria-hidden="true" className="space-y-2 animate-pulse motion-reduce:animate-none">
        <div className="h-4 w-1/3 rounded bg-muted" />
        <div className="h-3 w-full rounded bg-muted" />
        <div className="h-3 w-11/12 rounded bg-muted" />
        <div className="h-3 w-3/4 rounded bg-muted" />
      </div>
    </div>
  )
}
