/**
 * POST /api/token/host `{ kind: 'publisher' | 'listener' }` — Keycloak host only.
 *   publisher → RTC publisher token bound to the host's uid (stream live + a free camera slot),
 *               plus their RTM token (`host_{sub}`), so moderation messages are trusted.
 *   listener  → RTM token only (the editor's chat panel before going on camera).
 */
import { hostRtmId, hostUid, rtcToken, rtmToken } from '@/lib/server/agora-tokens'
import { requireHost } from '@/lib/server/host-auth'
import { errorResponse, json, rateLimited } from '@/lib/server/http'
import { hasSlot } from '@/lib/stream/registry'
import { cameraCapacity, getStatus, isLive, roleFor } from '@/lib/stream/state'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const host = await requireHost(request)
    if (rateLimited(`host-token:${host.sub}`, 30, 60_000))
      return json({ error: 'Too many token requests.', code: 'RATE_LIMITED' }, { status: 429 })
    const body = (await request.json().catch(() => ({}))) as { kind?: string; conn?: unknown }
    const rtm = rtmToken(hostRtmId(host.sub), host.name, getStatus().chatChannel, body.conn)
    if (body.kind !== 'publisher') return json({ rtm, role: roleFor(host.sub) })

    if (!isLive())
      return json({ error: 'Start the stream first, then go live.', code: 'LIVESTREAM_OFFLINE' }, { status: 409 })
    if (!hasSlot(host.sub, cameraCapacity()))
      return json(
        { error: `All ${cameraCapacity()} camera slot${cameraCapacity() > 1 ? 's are' : ' is'} taken.`, code: 'HOSTS_FULL' },
        { status: 409 },
      )
    return json({ rtc: rtcToken('publisher', hostUid(host.sub)), rtm, role: roleFor(host.sub) })
  } catch (error) {
    return errorResponse(error)
  }
}
