import { describe, expect, it } from 'vitest'
import { capacityOf, CHAT_HISTORY, cleanSnapshot, normalizeMaxHosts } from './rules'
import { canPost, hostRtmId, isHostId } from './ids'

describe('stream rules', () => {
  it('max hosts: 1 in single mode, 2…4 in multi', () => {
    expect(normalizeMaxHosts(3, 'single', 2)).toBe(1)
    expect(normalizeMaxHosts(3, 'multi', 2)).toBe(3)
    expect(normalizeMaxHosts(9, 'multi', 2)).toBe(4)
    expect(normalizeMaxHosts(1, 'multi', 2)).toBe(2)
    expect(normalizeMaxHosts('x', 'multi', 3)).toBe(3)
    expect(capacityOf('single', 4)).toBe(1)
    expect(capacityOf('multi', 3)).toBe(3)
  })

  it('snapshot: keeps the last 50 valid messages, caps totals, dedupes muted ids', () => {
    const messages = Array.from({ length: 60 }, (_, i) => ({ id: `m${i}`, userId: 'u_drlive_1', name: 'A', text: 'hi', at: i, host: false }))
    const snap = cleanSnapshot(
      {
        messages: [...messages, { id: 'bad', text: 5 }, { id: 'long', userId: 'u', name: 'A', text: 'x'.repeat(301), at: 1 }],
        mutedUserIds: ['u_a', 'u_a', 7],
        totals: { love: 3.7, like: -1, smile: 'x', extra: 9 },
      },
      's1',
    )
    expect(snap.messages).toHaveLength(CHAT_HISTORY)
    expect(snap.messages[0]!.id).toBe('m10')
    expect(snap.mutedUserIds).toEqual(['u_a'])
    expect(snap.totals).toEqual({ love: 3, like: 0, smile: 0 })
    expect(snap.sessionId).toBe('s1')
  })

  it('RTM ids: hosts and ticket holders may post, guests may not', () => {
    expect(hostRtmId('a:b/c')).toBe('host_a_b_c')
    expect(isHostId('host_x')).toBe(true)
    expect(canPost('u_drlive_1')).toBe(true)
    expect(canPost('anon_123')).toBe(false)
  })
})
