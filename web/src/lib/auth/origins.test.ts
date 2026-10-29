import { describe, expect, it } from 'vitest'
import { isAllowedOrigin, originPatterns } from './origins'

const patterns = originPatterns('https://dupontregistry.com,https://*.dupontregistry.com,https://*.dra.tools,http://localhost:*')

describe('parent origin allow-list', () => {
  it('matches the platforms', () => {
    for (const origin of [
      'https://dupontregistry.com',
      'https://live.dupontregistry.com',
      'https://a.b.dupontregistry.com',
      'https://new-dev.dra.tools',
      'http://localhost:3000',
      'http://localhost',
    ])
      expect(isAllowedOrigin(origin, patterns), origin).toBe(true)
  })

  it('rejects look-alikes, other schemes and null', () => {
    for (const origin of [
      'https://evildupontregistry.com',
      'https://dupontregistry.com.evil.io',
      'http://live.dupontregistry.com',
      'https://localhost:3000',
      'null',
      '',
      null,
    ])
      expect(isAllowedOrigin(origin, patterns), String(origin)).toBe(false)
  })
})
