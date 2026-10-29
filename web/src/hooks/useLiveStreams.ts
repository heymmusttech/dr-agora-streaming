'use client'

import { useEffect, useSyncExternalStore } from 'react'
import {
  acquireLiveStreamFeed,
  getLiveStreamFeedStatus,
  getLiveStreamFeedStatusOnServer,
  getLiveStreamStatus,
  getLiveStreamStatusOnServer,
  seedLiveStreamStatus,
  subscribeLiveStream,
  subscribeLiveStreamFeed,
} from '@/lib/stream/live-store'
import type { AppLiveStreamStatus } from '@/lib/stream/types'

/** Keeps the live-stream feed (SSE) open while mounted. */
export function useLiveStreamFeed(): void {
  useEffect(() => acquireLiveStreamFeed(), [])
}

/** The feed's connection state — shown as a chip in the editor. */
export function useLiveStreamFeedStatus() {
  return useSyncExternalStore(subscribeLiveStreamFeed, getLiveStreamFeedStatus, getLiveStreamFeedStatusOnServer)
}

/**
 * The stream status, pushed in real time. `initial` is the server-rendered status, so the page is
 * right on first paint.
 */
export function useAppLiveStream(initial?: AppLiveStreamStatus | null): AppLiveStreamStatus | null {
  useLiveStreamFeed()
  // Seeding during render is deliberate: the first `getSnapshot` must already see it.
  if (initial && typeof window !== 'undefined') seedLiveStreamStatus(initial)
  const status = useSyncExternalStore(subscribeLiveStream, getLiveStreamStatus, getLiveStreamStatusOnServer)
  return status ?? initial ?? null
}
