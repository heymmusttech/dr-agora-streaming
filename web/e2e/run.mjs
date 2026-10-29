/**
 * End-to-end check with real Agora (RTC video + RTM chat), fake camera/mic, several browsers:
 *
 *   admin Alice starts (multi, max 2) and goes live → guest viewer joins from the plugin demo,
 *   video plays → guest reacting asks the site to sign in → signed-in viewer Jane chats and
 *   reacts → host and guest see message + totals → co-host Bob joins on camera → viewers see
 *   2 tiles (and the host stage shows both) → Carol is refused (slots full) → Alice mutes Jane → late joiner gets history →
 *   co-host can't Stop → Alice stops → players close.
 *
 * Needs a server with the dev auth bypass:
 *   NEXT_PUBLIC_HOST_AUTH=false NEXT_PUBLIC_LIVESTREAM_CHANNEL=Live-e2e NEXT_DIST_DIR=.next-e2e LIVESTREAM_DATA_DIR=.data-e2e npx next dev -p 5174
 *   E2E_BASE=http://localhost:5174 npm run e2e
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = process.env.E2E_BASE || 'http://localhost:5174'
const OUT = new URL('./artifacts/', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const TIMEOUT = 45_000

const results = []
const step = async (name, fn) => {
  const started = Date.now()
  try {
    await fn()
    results.push({ name, ok: true, ms: Date.now() - started })
    console.log(`✔ ${name} (${Date.now() - started} ms)`)
  } catch (error) {
    results.push({ name, ok: false, error: String(error?.message ?? error).split('\n')[0] })
    console.log(`✘ ${name}\n   ${String(error?.message ?? error).split('\n').slice(0, 3).join('\n   ')}`)
    throw error
  }
}

const browser = await chromium.launch({
  headless: process.env.HEADED ? false : true,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
})

async function hostPage(name) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 }, permissions: ['camera', 'microphone'] })
  await context.addInitScript((n) => localStorage.setItem('dpr-live-dev-host', n), name)
  const page = await context.newPage()
  page.on('pageerror', (error) => console.log(`[${name} pageerror]`, error.message))
  await page.goto(`${BASE}/host`)
  await page.getByLabel('Stream title').waitFor({ timeout: TIMEOUT })
  return page
}

async function viewerPage(label, user, query = '') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  if (user) await context.addInitScript((u) => localStorage.setItem('dpr-live-preview-user', JSON.stringify(u)), user)
  const page = await context.newPage()
  page.on('pageerror', (error) => console.log(`[${label} pageerror]`, error.message))
  page.on('console', (message) => {
    if (message.type() === 'error' || /\[rtm\]/.test(message.text())) console.log(`[${label} console]`, message.text().slice(0, 240))
  })
  await page.goto(`${BASE}/sandbox/partner.html${query}`)
  return page
}

const player = (page) => page.frameLocator('dpr-live-widget iframe')

async function joinFromPlugin(page) {
  await page.getByRole('button', { name: 'Join live' }).click({ timeout: TIMEOUT })
  await player(page).locator('main').waitFor({ timeout: TIMEOUT })
}

async function videosPlaying(page, count) {
  const frame = page.frames().find((f) => f.url().includes('/embed/live'))
  if (!frame) throw new Error('player iframe not found')
  await frame.waitForFunction(
    (n) => [...document.querySelectorAll('video')].filter((v) => v.readyState >= 2 && v.videoWidth > 0).length >= n,
    count,
    { timeout: TIMEOUT },
  )
}

/** The device check every host goes through before going on air: preview, mic picks up sound. */
async function previewAndTest(page) {
  await page.getByRole('button', { name: 'Preview camera' }).click({ timeout: TIMEOUT })
  const check = page.getByRole('region', { name: 'Camera and microphone check' })
  await check.getByRole('combobox', { name: 'Camera' }).waitFor({ timeout: TIMEOUT })
  await check.getByRole('combobox', { name: 'Microphone' }).waitFor({ timeout: TIMEOUT })
  await check.getByText('Mic OK').waitFor({ timeout: TIMEOUT }) // the fake mic beeps
}

/** A co-host joining: preview + test, then one press goes on air. */
async function joinAsCoHost(page) {
  await previewAndTest(page)
  await page.getByRole('button', { name: 'Join as co-host' }).click({ timeout: TIMEOUT })
}

