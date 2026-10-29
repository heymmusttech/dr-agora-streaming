/** GET /api/editor/me — the signed-in host as the server sees them (and their role in the current session). */
import { hostAuthBypassed, requireHost } from '@/lib/server/host-auth'
import { errorResponse, json } from '@/lib/server/http'
import { roleFor } from '@/lib/stream/state'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const host = await requireHost(request)
    return json({ host, role: roleFor(host.sub), bypass: hostAuthBypassed() })
  } catch (error) {
    return errorResponse(error)
  }
}
