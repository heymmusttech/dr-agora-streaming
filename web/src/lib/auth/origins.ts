/**
 * Origin allow-list for the sites that may embed the player and call the public status API:
 * `LIVESTREAM_ALLOWED_PARENT_ORIGINS`, comma-separated, `*` = one or more subdomain labels or any
 * port — e.g. `https://*.dupontregistry.com,https://*.dra.tools,http://localhost:*`.
 * A `*.` pattern also matches the bare domain (`https://dupontregistry.com`).
 */

export const DEFAULT_PARENT_ORIGINS =
  'https://dupontregistry.com,https://*.dupontregistry.com,https://*.dra.tools,http://localhost:*,http://127.0.0.1:*'

const escape = (value: string) => value.replace(/[.+?^${}()|[\]\\]/g, '\\$&')

export function originPatterns(list: string | undefined = DEFAULT_PARENT_ORIGINS): string[] {
  return (list || DEFAULT_PARENT_ORIGINS)
    .split(',')
    .map((item) => item.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

function toRegExp(pattern: string): RegExp {
  const match = /^(https?):\/\/(.+)$/i.exec(pattern)
  if (!match) return /$^/
  const [, scheme, rest] = match
  let host = rest!
  let port = ''
  const colon = host.lastIndexOf(':')
  if (colon > -1) {
    port = host.slice(colon + 1)
    host = host.slice(0, colon)
  }
  const hostPart = host.startsWith('*.')
    ? `([a-z0-9-]+\\.)*${escape(host.slice(2))}`
    : escape(host)
  const portPart = port === '*' ? '(:\\d+)?' : port ? `:${escape(port)}` : ''
  return new RegExp(`^${scheme}://${hostPart}${portPart}$`, 'i')
}

export function isAllowedOrigin(origin: string | null | undefined, patterns: string[]): boolean {
  if (!origin || origin === 'null') return false
  return patterns.some((pattern) => toRegExp(pattern).test(origin))
}
