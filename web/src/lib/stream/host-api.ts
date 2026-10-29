'use client'

/** Browser calls for hosts: Start / Stop, camera presence, tokens, session snapshot. */
import { hostFetch } from '@/lib/auth/host-session'
import { applyLiveStreamStatus } from './live-store'
import type {
  AppLiveStreamStatus,
  HostRole,
  LiveStreamEntry,
  LiveStreamHostMode,
  ReactionKind,
  RtcTokenResponse,
  RtmTokenResponse,
  SessionSnapshot,
  StreamOrientation,
} from './types'

async function withStatus(path: string, body?: unknown): Promise<AppLiveStreamStatus> {
  const status = await hostFetch<AppLiveStreamStatus>(path, { body })
  // The feed delivers it too; applying it here flips the page before the round-trip.
  applyLiveStreamStatus(status)
  return status
}

export interface StartLiveStreamInput {
  title?: string
  hostMode?: LiveStreamHostMode
  maxHosts?: number
}

export const startLiveStream = (input: StartLiveStreamInput) => withStatus('/api/editor/stream/start', input)
export const stopLiveStream = () => withStatus('/api/editor/stream/stop', {})

/**
 * Tell the server the admin camera is moving between tabs, so it leaving the registry does not
 * stop the stream. Fire-and-forget.
 */
export const beginCameraHandover = (): void => {
  void hostFetch('/api/editor/stream/handover', { body: {} }).catch(() => undefined)
}

export const sendHostHeartbeat = (orientation: StreamOrientation) =>
  hostFetch<{ host: LiveStreamEntry }>('/api/hosts/heartbeat', { body: { orientation } })

export const endHostPresence = (keepalive = false) =>
  hostFetch('/api/hosts/heartbeat', { method: 'DELETE', keepalive }).catch(() => undefined)

export interface PublisherTokens {
  rtc: RtcTokenResponse
  rtm: RtmTokenResponse
  role: HostRole
}

export const fetchPublisherTokens = () => hostFetch<PublisherTokens>('/api/token/host', { body: { kind: 'publisher' } })

/** `conn`: the chat connection's tag, so a renewal is for the same RTM id. */
export const fetchHostRtmToken = (conn?: string) =>
  hostFetch<{ rtm: RtmTokenResponse; role: HostRole }>('/api/token/host', { body: { kind: 'listener', conn } })

/** Counts the host's own reaction on the server. */
export const sendHostReaction = (kind: ReactionKind) => hostFetch('/api/stream/react', { body: { kind } })

export const saveSessionSnapshot = (snapshot: Omit<SessionSnapshot, 'updatedAt' | 'sessionId'>) =>
  hostFetch<SessionSnapshot>('/api/stream/snapshot', { method: 'PUT', body: snapshot })
