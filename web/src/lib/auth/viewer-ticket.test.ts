import { SignJWT } from 'jose'
import { describe, expect, it } from 'vitest'
import { signViewerTicket, verifyViewerTicket, viewerRtmId } from './viewer-ticket'

const secret = 'x'.repeat(48)
const env = { LIVESTREAM_VIEWER_TICKET_SECRET: secret, LIVESTREAM_VIEWER_TICKET_SECRET_GARAGE: 'g'.repeat(48) }

describe('viewer tickets', () => {
  it('round-trips a ticket and derives the RTM id', async () => {
    const ticket = await signViewerTicket({ platform: 'drlive', userId: 'ABC-123', name: 'Jane D.' }, secret)
    const viewer = await verifyViewerTicket(ticket, env)
    expect(viewer).toEqual({ platform: 'drlive', userId: 'ABC-123', name: 'Jane D.', avatar: null })
    expect(viewerRtmId(viewer!)).toBe('u_drlive_ABC-123')
  })

  it('uses the per-platform secret when there is one', async () => {
    const wrong = await signViewerTicket({ platform: 'garage', userId: '1', name: 'A' }, secret)
    expect(await verifyViewerTicket(wrong, env)).toBeNull()
    const right = await signViewerTicket({ platform: 'garage', userId: '1', name: 'A' }, 'g'.repeat(48))
    expect((await verifyViewerTicket(right, env))?.platform).toBe('garage')
  })

  it('rejects forged, expired, long-lived and malformed tickets', async () => {
    const forged = await signViewerTicket({ platform: 'drlive', userId: '1', name: 'A' }, 'y'.repeat(48))
    expect(await verifyViewerTicket(forged, env)).toBeNull()

    const key = new TextEncoder().encode(secret)
    const now = Math.floor(Date.now() / 1000)
    const expired = await new SignJWT({ name: 'A' }).setProtectedHeader({ alg: 'HS256' }).setIssuer('drlive').setSubject('1').setIssuedAt(now - 600).setExpirationTime(now - 300).sign(key)
    expect(await verifyViewerTicket(expired, env)).toBeNull()

    const longLived = await new SignJWT({ name: 'A' }).setProtectedHeader({ alg: 'HS256' }).setIssuer('drlive').setSubject('1').setIssuedAt(now).setExpirationTime(now + 3600).sign(key)
    expect(await verifyViewerTicket(longLived, env)).toBeNull()

    const noIat = await new SignJWT({ name: 'A' }).setProtectedHeader({ alg: 'HS256' }).setIssuer('drlive').setSubject('1').setExpirationTime(now + 60).sign(key)
    expect(await verifyViewerTicket(noIat, env)).toBeNull()

    expect(await verifyViewerTicket('not-a-jwt-at-all-really', env)).toBeNull()
    expect(await verifyViewerTicket(42, env)).toBeNull()
    expect(await verifyViewerTicket(await signViewerTicket({ platform: 'drlive', userId: '1', name: 'A' }, secret), {})).toBeNull()
  })
})
