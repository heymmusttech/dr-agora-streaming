/**
 * Chat, live reaction animations and viewer count over Agora RTM (Signaling 2.x), on the stream
 * session's **private** message channel (`dprlive-{sessionId}`, from the token) — never the shared
 * RTC channel `Live`, where other apps on the Agora project would mix in. Browser-only; the SDK is
 * imported lazily.
 *
 * Trust model (see `ids.ts`): the server binds every RTM token to a user id, and receivers only
 * trust RTM's `publisher` field:
 *   - chat / reactions from `anon_*` (guests) are dropped; from a muted user too;
 *   - `delete`, `mute` are accepted only from `host_*`.
 *
 * Reaction **totals** are not counted here: the server counts them (`POST /api/stream/react`,
 * capped per person) and pushes them with the status, so every screen shows the same real numbers
 * even if a host's connection drops. RTM only carries the reaction for the floating animation.
 *
 * One host client — the **leader** (the admin if online, else the first host by id) — saves the
 * session snapshot (last 50 messages, muted ids) to `/api/stream/snapshot`, which late joiners load.
 *
 * Wire format (JSON strings, `v: 1`):
 *   { t: 'chat', id, name, text }          viewer / host
 *   { t: 'react', kind }                   viewer / host (animation only)
 *   { t: 'delete', id }                    host
 *   { t: 'mute', userId, muted }           host
 */
import type { RTMClient } from 'agora-rtm-sdk'
import { canPost, identityOf, isHostId } from './ids'
import { CHAT_HISTORY, MAX_CHAT_TEXT } from './rules'
import {
  EMPTY_TOTALS,
  REACTIONS,
  type ChatMessage,
  type ReactionKind,
  type RtmTokenResponse,
  type SessionSnapshot,
} from './types'

/** `conn`: this connection's tag; the token's RTM id is `{identity}~{conn}` (see `ids.ts`). */
export type RtmTokenProvider = (conn: string) => Promise<RtmTokenResponse>

export type ChatStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

export interface ChatState {
  status: ChatStatus
  /** This client's RTM identity; null until connected. */
  me: { userId: string; name: string | null; canPost: boolean; isHost: boolean } | null
  messages: ChatMessage[]
  /** People watching this session (signed-in viewers and guests; hosts not counted). */
  viewers: number
  /** `viewers` has been measured at least once (until then show "—", never a made-up 0). */
  viewersKnown: boolean
  mutedUserIds: string[]
  /** This host client is the one saving the chat snapshot. */
  leader: boolean
  error: string | null
}

export const INITIAL_CHAT: ChatState = {
  status: 'idle',
  me: null,
  messages: [],
  viewers: 0,
  viewersKnown: false,
  mutedUserIds: [],
  leader: false,
  error: null,
}

export interface ChatOptions {
  /** RTM id of the admin (the host who started the stream) — preferred leader. */
  adminUserId?: string | null
  /** Host clients only: persists the snapshot (leader). */
  persist?: (snapshot: Omit<SessionSnapshot, 'updatedAt' | 'sessionId'>) => Promise<unknown>
  /** Every reaction seen (own included), for the floating animation. */
  onReaction?: (kind: ReactionKind) => void
  /** Counts this client's reaction on the server (the only counter). */
  sendReaction?: (kind: ReactionKind) => Promise<unknown>
}

const PRESENCE_MS = 5_000
const PERSIST_MS = 2_000
const SEND_REACT_LIMIT = 5 // per second, client-side — the same cap the server counts, so a shown click is a counted one

/** Ids of our viewers: signed-in (`u_…`) and guests (`anon_…`). Anything else is not ours to count. */
/**
 * Clients are created one after another in a page: a new session (sign-in, a new stream) waits until
 * the previous one has logged out, so two RTM clients are never alive together (Agora warns about
 * "mutual kick / client mix-up" when they are).
 */
let lastLogout: Promise<void> = Promise.resolve()

const connectionTag = () => Math.random().toString(36).slice(2, 10).padEnd(8, '0')

const isViewer = (userId: string) => userId.startsWith('u_') || userId.startsWith('anon_')