let alice, bob, carol, guest, jane, late
try {
  await step('admin: Preview camera + mic check, then one Start stream = start + on air (multi host, max 2)', async () => {
    alice = await hostPage('Alice')
    if (await alice.getByRole('button', { name: 'End stream' }).isVisible()) {
      await alice.getByRole('button', { name: 'End stream' }).first().click()
      await alice.getByRole('dialog').getByRole('button', { name: 'End stream' }).click()
    }
    await alice.getByLabel('Stream title').fill('E2E live test')
    await alice.getByLabel('Hosts').selectOption('multi')
    await alice.getByLabel('Cameras on air (max)').selectOption('2')
    if (await alice.getByRole('button', { name: 'Start stream' }).count()) throw new Error('Start stream must wait for the preview')
    await previewAndTest(alice)
    const loopback = alice.getByRole('button', { name: 'Hear myself' })
    await loopback.click()
    await alice.getByRole('button', { name: 'Stop hearing myself' }).waitFor()
    await alice.screenshot({ path: `${OUT}00-host-device-check.png` })
    await alice.getByRole('button', { name: 'Start stream' }).click()
    await alice.getByText('On camera: You').waitFor({ timeout: TIMEOUT })
    await alice.getByRole('button', { name: 'End stream' }).waitFor({ timeout: TIMEOUT })
    await alice.screenshot({ path: `${OUT}00-host-live.png` })
  })

  await step('no Embed & share in /host; /docs has the three guides with this origin', async () => {
    if (await alice.getByRole('button', { name: 'Embed & share' }).count()) throw new Error('Embed & share should be gone from /host')
    const docs = await alice.context().newPage()
    await docs.goto(`${BASE}/docs`)
    for (const tab of ['Next.js', 'Flutter', 'Simple app (HTML)']) {
      await docs.getByRole('tab', { name: tab }).click()
      await docs.getByText(BASE).first().waitFor({ timeout: TIMEOUT })
    }
    await docs.close()
  })

  await step('guest viewer sees the pill and the header badge, joins, video plays', async () => {
    guest = await viewerPage('guest')
    await guest.getByRole('button', { name: 'Live now — join the stream' }).waitFor({ timeout: TIMEOUT })
    await joinFromPlugin(guest)
    await videosPlaying(guest, 1)
    await guest.screenshot({ path: `${OUT}01-guest-player.png` })
  })

  await step('guest expands the dock in the page → [stream][chat] side by side, then collapses', async () => {
    const dockButtons = guest.locator('dpr-live-widget')
    if (await dockButtons.getByRole('button', { name: 'Mute' }).count()) throw new Error('mute is duplicated in the dock bar')
    if (await player(guest).getByRole('button', { name: 'Fullscreen' }).count()) throw new Error('fullscreen is duplicated in the dock player')
    await dockButtons.getByRole('button', { name: 'Expand' }).click()
    const embed = guest.frames().find((f) => f.url().includes('/embed/live'))
    await embed.waitForFunction(() => {
      const chat = document.querySelector('section[aria-label="Live chat"]')?.getBoundingClientRect()
      const video = document.querySelector('main > section')?.getBoundingClientRect()
      return Boolean(chat && video && chat.left >= video.right - 1 && Math.abs(chat.top - video.top) < 2)
    }, null, { timeout: TIMEOUT })
    await guest.screenshot({ path: `${OUT}01b-guest-expanded.png` })
    await dockButtons.getByRole('button', { name: 'Collapse' }).click()
    await dockButtons.getByRole('button', { name: 'Expand' }).waitFor()
  })

  await step('dock: collapse the chat, then bring it back from the video', async () => {
    await player(guest).getByRole('button', { name: 'Collapse chat' }).click()
    await player(guest).locator('section[aria-label="Live chat"]').waitFor({ state: 'detached', timeout: TIMEOUT })
    await player(guest).getByRole('button', { name: 'Show chat' }).click()
    await player(guest).locator('section[aria-label="Live chat"]').waitFor({ timeout: TIMEOUT })
  })

  await step('plugin follows the page theme (light / dark) live', async () => {
    const theme = () => guest.locator('dpr-live-widget').getAttribute('data-theme')
    const embedTheme = () => guest.frames().find((f) => f.url().includes('/embed/live')).evaluate(() => document.documentElement.dataset.theme)
    const start = await theme()
    const flipped = start === 'dark' ? 'light' : 'dark'
    await guest.evaluate((t) => document.documentElement.setAttribute('data-theme', t), flipped)
    await guest.waitForFunction((t) => document.querySelector('dpr-live-widget')?.getAttribute('data-theme') === t, flipped, { timeout: TIMEOUT })
    await guest.waitForTimeout(500)
    if ((await embedTheme()) !== flipped) throw new Error(`player theme ${await embedTheme()}, expected ${flipped}`)
    await guest.screenshot({ path: `${OUT}01c-guest-${flipped}.png` })
    await guest.evaluate((t) => document.documentElement.setAttribute('data-theme', t), start)
  })

  await step('guest reacting asks the site to sign in (onLoginRequest)', async () => {
    await player(guest).getByRole('button', { name: /^Love/ }).click()
    await guest.getByTestId('plugin-log').getByText('player asked for sign-in').waitFor({ timeout: TIMEOUT })
    await guest.getByRole('dialog', { name: 'Sign in' }).getByRole('button', { name: 'Cancel' }).click()
    await player(guest).getByRole('button', { name: 'Sign in to chat and react' }).waitFor()
  })

  await step('signed-in viewer chats and reacts', async () => {
    // The site's first two ticket lookups fail (slow backend): Jane must still end up signed in.
    jane = await viewerPage('jane', { id: 'viewer-jane', name: 'Jane Doe' }, '?failTickets=2')
    await joinFromPlugin(jane)
    const input = player(jane).getByRole('textbox', { name: 'Chat message' })
    await input.waitFor({ timeout: TIMEOUT })
    await player(jane).locator('input[aria-label="Chat message"]:not([disabled])').waitFor({ timeout: TIMEOUT })
    await input.fill('Hello from Jane')
    await player(jane).getByRole('button', { name: 'Send' }).click()
    // A click shows at once (before the server's total comes back).
    await player(jane).getByRole('button', { name: /^Love/ }).click()
    await player(jane).getByRole('button', { name: /^Love \(1\)/ }).waitFor({ timeout: 1_000 })
    for (let i = 0; i < 2; i++) {
      await jane.waitForTimeout(250)
      await player(jane).getByRole('button', { name: /^Love/ }).click()
    }
  })

  await step('host and guest see the message and the love total', async () => {
    await player(guest).getByText('Hello from Jane').waitFor({ timeout: TIMEOUT })
    await player(guest).getByRole('button', { name: /^Love \(3\)/ }).waitFor({ timeout: TIMEOUT })
    await alice.getByText('Hello from Jane').waitFor({ timeout: TIMEOUT })
    await alice.getByRole('group', { name: 'Live stats' }).getByRole('button', { name: /^Love \(3\)/ }).waitFor({ timeout: TIMEOUT })
    await alice.screenshot({ path: `${OUT}02-host-chat.png` })
  })

  await step('counts are real: server totals, same on every screen, reactions capped per person', async () => {
    const status = await (await fetch(`${BASE}/api/stream/status`)).json()
    if (status.reactions.love !== 3) throw new Error(`server counted ${status.reactions.love} loves, expected 3`)
    if (!status.chatChannel?.startsWith('dprlive-')) throw new Error('chat must use the session channel')
    // A burst of 12 taps from one person counts at most 5 per second.
    const ticket = (await (await fetch(`${BASE}/api/dev/viewer-ticket`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: 'burst', name: 'Burst' }) })).json()).ticket
    const results = await Promise.all(Array.from({ length: 12 }, () => fetch(`${BASE}/api/stream/react`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'smile', ticket }) }).then((r) => r.json())))
    const counted = results.filter((r) => r.counted).length
    if (counted !== 5) throw new Error(`burst counted ${counted}, expected 5`)
    const guestReact = await fetch(`${BASE}/api/stream/react`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'love' }) })
    if (guestReact.status !== 401) throw new Error(`guest reaction should be refused, got ${guestReact.status}`)
    await alice.getByRole('group', { name: 'Live stats' }).getByRole('button', { name: /^Smile \(5\)/ }).waitFor({ timeout: TIMEOUT })
    await player(guest).getByRole('button', { name: /^Smile \(5\)/ }).waitFor({ timeout: TIMEOUT })
    await player(jane).getByRole('button', { name: /^Smile \(5\)/ }).waitFor({ timeout: TIMEOUT })
  })

  await step('viewer count reaches 2 on the host', async () => {
    await alice.waitForFunction(() => Number(document.querySelector('[data-testid="viewer-count"]')?.textContent) >= 2, null, { timeout: TIMEOUT })
  })

  await step('co-host Bob joins on camera → viewers see 2 tiles', async () => {
    bob = await hostPage('Bob')
    await bob.getByText('Alice is live').waitFor({ timeout: TIMEOUT })
    await joinAsCoHost(bob)
    await bob.getByText(/On camera: .*Bob|On camera: Alice · Bob/).waitFor({ timeout: TIMEOUT })
    await videosPlaying(guest, 2)
    await player(guest).getByText('2 hosts live').waitFor({ timeout: TIMEOUT })
    await guest.screenshot({ path: `${OUT}03-guest-two-hosts.png` })
    // The host stage shows what viewers see: Alice has Bob's tile next to her own.
    await alice.getByRole('region', { name: 'Stage' }).getByText('Bob').waitFor({ timeout: TIMEOUT })
    await alice.screenshot({ path: `${OUT}04-host-two-cameras.png` })
  })

  await step('a third host is refused (2 camera slots)', async () => {
    carol = await hostPage('Carol')
    await carol.getByText('All 2 camera slots are taken.').first().waitFor({ timeout: TIMEOUT })
    const disabled = await carol.getByRole('button', { name: 'Preview camera' }).isDisabled()
    if (!disabled) throw new Error('Preview camera should be disabled for Carol (no free slot)')
  })

  await step('co-host cannot stop the stream while the admin is on camera', async () => {
    if (await bob.getByRole('button', { name: 'End stream' }).count()) throw new Error('a co-host on air must not see End stream')
    await bob.getByRole('button', { name: 'Leave stage' }).waitFor()
    const status = await bob.evaluate(async () => (await fetch('/api/editor/stream/stop', { method: 'POST', headers: { 'x-dev-host': 'Bob' } })).status)
    if (status !== 403) throw new Error(`expected 403, got ${status}`)
  })

  await step('host in two tabs: chat stays connected; host and viewers see each other\'s messages and reaction animations', async () => {
    // A second /host tab of the same host (same identity) used to collide (-10027) or kick the first.
    const second = await alice.context().newPage()
    await second.goto(`${BASE}/host`)
    await second.getByRole('textbox', { name: 'Chat message' }).and(second.locator(':not([disabled])')).waitFor({ timeout: TIMEOUT })
    await alice.getByRole('textbox', { name: 'Chat message' }).and(alice.locator(':not([disabled])')).waitFor({ timeout: TIMEOUT })
    // Viewer → host: a reaction animates on the host's stage, a message shows in the host chat.
    await player(jane).getByRole('button', { name: /^Like/ }).click()
    await alice.locator('.reaction-particle').first().waitFor({ timeout: TIMEOUT })
    await player(jane).getByRole('textbox', { name: 'Chat message' }).fill('Ping from Jane')
    await player(jane).getByRole('button', { name: 'Send' }).click()
    await alice.getByText('Ping from Jane').waitFor({ timeout: TIMEOUT })
    await second.getByText('Ping from Jane').waitFor({ timeout: TIMEOUT })
    // Host → viewers: the host reacts from the stage, the viewer sees the animation.
    await alice.getByRole('group', { name: 'Live stats' }).getByRole('button', { name: /^Smile/ }).click()
    await player(guest).locator('.reaction-particle').first().waitFor({ timeout: TIMEOUT })
    await second.close()
  })

  await step('host messages, then mutes Jane → her messages vanish and she is muted', async () => {
    const hostInput = alice.getByRole('textbox', { name: 'Chat message' })
    await hostInput.fill('Welcome everyone')
    await alice.getByRole('button', { name: 'Send' }).click()
    await player(guest).getByText('Welcome everyone').waitFor({ timeout: TIMEOUT })
    await alice.getByText('Hello from Jane').hover()
    await alice.getByRole('button', { name: 'Mute Jane Doe' }).first().click()
    await player(jane).getByText('The host muted you in this chat.').waitFor({ timeout: TIMEOUT })
    await player(guest).getByText('Hello from Jane').waitFor({ state: 'detached', timeout: TIMEOUT })
    await player(guest).getByText('Ping from Jane').waitFor({ state: 'detached', timeout: TIMEOUT })
  })

  await step('late joiner gets the chat history and the totals', async () => {
    await alice.waitForTimeout(3_000) // the leader saves the snapshot every 2 s
    late = await viewerPage('late')
    await joinFromPlugin(late)
    await player(late).getByText('Welcome everyone').waitFor({ timeout: TIMEOUT })
    await player(late).getByRole('button', { name: /^Love \(3\)/ }).waitFor({ timeout: TIMEOUT })
    await player(late).getByRole('button', { name: /^Smile \(6\)/ }).waitFor({ timeout: TIMEOUT }) // 5 + the host's
    if (await player(late).getByText(/(Hello|Ping) from Jane/).count()) throw new Error('muted message came back in history')
  })

  await step('/embed/live in a wide tab: chat beside the video (like /host), one LIVE icon', async () => {
    const wide = await browser.newPage({ viewport: { width: 1280, height: 760 } })
    await wide.goto(`${BASE}/embed/live`)
    await wide.waitForFunction(() => {
      const chat = document.querySelector('section[aria-label="Live chat"]')?.getBoundingClientRect()
      const video = document.querySelector('main > section')?.getBoundingClientRect()
      return Boolean(chat && video && chat.left >= video.right - 1)
    }, null, { timeout: TIMEOUT })
    await wide.getByRole('button', { name: 'Collapse chat' }).click()
    await wide.locator('section[aria-label="Live chat"]').waitFor({ state: 'detached', timeout: TIMEOUT })
    await wide.getByRole('button', { name: 'Show chat' }).click()
    await wide.locator('section[aria-label="Live chat"]').waitFor({ timeout: TIMEOUT })
    await wide.screenshot({ path: `${OUT}11-embed-wide.png` })
    await wide.close()
    const icons = await alice.getByRole('region', { name: 'Stage' }).locator('svg.live-reveal-icon').count()
    if (icons) throw new Error('LIVE badge should show one icon')
  })

  await step('standalone small player: the chat button is clickable (not covered by the counts)', async () => {
    const small = await browser.newPage({ viewport: { width: 420, height: 300 } })
    await small.goto(`${BASE}/embed/live`)
    await small.getByRole('button', { name: 'Show chat' }).click({ timeout: TIMEOUT })
    await small.getByRole('button', { name: 'Hide chat' }).first().waitFor({ timeout: TIMEOUT })
    await small.close()
  })

  await step('sidebar: links open in a new tab, Log out pinned to the bottom', async () => {
    const nav = alice.getByRole('navigation', { name: 'Main' })
    for (const name of ['Live Stream', 'Viewer', 'Docs']) {
      const target = await nav.getByRole('link', { name }).getAttribute('target')
      if (target !== '_blank') throw new Error(`${name} should open in a new tab`)
    }
    const navBox = await nav.boundingBox()
    const logout = await nav.getByRole('button', { name: 'Log out' }).boundingBox()
    if (!navBox || !logout || navBox.y + navBox.height - (logout.y + logout.height) > 100) throw new Error('Log out should sit at the bottom') // dev adds room for Next's badge
  })

  await step('/editor/live-stream and /plugin/preview redirect; Plugin preview opens as a sheet on /host', async () => {
    await carol.goto(`${BASE}/editor/live-stream`)
    await carol.waitForURL(/\/host$/, { timeout: TIMEOUT })
    await carol.goto(`${BASE}/plugin/preview`)
    await carol.waitForURL(/\/host\?preview=1$/, { timeout: TIMEOUT })
    const sheet = carol.getByRole('dialog', { name: 'Plugin preview' })
    await sheet.waitFor({ timeout: TIMEOUT })
    await carol.frameLocator('iframe[title="Plugin preview — partner site"]').getByRole('heading', { name: 'Any page, one script' }).waitFor({ timeout: TIMEOUT })
    await carol.waitForTimeout(400) // let the sheet finish sliding in
    await carol.screenshot({ path: `${OUT}09-host-preview-sheet.png` })
    await sheet.getByRole('button', { name: 'Close preview' }).click()
    await carol.waitForURL(/\/host$/, { timeout: TIMEOUT })
    // The header button opens it again.
    await carol.getByRole('button', { name: 'Plugin preview' }).click()
    await sheet.waitFor({ timeout: TIMEOUT })
  })

  await step('admin stops the stream → viewers\' players close', async () => {
    await alice.getByRole('button', { name: 'End stream' }).click()
    await alice.getByRole('dialog').getByRole('button', { name: 'End stream' }).click()
    await alice.getByText('Ready to go live').waitFor({ timeout: TIMEOUT })
    await guest.locator('dpr-live-widget iframe').waitFor({ state: 'detached', timeout: TIMEOUT })
    await jane.getByTestId('plugin-log').getByText('event: offline').waitFor({ timeout: TIMEOUT })
    const offline = await browser.newPage({ viewport: { width: 1100, height: 650 } })
    await offline.goto(`${BASE}/embed/live`)
    await offline.getByText('No live stream right now').waitFor({ timeout: TIMEOUT })
    if (await offline.getByRole('navigation', { name: 'Main' }).count()) throw new Error('/embed/live must be the bare player')
    await offline.screenshot({ path: `${OUT}10-embed-offline.png` })
    await offline.close()
  })
} catch {
  for (const [name, page] of Object.entries({ alice, bob, carol, guest, jane, late }))
    if (page) await page.screenshot({ path: `${OUT}fail-${name}.png` }).catch(() => undefined)
} finally {
  await browser.close()
  const failed = results.filter((r) => !r.ok)
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`)
  process.exit(failed.length ? 1 : 0)
}
