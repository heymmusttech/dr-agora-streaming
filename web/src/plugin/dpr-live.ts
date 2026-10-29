/**
 * dpr-live.js — the duPont REGISTRY Live plugin. One script for every website (dR Live, dR Garage
 * web, partners): the LIVE pill, Join, the floating player (an iframe of `/embed/live` with video,
 * chat and reactions), and the link between the site's login and the stream.
 *
 * No dependencies; renders in a Shadow DOM; nothing connects to the video before the visitor
 * presses Join (until then it only polls `GET {origin}/api/stream/status`).
 *
 *   <script src="https://live-stream.example.com/plugin/dpr-live.js" async></script>
 *   <script>
 *     window.addEventListener('dpr-live:loaded', () => DprLive.init({
 *       platform: 'drlive',
 *       getViewerTicket: () => fetch('/api/livestream/viewer-ticket').then(r => r.json()).then(b => b.ticket),
 *       onLoginRequest: () => openMyLoginModal(),
 *     }))
 *   </script>
 *
 * Login state is dynamic: call `DprLive.setViewer(ticket | null)` (or `DprLive.refreshViewer()`)
 * whenever the site's user signs in or out. Full API: docs/PLUGIN-API.md.
 */
import css from './dpr-live.css'

type Mode = 'hidden' | 'pill' | 'player' | 'minimized'
type EventName = 'status' | 'live' | 'offline' | 'state' | 'open' | 'close' | 'login-request' | 'ready'
type ThemeOption = 'auto' | 'light' | 'dark'
type Theme = 'light' | 'dark'
type Listener = (detail: unknown) => void

export interface DprLiveOptions {
  /** Where the live-stream app is served. Default: the origin this script was loaded from. */
  origin?: string
  /** Who is embedding: `drlive`, `garage`, … (must match the viewer ticket's `iss`). */
  platform?: string
  /** Returns a viewer ticket for the signed-in user, or null for guests. Called on Join, on expiry and every 10 min. */
  getViewerTicket?: () => Promise<string | null | undefined> | string | null | undefined
  /** The player asks the visitor to sign in (Sign in to chat / react): open the site's login. */
  onLoginRequest?: () => void
  /** Corner of the screen. Default `bottom-left`. */
  position?: 'bottom-left' | 'bottom-right'
  /** Open the player as soon as a stream is live (otherwise the Join pill shows). Default false. */
  autoOpen?: boolean
  /** Status poll interval, ms (min 2000). Default 5000. */
  pollMs?: number
  /** Element the widget is appended to. Default `document.body`. */
  container?: HTMLElement
  /** Don't render the floating pill / dock (use `mountBadge` + `open()` only). Default false. */
  headless?: boolean
  /**
   * `auto` (default) follows the host page: `<html data-theme="light|dark">` (drlive-frontend),
   * else a `dark` class on `<html>`, else the OS setting — and keeps following it live.
   * `light` / `dark` force one.
   */
  theme?: ThemeOption
}

