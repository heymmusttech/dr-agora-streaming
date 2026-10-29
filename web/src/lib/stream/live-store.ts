'use client'

/**
 * Client store of the stream status, fed by the SSE feed (`/api/live-stream/events`). One
 * connection per tab, opened while a hook subscribes and closed 10 s after the last one leaves.
 * Falls back to polling `/api/stream/status` when EventSource is unavailable or
 * `NEXT_PUBLIC_LIVESTREAM_TRANSPORT=poll`.
 *
 * Rules: last write wins by `serverTime`; a feed drop never ends playback — only a status with
 * `isLive: false` does. (The visitor's Join / minimise / dismiss state lives in the plugin.)
 */
import type { AppLiveStreamStatus, LiveStreamFeedStatus } from './types'

const IDLE_CLOSE_MS = 10_000
const POLL_MS = Math.max(1_000, Number(process.env.NEXT_PUBLIC_LIVESTREAM_POLL_MS) || 5_000)
const FORCE_POLL = process.env.NEXT_PUBLIC_LIVESTREAM_TRANSPORT === 'poll'

let status: AppLiveStreamStatus | null = null
let feedStatus: LiveStreamFeedStatus = 'idle'
const listeners = new Set<() => void>()
const feedListeners = new Set<() => void>()

function notify() {
  listeners.forEach((listener) => listener())
}
function setFeedStatus(next: LiveStreamFeedStatus) {
  if (feedStatus === next) return
  feedStatus = next
  feedListeners.forEach((listener) => listener())
}

/** Applies a status unless the store already has a newer one. */
export function applyLiveStreamStatus(next: AppLiveStreamStatus): void {
  if (status && status.serverTime > next.serverTime) return
  status = next
  notify()
}

/** Server-rendered initial status — applied only if the store has nothing yet. */
export function seedLiveStreamStatus(initial: AppLiveStreamStatus | null | undefined): void {
  if (!initial || status) return
  status = initial
  notify()
}

export const getLiveStreamStatus = (): AppLiveStreamStatus | null => status
export const getLiveStreamStatusOnServer = (): AppLiveStreamStatus | null => null
export const getLiveStreamFeedStatus = (): LiveStreamFeedStatus => feedStatus
export const getLiveStreamFeedStatusOnServer = (): LiveStreamFeedStatus => 'idle'

export function subscribeLiveStream(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function subscribeLiveStreamFeed(listener: () => void): () => void {
  feedListeners.add(listener)
  return () => feedListeners.delete(listener)
}

// ── Connection (ref-counted) ─────────────────────────────────────

let subscribers = 0
let source: EventSource | null = null
let pollTimer: ReturnType<typeof setInterval> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null

async function pollOnce() {
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
  try {
    const response = await fetch('/api/stream/status', { cache: 'no-store' })
    if (!response.ok) throw new Error(String(response.status))
    applyLiveStreamStatus((await response.json()) as AppLiveStreamStatus)
    setFeedStatus('polling')
  } catch {
    setFeedStatus('disconnected')
  }
}

function onVisible() {
  if (document.visibilityState === 'visible') void pollOnce()
}

function startPolling() {
  if (pollTimer) return
  void pollOnce()
  pollTimer = setInterval(() => void pollOnce(), POLL_MS)
  document.addEventListener('visibilitychange', onVisible)
}

function open() {
  if (source || pollTimer) return
  if (FORCE_POLL || typeof EventSource === 'undefined') {
    startPolling()
    return
  }
  setFeedStatus('connecting')
  const next = new EventSource('/api/live-stream/events')
  source = next
  next.addEventListener('app-livestream-status', (event) => {
    applyLiveStreamStatus(JSON.parse((event as MessageEvent<string>).data) as AppLiveStreamStatus)
    setFeedStatus('connected')
  })
  next.onopen = () => setFeedStatus('connected')
  // EventSource retries by itself; the first event after reconnect re-syncs the store.
  next.onerror = () => setFeedStatus(next.readyState === EventSource.CLOSED ? 'disconnected' : 'connecting')
}

function close() {
  source?.close()
  source = null
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
    document.removeEventListener('visibilitychange', onVisible)
  }
  setFeedStatus('idle')
}

/** Keeps the feed open while the caller is mounted. Returns the release function. */
export function acquireLiveStreamFeed(): () => void {
  subscribers += 1
  if (idleTimer) {
    clearTimeout(idleTimer)
    idleTimer = null
  }
  open()
  let released = false
  return () => {
    if (released) return
    released = true
    subscribers -= 1
    if (subscribers > 0) return
    idleTimer = setTimeout(() => {
      idleTimer = null
      if (subscribers === 0) close()
    }, IDLE_CLOSE_MS)
  }
}
