/**
 * Server-side host authentication for every `/api/editor/*`, `/api/hosts/*` and publisher-token
 * route: `Authorization: Bearer <Keycloak access token>`, verified against the realm's JWKS.
 *
 * Dev bypass: `NEXT_PUBLIC_HOST_AUTH=false` (never in production) accepts any request and names
 * the host from the `x-dev-host` header, so automated tests can run several hosts.
 */
import 'server-only'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { checkHostClaims, HostAuthError, parseDomains, type HostIdentity } from '@/lib/auth/host-claims'

export { HostAuthError, type HostIdentity }

const KEYCLOAK_URL = (process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? '').replace(/\/$/, '')
const REALM = process.env.NEXT_PUBLIC_KEYCLOAK_REALM || 'mrkt'
const CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || 'auction-stream'
const DOMAINS = parseDomains(process.env.HOST_ALLOWED_EMAIL_DOMAINS)

export const hostAuthBypassed = (): boolean =>
  process.env.NODE_ENV !== 'production' && process.env.NEXT_PUBLIC_HOST_AUTH === 'false'

const issuer = `${KEYCLOAK_URL}/realms/${REALM}`
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null

function keySet() {
  if (!KEYCLOAK_URL) throw new HostAuthError('Keycloak is not configured on this server.', 401, 'HOST_AUTH_UNCONFIGURED')
  jwks ??= createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`), { cooldownDuration: 30_000 })
  return jwks
}

export async function verifyHostToken(token: string): Promise<HostIdentity> {
  let payload: Record<string, unknown>
  try {
    ;({ payload } = await jwtVerify(token, keySet(), { issuer, clockTolerance: 30 }))
  } catch (error) {
    if (error instanceof HostAuthError) throw error
    throw new HostAuthError('Your session expired. Sign in again.', 401, 'HOST_TOKEN_INVALID')
  }
  return checkHostClaims(payload, { clientId: CLIENT_ID, domains: DOMAINS })
}

function devHost(request: Request): HostIdentity {
  const raw = (request.headers.get('x-dev-host') ?? 'Dev Host').trim().slice(0, 40) || 'Dev Host'
  const slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'dev-host'
  return { sub: `dev-${slug}`, email: `${slug}@dupontregistry.com`, name: raw }
}

/** The signed-in host, or throws `HostAuthError` (401 no/bad token, 403 not allowed). */
export async function requireHost(request: Request): Promise<HostIdentity> {
  if (hostAuthBypassed()) return devHost(request)
  const header = request.headers.get('authorization') ?? ''
  const token = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  if (!token) throw new HostAuthError('Sign in with your duPont Registry account.', 401, 'HOST_TOKEN_MISSING')
  return verifyHostToken(token)
}