/** The host page's current theme (see `DprLiveOptions.theme`). */
function pageTheme(): Theme {
  const root = document.documentElement
  const attr = root.getAttribute('data-theme')
  if (attr === 'light' || attr === 'dark') return attr
  if (root.classList.contains('dark')) return 'dark'
  if (root.classList.contains('light')) return 'light'
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

interface StreamStatus {
  isLive: boolean
  title: string | null
  sessionId: string | null
  serverTime: number
}

interface PlayerState {
  status: 'live' | 'connecting' | 'offline'
  isLive: boolean
  title: string | null
  aspectRatio: 'portrait' | 'landscape'
  hosts: number
  viewers: number
  muted: boolean
  volume: number
  signedIn: boolean
}

const SOURCE = 'dpr-live'
const DISMISS_KEY = 'dpr-live-dismissed'
// Tickets live ≤ 15 min (sites use 10): refresh well before, so a renewal never meets an expired one.
const TICKET_REFRESH_MS = 8 * 60 * 1000
const TICKET_RETRY_MS = [2_000, 5_000, 15_000]

const ICON = {
  expand: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" x2="14" y1="3" y2="10"/><line x1="3" x2="10" y1="21" y2="14"/></svg>',
  collapse: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/></svg>',
  play: '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="6 3 20 12 6 21 6 3"/></svg>',
  x: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>',
  minus: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** The origin this script was served from (default `origin`). */
const scriptOrigin = (() => {
  try {
    const current = document.currentScript as HTMLScriptElement | null
    if (current?.src) return new URL(current.src).origin
  } catch {
    // ignore
  }
  return window.location.origin
})()
const scriptElement = document.currentScript as HTMLScriptElement | null

class Widget {
  private options: Required<Pick<DprLiveOptions, 'origin' | 'platform' | 'position' | 'autoOpen' | 'pollMs' | 'headless'>> & DprLiveOptions
  private host: HTMLElement | null = null
  private shadow: ShadowRoot | null = null
  private status: StreamStatus | null = null
  private state: PlayerState | null = null
  private mode: Mode = 'hidden'
  private joined = false
  private minimized = false
  /** The dock enlarged inside the page (stream and chat side by side) — never browser fullscreen. */
  private expanded = false
  private iframe: HTMLIFrameElement | null = null
  private iframeReady = false
  private ticket: string | null = null
  private ticketKnown = false
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private ticketTimer: ReturnType<typeof setInterval> | null = null
  private listeners = new Map<EventName, Set<Listener>>()
  private badges = new Set<{ el: HTMLElement; root: ShadowRoot }>()
  private destroyed = false
  private themeOption: ThemeOption = 'auto'
  private theme: Theme = 'dark'
  private themeWatch: (() => void) | null = null

  constructor(options: DprLiveOptions) {
    this.options = {
      ...options,
      origin: (options.origin || scriptOrigin).replace(/\/$/, ''),
      platform: options.platform || 'web',
      position: options.position || 'bottom-left',
      autoOpen: Boolean(options.autoOpen),
      pollMs: Math.max(2_000, options.pollMs || 5_000),
      headless: Boolean(options.headless),
    }
    window.addEventListener('message', this.onMessage)
    document.addEventListener('visibilitychange', this.onVisibility)
    if (!this.options.headless) this.mountRoot()
    this.setTheme(options.theme ?? 'auto')
    void this.poll()
  }

  /* ── events ── */

  on(name: EventName, listener: Listener): () => void {
    let set = this.listeners.get(name)
    if (!set) this.listeners.set(name, (set = new Set()))
    set.add(listener)
    return () => set!.delete(listener)
  }

  private emit(name: EventName, detail?: unknown) {
    this.listeners.get(name)?.forEach((listener) => {
      try {
        listener(detail)
      } catch (error) {
        console.error('[dpr-live] listener failed', error)
      }
    })
    window.dispatchEvent(new CustomEvent(`dpr-live:${name}`, { detail }))
  }

  /* ── status polling ── */

  private onVisibility = () => {
    if (document.visibilityState === 'visible') void this.poll()
  }

  private async poll() {
    if (this.destroyed) return
    if (this.pollTimer) clearTimeout(this.pollTimer)
    try {
      const response = await fetch(`${this.options.origin}/api/stream/status`, { cache: 'no-store', credentials: 'omit' })
      if (response.ok) this.applyStatus((await response.json()) as StreamStatus)
    } catch {
      // Offline or blocked by CSP: try again later.
    }
    if (!this.destroyed) this.pollTimer = setTimeout(() => void this.poll(), this.options.pollMs)
  }

  private applyStatus(next: StreamStatus) {
    if (this.status && this.status.serverTime > next.serverTime) return
    const previous = this.status
    this.status = next
    this.emit('status', next)
    if (next.isLive && !previous?.isLive) this.emit('live', next)
    if (!next.isLive && previous?.isLive) this.emit('offline', next)
    // Stream ended or a new session began: nobody is joined any more.
    if (!next.isLive || (previous?.sessionId && previous.sessionId !== next.sessionId)) {
      if (this.joined) this.leave(false)
    }
    if (next.isLive && this.options.autoOpen && !this.joined && !this.dismissedFor(next.sessionId)) this.open()
    this.render()
  }

  /* ── dock state ── */

  private dismissedFor(sessionId: string | null): boolean {
    try {
      return Boolean(sessionId) && sessionStorage.getItem(DISMISS_KEY) === sessionId
    } catch {
      return false
    }
  }

  private computeMode(): Mode {
    if (!this.status?.isLive) return 'hidden'
    if (this.joined) return this.minimized ? 'minimized' : 'player'
    return this.dismissedFor(this.status.sessionId) ? 'hidden' : 'pill'
  }

  /** Join: the only action that connects the visitor to the video. */
  open() {
    if (!this.status?.isLive) return
    this.joined = true
    this.minimized = false
    try {
      sessionStorage.removeItem(DISMISS_KEY)
    } catch {
      // private mode
    }
    this.render()
    this.emit('open')
    void this.refreshViewer()
    this.ticketTimer ??= setInterval(() => void this.refreshViewer(), TICKET_REFRESH_MS)
  }

  /** Close the player (back to the Join pill). */
  close() {
    this.leave(true)
  }

  private leave(user: boolean) {
    this.joined = false
    this.minimized = false
    this.expanded = false
    if (this.ticketTimer) clearInterval(this.ticketTimer)
    this.ticketTimer = null
    this.render()
    if (user) this.emit('close')
  }

  minimize() {
    if (!this.joined) return
    this.minimized = true
    this.render()
  }

  restore() {
    if (!this.joined) return
    this.minimized = false
    this.render()
  }

  /**
   * Enlarges the dock inside the page, like a chat widget's expand (stream and chat side by side),
   * or shrinks it back. No browser fullscreen, so there is no Esc trap: the same button, or Esc,
   * brings it back.
   */
  expand(on = !this.expanded) {
    if (!this.joined) return
    this.expanded = on
    if (on) this.minimized = false
    this.render()
  }

  /** ✕ on the pill: hidden until the next session. */
  dismiss() {
    try {
      if (this.status?.sessionId) sessionStorage.setItem(DISMISS_KEY, this.status.sessionId)
    } catch {
      // private mode
    }
    this.render()
  }

  /* ── theme ── */

  /** `auto` follows the host page live; `light` / `dark` force one. */
  setTheme(option: ThemeOption) {
    this.themeOption = option === 'light' || option === 'dark' ? option : 'auto'
    this.themeWatch?.()
    this.themeWatch = null
    if (this.themeOption === 'auto') {
      const update = () => this.applyTheme(pageTheme())
      const observer = new MutationObserver(update)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })
      const media = window.matchMedia?.('(prefers-color-scheme: dark)')
      media?.addEventListener?.('change', update)
      this.themeWatch = () => {
        observer.disconnect()
        media?.removeEventListener?.('change', update)
      }
      update()
    } else this.applyTheme(this.themeOption)
  }

  private applyTheme(theme: Theme) {
    const changed = theme !== this.theme
    this.theme = theme
    this.host?.setAttribute('data-theme', theme)
    this.badges.forEach(({ el }) => el.setAttribute('data-theme', theme))
    if (changed) this.post({ type: 'THEME', theme })
  }

  /* ── identity ── */

  /** The site's login state changed: a ticket for the signed-in user, or null (signed out). */
  setViewer(ticket: string | null | undefined) {
    this.ticket = ticket || null
    this.ticketKnown = true
    this.sendTicket()
  }

  /**
   * Asks `getViewerTicket` again (after login / logout, or when the player says it expired).
   *
   * `null` means signed out. A *failed* lookup (it threw) does not: the current ticket is kept and
   * the lookup retried a few times, so a slow site backend never downgrades a signed-in viewer to
   * "Sign in to chat".
   */
  async refreshViewer(attempt = 0) {
    const getter = this.options.getViewerTicket
    if (!getter) {
      // No ticket source: answer with what we have (null = guest), so the player doesn't wait.
      this.sendTicket()
      return
    }
    try {
      this.setViewer((await getter()) ?? null)
    } catch (error) {
      console.warn('[dpr-live] getViewerTicket failed', error)
      if (this.destroyed) return
      const delay = TICKET_RETRY_MS[attempt]
      if (delay !== undefined) setTimeout(() => void this.refreshViewer(attempt + 1), delay)
      // Out of retries with nothing known: let the player go on as a guest instead of waiting.
      else if (!this.ticketKnown) this.setViewer(null)
    }
  }

  private sendTicket() {
    if (this.iframe && this.iframeReady) this.post({ type: 'VIEWER_TICKET', ticket: this.ticket })
  }

  /* ── iframe bridge ── */

  private post(message: Record<string, unknown>) {
    this.iframe?.contentWindow?.postMessage({ source: SOURCE, ...message }, this.options.origin)
  }

  private onMessage = (event: MessageEvent) => {
    if (!this.iframe || event.origin !== this.options.origin || event.source !== this.iframe.contentWindow) return
    const data = event.data as { source?: string; type?: string; state?: PlayerState } | null
    if (!data || data.source !== SOURCE) return
    switch (data.type) {
      case 'READY':
        this.iframeReady = true
        this.post({ type: 'THEME', theme: this.theme })
        this.emit('ready')
        if (this.ticketKnown) this.sendTicket()
        else void this.refreshViewer()
        break
      case 'STATE':
        if (data.state) {
          this.state = data.state
          this.emit('state', data.state)
          this.renderBar()
        }
        break
      case 'LOGIN_REQUEST':
        this.emit('login-request')
        this.options.onLoginRequest?.()
        break
      case 'TICKET_EXPIRED':
        void this.refreshViewer()
        break
      case 'CLOSE_REQUEST':
        this.close()
        break
    }
  }

  mute(muted = true) {
    this.post({ type: muted ? 'MUTE' : 'UNMUTE' })
  }

  setVolume(volume: number) {
    this.post({ type: 'SET_VOLUME', volume })
  }

  /* ── rendering ── */

  private mountRoot() {
    const host = document.createElement('dpr-live-widget')
    host.setAttribute('data-dpr-live', '')
    const shadow = host.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = css
    shadow.appendChild(style)
    const root = document.createElement('div')
    root.className = `root${this.options.position === 'bottom-right' ? ' right' : ''}`
    shadow.appendChild(root)
    ;(this.options.container || document.body).appendChild(host)
    this.host = host
    this.shadow = shadow
  }

  private get root(): HTMLElement | null {
    return (this.shadow?.querySelector('.root') as HTMLElement | null) ?? null
  }

  private render() {
    const mode = this.computeMode()
    const changed = mode !== this.mode
    this.mode = mode
    this.renderBadges()
    const root = this.root
    if (!root) {
      // Headless: the iframe still needs a home while joined.
      if (this.joined) this.ensureHeadlessFrame()
      return
    }
    const title = escapeHtml(this.status?.title || 'Live stream now')

    // Pills are cheap to rebuild; the player window is kept (its iframe must not reload).
    root.querySelectorAll('.pill').forEach((node) => node.remove())
    if (mode === 'pill') {
      const pill = document.createElement('div')
      pill.className = 'pill'
      pill.setAttribute('role', 'region')
      pill.setAttribute('aria-label', 'Live stream')
      pill.innerHTML = `<span class="dot"></span><span class="live-label">Live</span><span class="pill-title" aria-live="polite">${title}</span>
        <button type="button" class="join" data-act="join">${ICON.play} Join live</button>
        <button type="button" class="icon-btn" data-act="dismiss" aria-label="Hide the live stream for this session">${ICON.x}</button>`
      root.prepend(pill)
    } else if (mode === 'minimized') {
      const pill = document.createElement('div')
      pill.className = 'pill'
      pill.innerHTML = `<button type="button" class="restore" data-act="restore" aria-label="Back to the live stream"><span class="dot"></span><span class="live-label">Live</span><span class="pill-title">— Back to stream</span></button>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close the live stream">${ICON.x}</button>`
      root.prepend(pill)
    }

    let win = root.querySelector('.window') as HTMLElement | null
    if (this.joined) {
      if (!win) win = this.createWindow(root)
      win.classList.toggle('hidden', mode === 'minimized')
      this.renderBar()
    } else if (win) {
      win.remove()
      this.iframe = null
      this.iframeReady = false
      this.state = null
    }
    root.querySelectorAll('[data-act]').forEach((node) => {
      ;(node as HTMLElement).onclick = () => this.act((node as HTMLElement).dataset.act!)
    })
    if (changed && mode === 'player') (root.querySelector('[data-act="minimize"]') as HTMLElement | null)?.focus({ preventScroll: true })
  }

  private embedUrl(): string {
    const params = new URLSearchParams({ platform: this.options.platform, parent: window.location.origin })
    // `ui=dock`: the player drops what the dock bar already shows (LIVE, title, fullscreen).
    params.set('ui', 'dock')
    params.set('theme', this.theme)
    return `${this.options.origin}/embed/live?${params}`
  }

  private createIframe(): HTMLIFrameElement {
    const iframe = document.createElement('iframe')
    iframe.src = this.embedUrl()
    iframe.title = `${this.status?.title || 'Live stream'} — player`
    iframe.allow = 'autoplay; fullscreen; picture-in-picture'
    iframe.setAttribute('allowfullscreen', '')
    this.iframe = iframe
    this.iframeReady = false
    return iframe
  }

  private createWindow(root: HTMLElement): HTMLElement {
    const win = document.createElement('section')
    win.className = 'window'
    win.setAttribute('aria-label', 'Live stream')
    win.innerHTML = `<div class="bar">
        <span class="chip"><span class="dot"></span>Live</span>
        <span class="bar-title"></span>
        <button type="button" class="icon-btn" data-act="minimize" aria-label="Minimise">${ICON.minus}</button>
        <button type="button" class="icon-btn" data-act="expand" aria-label="Expand">${ICON.expand}</button>
        <button type="button" class="icon-btn" data-act="close" aria-label="Close the live stream">${ICON.x}</button>
      </div>
      <div class="frame"></div>`
    win.querySelector('.frame')!.appendChild(this.createIframe())
    win.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || document.fullscreenElement) return
      if (this.expanded) this.expand(false)
      else this.minimize()
    })
    root.appendChild(win)
    return win
  }

  private ensureHeadlessFrame() {
    if (this.iframe) return
    const holder = document.createElement('div')
    holder.style.cssText = 'position:fixed;inset:auto 16px 16px auto;width:400px;height:520px;z-index:2147483000'
    holder.appendChild(this.createIframe())
    this.iframe!.style.cssText = 'width:100%;height:100%;border:0;border-radius:16px'
    ;(this.options.container || document.body).appendChild(holder)
  }

  private renderBar() {
    const win = this.root?.querySelector('.window')
    if (!win) return
    const title = win.querySelector('.bar-title') as HTMLElement
    title.textContent = this.state?.title || this.status?.title || 'Live stream'
    // Viewers are shown once, in the player's count row next to the reactions.
    win.classList.toggle('expanded', this.expanded)
    const size = win.querySelector('[data-act="expand"]') as HTMLElement
    size.innerHTML = this.expanded ? ICON.collapse : ICON.expand
    size.setAttribute('aria-label', this.expanded ? 'Collapse' : 'Expand')
    size.setAttribute('aria-pressed', String(this.expanded))
  }

  private act(action: string) {
    switch (action) {
      case 'join':
        return this.open()
      case 'dismiss':
        return this.dismiss()
      case 'restore':
        return this.restore()
      case 'minimize':
        return this.minimize()
      case 'close':
        return this.close()
      case 'expand':
        return this.expand()
    }
  }

  /** A LIVE badge (Join button) inside `el` — e.g. in the site header. Shown only while live. */
  mountBadge(el: HTMLElement): () => void {
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' })
    const entry = { el, root }
    this.badges.add(entry)
    this.renderBadges()
    return () => {
      this.badges.delete(entry)
      root.innerHTML = ''
    }
  }

  private renderBadges() {
    this.badges.forEach(({ root }) => {
      if (!this.status?.isLive) {
        root.innerHTML = ''
        return
      }
      if (root.querySelector('.badge')) return
      root.innerHTML = `<style>${css}</style><button type="button" class="badge" aria-label="Live now — join the stream" title="Join the live stream"><span class="dot"></span>Live</button>`
      ;(root.querySelector('.badge') as HTMLElement).onclick = () => this.open()
    })
  }

  /** Current stream status (null until the first poll). */
  getStatus(): StreamStatus | null {
    return this.status
  }

  /** Last state the player reported (null until joined). */
  getState(): PlayerState | null {
    return this.state
  }

  destroy() {
    this.destroyed = true
    if (this.pollTimer) clearTimeout(this.pollTimer)
    if (this.ticketTimer) clearInterval(this.ticketTimer)
    window.removeEventListener('message', this.onMessage)
    document.removeEventListener('visibilitychange', this.onVisibility)
    this.themeWatch?.()
    this.badges.forEach(({ root }) => (root.innerHTML = ''))
    this.badges.clear()
    this.host?.remove()
    this.iframe?.parentElement?.remove()
    this.listeners.clear()
  }
}

