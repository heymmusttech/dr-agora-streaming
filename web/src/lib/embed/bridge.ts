'use client'

/**
 * The player's link to whoever hosts it (`/embed/live`):
 *
 * 1. **Web (plugin iframe)** — `window.postMessage`, exact origin checks on both sides. The parent
 *    origin must match `LIVESTREAM_ALLOWED_PARENT_ORIGINS`; it is read from
 *    `location.ancestorOrigins`, else the `parent` query parameter the plugin adds, else the
 *    referrer — and only ever used if allowed.
 * 2. **Native (Flutter / iOS / Android WebView)** — the page loads `/embed/live` directly. Events
 *    go to a JS channel named `DprLiveNative` (Flutter `JavaScriptChannel`, iOS
 *    `webkit.messageHandlers.DprLiveNative`, Android `addJavascriptInterface`). Commands come in
 *    through `window.DprLive.*`, called with `runJavaScript`.
 *
 * Messages (both directions carry `source: 'dpr-live'`):
 *   parent → player   VIEWER_TICKET {ticket|null} · THEME {theme} · MUTE · UNMUTE · SET_VOLUME {volume} · GET_STATUS
 *   player → parent   READY · STATE {…} · LOGIN_REQUEST · TICKET_EXPIRED · CLOSE_REQUEST
 */
import { isAllowedOrigin } from '@/lib/auth/origins'

export const BRIDGE_SOURCE = 'dpr-live'

export type PlayerCommand =
  | { type: 'VIEWER_TICKET'; ticket: string | null }
  | { type: 'THEME'; theme: 'light' | 'dark' }
  | { type: 'MUTE' }
  | { type: 'UNMUTE' }
  | { type: 'GET_STATUS' }
  | { type: 'SET_VOLUME'; volume: number }

export interface PlayerState {
  /** Video is playing / joining / nothing to show. */
  status: 'live' | 'connecting' | 'offline'
  /** The stream is started (a host pressed Start), even before video arrives. */
  isLive: boolean
  title: string | null
  aspectRatio: 'portrait' | 'landscape'
  hosts: number
  viewers: number
  muted: boolean
  volume: number
  signedIn: boolean
}

export type PlayerEvent =
  | { type: 'READY' }
  | { type: 'STATE'; state: PlayerState }
  | { type: 'LOGIN_REQUEST' }
  | { type: 'TICKET_EXPIRED' }
  | { type: 'CLOSE_REQUEST' }

type NativeChannel = { postMessage: (message: string) => void }

interface NativeWindow extends Window {
  DprLiveNative?: NativeChannel
  webkit?: { messageHandlers?: { DprLiveNative?: NativeChannel } }
  ReactNativeWebView?: NativeChannel
}

function nativeChannel(): NativeChannel | null {
  const w = window as NativeWindow
  return w.DprLiveNative ?? w.webkit?.messageHandlers?.DprLiveNative ?? w.ReactNativeWebView ?? null
}

export const isNativeHost = (): boolean => typeof window !== 'undefined' && nativeChannel() !== null

/** The embedding page's origin, when it is allowed; null when top-level or not allowed. */
export function resolveParentOrigin(patterns: string[]): string | null {
  if (typeof window === 'undefined' || window.parent === window) return null
  const candidates: string[] = []
  const ancestors = (window.location as Location & { ancestorOrigins?: DOMStringList }).ancestorOrigins
  if (ancestors && ancestors.length > 0) candidates.push(ancestors[0]!)
  else {
    const param = new URLSearchParams(window.location.search).get('parent')
    if (param) candidates.push(param)
    try {
      if (document.referrer) candidates.push(new URL(document.referrer).origin)
    } catch {
      // no referrer
    }
  }
  return candidates.find((origin) => isAllowedOrigin(origin, patterns)) ?? null
}

function parseCommand(data: unknown): PlayerCommand | null {
  if (!data || typeof data !== 'object') return null
  const message = data as Record<string, unknown>
  if (message.source !== BRIDGE_SOURCE) return null
  switch (message.type) {
    case 'MUTE':
    case 'UNMUTE':
    case 'GET_STATUS':
      return { type: message.type }
    case 'SET_VOLUME':
      return typeof message.volume === 'number' ? { type: 'SET_VOLUME', volume: message.volume } : null
    case 'THEME':
      return message.theme === 'light' || message.theme === 'dark' ? { type: 'THEME', theme: message.theme } : null
    case 'VIEWER_TICKET':
      return { type: 'VIEWER_TICKET', ticket: typeof message.ticket === 'string' ? message.ticket : null }
    default:
      return null
  }
}

export interface Bridge {
  send: (event: PlayerEvent) => void
  /** Someone (web parent or native app) is listening. */
  embedded: boolean
  dispose: () => void
}

/**
 * Connects the player to its host. `onCommand` receives web and native commands alike.
 * Exposes `window.DprLive` for native apps: `setViewer(ticket)`, `setTheme('light' | 'dark')`, `mute()`, `unmute()`, `setVolume(n)`, `getState()`.
 */
export function connectBridge(patterns: string[], onCommand: (command: PlayerCommand) => void, getState: () => PlayerState): Bridge {
  const parentOrigin = resolveParentOrigin(patterns)
  const native = nativeChannel()

  const send = (event: PlayerEvent) => {
    const message = { source: BRIDGE_SOURCE, ...event }
    if (parentOrigin) window.parent.postMessage(message, parentOrigin)
    if (native) {
      try {
        native.postMessage(JSON.stringify(message))
      } catch {
        // channel gone (app backgrounded)
      }
    }
  }

  const onMessage = (event: MessageEvent) => {
    if (!parentOrigin || event.origin !== parentOrigin || event.source !== window.parent) return
    const command = parseCommand(event.data)
    if (command) onCommand(command)
  }
  window.addEventListener('message', onMessage)

  const api = {
    setViewer: (ticket: string | null) => onCommand({ type: 'VIEWER_TICKET', ticket: ticket || null }),
    setTheme: (theme: 'light' | 'dark') => onCommand({ type: 'THEME', theme: theme === 'light' ? 'light' : 'dark' }),
    mute: () => onCommand({ type: 'MUTE' }),
    unmute: () => onCommand({ type: 'UNMUTE' }),
    setVolume: (volume: number) => onCommand({ type: 'SET_VOLUME', volume }),
    getState: () => getState(),
  }
  // Inside the player's own window (not the host page, where `DprLive` is the plugin).
  const globals = window as unknown as Record<string, unknown>
  globals.DprLive = api

  return {
    send,
    embedded: Boolean(parentOrigin || native),
    dispose: () => {
      window.removeEventListener('message', onMessage)
      delete globals.DprLive
    },
  }
}
