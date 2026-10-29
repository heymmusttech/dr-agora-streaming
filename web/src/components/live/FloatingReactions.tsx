'use client'

/** Reactions rising over the video — everyone's, live. Purely decorative (aria-hidden). */
import type { FloatingReaction } from '@/hooks/useLiveChat'
import { REACTION_EMOJI } from '@/lib/stream/types'
import { cn } from '@/lib/utils'

export function FloatingReactions({ particles, className }: { particles: FloatingReaction[]; className?: string }) {
  return (
    <div aria-hidden className={cn('pointer-events-none absolute bottom-16 right-2 top-1/4 z-[15] w-20 overflow-visible', className)}>
      {particles.map((particle) => (
        <span
          key={particle.id}
          className="reaction-particle absolute bottom-0 text-2xl drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]"
          style={{ left: `${Math.round(particle.x * 60)}%`, height: '100%', display: 'flex', alignItems: 'flex-end' }}
        >
          {REACTION_EMOJI[particle.kind]}
        </span>
      ))}
    </div>
  )
}
