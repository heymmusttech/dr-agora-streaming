import { MAX_IDENTITY } from '@/lib/stream/ids'
/**
 * Viewer tickets: how a host platform (dR Live web, dR Garage app, …) tells the stream who its
 * signed-in user is, without sharing its own session.
 *
 * The platform's **server** signs a short-lived HS256 JWT with a secret it shares with us:
 *
 *   { iss: "drlive", sub: "<user id>", name: "Jane D.", avatar?: "https://…", iat, exp }   (≤ 15 min)
 *
 * The plugin passes it to the player, the player sends it to `/api/token/viewer`, and the RTM
 * user id we bind the chat token to (`u_{iss}_{sub}`) is derived from it — so a chat message's
 * sender can't be faked by the browser.
 *
 * Secrets: `LIVESTREAM_VIEWER_TICKET_SECRET`, or per platform
 * `LIVESTREAM_VIEWER_TICKET_SECRET_<ISS>` (e.g. `_GARAGE`) when platforms must not share one.
 */
import { decodeJwt, jwtVerify, SignJWT } from 'jose'

export interface ViewerIdentity {
  platform: string
  userId: string
  name: string
  avatar: string | null
}

/** Longest a ticket may live (exp − iat). */
export const MAX_TICKET_SECONDS = 15 * 60

const PLATFORM = /^[a-z][a-z0-9-]{0,19}$/
const USER_ID = /^[A-Za-z0-9_.:@-]{1,64}$/

type Env = Record<string, string | undefined>

export function ticketSecretFor(platform: string, env: Env = process.env): Uint8Array | null {
  const value = env[`LIVESTREAM_VIEWER_TICKET_SECRET_${platform.toUpperCase().replace(/-/g, '_')}`] ?? env.LIVESTREAM_VIEWER_TICKET_SECRET
  return value && value.length >= 32 ? new TextEncoder().encode(value) : null
}

/** Valid ticket → the viewer; anything else (missing, expired, forged, too long-lived) → null. */
export async function verifyViewerTicket(ticket: unknown, env: Env = process.env): Promise<ViewerIdentity | null> {
  if (typeof ticket !== 'string' || ticket.length < 20 || ticket.length > 4096) return null
  let platform: string
  try {
    const claims = decodeJwt(ticket)
    platform = typeof claims.iss === 'string' ? claims.iss : ''
  } catch {
    return null
  }
  if (!PLATFORM.test(platform)) return null
  const secret = ticketSecretFor(platform, env)
  if (!secret) return null
  try {
    const { payload } = await jwtVerify(ticket, secret, {
      algorithms: ['HS256'],
      issuer: platform,
      requiredClaims: ['sub', 'exp', 'iat'],
      clockTolerance: 30,
    })
    if ((payload.exp ?? 0) - (payload.iat ?? 0) > MAX_TICKET_SECONDS) return null
    const userId = String(payload.sub)
    if (!USER_ID.test(userId)) return null
    const name = typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim().slice(0, 40) : 'Viewer'
    const avatar =
      typeof payload.avatar === 'string' && /^https:\/\//.test(payload.avatar) ? payload.avatar.slice(0, 500) : null
    return { platform, userId, name, avatar }
  } catch {
    return null
  }
}

/** What a platform server does (also used by our dev endpoint and tests). */
export async function signViewerTicket(
  identity: { platform: string; userId: string; name: string; avatar?: string | null },
  secret: string,
  ttlSeconds = 10 * 60,
): Promise<string> {
  return new SignJWT({ name: identity.name, ...(identity.avatar ? { avatar: identity.avatar } : {}) })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(identity.platform)
    .setSubject(identity.userId)
    .setIssuedAt()
    .setExpirationTime(`${Math.min(ttlSeconds, MAX_TICKET_SECONDS)}s`)
    .sign(new TextEncoder().encode(secret))
}

/** RTM user id for a ticket holder: `u_{platform}_{id}` (RTM ids: ≤ 64 chars, no spaces). */
export const viewerRtmId = (viewer: ViewerIdentity): string =>
  `u_${viewer.platform}_${viewer.userId.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, MAX_IDENTITY)
