/** Shared stream types (client + server). */

export type StreamOrientation = 'portrait' | 'landscape'

/**
 * Who is publishing: `admin` = the host who started the stream (their camera is the stream),
 * `host` = another Keycloak host who joined as co-host from `/host` (multi-host only).
 */
export type HostRole = 'admin' | 'host'

/** `single`: only the admin on camera. `multi`: up to `maxHosts` cameras, Agora splits the screen. */
export type LiveStreamHostMode = 'single' | 'multi'

export const MAX_HOSTS_LIMIT = 4

/** One camera on air (heartbeat registry). `uid` is its Agora RTC uid, so tiles can show a name. */
export interface OnAirHost {
  uid: number
  name: string
  role: HostRole
  since: number
  orientation: StreamOrientation
}

/** Cameras on air in the channel. */
export interface LiveStreamEntry {
  channel: string
  /** When the first camera went on air (ms). */
  since: number
  orientation: StreamOrientation
  hosts: number
  admins: number
  /** In on-air order. */
  participants: OnAirHost[]
}

export type RtcRole = 'publisher' | 'subscriber'

export interface RtcTokenResponse {
  token: string
  appId: string
  channel: string
  /** RTC uid the token is bound to (0 = any uid). */
  uid: number
  /** Epoch ms. */
  expiresAt: number
}

export interface RtmTokenResponse {
  token: string
  appId: string
  channel: string
  /** RTM user id the token is bound to: `host_…`, `u_{platform}_{id}` or `anon_…`. */
  userId: string
  /** Display name (null for guests). */
  name: string | null
  /** Epoch ms. */
  expiresAt: number
}

export interface StreamStats {
  rtt: number
  fps: number
  /** kbps */
  bitrate: number
  resolution: string
}

/** Viewer lifecycle (3 s grace on unpublish). */
export type ViewerStatus =
  | 'idle'
  | 'connecting'
  /** In the channel, no host video yet. */
  | 'waiting'
  | 'live'
  /** Host unpublished; within the grace period before showing offline. */
  | 'reconnecting'
  | 'error'

/** Why the last session ended: a host pressed Stop, or the admin's camera went off air. */
export type LiveStreamStopReason = 'editor' | 'admin-ended'

/** A host as shown to others (never the email). */
export interface HostIdentityPublic {
  sub: string
  name: string
}

/**
 * The stream status — Start/Stop plus who is on air. Same shape on the server
 * (`/api/stream/status`, SSE feed) and in the client store.
 */
export interface AppLiveStreamStatus {
  /** A host started the stream. Drives the LIVE badge and the Join pill. */
  isLive: boolean
  title: string | null
  hostMode: LiveStreamHostMode
  /** Cameras allowed on air at once (1 in single mode). */
  maxHosts: number
  /** Agora channel (`Live`). */
  channel: string
  sessionId: string | null
  /** ms */
  startedAt: number | null
  startedBy: HostIdentityPublic | null
  /** ms */
  stoppedAt: number | null
  /** Prefill after Stop. */
  lastTitle: string | null
  stopReason: LiveStreamStopReason | null
  /** Cameras publishing in the channel; null when nobody is. */
  host: LiveStreamEntry | null
  /**
   * Reaction totals of the current session, counted by the server (`POST /api/stream/react`), so
   * every screen shows the same real numbers. Zeros while offline.
   */
  reactions: ReactionTotals
  /**
   * People watching, as measured by the leading host's chat client and reported to the server
   * (`POST /api/stream/viewers`) — one measurement for everyone instead of every viewer asking
   * Agora. Null while offline or before the first report.
   */
  viewers: number | null
  /**
   * The session's private RTM channel (chat, reactions, viewer presence) — never shared with other
   * apps on the same Agora project or with earlier sessions. Null while offline.
   */
  chatChannel: string | null
  /** ms */
  serverTime: number
}

/** The small, frequent part of the status (reactions, viewers), pushed at most once a second. */
export interface LiveCounts {
  sessionId: string | null
  reactions: ReactionTotals
  viewers: number | null
  serverTime: number
}

export type LiveStreamFeedStatus = 'idle' | 'connecting' | 'connected' | 'polling' | 'disconnected'

/* ───────────── Chat + reactions (RTM) ───────────── */

export const REACTIONS = ['love', 'like', 'smile'] as const
export type ReactionKind = (typeof REACTIONS)[number]
export const REACTION_EMOJI: Record<ReactionKind, string> = { love: '❤️', like: '👍', smile: '😄' }

export type ReactionTotals = Record<ReactionKind, number>
export const EMPTY_TOTALS: ReactionTotals = { love: 0, like: 0, smile: 0 }

export interface ChatMessage {
  id: string
  /** RTM user id of the sender (trusted: taken from RTM's `publisher`, not the payload). */
  userId: string
  name: string
  text: string
  /** ms */
  at: number
  /** Sent by a host. */
  host: boolean
}

/** What the host keeps for the session: chat history, moderation and reaction totals. */
export interface SessionSnapshot {
  sessionId: string | null
  messages: ChatMessage[]
  mutedUserIds: string[]
  totals: ReactionTotals
  /** ms */
  updatedAt: number
}
