/**
 * Agora tokens (replaces auction-stream's token Lambda). The App Certificate never leaves the
 * server. RTC: subscriber tokens for viewers (uid 0 = any uid), publisher tokens bound to the
 * host's own uid. RTM: bound to the user id we choose, so the sender of a chat message is trusted.
 */
import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import { RtcRole, RtcTokenBuilder, RtmTokenBuilder } from 'agora-token'
import { LIVE_CHANNEL } from '@/lib/stream/channel'
import type { RtcRole as Role, RtcTokenResponse, RtmTokenResponse } from '@/lib/stream/types'

export class AgoraConfigError extends Error {}

function config() {
  const appId = process.env.NEXT_PUBLIC_AGORA_APP_ID
  const certificate = process.env.AGORA_APP_CERTIFICATE
  if (!appId || !certificate)
    throw new AgoraConfigError('Agora is not configured: set NEXT_PUBLIC_AGORA_APP_ID and AGORA_APP_CERTIFICATE.')
  const ttl = Math.max(300, Number(process.env.AGORA_TOKEN_TTL_SECONDS) || 3600)
  return { appId, certificate, ttl }
}

/** A host's RTC uid: stable per Keycloak subject, 1…2^31-1 (so tiles can be named). */
export function hostUid(sub: string): number {
  const n = createHash('sha256').update(`host:${sub}`).digest().readUInt32BE(0) & 0x7fffffff
  return n === 0 ? 1 : n
}

export function rtcToken(role: Role, uid = 0): RtcTokenResponse {
  const { appId, certificate, ttl } = config()
  const token = RtcTokenBuilder.buildTokenWithUid(
    appId,
    certificate,
    LIVE_CHANNEL,
    uid,
    role === 'publisher' ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER,
    ttl,
    ttl,
  )
  return { token, appId, channel: LIVE_CHANNEL, uid, expiresAt: Date.now() + ttl * 1000 }
}

/**
 * RTM token for `userId`, plus the chat channel to subscribe to: the live session's private
 * channel (`chatChannelFor`), so other apps on the Agora project never mix into our chat,
 * reactions or viewer count.
 */
export function rtmToken(identity: string, name: string | null, chatChannel: string | null, connection?: unknown): RtmTokenResponse {
  const { appId, certificate, ttl } = config()
  // One RTM id per connection (`ids.ts`): the client keeps its tag for renewals, so they match.
  const tag = isConnectionTag(connection) ? connection : randomBytes(4).toString('hex')
  const userId = `${identity.slice(0, MAX_IDENTITY)}${CONNECTION_SEPARATOR}${tag}`
  const token = RtmTokenBuilder.buildToken(appId, certificate, userId, ttl)
  return { token, appId, channel: chatChannel ?? `${LIVE_CHANNEL}-idle`, userId, name, expiresAt: Date.now() + ttl * 1000 }
}

export { hostRtmId } from '@/lib/stream/ids'
import { CONNECTION_SEPARATOR, isConnectionTag, MAX_IDENTITY } from '@/lib/stream/ids'

/** Guests: watch, count as viewers, read chat — can't post (receivers drop `anon_*`). */
export const anonymousRtmId = (): string => `anon_${randomBytes(8).toString('hex')}`
