/**
 * Server-Sent Events feed of the stream status (same-origin: the editor and the player).
 *
 *   event: app-livestream-status   AppLiveStreamStatus   once on connect, then on every change
 *   event: app-livestream-counts   LiveCounts            reactions / viewers, at most once a second
 *   : ping                                               every 5 s (keeps proxies awake, runs the camera sweep)
 *
 * One connection per tab (`src/lib/stream/live-store.ts`); EventSource reconnects on its own.
 * Cross-origin embedders (the plugin) poll `GET /api/stream/status` instead.
 */
import type { NextRequest } from 'next/server'
import { subscribeCounts, subscribeHostsChanged, subscribeStreamStatus } from '@/lib/stream/bus'
import { sweepHosts } from '@/lib/stream/registry'
import { getStatus } from '@/lib/stream/state'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PING_MS = 5_000
const EVENT = 'app-livestream-status'
const COUNTS_EVENT = 'app-livestream-counts'

/**
 * One hub for every open feed: each event is serialised and encoded once, then the same bytes go
 * to all connections, and one timer pings everyone (and sweeps expired cameras once) — per-
 * connection work would grow with the audience (3,000 viewers = 3,000 stringify + timers each time).
 */
type Writer = (chunk: Uint8Array) => void
interface Hub {
  clients: Set<Writer>
  unsubscribe: Array<() => void>
  ping: ReturnType<typeof setInterval> | null
}
const encoder = new TextEncoder()
const hubStore = globalThis as typeof globalThis & { __dprLiveFeedHub?: Hub }
const hub: Hub = (hubStore.__dprLiveFeedHub ??= { clients: new Set(), unsubscribe: [], ping: null })

const frame = (event: string, data: unknown) => encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
const PING = encoder.encode(': ping\n\n')

function broadcast(chunk: Uint8Array) {
  hub.clients.forEach((write) => write(chunk))
}

function join(write: Writer) {
  hub.clients.add(write)
  if (hub.clients.size > 1) return
  // First client: wire the bus and the shared ping.
  hub.unsubscribe = [
    subscribeStreamStatus((status) => broadcast(frame(EVENT, status))),
    subscribeHostsChanged(() => broadcast(frame(EVENT, getStatus()))),
    subscribeCounts((counts) => broadcast(frame(COUNTS_EVENT, counts))),
  ]
  hub.ping = setInterval(() => {
    sweepHosts() // notifies (once) when a camera expired
    broadcast(PING)
  }, PING_MS)
}

function leave(write: Writer) {
  hub.clients.delete(write)
  if (hub.clients.size > 0) return
  hub.unsubscribe.forEach((off) => off())
  hub.unsubscribe = []
  if (hub.ping) clearInterval(hub.ping)
  hub.ping = null
}

export function GET(request: NextRequest) {
  let cleanup: () => void = () => undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true
      const write: Writer = (chunk) => {
        if (!open) return
        try {
          controller.enqueue(chunk)
        } catch {
          cleanup()
        }
      }
      write(frame(EVENT, getStatus()))
      join(write)

      cleanup = () => {
        if (!open) return
        open = false
        leave(write)
        try {
          controller.close()
        } catch {
          // already closed
        }
      }
      request.signal.addEventListener('abort', cleanup)
    },
    cancel() {
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}
