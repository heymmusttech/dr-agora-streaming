import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A fake Agora RTM SDK with the real rule behind error -10027: one live client per user id in a
 * page, released only when `logout()` has finished.
 */
const live = new Set<string>()
let constructed = 0

class FakeRTM {
  private listeners = new Map<string, (event: unknown) => void>()
  presence = { getOnlineUsers: async () => ({ occupants: [], totalOccupancy: 0 }) }
  constructor(
    _appId: string,
    readonly userId: string,
  ) {
    if (live.has(userId)) throw new Error('RtmUnavailableError: Error Code -10027 - The user ID is already in use')
    live.add(userId)
    constructed += 1
  }
  addEventListener(name: string, listener: (event: unknown) => void) {
    this.listeners.set(name, listener)
  }
  async login() {}
  async subscribe() {}
  async unsubscribe() {}
  async publish() {}
  async logout() {
    await new Promise((resolve) => setTimeout(resolve, 30)) // logout takes a moment
    live.delete(this.userId)
  }
}

vi.mock('agora-rtm-sdk', () => ({ default: { RTM: FakeRTM } }))

/** Like the server: the RTM id is `{identity}~{connection tag}`. */
const token = (identity: string) => async (conn: string) => ({
  token: 't',
  appId: 'app',
  channel: 'dprlive-s1',
  userId: `${identity}~${conn}`,
  name: 'Jane',
  expiresAt: Date.now() + 3_600_000,
})

beforeEach(() => {
  live.clear()
  constructed = 0
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ messages: [], mutedUserIds: [] }) })))
})
afterEach(() => vi.unstubAllGlobals())

describe('LiveChatSession — one RTM id per connection', () => {
  it('two sessions of the same person run side by side (no -10027)', async () => {
    const { LiveChatSession } = await import('./rtm')
    const errors: string[] = []
    const a = new LiveChatSession((s) => s.error && errors.push(s.error), token('host_alice'))
    const b = new LiveChatSession((s) => s.error && errors.push(s.error), token('host_alice'))
    await Promise.all([a.start(), b.start()])
    expect(errors).toEqual([])
    expect(a.snapshot.status).toBe('connected')
    expect(b.snapshot.status).toBe('connected')
    expect(constructed).toBe(2)
    // Who they are is the identity, the same for both.
    expect(a.snapshot.me?.userId).toBe('host_alice')
    expect(b.snapshot.me?.userId).toBe('host_alice')
    await Promise.all([a.stop(), b.stop()])
  })

  it('a remount for the same person connects while the old one is still logging out', async () => {
    const { LiveChatSession } = await import('./rtm')
    const a = new LiveChatSession(() => undefined, token('u_drlive_1'))
    await a.start()
    void a.stop()
    const b = new LiveChatSession(() => undefined, token('u_drlive_1'))
    await b.start()
    expect(b.snapshot.status).toBe('connected')
    await b.stop()
  })
})
