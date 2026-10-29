/** POST /api/editor/stream/start — `{ title?, hostMode?, maxHosts? }`. Keycloak host. Idempotent (also updates a live stream). */
import { requireHost } from '@/lib/server/host-auth'
import { errorResponse, json } from '@/lib/server/http'
import { startStream } from '@/lib/stream/state'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const host = await requireHost(request)
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    return json(startStream({ title: body.title, hostMode: body.hostMode, maxHosts: body.maxHosts, by: host }))
  } catch (error) {
    return errorResponse(error)
  }
}
