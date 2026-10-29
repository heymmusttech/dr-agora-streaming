/**
 * POST /api/stream/react `{ kind, ticket? }` — counts one reaction (love / like / smile).
 *
 * The server is the only counter, so every screen shows the same, real totals (they reach
 * everyone with the status feed). Who may react: a signed-in viewer (valid viewer ticket) or a
 * host (Keycloak bearer token / dev header). Each person counts at most 5 reactions per second.
 */
import { verifyViewerTicket, viewerRtmId } from '@/lib/auth/viewer-ticket'
import { hostAuthBypassed, requireHost } from '@/lib/server/host-auth'
import { clientIp, corsHeaders, errorResponse, json, rateLimited } from '@/lib/server/http'
import { hostRtmId } from '@/lib/stream/ids'
import { addReaction } from '@/lib/stream/state'
import { REACTIONS, type ReactionKind } from '@/lib/stream/types'

export const dynamic = 'force-dynamic'

async function reactorId(request: Request, ticket: unknown): Promise<string | null> {
  const asHost = request.headers.has('authorization') || (hostAuthBypassed() && request.headers.has('x-dev-host'))
  if (asHost) return hostRtmId((await requireHost(request)).sub)
  const viewer = await verifyViewerTicket(ticket)
  return viewer ? viewerRtmId(viewer) : null
}

export async function POST(request: Request) {
  const headers = corsHeaders(request, 'POST, OPTIONS')
  try {
    if (rateLimited(`react-ip:${clientIp(request)}`, 60, 1_000))
      return json({ error: 'Too many reactions.', code: 'RATE_LIMITED' }, { status: 429, headers })
    const body = (await request.json().catch(() => ({}))) as { kind?: string; ticket?: unknown }
    const kind = body.kind as ReactionKind
    if (!REACTIONS.includes(kind)) return json({ error: 'Unknown reaction.', code: 'REACTION_INVALID' }, { status: 422, headers })
    const who = await reactorId(request, body.ticket)
    if (!who) return json({ error: 'Sign in to react.', code: 'REACTION_SIGN_IN' }, { status: 401, headers })
    // Capped per person: a held-down button can't inflate the totals.
    if (rateLimited(`react:${who}`, 5, 1_000)) return json({ counted: false }, { headers })
    return json({ counted: true, totals: addReaction(kind) }, { headers })
  } catch (error) {
    return errorResponse(error, headers)
  }
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request, 'POST, OPTIONS') })
}
