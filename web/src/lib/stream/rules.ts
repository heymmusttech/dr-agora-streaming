/**
 * Pure stream rules shared by the server state and its tests: input normalisation, camera
 * capacity, session-snapshot validation.
 */
import {
  EMPTY_TOTALS,
  MAX_HOSTS_LIMIT,
  REACTIONS,
  type ChatMessage,
  type LiveStreamHostMode,
  type ReactionTotals,
  type SessionSnapshot,
} from './types'

export const MAX_TITLE = 120
export const MAX_CHAT_TEXT = 300
export const CHAT_HISTORY = 50
export const MAX_MUTED = 500

export const normalizeTitle = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TITLE) : null

export const normalizeHostMode = (value: unknown, fallback: LiveStreamHostMode): LiveStreamHostMode =>
  value === 'single' || value === 'multi' ? value : fallback

/** 2…MAX_HOSTS_LIMIT in multi mode; the mode decides when the value is missing or bad. */
export function normalizeMaxHosts(value: unknown, mode: LiveStreamHostMode, fallback: number): number {
  if (mode === 'single') return 1
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  const base = Number.isFinite(n) ? Math.round(n) : fallback
  return Math.min(MAX_HOSTS_LIMIT, Math.max(2, base))
}

/** Cameras allowed on air at once. */
export const capacityOf = (mode: LiveStreamHostMode, maxHosts: number): number => (mode === 'single' ? 1 : maxHosts)

const isString = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max

function cleanMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== 'object') return null
  const m = value as Record<string, unknown>
  if (!isString(m.id, 64) || !isString(m.userId, 64) || !isString(m.name, 60) || !isString(m.text, MAX_CHAT_TEXT)) return null
  if (typeof m.at !== 'number' || !Number.isFinite(m.at)) return null
  return { id: m.id, userId: m.userId, name: m.name, text: m.text, at: m.at, host: m.host === true }
}

function cleanTotals(value: unknown): ReactionTotals {
  const totals = { ...EMPTY_TOTALS }
  if (!value || typeof value !== 'object') return totals
  for (const kind of REACTIONS) {
    const n = (value as Record<string, unknown>)[kind]
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) totals[kind] = Math.min(Math.floor(n), 1e9)
  }
  return totals
}

/** Validates a snapshot the host posts; keeps the last `CHAT_HISTORY` messages. */
export function cleanSnapshot(value: unknown, sessionId: string | null): SessionSnapshot {
  const body = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const messages = (Array.isArray(body.messages) ? body.messages : [])
    .map(cleanMessage)
    .filter((message): message is ChatMessage => message !== null)
    .slice(-CHAT_HISTORY)
  const muted = (Array.isArray(body.mutedUserIds) ? body.mutedUserIds : [])
    .filter((id): id is string => isString(id, 64))
    .slice(0, MAX_MUTED)
  return { sessionId, messages, mutedUserIds: [...new Set(muted)], totals: cleanTotals(body.totals), updatedAt: Date.now() }
}

export const emptySnapshot = (sessionId: string | null): SessionSnapshot => ({
  sessionId,
  messages: [],
  mutedUserIds: [],
  totals: { ...EMPTY_TOTALS },
  updatedAt: Date.now(),
})
