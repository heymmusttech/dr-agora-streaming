'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { EMPTY_TOTALS, REACTIONS, type ReactionKind, type ReactionTotals } from '@/lib/stream/types'

/** A click not confirmed by the server within this long is dropped (it wasn't counted). */
const PENDING_MS = 4_000

/**
 * Reaction counts that answer a click at once: the server's real totals plus this viewer's own
 * clicks the server hasn't reported back yet. When the next totals arrive with the increase, the
 * pending click is absorbed, so the number never jumps back or double-counts.
 */
export function useOptimisticReactions(server: ReactionTotals) {
  const [pending, setPending] = useState<ReactionTotals>({ ...EMPTY_TOTALS })
  const previous = useRef(server)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  // Real totals went up: those increases cover our pending clicks first.
  useEffect(() => {
    const before = previous.current
    previous.current = server
    setPending((current) => {
      let changed = false
      const next = { ...current }
      for (const kind of REACTIONS) {
        const delta = server[kind] - before[kind]
        if (delta > 0 && next[kind] > 0) {
          next[kind] = Math.max(0, next[kind] - delta)
          changed = true
        }
        // A new session (totals reset): nothing of ours is pending any more.
        if (server[kind] < before[kind]) {
          next[kind] = 0
          changed = true
        }
      }
      return changed ? next : current
    })
  }, [server])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  /** Counts one click locally until the server confirms it. */
  const bump = useCallback((kind: ReactionKind) => {
    setPending((current) => ({ ...current, [kind]: current[kind] + 1 }))
    timers.current.push(
      setTimeout(() => setPending((current) => ({ ...current, [kind]: Math.max(0, current[kind] - 1) })), PENDING_MS),
    )
  }, [])

  const totals: ReactionTotals = {
    love: server.love + pending.love,
    like: server.like + pending.like,
    smile: server.smile + pending.smile,
  }
  return { totals, bump }
}
