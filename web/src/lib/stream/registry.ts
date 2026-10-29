/**
 * Cameras on air in the channel. Each host's camera heartbeats every 10 s; a camera expires after
 * `STREAM_HEARTBEAT_TTL_MS` without one (tab closed, network lost).
 *
 * Keyed by the host's Keycloak subject, so one person is one camera however many tabs they open,
 * and the `maxHosts` limit counts people.
 *
 * Single-process (globalThis, survives dev hot reloads). Swap for Redis before running several
 * instances — same functions.
 */
import 'server-only'
import { notifyHostsChanged } from './bus'
import { LIVE_CHANNEL } from './channel'
import type { HostRole, LiveStreamEntry, OnAirHost, StreamOrientation } from './types'

const TTL_MS = Number(process.env.STREAM_HEARTBEAT_TTL_MS) || 30_000

interface HostBeat extends OnAirHost {
  lastSeen: number
}

const store = globalThis as typeof globalThis & { __dprLiveHosts?: Map<string, HostBeat> }
const hosts = (store.__dprLiveHosts ??= new Map<string, HostBeat>())

function sweep(now = Date.now()) {
  let changed = false
  hosts.forEach((beat, sub) => {
    if (now - beat.lastSeen > TTL_MS) {
      hosts.delete(sub)
      changed = true
    }
  })
  if (changed) notifyHostsChanged()
}

function toEntry(): LiveStreamEntry | null {
  if (hosts.size === 0) return null
  const participants = [...hosts.values()]
    .sort((a, b) => a.since - b.since)
    .map(({ uid, name, role, since, orientation }) => ({ uid, name, role, since, orientation }))
  return {
    channel: LIVE_CHANNEL,
    since: participants[0]!.since,
    // The first camera decides the single-host layout.
    orientation: participants[0]!.orientation,
    hosts: participants.length,
    admins: participants.filter((host) => host.role === 'admin').length,
    participants,
  }
}

export const isOnAir = (sub: string): boolean => {
  sweep()
  return hosts.has(sub)
}

export const onAirCount = (): number => {
  sweep()
  return hosts.size
}

/** A camera slot for `sub`: already on air, or a free place under `capacity`. */
export const hasSlot = (sub: string, capacity: number): boolean => isOnAir(sub) || onAirCount() < capacity

export interface HeartbeatInput {
  sub: string
  uid: number
  name: string
  role: HostRole
  orientation: StreamOrientation
}

export function heartbeat(input: HeartbeatInput): LiveStreamEntry {
  const now = Date.now()
  const existing = hosts.get(input.sub)
  const changed = !existing || existing.orientation !== input.orientation || existing.role !== input.role
  hosts.set(input.sub, {
    uid: input.uid,
    name: input.name,
    role: input.role,
    orientation: input.orientation,
    since: existing?.since ?? now,
    lastSeen: now,
  })
  // Only transitions reach the feed; a plain 10 s heartbeat is silent.
  if (changed) notifyHostsChanged()
  return toEntry()!
}

/** Takes one host's camera off the registry, or every camera when `sub` is omitted. */
export function removeHost(sub?: string) {
  const before = hosts.size
  if (sub) hosts.delete(sub)
  else hosts.clear()
  if (hosts.size !== before) notifyHostsChanged()
}

/** Takes every co-host (role `host`) off — used when the mode switches to single. */
export function removeCoHosts() {
  let changed = false
  hosts.forEach((beat, sub) => {
    if (beat.role === 'host') {
      hosts.delete(sub)
      changed = true
    }
  })
  if (changed) notifyHostsChanged()
}

export function getOnAir(): LiveStreamEntry | null {
  sweep()
  return toEntry()
}

/** Runs the expiry sweep (the SSE ping calls it so expired cameras reach the feed). */
export const sweepHosts = (): void => sweep()
