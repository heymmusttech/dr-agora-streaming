'use client'

/**
 * Love / like / smile with live totals (the host's counts). Guests see the buttons too; pressing
 * one asks them to sign in (`onBlocked`).
 */
import { Eye } from 'lucide-react'
import { REACTIONS, REACTION_EMOJI, type ReactionKind, type ReactionTotals } from '@/lib/stream/types'
import { cn } from '@/lib/utils'

const LABEL: Record<ReactionKind, string> = { love: 'Love', like: 'Like', smile: 'Smile' }

const compactNumber = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })

export function ReactionBar({
  totals,
  onReact,
  canReact,
  onBlocked,
  tone = 'dark',
  vertical = false,
  className,
}: {
  totals: ReactionTotals
  onReact: (kind: ReactionKind) => void
  canReact: boolean
  /** Called instead of `onReact` when the viewer may not react (guest / muted). */
  onBlocked?: () => void
  tone?: 'dark' | 'light'
  vertical?: boolean
  className?: string
}) {
  return (
    <div role="group" aria-label="Reactions" className={cn('flex gap-1.5', vertical ? 'flex-col' : 'flex-row', className)}>
      {REACTIONS.map((kind) => (
        <button
          key={kind}
          type="button"
          aria-label={`${LABEL[kind]} (${totals[kind]})`}
          title={canReact ? LABEL[kind] : 'Sign in to react'}
          onClick={() => (canReact ? onReact(kind) : onBlocked?.())}
          className={cn(
            'inline-flex h-10 items-center justify-center gap-1 rounded-full px-3 font-manrope text-xs font-semibold tabular-nums transition-transform active:scale-90',
            tone === 'dark'
              ? 'bg-black/55 text-white ring-1 ring-white/15 backdrop-blur hover:bg-black/70'
              : 'border border-outline-variant bg-surface-1 text-foreground hover:border-dr-live-container',
            vertical && 'h-auto min-w-12 flex-col gap-0 px-2 py-1.5',
          )}
        >
          <span className="text-base leading-none" aria-hidden>
            {REACTION_EMOJI[kind]}
          </span>
          <span>{compactNumber.format(totals[kind])}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * Viewers watching now, as a pill identical to the reaction pills (same size, same style) so the
 * counts read as one row everywhere: player, plugin, host stage.
 */
export function ViewerCount({
  count,
  tone = 'dark',
  className,
  testId,
}: {
  count: number | null
  tone?: 'dark' | 'light'
  className?: string
  testId?: string
}) {
  return (
    <span
      title="Watching now"
      aria-label={`${count ?? 0} watching`}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-1 rounded-full px-3 font-manrope text-xs font-semibold tabular-nums',
        tone === 'dark' ? 'bg-black/55 text-white ring-1 ring-white/15 backdrop-blur' : 'border border-outline-variant bg-surface-1 text-foreground',
        className,
      )}
    >
      <Eye className="h-4 w-4" aria-hidden />
      <span data-testid={testId}>{count ?? '—'}</span>
    </span>
  )
}
