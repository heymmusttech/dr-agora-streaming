/**
 * POST /api/stream/viewers `{ count }` — the leading host's measurement of people watching (Agora
 * presence), shared with every viewer through the status. One host measures; viewers no longer
 * each ask Agora every few seconds.
 */
import { requireHost } from '@/lib/server/host-auth'
import { errorResponse, json, rateLimited } from '@/lib/server/http'
import { isOnAir } from '@/lib/stream/registry'
import { roleFor, setViewerCount } from '@/lib/stream/state'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const host = await requireHost(request)
    if (roleFor(host.sub) !== 'admin' && !isOnAir(host.sub))
      return json({ error: 'Only the hosts of this session can report viewers.', code: 'HOST_NOT_IN_SESSION' }, { status: 403 })
    if (rateLimited(`viewers:${host.sub}`, 30, 60_000)) return json({ error: 'Too many updates.', code: 'RATE_LIMITED' }, { status: 429 })
    const body = (await request.json().catch(() => ({}))) as { count?: unknown }
    if (typeof body.count !== 'number' || !Number.isFinite(body.count) || body.count < 0)
      return json({ error: 'count must be a number ≥ 0.', code: 'VIEWERS_INVALID' }, { status: 422 })
    return json({ viewers: setViewerCount(body.count) })
  } catch (error) {
    return errorResponse(error)
  }
}
