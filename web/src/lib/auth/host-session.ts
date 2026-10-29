'use client'

/**
 * The host's Keycloak session in the browser (same realm and client as auction-stream's `/host`:
 * `keycloak-js`, PKCE S256, no login iframe). Every host API call goes through `hostFetch`, which
 * refreshes the access token and sends it as `Authorization: Bearer …`; the server verifies it.
 *
 * Dev bypass (`NEXT_PUBLIC_HOST_AUTH=false`, ignored by the server in production): no Keycloak,
 * the host types a display name that is sent as `x-dev-host`.
 */
import type Keycloak from 'keycloak-js'

export const HOST_AUTH_ENABLED = process.env.NEXT_PUBLIC_HOST_AUTH !== 'false'

const KEYCLOAK_URL = process.env.NEXT_PUBLIC_KEYCLOAK_URL ?? ''
const REALM = process.env.NEXT_PUBLIC_KEYCLOAK_REALM || 'mrkt'
const CLIENT_ID = process.env.NEXT_PUBLIC_KEYCLOAK_CLIENT_ID || 'auction-stream'
const DEV_NAME_KEY = 'dpr-live-dev-host'

export interface HostProfile {
  name: string
  email: string
}

let keycloak: Keycloak | null = null
let initPromise: Promise<HostProfile> | null = null

function profileOf(kc: Keycloak): HostProfile {
  const t = (kc.tokenParsed ?? {}) as Record<string, unknown>
  const email = typeof t.email === 'string' ? t.email : ''
  const name =
    (typeof t.name === 'string' && t.name) ||
    [t.given_name, t.family_name].filter((part) => typeof part === 'string' && part).join(' ') ||
    email.split('@')[0] ||
    'Host'
  return { name, email }
}

/** Signs the host in (redirects to Keycloak when needed). Resolves with their profile. */
export function signInHost(): Promise<HostProfile> {
  if (!HOST_AUTH_ENABLED) {
    const name = getDevHostName()
    return Promise.resolve({ name, email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, '.')}@dupontregistry.com` })
  }
  initPromise ??= (async () => {
    if (!KEYCLOAK_URL) throw new Error('Keycloak is not configured (NEXT_PUBLIC_KEYCLOAK_URL).')
    const { default: KeycloakCtor } = await import('keycloak-js')
    const kc = new KeycloakCtor({ url: KEYCLOAK_URL, realm: REALM, clientId: CLIENT_ID })
    keycloak = kc
    // Come back to the same page (query and hash stripped of Keycloak's own parameters).
    const redirectUri = `${window.location.origin}${window.location.pathname}`
    const authenticated = await kc.init({
      onLoad: 'login-required',
      pkceMethod: 'S256',
      checkLoginIframe: false,
      responseMode: 'query',
      redirectUri,
    })
    if (!authenticated) throw new Error('Sign-in was cancelled.')
    kc.onTokenExpired = () => void kc.updateToken(30).catch(() => kc.login({ redirectUri }))
    return profileOf(kc)
  })()
  initPromise.catch(() => {
    initPromise = null
  })
  return initPromise
}

export async function signOutHost(): Promise<void> {
  if (!HOST_AUTH_ENABLED) {
    localStorage.removeItem(DEV_NAME_KEY)
    window.location.reload()
    return
  }
  await keycloak?.logout({ redirectUri: `${window.location.origin}/` })
}

export function getDevHostName(): string {
  try {
    return localStorage.getItem(DEV_NAME_KEY) || 'Dev Host'
  } catch {
    return 'Dev Host'
  }
}

export function setDevHostName(name: string): void {
  localStorage.setItem(DEV_NAME_KEY, name.trim().slice(0, 40) || 'Dev Host')
}

/** Headers that authenticate the host (fresh token). */
export async function hostAuthHeaders(): Promise<Record<string, string>> {
  if (!HOST_AUTH_ENABLED) return { 'x-dev-host': getDevHostName() }
  await signInHost()
  const kc = keycloak!
  await kc.updateToken(30).catch(() => undefined)
  return kc.token ? { Authorization: `Bearer ${kc.token}` } : {}
}

export class HostApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
  }
}

/** `fetch` for host APIs: JSON in/out, auth headers, readable errors. */
export async function hostFetch<T>(path: string, init: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(await hostAuthHeaders()) }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(path, {
    method: init.method ?? 'POST',
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
    keepalive: init.keepalive,
  })
  const data = (await response.json().catch(() => ({}))) as T & { error?: string; code?: string }
  if (!response.ok) throw new HostApiError(data.error ?? `Request failed (${response.status})`, response.status, data.code)
  return data
}
