/**
 * The session snapshot: last 50 chat messages, muted viewers, reaction totals.
 * GET (public) — a viewer joining late loads the history and totals.
 * PUT (host)   — the hosts' client is the authority; it saves the snapshot as chat and reactions arrive.
 */
import { requireHost } from '@/lib/server/host-auth'
import { errorResponse, json, rateLimited } from '@/lib/server/http'
import { isOnAir } from '@/lib/stream/registry'
import { getSnapshot, roleFor, saveSnapshot } from '@/lib/stream/state'

export const dynamic = 'force-dynamic'

export function GET() {
  return json(getSnapshot())
}

export async function PUT(request: Request) {
  try {
    const host = await requireHost(request)
    // The admin keeps the snapshot; a co-host may too while on air (e.g. the admin's tab is in the background).
    if (roleFor(host.sub) !== 'admin' && !isOnAir(host.sub))
      return json({ error: 'Only the hosts of this session can save it.', code: 'HOST_NOT_IN_SESSION' }, { status: 403 })
    if (rateLimited(`snapshot:${host.sub}`, 60, 60_000))
      return json({ error: 'Too many updates.', code: 'RATE_LIMITED' }, { status: 429 })
    const body = await request.json().catch(() => ({}))
    return json(saveSnapshot(body))
  } catch (error) {
    return errorResponse(error)
  }
}
