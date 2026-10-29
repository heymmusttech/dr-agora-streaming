'use client'

/**
 * One camera per browser profile.
 *
 * Every tab runs its own `HostSession`, so without this two tabs would publish two tiles from the
 * same person — and usually fail, because the first tab already holds the camera device. This lock
 * lets exactly one tab be "the camera tab" at a time:
 *
 * - **Claim** is a record in `localStorage` (shared by every tab of the profile) holding the owning
 *   tab's id and a `heartbeat` the owner refreshes. A tab that crashes stops refreshing, so the
 *   claim goes stale after `STALE_MS` and the next tab may take it. That mirrors the server-side
 *   host registry's TTL sweep.
 * - **Messages** go over a `BroadcastChannel`, so the other tabs react immediately instead of
 *   waiting for the next heartbeat: `claimed` / `released` keep their UI in step, `focus` asks the
 *   owner to bring itself forward, and `yield` asks it to end so the asking tab can take over.
 *
 * This is a convenience, not a security control: `localStorage` can be cleared. The real limit
 * belongs on the server, which refuses a second publisher token for the same user
 * (`docs/12-phase-3-in-page-hosting.md` §5, the presence rules).
 *
 * Everything degrades to "no lock" when the APIs are missing (old browser, SSR), so the camera
 * still works — it just stops being exclusive.
 */

const CLAIM_KEY = 'app-live-stream-camera-claim'
const CHANNEL_NAME = 'app-live-stream-camera'
/** The owner refreshes this often; other tabs treat a claim older than `STALE_MS` as abandoned. */
const HEARTBEAT_MS = 2_000
const STALE_MS = 6_000

export interface CameraClaim {
  /** `tabId` of the tab that owns the camera. */
  tabId: string
  /** What the owner is broadcasting as. The admin's camera carries the stream, so it is not handed over. */
  role: 'admin' | 'host' | 'guest'
  /** The registry host id that tab publishes under (kept so the server sees one host, not two). */
  hostId: string
  /** When the broadcast started, for "live for 4 min" in the other tabs. */
  since: number
  /** Last refresh; a claim older than `STALE_MS` is ignored. */
  heartbeat: number
}

type Message =
  | { type: 'claimed'; claim: CameraClaim }
  | { type: 'released'; tabId: string }
  /** "Bring yourself forward" — sent to the owner when another tab presses Switch. */
  | { type: 'focus'; tabId: string }
  /** "End your broadcast, I'm taking over" — sent to the owner when another tab takes over. */
  | { type: 'yield'; tabId: string }

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

/** This tab's id, stable for the life of the document. */
let tabId: string | null = null
export function getTabId(): string {
  return (tabId ??= uid())
}

/**
 * The host id this browser publishes under. Shared across tabs (`localStorage`), so a takeover
 * replaces the same host in the registry instead of adding a second one. Falls back to a per-tab
 * id when storage is unavailable (private mode with storage disabled).
 */
const HOST_ID_KEY = 'app-live-stream-host-id'
export function getSharedHostId(): string {
  try {
    const existing = localStorage.getItem(HOST_ID_KEY)
    if (existing) return existing
    const created = uid()
    localStorage.setItem(HOST_ID_KEY, created)
    return created
  } catch {
    return getTabId()
  }
}

function readRaw(): CameraClaim | null {
  try {
    const raw = localStorage.getItem(CLAIM_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<CameraClaim>
    if (typeof parsed?.tabId !== 'string' || typeof parsed.heartbeat !== 'number') return null
    return {
      tabId: parsed.tabId,
      role: parsed.role === 'admin' || parsed.role === 'guest' ? parsed.role : 'host',
      hostId: typeof parsed.hostId === 'string' ? parsed.hostId : parsed.tabId,
      since: typeof parsed.since === 'number' ? parsed.since : parsed.heartbeat,
      heartbeat: parsed.heartbeat,
    }
  } catch {
    return null
  }
}

/** The live claim, or `null` when there is none or the owner stopped refreshing it. */
export function readClaim(): CameraClaim | null {
  const claim = readRaw()
  if (!claim) return null
  return Date.now() - claim.heartbeat > STALE_MS ? null : claim
}

/** Another tab of this browser is on camera right now. */
export function claimedByOtherTab(): CameraClaim | null {
  const claim = readClaim()
  return claim && claim.tabId !== getTabId() ? claim : null
}

function post(message: Message): void {
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channel.postMessage(message)
    channel.close()
  } catch {
    // No BroadcastChannel: the storage event below still reaches the other tabs.
  }
}

function write(claim: CameraClaim | null): void {
  try {
    if (claim) localStorage.setItem(CLAIM_KEY, JSON.stringify(claim))
    else localStorage.removeItem(CLAIM_KEY)
  } catch {
    // Storage unavailable: the lock is simply inactive.
  }
}

/**
 * Take the camera for this tab and keep the claim fresh. Returns the release function; call it when
 * the broadcast ends. Safe to call when another tab holds the claim — the caller checks first, and
 * a takeover intentionally overwrites.
 */
