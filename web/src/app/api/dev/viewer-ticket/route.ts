/**
 * POST /api/dev/viewer-ticket `{ userId, name, platform? }` — DEV ONLY (404 in production).
 * Stands in for a host platform's server so the plugin preview (`/sandbox/partner.html`, the sheet on /host) can sign a viewer in and out.
 */
import { signViewerTicket } from '@/lib/auth/viewer-ticket'
import { json } from '@/lib/server/http'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const secret = process.env.LIVESTREAM_VIEWER_TICKET_SECRET
  if (process.env.NODE_ENV === 'production' || !secret) return json({ error: 'Not found' }, { status: 404 })
  const body = (await request.json().catch(() => ({}))) as { userId?: string; name?: string; platform?: string }
  const userId = String(body.userId || 'preview-user').replace(/[^A-Za-z0-9_.:@-]/g, '').slice(0, 64) || 'preview-user'
  const name = String(body.name || 'Viewer').slice(0, 40)
  const platform = /^[a-z][a-z0-9-]{0,19}$/.test(body.platform ?? '') ? body.platform! : 'preview'
  return json({ ticket: await signViewerTicket({ platform, userId, name }, secret) })
}