let sdk: Promise<typeof import('agora-rtm-sdk').default> | null = null
const loadRtm = () => (sdk ??= import('agora-rtm-sdk').then((module) => module.default))

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`

const cleanText = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHAT_TEXT)

export class LiveChatSession {
  private client: RTMClient | null = null
  private channel = ''
  /** This connection's RTM id (`{identity}~{tag}`) — unique, so sessions never collide (-10027). */
  private connId = ''
  private readonly conn = connectionTag()
  private state: ChatState = { ...INITIAL_CHAT }
  private stopped = false
  private presenceTimer: ReturnType<typeof setInterval> | null = null
  private persistTimer: ReturnType<typeof setInterval> | null = null
  private snapshotDirty = false
  private sentReacts: number[] = []
  private onlineHosts: string[] = []
  /** Logged in and subscribed: only then may link-state changes report `connected`. */
  private ready = false

  constructor(
    private readonly onChange: (state: ChatState) => void,
    private readonly getToken: RtmTokenProvider,
    private readonly options: ChatOptions = {},
  ) {}

  get snapshot(): ChatState {
    return this.state
  }

  private set(patch: Partial<ChatState>) {
    this.state = { ...this.state, ...patch }
    this.onChange(this.state)
  }

  setAdminUserId(adminUserId: string | null) {
    this.options.adminUserId = adminUserId
    this.electLeader()
  }

  async start() {
    if (this.client) return
    this.stopped = false
    this.set({ status: 'connecting', error: null })
    // History doesn't wait for RTM: a slow login must not leave a late joiner with an empty chat.
    void this.loadSnapshot()
    try {
      const [AgoraRTM, token] = await Promise.all([loadRtm(), this.getToken(this.conn)])
      await lastLogout
      if (this.stopped) return
      this.channel = token.channel
      this.connId = token.userId
      // The SDK's own logs go to console.error (Next's dev overlay shows them as errors). Our code
      // reports real failures itself ('[rtm] …'), so keep the SDK quiet.
      const client = new AgoraRTM.RTM(token.appId, token.userId, { logLevel: 'none', presenceTimeout: 10 })
      this.client = client
      client.addEventListener('message', (event) => {
        if (event.channelName !== this.channel || typeof event.message !== 'string') return
        this.receive(event.publisher, event.message)
      })
      client.addEventListener('linkState', (event) => {
        if (this.stopped) return
        // Before subscribe completes, CONNECTED only means "logged in": `start()` reports connected.
        if (!this.ready) return
        if (event.currentState === 'CONNECTED') {
          const recovering = this.state.status === 'reconnecting'
          this.set({ status: 'connected' })
          // Messages sent while this client was cut off are lost in RTM: catch up from the saved snapshot.
          if (recovering) void this.loadSnapshot()
        }
        else if (event.currentState === 'CONNECTING' || event.currentState === 'DISCONNECTED')
          this.set({ status: 'reconnecting' })
        else if (event.currentState === 'FAILED') this.set({ status: 'error', error: 'Chat connection failed.' })
      })
      client.addEventListener('tokenPrivilegeWillExpire', () => void this.renew())

      await client.login({ token: token.token })
      await client.subscribe(this.channel, { withMessage: true, withPresence: true })
      if (this.stopped) return
      this.ready = true
      this.set({
        status: 'connected',
        // `me.userId` is the identity (shared by all of this person's connections).
        me: { userId: identityOf(token.userId), name: token.name, canPost: canPost(token.userId), isHost: isHostId(token.userId) },
      })
      await this.loadSnapshot()
      void this.refreshPresence()
      this.presenceTimer = setInterval(() => void this.refreshPresence(), PRESENCE_MS)
      if (this.options.persist) this.persistTimer = setInterval(() => void this.flushSnapshot(), PERSIST_MS)
    } catch (error) {
      console.error('[rtm] chat failed to connect', error)
      this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      await this.leave()
    }
  }

  /**
   * Renews the RTM token before it expires. The new token must be for the *same* user: if the viewer
   * ticket had expired, the server answers with a guest token — renewing with it would fail (or sign
   * the viewer out of chat). Then wait for the host site's fresh ticket and try again.
   */
  private async renew(attempt = 0) {
    try {
      const token = await this.getToken(this.conn)
      if (this.stopped || !this.client) return
      if (token.userId !== this.connId) {
        if (attempt < 5) setTimeout(() => void this.renew(attempt + 1), 3_000)
        return
      }
      await this.client.renewToken(token.token)
    } catch (error) {
      console.error('[rtm] token renewal failed', error)
      if (attempt < 3 && !this.stopped) setTimeout(() => void this.renew(attempt + 1), 5_000)
    }
  }

  /** History and muted list saved by the leader — a late joiner starts from these. */
  private async loadSnapshot() {
    try {
      const response = await fetch('/api/stream/snapshot', { cache: 'no-store' })
      if (!response.ok) return
      const snap = (await response.json()) as SessionSnapshot
      const known = new Set(this.state.messages.map((m) => m.id))
      const messages = [...snap.messages.filter((m) => !known.has(m.id)), ...this.state.messages]
        .sort((a, b) => a.at - b.at)
        .slice(-CHAT_HISTORY)
      const muted = new Set([...snap.mutedUserIds, ...this.state.mutedUserIds])
      this.set({
        messages: messages.filter((m) => !muted.has(m.userId)),
        mutedUserIds: [...muted],
      })
    } catch {
      // History is a nicety; live chat still works.
    }
  }

  private async refreshPresence() {
    const client = this.client
    if (!client || this.stopped) return
    try {
      const result = await client.presence.getOnlineUsers(this.channel, 'MESSAGE', { includedUserId: true })
      // People, not connections: one person in two tabs counts once.
      const ids = result.occupants.map((occupant) => identityOf(occupant.userId))
      this.onlineHosts = ids.filter(isHostId).sort()
      // Count people, not connections, and only ours (the channel is the session's own anyway).
      const viewers = new Set(ids.filter(isViewer)).size
      if (viewers !== this.state.viewers || !this.state.viewersKnown) this.set({ viewers, viewersKnown: true })
      this.electLeader()
    } catch {
      // Presence can lag right after subscribing; the next tick retries.
    }
  }

  private electLeader() {
    const me = this.state.me
    if (!me?.isHost || !this.options.persist) return
    const admin = this.options.adminUserId
    const online = new Set([...this.onlineHosts, me.userId])
    const leaderId = admin && online.has(admin) ? admin : [...online].sort()[0]
    const leader = leaderId === me.userId
    if (leader !== this.state.leader) this.set({ leader })
  }

  private receive(publisher: string, raw: string) {
    let data: Record<string, unknown>
    try {
      data = JSON.parse(raw) as Record<string, unknown>
    } catch {
      return
    }
    // RTM echoes a channel message to its sender connection; our own actions were applied locally.
    if (publisher === this.connId && (data.t === 'react' || data.t === 'delete' || data.t === 'mute')) return
    // Everything below is about the person, not the connection.
    publisher = identityOf(publisher)
    const muted = this.state.mutedUserIds.includes(publisher)
    switch (data.t) {
      case 'chat': {
        if (!canPost(publisher) || muted || typeof data.text !== 'string' || typeof data.id !== 'string') return
        const text = cleanText(data.text)
        if (!text) return
        const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 40) : 'Viewer'
        this.addMessage({ id: data.id.slice(0, 64), userId: publisher, name, text, at: Date.now(), host: isHostId(publisher) })
        return
      }
      case 'react': {
        const kind = data.kind as ReactionKind
        if (!canPost(publisher) || muted || !REACTIONS.includes(kind)) return
        this.options.onReaction?.(kind)
        return
      }
      case 'delete': {
        if (!isHostId(publisher) || typeof data.id !== 'string') return
        this.set({ messages: this.state.messages.filter((m) => m.id !== data.id) })
        this.snapshotDirty = true
        return
      }
      case 'mute': {
        if (!isHostId(publisher) || typeof data.userId !== 'string') return
        this.applyMute(identityOf(data.userId), data.muted !== false)
        return
      }
    }
  }

  private addMessage(message: ChatMessage) {
    if (this.state.messages.some((m) => m.id === message.id)) return
    this.set({ messages: [...this.state.messages, message].slice(-CHAT_HISTORY) })
    this.snapshotDirty = true
  }

  private applyMute(userId: string, muted: boolean) {
    const set = new Set(this.state.mutedUserIds)
    if (muted) set.add(userId)
    else set.delete(userId)
    this.set({
      mutedUserIds: [...set],
      messages: muted ? this.state.messages.filter((m) => m.userId !== userId) : this.state.messages,
    })
    this.snapshotDirty = true
  }

  private async flushSnapshot() {
    if (!this.state.leader || !this.snapshotDirty || !this.options.persist) return
    this.snapshotDirty = false
    try {
      await this.options.persist({
        messages: this.state.messages,
        mutedUserIds: this.state.mutedUserIds,
        // The server keeps its own count; this field is ignored there.
        totals: { ...EMPTY_TOTALS },
      })
    } catch {
      this.snapshotDirty = true
    }
  }

  private async publish(payload: Record<string, unknown>): Promise<boolean> {
    if (!this.client || this.state.status !== 'connected') return false
    try {
      await this.client.publish(this.channel, JSON.stringify({ v: 1, ...payload }))
      return true
    } catch (error) {
      console.warn('[rtm] publish failed', error)
      return false
    }
  }

  /* ── actions ── */

  /** Sends a chat message; false when not allowed (guest, muted, empty) or not sent. */
  async sendChat(text: string, name?: string | null): Promise<boolean> {
    const me = this.state.me
    const clean = cleanText(text)
    if (!me?.canPost || !clean || this.state.mutedUserIds.includes(me.userId)) return false
    const id = newId()
    const display = (name ?? me.name ?? 'Viewer').slice(0, 40)
    const sent = await this.publish({ t: 'chat', id, name: display, text: clean })
    // Shown at once; RTM's echo of it is ignored by id.
    if (sent) this.addMessage({ id, userId: me.userId, name: display, text: clean, at: Date.now(), host: me.isHost })
    return sent
  }

  /** Sends a reaction (≤ 5/s, like the server). Returns true only when it was actually sent. */
  react(kind: ReactionKind): boolean {
    const me = this.state.me
    if (!me?.canPost || this.state.mutedUserIds.includes(me.userId)) return false
    const now = Date.now()
    this.sentReacts = this.sentReacts.filter((at) => now - at < 1_000)
    if (this.sentReacts.length >= SEND_REACT_LIMIT) return false
    this.sentReacts.push(now)
    this.options.onReaction?.(kind)
    // Counted by the server (totals come back with the status); RTM only animates it for others.
    void this.options.sendReaction?.(kind)?.catch(() => undefined)
    void this.publish({ t: 'react', kind })
    return true
  }

  /** Host: removes a message for everyone. */
  async deleteMessage(id: string) {
    if (!this.state.me?.isHost) return
    this.set({ messages: this.state.messages.filter((m) => m.id !== id) })
    this.snapshotDirty = true
    await this.publish({ t: 'delete', id })
  }

  /** Host: mutes / unmutes a viewer for everyone (their messages are hidden and no longer accepted). */
  async setMuted(userId: string, muted: boolean) {
    if (!this.state.me?.isHost || isHostId(userId)) return
    this.applyMute(userId, muted)
    await this.publish({ t: 'mute', userId, muted })
  }

  private async leave() {
    const client = this.client
    this.client = null
    if (!client) return
    const done = (async () => {
      try {
        await client.unsubscribe(this.channel)
      } catch {
        // ignore
      }
      try {
        await client.logout()
      } catch {
        // ignore
      }
    })()
    lastLogout = lastLogout.then(() => done)
    await done
  }

  async stop() {
    this.stopped = true
    this.ready = false
    for (const timer of [this.presenceTimer, this.persistTimer]) if (timer) clearInterval(timer)
    this.presenceTimer = this.persistTimer = null
    await this.flushSnapshot().catch(() => undefined)
    await this.leave()
    this.set({ ...INITIAL_CHAT })
  }
}
