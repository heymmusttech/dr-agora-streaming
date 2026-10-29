'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { INITIAL_CHAT, LiveChatSession, type ChatOptions, type ChatState, type RtmTokenProvider } from '@/lib/stream/rtm'
import type { ReactionKind } from '@/lib/stream/types'

export interface FloatingReaction {
  id: number
  kind: ReactionKind
  /** 0…1 horizontal jitter. */
  x: number
}

const MAX_PARTICLES = 40
const PARTICLE_MS = 2_400

/**
 * Chat + reactions + viewer count for the stream (`lib/stream/rtm.ts`). Connects while `enabled`;
 * a new `sessionKey` (stream session, or the viewer signing in / out) reconnects with a fresh token.
 */
export function useLiveChat({
  enabled,
  sessionKey,
  getToken,
  adminUserId = null,
  persist,
  sendReaction,
}: {
  enabled: boolean
  sessionKey: string
  getToken: RtmTokenProvider
  adminUserId?: string | null
  persist?: ChatOptions['persist']
  /** Counts a reaction on the server (the only counter; totals come back with the status). */
  sendReaction?: ChatOptions['sendReaction']
}) {
  const [state, setState] = useState<ChatState>(INITIAL_CHAT)
  const [particles, setParticles] = useState<FloatingReaction[]>([])
  const sessionRef = useRef<LiveChatSession | null>(null)
  const tokenRef = useRef(getToken)
  tokenRef.current = getToken
  const persistRef = useRef(persist)
  persistRef.current = persist
  const adminRef = useRef(adminUserId)
  adminRef.current = adminUserId
  const reactRef = useRef(sendReaction)
  reactRef.current = sendReaction
  const nextId = useRef(0)

  const onReaction = useCallback((kind: ReactionKind) => {
    const id = ++nextId.current
    setParticles((list) => [...list.slice(-(MAX_PARTICLES - 1)), { id, kind, x: Math.random() }])
    setTimeout(() => setParticles((list) => list.filter((p) => p.id !== id)), PARTICLE_MS)
  }, [])

  useEffect(() => {
    if (!enabled) return
    // Only the current session may update the state: a previous one (e.g. the guest session being
    // replaced by the signed-in one) still reports while it shuts down and would wipe the new state.
    let current = true
    const session = new LiveChatSession((next) => current && setState(next), (conn) => tokenRef.current(conn), {
      adminUserId: adminRef.current,
      persist: persistRef.current ? (snapshot) => persistRef.current!(snapshot) : undefined,
      sendReaction: (kind) => reactRef.current?.(kind) ?? Promise.resolve(),
      onReaction,
    })
    sessionRef.current = session
    // Started on the next tick: React's dev double-mount (mount → cleanup → mount) then never
    // creates a throw-away RTM client — each one shows up as an "Ins id is N" warning.
    const timer = setTimeout(() => void session.start(), 0)
    return () => {
      current = false
      clearTimeout(timer)
      sessionRef.current = null
      setState(INITIAL_CHAT)
      void session.stop()
    }
  }, [enabled, sessionKey, onReaction])

  useEffect(() => {
    sessionRef.current?.setAdminUserId(adminUserId)
  }, [adminUserId])

  return {
    ...state,
    particles,
    sendChat: (text: string, name?: string | null) => sessionRef.current?.sendChat(text, name) ?? Promise.resolve(false),
    react: (kind: ReactionKind) => sessionRef.current?.react(kind) ?? false,
    deleteMessage: (id: string) => sessionRef.current?.deleteMessage(id),
    setMuted: (userId: string, muted: boolean) => sessionRef.current?.setMuted(userId, muted),
  }
}

export type LiveChat = ReturnType<typeof useLiveChat>
