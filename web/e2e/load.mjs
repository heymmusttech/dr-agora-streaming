/**
 * Load test for the parts that grow with the audience (no browsers, no Agora — only this server):
 *   - VIEWERS open the real-time feed (SSE /api/live-stream/events), like joined players;
 *   - SITE_VISITORS poll GET /api/stream/status every 5 s, like the plugin on partner pages;
 *   - REACTORS (signed-in) send a reaction batch every second, like players during a burst.
 * A stream must be live (start one at /host). Reports request rates, latency and errors, and how
 * long the feed takes to deliver a reaction change to every viewer.
 *
 *   BASE=http://localhost:5174 VIEWERS=2000 SITE_VISITORS=2000 REACTORS=300 SECONDS=30 RAMP_SECONDS=10 node e2e/load.mjs
 *
 * Mind the open-file limit for thousands of connections: `ulimit -n 20000` in the same shell.
 * Measure a production build (`next build && next start`), not `next dev`, which is far slower.
 * Behind a CDN, `/api/stream/status` mostly never reaches this server; this measures the worst case.
 */
const BASE = process.env.BASE || 'http://localhost:5174'
const VIEWERS = Number(process.env.VIEWERS || 1000)
const SITE_VISITORS = Number(process.env.SITE_VISITORS || 1000)
const REACTORS = Number(process.env.REACTORS || 200)
const SECONDS = Number(process.env.SECONDS || 20)
const POLL_MS = 5_000
/** People arrive over this many seconds (all at once overflows the OS accept queue, which is not the app). */
const RAMP_MS = Number(process.env.RAMP_SECONDS ?? 10) * 1_000

const stats = { status: [], react: [], errors: {}, counts: 0, firstCountsAt: [] }
const err = (what) => (stats.errors[what] = (stats.errors[what] ?? 0) + 1)
const pct = (list, p) => (list.length ? [...list].sort((a, b) => a - b)[Math.min(list.length - 1, Math.floor(list.length * p))] : 0)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const controller = new AbortController()

const status = await (await fetch(`${BASE}/api/stream/status`)).json()
if (!status.isLive) {
  console.error('No stream live: start one at /host first.')
  process.exit(1)
}

/* viewers: real-time feed */
let reactionSentAt = 0
async function viewer() {
  await sleep(Math.random() * RAMP_MS)
  try {
    const response = await fetch(`${BASE}/api/live-stream/events`, { signal: controller.signal })
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let at
      while ((at = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, at)
        buffer = buffer.slice(at + 2)
        if (block.includes('event: app-livestream-counts')) {
          stats.counts += 1
          if (reactionSentAt) stats.firstCountsAt.push(Date.now() - reactionSentAt)
        }
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) err(`sse: ${error.cause?.code ?? error.message}`)
  }
}

/* site visitors: plugin status poll */
async function visitor() {
  await sleep(Math.random() * Math.max(POLL_MS, RAMP_MS))
  while (!controller.signal.aborted) {
    const started = performance.now()
    try {
      const response = await fetch(`${BASE}/api/stream/status`, { signal: controller.signal })
      await response.arrayBuffer()
      if (!response.ok) err(`status ${response.status}`)
      else stats.status.push(performance.now() - started)
    } catch (error) {
      if (!controller.signal.aborted) err(`status: ${error.cause?.code ?? error.message}`)
    }
    await sleep(POLL_MS)
  }
}

/* reactors: one batch per second each */
/**
 * Viewer tickets: signed here when TICKET_SECRET is given (same value as the server's
 * LIVESTREAM_VIEWER_TICKET_SECRET; needed against a production build), else from the dev endpoint.
 */
async function ticketFor(i) {
  if (process.env.TICKET_SECRET) {
    const { SignJWT } = await import('jose')
    return new SignJWT({ name: `Load ${i}` })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('load')
      .setSubject(`load-${i}`)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode(process.env.TICKET_SECRET))
  }
  const response = await fetch(`${BASE}/api/dev/viewer-ticket`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: `load-${i}`, name: `Load ${i}` }),
  })
  return (await response.json()).ticket
}

async function reactor(i) {
  await sleep(Math.random() * RAMP_MS)
  const ticket = await ticketFor(i)
  while (!controller.signal.aborted) {
    const started = performance.now()
    reactionSentAt ||= Date.now()
    try {
      const response = await fetch(`${BASE}/api/stream/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ counts: { love: 2, smile: 1 }, ticket }),
        signal: controller.signal,
      })
      await response.arrayBuffer()
      if (!response.ok) err(`react ${response.status}`)
      else stats.react.push(performance.now() - started)
    } catch (error) {
      if (!controller.signal.aborted) err(`react: ${error.cause?.code ?? error.message}`)
    }
    await sleep(1_000)
  }
}

console.log(`Load: ${VIEWERS} feed viewers, ${SITE_VISITORS} plugin visitors (poll ${POLL_MS / 1000}s), ${REACTORS} reactors, ${SECONDS}s → ${BASE}`)
const before = (await (await fetch(`${BASE}/api/stream/status`)).json()).reactions
const tasks = [
  ...Array.from({ length: VIEWERS }, viewer),
  ...Array.from({ length: SITE_VISITORS }, visitor),
  ...Array.from({ length: REACTORS }, (_, i) => reactor(i)),
]
const t0 = Date.now()
await sleep(SECONDS * 1_000 + RAMP_MS)
controller.abort()
await Promise.allSettled(tasks)
const elapsed = (Date.now() - t0) / 1000
const after = (await (await fetch(`${BASE}/api/stream/status`)).json()).reactions

const line = (name, list) =>
  `${name.padEnd(16)} ${(list.length / elapsed).toFixed(0).padStart(6)} req/s   p50 ${pct(list, 0.5).toFixed(0)} ms   p95 ${pct(list, 0.95).toFixed(0)} ms   p99 ${pct(list, 0.99).toFixed(0)} ms`
console.log(line('status poll', stats.status))
console.log(line('react batch', stats.react))
console.log(`feed counts      ${stats.counts} events to ${VIEWERS} viewers (${(stats.counts / Math.max(1, VIEWERS) / elapsed).toFixed(2)} per viewer per s)`)
console.log(`reactions        +${after.love - before.love} love, +${after.smile - before.smile} smile counted (cap 5 / person / s)`)
console.log(`errors           ${Object.keys(stats.errors).length ? JSON.stringify(stats.errors) : 'none'}`)
