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
  // Cacheable for 2 s by a CDN (CloudFront in front of this app): however many sites poll, the
  // origin answers about once per 2 s. Browsers don't cache it (max-age=0).
  return json(s, {
    headers: { ...corsHeaders(request), 'Cache-Control': 'public, max-age=0, s-maxage=2, stale-while-revalidate=5' },
  })
}

export function OPTIONS(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}
