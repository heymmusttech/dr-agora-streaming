/**
 * GET /api/stream/status — the public stream status. The plugin polls it (CORS for allowed
 * embedding sites) to show the LIVE pill before anything connects to the video.
 */
import { corsHeaders, json } from '@/lib/server/http'
import { getStatus } from '@/lib/stream/state'

export const dynamic = 'force-dynamic'

export function GET(request: Request) {
  const s = getStatus()
  // Public view: who started it is shown by name only; nothing else about hosts leaves the server.
  return json(s, { headers: corsHeaders(request) })
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}
