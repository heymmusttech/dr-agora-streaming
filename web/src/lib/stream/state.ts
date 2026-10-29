/**
 * The stream record (one stream at a time): Start / Stop from `/host`, plus the
 * host's session snapshot (chat history, muted viewers, reaction totals).
 *
 * "Is live" is a host's decision. Whether a camera is publishing comes from the heartbeat
 * registry and is merged in as `host` (the player says "Waiting for the host…" until then).
 *
 * Admin ⇄ stream link: the host who pressed Start is the `admin`. Once their camera has been on air
 * in a session, it going off air (End, tab closed, heartbeat expired) stops the stream. Stop takes
 * every camera off the registry, and every client ends its broadcast when it sees `isLive: false`.
 *
 * Persisted to `.data/stream.json` (`LIVESTREAM_DATA_DIR`), so a restart keeps the stream and its
 * chat history. Single instance; move it to Redis / the backend before scaling out.
 */
import 'server-only'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { HostIdentity } from '@/lib/auth/host-claims'
import { emitCounts, emitStreamStatus, subscribeHostsChanged } from './bus'
import { chatChannelFor, LIVE_CHANNEL } from './channel'
import { getOnAir, removeCoHosts, removeHost } from './registry'
import {
  capacityOf,
  cleanSnapshot,
  emptySnapshot,
  normalizeHostMode,
  normalizeMaxHosts,
  normalizeTitle,
} from './rules'
import { REACTIONS } from './types'
import type {
  AppLiveStreamStatus,
  HostIdentityPublic,
  LiveCounts,
  ReactionKind,
  HostRole,
  LiveStreamHostMode,
  LiveStreamStopReason,
  SessionSnapshot,
} from './types'

interface StreamRecord {
  isLive: boolean
  title: string | null
  hostMode: LiveStreamHostMode
  maxHosts: number
  sessionId: string | null
  startedAt: number | null
  startedBy: HostIdentityPublic | null
  stoppedAt: number | null
  lastTitle: string | null
  /** The admin's camera was on air at least once in this session (arms the admin ⇄ stream link). */
  adminJoined: boolean
  stopReason: LiveStreamStopReason | null
}

const EMPTY: StreamRecord = {
  isLive: false,
  title: null,
  hostMode: 'single',
  maxHosts: 1,
  sessionId: null,
  startedAt: null,
  startedBy: null,
  stoppedAt: null,
  lastTitle: null,
  adminJoined: false,
  stopReason: null,
}

export class StreamInputError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 422,
  ) {
    super(message)
  }
}

/* ── persistence ── */

const DATA_DIR = process.env.LIVESTREAM_DATA_DIR || join(process.cwd(), '.data')
const DATA_FILE = join(DATA_DIR, 'stream.json')

interface Persisted {
  record: StreamRecord
  snapshot: SessionSnapshot
}

function load(): Persisted {
  try {
    const parsed = JSON.parse(readFileSync(DATA_FILE, 'utf8')) as Partial<Persisted>
    const record = { ...EMPTY, ...parsed.record }
    return { record, snapshot: cleanSnapshot(parsed.snapshot, record.sessionId) }
  } catch {
    return { record: { ...EMPTY }, snapshot: emptySnapshot(null) }
  }
}

function save() {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const tmp = `${DATA_FILE}.tmp`
    writeFileSync(tmp, JSON.stringify({ record: holder.record, snapshot: holder.snapshot }))
    renameSync(tmp, DATA_FILE)
  } catch (error) {
    console.error('[stream] could not persist state', error)
  }
}

interface Holder extends Persisted {
  unlink?: () => void
  /** Last viewer count reported by the leading host (not persisted: it is only true right now). */
  viewers?: { sessionId: string | null; count: number; at: number }
  graceTimer: ReturnType<typeof setTimeout> | null
  handoverUntil: number
}

// globalThis: one record for every route bundle and across dev hot reloads (timers included).
const store = globalThis as typeof globalThis & { __dprLiveStream?: Holder }
const holder: Holder = (store.__dprLiveStream ??= { ...load(), graceTimer: null, handoverUntil: 0 })

/* ── reads ── */