let instance: Widget | null = null

const api = {
  version: '1.0.0',
  /** Creates the widget (idempotent: a second call replaces the first). */
  init(options: DprLiveOptions = {}) {
    instance?.destroy()
    instance = new Widget(options)
    return api
  },
  setViewer: (ticket: string | null | undefined) => instance?.setViewer(ticket),
  refreshViewer: () => instance?.refreshViewer(),
  open: () => instance?.open(),
  close: () => instance?.close(),
  minimize: () => instance?.minimize(),
  /** `auto` follows the page's light / dark theme (default); `light` / `dark` force one. */
  setTheme: (theme: ThemeOption) => instance?.setTheme(theme),
  /** Enlarge the dock in the page (stream + chat side by side); `false` shrinks it back. */
  expand: (on?: boolean) => instance?.expand(on),
  restore: () => instance?.restore(),
  mute: (muted = true) => instance?.mute(muted),
  setVolume: (volume: number) => instance?.setVolume(volume),
  mountBadge: (el: HTMLElement) => instance?.mountBadge(el) ?? (() => undefined),
  on: (name: EventName, listener: Listener) => instance?.on(name, listener) ?? (() => undefined),
  getStatus: () => instance?.getStatus() ?? null,
  getState: () => instance?.getState() ?? null,
  destroy() {
    instance?.destroy()
    instance = null
  },
}

