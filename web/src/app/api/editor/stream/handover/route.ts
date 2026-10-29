/**
 * POST /api/editor/stream/handover — "my camera is moving between tabs; hold the stream".
 * Without it, the admin camera leaving the registry during a tab takeover would stop the stream.
 */
import { requireHost } from '@/lib/server/host-auth'
import { errorResponse, json } from '@/lib/server/http'
import { beginAdminHandover, roleFor } from '@/lib/stream/state'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const host = await requireHost(request)
    if (roleFor(host.sub) === 'admin') beginAdminHandover()
    return json({ ok: true })
  } catch (error) {
    return errorResponse(error)
  }
}