export function getStatus(): AppLiveStreamStatus {
  const record = holder.record
  return {
    isLive: record.isLive,
    title: record.title,
    hostMode: record.hostMode,
    maxHosts: capacityOf(record.hostMode, record.maxHosts),
    channel: LIVE_CHANNEL,
    sessionId: record.sessionId,
    startedAt: record.isLive ? record.startedAt : null,
    startedBy: record.startedBy,
    stoppedAt: record.stoppedAt,
    lastTitle: record.lastTitle,
    stopReason: record.isLive ? null : record.stopReason,
    host: getOnAir(),
    reactions: record.isLive && holder.snapshot.sessionId === record.sessionId ? { ...holder.snapshot.totals } : { love: 0, like: 0, smile: 0 },
    viewers: currentViewers(),
    chatChannel: record.isLive && record.sessionId ? chatChannelFor(record.sessionId) : null,
    serverTime: Date.now(),
  }
}

export const isLive = (): boolean => holder.record.isLive

/** Cameras allowed on air right now. */
export const cameraCapacity = (): number => capacityOf(holder.record.hostMode, holder.record.maxHosts)

/** `admin` for the host who started the stream, `host` (co-host) for everyone else. */
export const roleFor = (sub: string): HostRole => (holder.record.startedBy?.sub === sub ? 'admin' : 'host')

/* ── writes ── */

export interface StartStreamInput {
  title?: unknown
  /** `single` | `multi`; omitted keeps the current mode (so a title Update does not reset it). */
  hostMode?: unknown
  maxHosts?: unknown
  by: HostIdentity
}

function publish(): AppLiveStreamStatus {
  save()
  const status = getStatus()
  emitStreamStatus(status)
  return status
}

/**
 * Idempotent: starting while live keeps the session and only updates title / mode / max hosts.
 * Always emits, so late subscribers converge.
 */
export function startStream(input: StartStreamInput): AppLiveStreamStatus {
  if (!process.env.NEXT_PUBLIC_AGORA_APP_ID || !process.env.AGORA_APP_CERTIFICATE)
    throw new StreamInputError('Agora is not configured on this server.', 'LIVESTREAM_PROVIDER_DISABLED', 503)
  const current = holder.record
  const title = normalizeTitle(input.title)
  const hostMode = normalizeHostMode(input.hostMode, current.hostMode)
  const maxHosts = normalizeMaxHosts(input.maxHosts, hostMode, current.maxHosts > 1 ? current.maxHosts : 2)
  const now = Date.now()
  if (current.isLive) {
    holder.record = { ...current, title, hostMode, maxHosts, lastTitle: title }
    // Single mode: co-hosts go off air now (their clients end the broadcast on the next status).
    if (hostMode === 'single') removeCoHosts()
  } else {
    const sessionId = randomUUID()
    holder.record = {
      isLive: true,
      title,
      hostMode,
      maxHosts,
      sessionId,
      startedAt: now,
      startedBy: { sub: input.by.sub, name: input.by.name },
      stoppedAt: null,
      lastTitle: title,
      adminJoined: false,
      stopReason: null,
    }
    holder.snapshot = emptySnapshot(sessionId)
    // Cameras left over from before Start (none normally) don't belong to this session.
    removeHost()
  }
  return publish()
}

/** Who may press Stop: the admin, or anyone while the admin's camera is not on air. */
export function canStop(sub: string): boolean {
  const record = holder.record
  if (!record.isLive || record.startedBy?.sub === sub) return true
  return (getOnAir()?.admins ?? 0) === 0
}

/** Idempotent: stopping while offline returns the status and emits nothing. */
export function stopStream(reason: LiveStreamStopReason = 'editor'): AppLiveStreamStatus {
  const current = holder.record
  if (!current.isLive) return getStatus()
  // Offline first, so the host-change notification below does not re-enter the admin link.
  cancelAdminGrace()
  holder.handoverUntil = 0
  holder.record = { ...current, isLive: false, stoppedAt: Date.now(), adminJoined: false, stopReason: reason }
  removeHost()
  return publish()
}

/* ── session snapshot (chat history, moderation, reaction totals) ── */

export function getSnapshot(): SessionSnapshot {
  const { record, snapshot } = holder
  if (!record.isLive || snapshot.sessionId !== record.sessionId) return emptySnapshot(record.isLive ? record.sessionId : null)
  return snapshot
}

/**
 * Written by the session's hosts: their client keeps the chat history and the muted list. Reaction
 * totals are the server's own count and are never taken from a client.
 */
export function saveSnapshot(value: unknown): SessionSnapshot {
  if (!holder.record.isLive) throw new StreamInputError('The stream is not live.', 'LIVESTREAM_OFFLINE', 409)
  const totals = holder.snapshot.sessionId === holder.record.sessionId ? holder.snapshot.totals : emptySnapshot(null).totals
  holder.snapshot = { ...cleanSnapshot(value, holder.record.sessionId), totals }
  save()
  return holder.snapshot
}