declare global {
  interface Window {
    DprLive?: typeof api
    DprLiveConfig?: DprLiveOptions
  }
}

window.DprLive = api

/**
 * Zero-code setup: `<script src=".../dpr-live.js" data-auto-init data-platform="drlive"
 * data-ticket-url="/api/livestream/viewer-ticket" data-login-url="/login">`, or a
 * `window.DprLiveConfig = {…}` object set before the script loads.
 */
function autoInit() {
  if (window.DprLiveConfig) {
    api.init(window.DprLiveConfig)
    return
  }
  const data = scriptElement?.dataset
  if (!data || !('autoInit' in data)) return
  const ticketUrl = data.ticketUrl
  const loginUrl = data.loginUrl
  api.init({
    origin: data.origin,
    platform: data.platform,
    position: data.position === 'bottom-right' ? 'bottom-right' : 'bottom-left',
    autoOpen: data.autoOpen === 'true',
    theme: data.theme === 'light' || data.theme === 'dark' ? data.theme : 'auto',
    getViewerTicket: ticketUrl
      ? () =>
          fetch(ticketUrl, { credentials: 'include', cache: 'no-store' })
            .then((response) => (response.ok ? response.json() : { ticket: null }))
            .then((body: { ticket?: string | null }) => body.ticket ?? null)
      : undefined,
    onLoginRequest: loginUrl
      ? () => {
          const url = new URL(loginUrl, window.location.href)
          url.searchParams.set('returnTo', window.location.pathname + window.location.search)
          window.location.assign(url.toString())
        }
      : undefined,
  })
}

autoInit()
window.dispatchEvent(new CustomEvent('dpr-live:loaded', { detail: api }))
