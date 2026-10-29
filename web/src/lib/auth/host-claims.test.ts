import { describe, expect, it } from 'vitest'
import { checkHostClaims, HostAuthError, isAllowedEmail, parseDomains } from './host-claims'

const rules = { clientId: 'auction-stream', domains: parseDomains('dupontregistry.com,dupontregistrygroup.com') }
const base = {
  sub: 'kc-1',
  azp: 'auction-stream',
  email: 'Jane.Doe@dupontregistry.com',
  email_verified: true,
  given_name: 'Jane',
  family_name: 'Doe',
}

const code = (payload: Record<string, unknown>) => {
  try {
    checkHostClaims(payload, rules)
    return 'ok'
  } catch (error) {
    return error instanceof HostAuthError ? `${error.status}:${error.code}` : 'other'
  }
}

describe('host claims (Keycloak)', () => {
  it('accepts a verified dr / drg email issued to our client', () => {
    expect(checkHostClaims(base, rules)).toEqual({ sub: 'kc-1', email: 'jane.doe@dupontregistry.com', name: 'Jane Doe' })
    expect(code({ ...base, email: 'a@dupontregistrygroup.com' })).toBe('ok')
    expect(code({ ...base, email: 'a@team.dupontregistry.com' })).toBe('ok')
  })

  it('rejects other domains, look-alikes, unverified and missing emails', () => {
    expect(code({ ...base, email: 'a@gmail.com' })).toBe('403:HOST_DOMAIN_NOT_ALLOWED')
    expect(code({ ...base, email: 'a@evildupontregistry.com' })).toBe('403:HOST_DOMAIN_NOT_ALLOWED')
    expect(code({ ...base, email: 'a@dupontregistry.com.evil.io' })).toBe('403:HOST_DOMAIN_NOT_ALLOWED')
    expect(code({ ...base, email_verified: false })).toBe('403:HOST_EMAIL_UNVERIFIED')
    expect(code({ ...base, email: undefined, preferred_username: 'a@dupontregistry.com' })).toBe('403:HOST_EMAIL_MISSING')
  })

  it('rejects tokens issued to another client of the realm', () => {
    expect(code({ ...base, azp: 'marketplace-web' })).toBe('401:HOST_TOKEN_WRONG_CLIENT')
    expect(code({ ...base, azp: 'other', aud: ['auction-stream'] })).toBe('ok')
    expect(code({ ...base, sub: '' })).toBe('401:HOST_TOKEN_INVALID')
  })

  it('parses the domain list', () => {
    expect(parseDomains('')).toEqual(['dupontregistry.com', 'dupontregistrygroup.com'])
    expect(parseDomains(' @Foo.com , bar.io')).toEqual(['foo.com', 'bar.io'])
    expect(isAllowedEmail('no-at-sign', ['foo.com'])).toBe(false)
  })
})