export function acquireCameraLock(hostId: string, role: CameraClaim['role']): () => void {
  const claim: CameraClaim = { tabId: getTabId(), role, hostId, since: Date.now(), heartbeat: Date.now() }
  write(claim)
  post({ type: 'claimed', claim })

  const timer = setInterval(() => {
    claim.heartbeat = Date.now()
    write(claim)
  }, HEARTBEAT_MS)

  let released = false
  const release = () => {
    if (released) return
    released = true
    clearInterval(timer)
    // Only clear the record if it is still ours: a takeover has already replaced it.
    if (readRaw()?.tabId === getTabId()) write(null)
    post({ type: 'released', tabId: getTabId() })
    window.removeEventListener('pagehide', release)
  }
  // A closed or reloaded tab frees the camera at once, rather than after the stale timeout.
  window.addEventListener('pagehide', release)
  return release
}

/**
 * Watch the lock from a tab that is not broadcasting. `onChange` fires with the other tab's claim
 * (or `null` when the camera is free here). Polling covers a tab that was closed without firing
 * `pagehide`; the events make the common cases instant.
 */
export function watchCameraLock(onChange: (claim: CameraClaim | null) => void): () => void {
  let last: string | null = null
  const emit = () => {
    const claim = claimedByOtherTab()
    const key = claim ? `${claim.tabId}:${claim.since}` : null
    if (key === last) return
    last = key
    onChange(claim)
  }
  emit()

  const timer = setInterval(emit, HEARTBEAT_MS)
  const onStorage = (event: StorageEvent) => {
    if (event.key === CLAIM_KEY || event.key === null) emit()
  }
  window.addEventListener('storage', onStorage)

  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<Message>) => {
      if (event.data?.type === 'claimed' || event.data?.type === 'released') emit()
    }
  } catch {
    // Falls back to the storage event and the poll.
  }

  return () => {
    clearInterval(timer)
    window.removeEventListener('storage', onStorage)
    channel?.close()
  }
}

/**
 * Listen for requests aimed at the tab that owns the camera: `focus` (another tab wants this one
 * brought forward) and `yield` (another tab is taking over, so end the broadcast).
 */
export function listenAsCameraOwner(handlers: { onFocus: () => void; onYield: () => void }): () => void {
  let channel: BroadcastChannel | null = null
  try {
    channel = new BroadcastChannel(CHANNEL_NAME)
    channel.onmessage = (event: MessageEvent<Message>) => {
      const data = event.data
      if (data?.type !== 'focus' && data?.type !== 'yield') return
      if (data.tabId === getTabId()) return // our own message, echoed back
      if (data.type === 'focus') handlers.onFocus()
      else handlers.onYield()
    }
  } catch {
    // Without BroadcastChannel the two buttons can't reach the owner; the UI hides them (§canSignal).
  }
  return () => channel?.close()
}

/** Whether Switch / Take over can reach the other tab (they need BroadcastChannel). */
export function canSignalOtherTabs(): boolean {
  return typeof BroadcastChannel !== 'undefined'
}

/** Ask the owning tab to bring itself to the front. */
export const requestFocusOwner = (): void => post({ type: 'focus', tabId: getTabId() })

/**
 * Make this tab findable when another tab presses Switch.
 *
 * `window.focus()` does nothing for a background tab: raising a tab needs a user gesture *in that
 * tab*, which we don't have. So the owner flags itself instead — it flashes its `document.title`,
 * which is what the person actually scans the tab strip for, and calls `window.focus()` anyway for
 * the browsers that still honour it. The flashing stops as soon as the tab becomes visible.
 *
 * Returns a cleanup that restores the title.
 */
export function flagThisTab(): () => void {
  // Already on screen: nothing to find. (Also the case in headless browsers, where every tab
  // reports itself visible.) Just try to raise the window and leave the title alone.
  if (document.visibilityState === 'visible') {
    try {
      window.focus()
    } catch {
      // ignore
    }
    return () => undefined
  }

  const original = document.title
  let on = false
  const timer = setInterval(() => {
    on = !on
    document.title = on ? '👉 Your camera is here' : original
  }, 700)

  const stop = () => {
    clearInterval(timer)
    document.title = original
    document.removeEventListener('visibilitychange', onSeen)
    window.removeEventListener('focus', onSeen)
    clearTimeout(limit)
  }
  /**
   * Clear the flag only once the person is actually looking at this tab. `window.focus()` below
   * can fire a `focus` event synchronously, so ignore anything while the tab is still hidden —
   * otherwise the flag would cancel itself the moment it was raised.
   */
  function onSeen() {
    if (document.visibilityState === 'visible') stop()
  }
  document.addEventListener('visibilitychange', onSeen)
  window.addEventListener('focus', onSeen)
  // Never flash forever if the person does not come back.
  const limit = setTimeout(stop, 30_000)

  // Harmless where it is ignored; still works in a popup or when the tab is already foreground.
  try {
    window.focus()
  } catch {
    // ignore
  }
  return stop
}

/** Ask the owning tab to end its broadcast so this tab can go live. */
export const requestYieldOwner = (): void => post({ type: 'yield', tabId: getTabId() })
