/** POST /api/editor/stream/stop — Keycloak host. Idempotent. Co-hosts can't stop while the admin is on camera. */
import { requireHost } from '@/lib/server/host-auth'
import { errorResponse, json } from '@/lib/server/http'
import { canStop, stopStream } from '@/lib/stream/state'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const host = await requireHost(request)
    if (!canStop(host.sub))
      return json(
        { error: 'Only the host who started the stream can stop it while they are on camera.', code: 'HOST_NOT_ADMIN' },
        { status: 403 },
      )
    return json(stopStream('editor'))
  } catch (error) {
    return errorResponse(error)
  }
}
