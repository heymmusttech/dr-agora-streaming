'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchViewerRtcToken, ViewerSession, type RtcTokenProvider, type ViewerSnapshot } from '@/lib/stream/agora'
import { LIVE_CHANNEL } from '@/lib/stream/channel'
import type { OnAirHost } from '@/lib/stream/types'

const INITIAL: ViewerSnapshot = {
  status: 'idle',
  muted: true,
  volume: 0,
  orientation: 'landscape',
  stats: null,
  participants: [],
  error: null,
}

type TileRef = (node: HTMLDivElement | null) => void

/**
 * Viewer side of the channel. Joins while `enabled` (the stream is live) and leaves when it turns
 * off. Every host on air is a participant with its own video tile, named from `hosts` (the status'
 * on-air list); `participantRef(id)` is the stable ref for that tile's element.
 */
export function useViewerStream(
  enabled: boolean,
  hosts: OnAirHost[] | null | undefined,
  getToken: RtcTokenProvider = fetchViewerRtcToken,
) {
  const sessionRef = useRef<ViewerSession | null>(null)
  // Tile elements by participant id — kept here so a re-created session can re-attach them.
  const containers = useRef(new Map<string, HTMLDivElement>())
  const tileRefs = useRef(new Map<string, TileRef>())
  const [snapshot, setSnapshot] = useState<ViewerSnapshot>(INITIAL)

  const tokenRef = useRef(getToken)
  tokenRef.current = getToken

  useEffect(() => {
    const session = new ViewerSession(setSnapshot, () => tokenRef.current())
    sessionRef.current = session
    containers.current.forEach((node, id) => session.attachParticipant(id, node))
    return () => {
      sessionRef.current = null
      void session.stop()
    }
  }, [])

  const namesKey = (hosts ?? []).map((host) => `${host.uid}:${host.name}`).join('|')
  useEffect(() => {
    sessionRef.current?.setNames(new Map((hosts ?? []).map((host) => [String(host.uid), host.name])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey])

  useEffect(() => {
    const session = sessionRef.current
    if (!session) return
    if (enabled) void session.start()
    // Stay while a host is mid-flip / reconnecting; leave once the channel is empty.
    else if (session.snapshot.status === 'waiting' || session.snapshot.status === 'error')
      void session.stop()
  }, [enabled, snapshot.status])

  /** Stable per-participant callback ref (a new function each render would replay the video). */
  const participantRef = useCallback((id: string): TileRef => {
    let ref = tileRefs.current.get(id)
    if (!ref) {
      ref = (node) => {
        if (node) containers.current.set(id, node)
        else containers.current.delete(id)
        sessionRef.current?.attachParticipant(id, node)
      }
      tileRefs.current.set(id, ref)
    }
    return ref
  }, [])

  return {
    ...snapshot,
    channel: LIVE_CHANNEL,
    participantRef,
    setMuted: (muted: boolean) => sessionRef.current?.setMuted(muted),
    setVolume: (volume: number) => sessionRef.current?.setVolume(volume),
    retry: () => {
      const session = sessionRef.current
      if (!session) return
      void session.stop().then(() => session.start())
    },
  }
}
