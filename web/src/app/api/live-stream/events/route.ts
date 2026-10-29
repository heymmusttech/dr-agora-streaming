/**
 * Server-Sent Events feed of the stream status (same-origin: the editor and the player).
 *
 *   event: app-livestream-status   AppLiveStreamStatus   once on connect, then on every change
 *   : ping                                               every 5 s (keeps proxies awake, runs the camera sweep)
 *
 * One connection per tab (`src/lib/stream/live-store.ts`); EventSource reconnects on its own.
 * Cross-origin embedders (the plugin) poll `GET /api/stream/status` instead.
 */
import type { NextRequest } from 'next/server'
import { subscribeHostsChanged, subscribeStreamStatus } from '@/lib/stream/bus'
import { sweepHosts } from '@/lib/stream/registry'
import { getStatus } from '@/lib/stream/state'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PING_MS = 5_000
const EVENT = 'app-livestream-status'

export function GET(request: NextRequest) {
  const encoder = new TextEncoder()
  let cleanup: () => void = () => undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let open = true
      const write = (chunk: string) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          open = false
        }
      }
      const send = (data: unknown) => write(`event: ${EVENT}\ndata: ${JSON.stringify(data)}\n\n`)

      send(getStatus())
      const unsubscribeStatus = subscribeStreamStatus((status) => send(status))
      const unsubscribeHosts = subscribeHostsChanged(() => send(getStatus()))
      const ping = setInterval(() => {
        sweepHosts() // notifies when a camera expired
        write(': ping\n\n')
      }, PING_MS)

      cleanup = () => {
        if (!open) return
        open = false
        unsubscribeStatus()
        unsubscribeHosts()
        clearInterval(ping)
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
