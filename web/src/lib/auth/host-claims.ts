/**
 * Who may host: a Keycloak user of our realm, signed in through our client, with a verified
 * duPont Registry (dr / drg) email. Pure functions so the rules are unit-tested
 * (`host-claims.test.ts`); the JWT signature itself is verified in `server/host-auth.ts`.
 *
 * Stricter than auction-stream's Lambda (`lambda/token/keycloak.mjs`), which checks only the
 * issuer and falls back to `preferred_username` / `username`: here the token must be issued to our
 * client (`azp`), the email must be verified, and only the `email` claim counts.
 */

export interface HostIdentity {
  /** Keycloak subject (stable user id). */
  sub: string
  email: string
  /** Display name for chat and tiles. */
  name: string
}

export class HostAuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
    readonly code: string,
  ) {
    super(message)
  }
}

export const DEFAULT_HOST_DOMAINS = ['dupontregistry.com', 'dupontregistrygroup.com']

export function parseDomains(value: string | undefined): string[] {
  const domains = (value ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase().replace(/^@/, ''))
    .filter(Boolean)
  return domains.length > 0 ? domains : DEFAULT_HOST_DOMAINS
}

/** `a@dupontregistry.com` and `a@team.dupontregistry.com` pass; `a@evildupontregistry.com` does not. */
export function isAllowedEmail(email: string, domains: string[]): boolean {
  const at = email.lastIndexOf('@')
  if (at < 1) return false
  const host = email.slice(at + 1).toLowerCase()
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`))
}

export interface HostClaimRules {
  clientId: string
  domains: string[]
}

/** Checks a verified Keycloak access token's claims and returns the host. Throws `HostAuthError`. */
export function checkHostClaims(payload: Record<string, unknown>, rules: HostClaimRules): HostIdentity {
  const sub = typeof payload.sub === 'string' ? payload.sub : ''
  if (!sub) throw new HostAuthError('The token has no subject.', 401, 'HOST_TOKEN_INVALID')

  const audience = Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : []
  const issuedToUs = payload.azp === rules.clientId || audience.includes(rules.clientId)
  if (!issuedToUs) throw new HostAuthError('The token was not issued to this app.', 401, 'HOST_TOKEN_WRONG_CLIENT')

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : ''
  if (!email) throw new HostAuthError('Your account has no email address.', 403, 'HOST_EMAIL_MISSING')
  if (payload.email_verified !== true)
    throw new HostAuthError('Verify your email address before hosting.', 403, 'HOST_EMAIL_UNVERIFIED')
  if (!isAllowedEmail(email, rules.domains))
    throw new HostAuthError(
      `Hosting is limited to ${rules.domains.map((domain) => `@${domain}`).join(' / ')} accounts.`,
      403,
      'HOST_DOMAIN_NOT_ALLOWED',
    )

  const given = typeof payload.given_name === 'string' ? payload.given_name.trim() : ''
  const family = typeof payload.family_name === 'string' ? payload.family_name.trim() : ''
  const full = typeof payload.name === 'string' ? payload.name.trim() : ''
  const name = (full || [given, family].filter(Boolean).join(' ') || email.split('@')[0]!).slice(0, 60)
  return { sub, email, name }
}
