/**
 * The caller's camera presence (Keycloak host).
 * POST   `{ orientation }` — heartbeat every 10 s while on air. 409 when the stream is offline,
 *        the mode is single and this is a co-host, or every camera slot is taken.
 * DELETE — the camera went off air (also sent with `keepalive` on pagehide).
 */
import { hostUid } from '@/lib/server/agora-tokens'
import { requireHost } from '@/lib/server/host-auth'
import { errorResponse, json } from '@/lib/server/http'
import { hasSlot, heartbeat, removeHost } from '@/lib/stream/registry'
import { cameraCapacity, isLive, roleFor } from '@/lib/stream/state'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const host = await requireHost(request)
    if (!isLive()) return json({ error: 'The stream is not live.', code: 'LIVESTREAM_OFFLINE' }, { status: 409 })
    if (!hasSlot(host.sub, cameraCapacity()))
      return json({ error: 'Every camera slot is taken.', code: 'HOSTS_FULL' }, { status: 409 })
    const body = (await request.json().catch(() => ({}))) as { orientation?: string }
    const entry = heartbeat({
      sub: host.sub,
      uid: hostUid(host.sub),
      name: host.name,
      role: roleFor(host.sub),
      orientation: body.orientation === 'portrait' ? 'portrait' : 'landscape',
    })
    return json({ host: entry })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function DELETE(request: Request) {
  try {
    const host = await requireHost(request)
    removeHost(host.sub)
    return json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
