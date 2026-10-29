import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * A fake Agora RTM SDK with the real rule behind error -10027: one live client per user id in a
 * page, released only when `logout()` has finished.
 */
const live = new Set<string>()
let constructed = 0

let lastClient: FakeRTM | null = null
/** When set, login() waits until logout() cancels it — like the real SDK (-10023). */
let pendingLogin = false

class FakeRTM {
  listeners = new Map<string, (event: unknown) => void>()
  presence = { getOnlineUsers: async () => ({ occupants: [], totalOccupancy: 0 }) }
  constructor(
    _appId: string,
    readonly userId: string,
  ) {
    if (live.has(userId)) throw new Error('RtmUnavailableError: Error Code -10027 - The user ID is already in use')
    live.add(userId)
    constructed += 1
    // eslint-disable-next-line @typescript-eslint/no-this-alias -- the test reaches the latest client
    lastClient = this
  }
  addEventListener(name: string, listener: (event: unknown) => void) {
    this.listeners.set(name, listener)
  }
  cancelLogin: ((error: Error) => void) | null = null
  async login() {
    if (!pendingLogin) return
    await new Promise((_resolve, reject) => (this.cancelLogin = reject))
  }
  async subscribe() {}
  async unsubscribe() {}
  async publish() {}
  async logout() {
    this.cancelLogin?.(new Error('RtmUnavailableError: Error Code -10023 - Login RTM service was canceled by user.'))
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
  pendingLogin = false
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

describe('LiveChatSession — stopped while signing in', () => {
  it('a cancelled login (-10023) is not reported as an error', async () => {
    const { LiveChatSession } = await import('./rtm')
    pendingLogin = true
    const errors: string[] = []
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const session = new LiveChatSession((s) => s.error && errors.push(s.error), token('u_garage_1'))
    const starting = session.start()
    await vi.waitFor(() => expect(lastClient?.cancelLogin).toBeTruthy())
    await session.stop()
    await starting
    expect(errors).toEqual([])
    expect(consoleError).not.toHaveBeenCalled()
    expect(session.snapshot.status).toBe('idle')
    consoleError.mockRestore()
  })
})

describe('LiveChatSession — received reactions', () => {
  it('spreads a batch over the second instead of drawing it all at once', async () => {
    const { LiveChatSession } = await import('./rtm')
    const seen: number[] = []
    const session = new LiveChatSession(() => undefined, token('anon_viewer'), { onReaction: () => seen.push(Date.now()) })
    await session.start()
    const started = Date.now()
    lastClient!.listeners.get('message')!({
      channelName: 'dprlive-s1',
      publisher: 'u_drlive_7~abc123',
      message: JSON.stringify({ v: 1, t: 'reacts', counts: { love: 2, like: 2, smile: 1 } }),
    })
    expect(seen.length).toBeLessThan(5) // not all at once
    await new Promise((resolve) => setTimeout(resolve, 1_200))
    expect(seen.length).toBe(5)
    expect(Math.max(...seen) - started).toBeGreaterThan(500) // spread over the second
    await session.stop()
  })
})