/* ── counts: reactions (counted here) and viewers (reported by the leading host) ── */

/**
 * At most one counts push per second, however many reactions arrive: with thousands of viewers a
 * push per tap (or the full status every 0.4 s) would be most of the server's traffic.
 */
const COUNTS_EMIT_MS = 1_000
const REACTION_SAVE_MS = 2_000
/** A viewer count older than this (the host's tab closed) is no longer shown. */
const VIEWERS_TTL_MS = 30_000
let countsEmit: ReturnType<typeof setTimeout> | null = null
let reactionSave: ReturnType<typeof setTimeout> | null = null

function currentViewers(): number | null {
  const v = holder.viewers
  const { record } = holder
  if (!record.isLive || !v || v.sessionId !== record.sessionId || Date.now() - v.at > VIEWERS_TTL_MS) return null
  return v.count
}

export function getCounts(): LiveCounts {
  const status = getStatus()
  return { sessionId: status.sessionId, reactions: status.reactions, viewers: status.viewers, serverTime: status.serverTime }
}

function scheduleCounts() {
  countsEmit ??= setTimeout(() => {
    countsEmit = null
    emitCounts(getCounts())
  }, COUNTS_EMIT_MS)
}

/**
 * Counts reactions for the live session — one tap, or a device's batch for the last second
 * (`{ love: 3 }`). The caller has authenticated and capped them.
 */
export function addReactions(add: Partial<Record<ReactionKind, number>>): SessionSnapshot['totals'] {
  const { record } = holder
  if (!record.isLive) throw new StreamInputError('The stream is not live.', 'LIVESTREAM_OFFLINE', 409)
  if (holder.snapshot.sessionId !== record.sessionId) holder.snapshot = emptySnapshot(record.sessionId)
  const totals = { ...holder.snapshot.totals }
  for (const kind of REACTIONS) totals[kind] += Math.max(0, Math.floor(add[kind] ?? 0))
  holder.snapshot = { ...holder.snapshot, totals }
  scheduleCounts()
  reactionSave ??= setTimeout(() => {
    reactionSave = null
    save()
  }, REACTION_SAVE_MS)
  return holder.snapshot.totals
}

export const addReaction = (kind: ReactionKind) => addReactions({ [kind]: 1 })

/** The leading host's measurement of people watching (from Agora presence). */
export function setViewerCount(count: number): number | null {
  const { record } = holder
  if (!record.isLive) throw new StreamInputError('The stream is not live.', 'LIVESTREAM_OFFLINE', 409)
  const clean = Math.max(0, Math.min(10_000_000, Math.floor(count)))
  const changed = currentViewers() !== clean
  holder.viewers = { sessionId: record.sessionId, count: clean, at: Date.now() }
  if (changed) scheduleCounts()
  return clean
}

/* ── admin ⇄ stream link ── */

/**
 * "The admin left" normally stops the stream, but the admin moving their camera between tabs
 * briefly leaves the registry too. A short grace covers a reload; an explicit handover window
 * (opened by the tab taking the camera over) covers the camera prompt.
 */
const ADMIN_GRACE_MS = 6_000
const HANDOVER_MS = 45_000

function cancelAdminGrace() {
  if (holder.graceTimer) clearTimeout(holder.graceTimer)
  holder.graceTimer = null
}

export function beginAdminHandover(): void {
  if (!holder.record.isLive) return
  holder.handoverUntil = Date.now() + HANDOVER_MS
  cancelAdminGrace()
}

const handoverActive = () => Date.now() < holder.handoverUntil

function linkAdminToStream() {
  const record = holder.record
  if (!record.isLive) {
    cancelAdminGrace()
    return
  }
  const admins = getOnAir()?.admins ?? 0
  if (admins > 0) {
    cancelAdminGrace()
    holder.handoverUntil = 0
    if (!record.adminJoined) {
      holder.record = { ...record, adminJoined: true }
      save()
    }
    return
  }
  if (!record.adminJoined || holder.graceTimer || handoverActive()) return
  holder.graceTimer = setTimeout(() => {
    holder.graceTimer = null
    const now = holder.record
    if (!now.isLive || !now.adminJoined || handoverActive()) return
    if ((getOnAir()?.admins ?? 0) > 0) return
    stopStream('admin-ended')
  }, ADMIN_GRACE_MS)
}

// Once per process (globalThis), not once per route bundle or hot reload.
holder.unlink ??= subscribeHostsChanged(linkAdminToStream)
