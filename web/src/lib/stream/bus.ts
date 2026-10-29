/**
 * In-process event bus behind the SSE feed (`/api/live-stream/events`):
 * - `status`: a host started, updated or stopped the stream (`state.ts`)
 * - `hosts`:  the cameras on air changed (`registry.ts`)
 *
 * On globalThis so every route bundle and dev hot reload share one bus. Single-process by design;
 * for several instances put Redis pub/sub behind the same functions.
 */
import 'server-only'
import type { AppLiveStreamStatus } from './types'

type StatusListener = (status: AppLiveStreamStatus) => void
type HostsListener = () => void

const store = globalThis as typeof globalThis & {
  __dprLiveBus?: { status: Set<StatusListener>; hosts: Set<HostsListener> }
}
const bus = (store.__dprLiveBus ??= { status: new Set(), hosts: new Set() })

function each<T>(listeners: Set<(value: T) => void>, value: T) {
  listeners.forEach((listener) => {
    try {
      listener(value)
    } catch {
      // A broken subscriber must not break the others.
    }
  })
}

export const emitStreamStatus = (status: AppLiveStreamStatus): void => each(bus.status, status)

export function subscribeStreamStatus(listener: StatusListener): () => void {
  bus.status.add(listener)
  return () => bus.status.delete(listener)
}

export const notifyHostsChanged = (): void => each(bus.hosts, undefined)

export function subscribeHostsChanged(listener: HostsListener): () => void {
  bus.hosts.add(listener)
  return () => bus.hosts.delete(listener)
}
