/**
 * POST /api/token/viewer `{ ticket? }` — what the player needs to watch and chat.
 *   rtc: subscriber token (uid 0).
 *   rtm: bound to `u_{platform}_{id}` for a valid viewer ticket, else to an anonymous `anon_…`
 *        id (guests watch, read chat and count as viewers; their messages are dropped).
 * Rate-limited per IP.
 */
import { verifyViewerTicket, viewerRtmId } from '@/lib/auth/viewer-ticket'
import { anonymousRtmId, rtcToken, rtmToken } from '@/lib/server/agora-tokens'
import { clientIp, errorResponse, json, rateLimited } from '@/lib/server/http'
import { getStatus } from '@/lib/stream/state'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    if (rateLimited(`viewer-token:${clientIp(request)}`, 120, 60_000))
      return json({ error: 'Too many token requests.', code: 'RATE_LIMITED' }, { status: 429 })
    const body = (await request.json().catch(() => ({}))) as { ticket?: unknown; rtcOnly?: boolean; conn?: unknown }
    const viewer = body.ticket ? await verifyViewerTicket(body.ticket) : null
    const rtc = rtcToken('subscriber')
    if (body.rtcOnly) return json({ rtc })
    const chatChannel = getStatus().chatChannel
    const rtm = viewer
      ? rtmToken(viewerRtmId(viewer), viewer.name, chatChannel, body.conn)
      : rtmToken(anonymousRtmId(), null, chatChannel, body.conn)
    return json({
      rtc,
      rtm,
      viewer: viewer ? { name: viewer.name, platform: viewer.platform, avatar: viewer.avatar } : null,
      // Tells the player a ticket was sent but rejected (expired / forged), so it can ask for a new one.
      ticketRejected: Boolean(body.ticket) && !viewer,
    })
  } catch (error) {
    return errorResponse(error)
  }
}
