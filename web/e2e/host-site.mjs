/**
 * Smoke check of the plugin on a real host site (default: drlive-frontend dev on :3005, stream app
 * on :5173): the plugin loads, Join opens the player, video plays, Sign in opens the site's own
 * login, and nothing of ours is blocked by the site's CSP. Joins as a guest.
 *
 *   SITE=http://localhost:3005 STREAM=http://localhost:5173 node e2e/host-site.mjs
 *
 * `START_HOST=1` (stream server with the dev auth bypass only) also starts a stream and puts a
 * fake camera on air first, then stops it at the end — don't use it on a server someone is
 * presenting from.
 */
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright'

const OUT = new URL('./artifacts', import.meta.url).pathname
mkdirSync(OUT, { recursive: true })
const SITE = process.env.SITE || 'http://localhost:3005'
const STREAM = process.env.STREAM || 'http://localhost:5173'
const START_HOST = process.env.START_HOST === '1'

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
})
let failed = false
const check = (ok, label) => {
  console.log(`${ok ? '✔' : '✘'} ${label}`)
  if (!ok) failed = true
}

let host = null
let page = null
try {
  if (START_HOST) {
    const context = await browser.newContext({ permissions: ['camera', 'microphone'] })
    await context.addInitScript(() => localStorage.setItem('dpr-live-dev-host', 'Site Check'))
    host = await context.newPage()
    await host.goto(`${STREAM}/host`)
    // Preview (device check), then one press: start + on air.
    await host.getByRole('button', { name: 'Preview camera' }).click({ timeout: 60_000 })
    await host.getByRole('button', { name: 'Start stream' }).click({ timeout: 30_000 })
    await host.getByText('On camera: You').waitFor({ timeout: 30_000 })
    check(true, 'host on air (fake camera)')
  }

  page = await browser.newPage({ viewport: { width: 1400, height: 950 } })
  const blocked = []
  page.on('console', (message) => {
    const text = message.text()
    const url = /'(https?:\/\/[^']+)'/.exec(text)?.[1] ?? ''
    if (/Content Security Policy|Refused to/i.test(text) && url.includes(new URL(STREAM).host)) blocked.push(text.slice(0, 200))
  })
  await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForFunction(() => Boolean(window.DprLive), null, { timeout: 180_000 })
  check(true, 'plugin loaded on the site')

  const live = await (await fetch(`${STREAM}/api/stream/status`)).json()
  if (live.isLive) {
    await page.getByRole('button', { name: 'Join live' }).click({ timeout: 30_000 })
    const frame = page.frameLocator('dpr-live-widget iframe')
    await frame.locator('main').waitFor({ timeout: 30_000 })
    check(true, 'player iframe loaded inside the site')
    if ((live.host?.hosts ?? 0) > 0) {
      const embed = page.frames().find((f) => f.url().includes('/embed/live'))
      await embed.waitForFunction(() => [...document.querySelectorAll('video')].some((v) => v.readyState >= 2 && v.videoWidth > 0), null, { timeout: 30_000 })
      check(true, 'video plays inside the site')
    }
    await frame.getByRole('button', { name: 'Sign in to chat and react' }).click({ timeout: 60_000 })
    await page.getByRole('dialog').first().waitFor({ timeout: 15_000 })
    check(true, "Sign in → the site's own sign-in modal opened")
    await page.keyboard.press('Escape')
    await page.screenshot({ path: `${OUT}/host-site-plugin.png` })
  } else console.log('… no stream live: only the loading check ran (START_HOST=1 to start one)')
  check(blocked.length === 0, `no CSP blocks for ${new URL(STREAM).host}${blocked.length ? `: ${blocked.join(' | ')}` : ''}`)
} catch (error) {
  check(false, String(error?.message ?? error).split('\n').slice(0, 6).join('\n   '))
  await page?.screenshot({ path: `${OUT}/host-site-fail.png` }).catch(() => undefined)
} finally {
  if (host) {
    await host.evaluate(() => fetch('/api/editor/stream/stop', { method: 'POST', headers: { 'x-dev-host': 'Site Check' } })).catch(() => undefined)
  }
  await browser.close()
  process.exit(failed ? 1 : 0)
}
