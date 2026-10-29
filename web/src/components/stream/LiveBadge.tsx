import { cn } from '@/lib/utils'

/** Red "LIVE" pill with one pulsing dot (a second broadcast glyph read as a duplicate icon). */
export function LiveBadge({ className, label = 'LIVE' }: { className?: string; label?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded bg-dr-live-container px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-white shadow-lg',
        className,
      )}
    >
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white opacity-75 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
      </span>
      {label}
    </span>
  )
}
