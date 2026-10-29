'use client'

/**
 * The viewer (`/embed/live`): what the plugin's dock iframe and the mobile apps' WebView load.
 * Video tiles (one per host), love / like / smile with live totals, live chat, viewer count.
 *
 * Layout follows the space it gets: **split** (video on top, chat below) when there is room for
 * both — a phone WebView, a tall dock — else **overlay** (chat in a sheet over the video, opened
 * from the chat button).
 *
 * Identity: the host platform sends a viewer ticket (`VIEWER_TICKET`, or `DprLive.setViewer()` from
 * a native app). Without one the viewer watches as a guest; Sign in posts `LOGIN_REQUEST` so the
 * platform opens its own login, then sends a ticket.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { decodeJwt } from 'jose'
import { ChevronDown, MessageCircle, PanelRightClose, Radio, X } from 'lucide-react'
import { ChatPanel } from '@/components/live/ChatPanel'
import { FloatingReactions } from '@/components/live/FloatingReactions'
import { ReactionBar, ViewerCount } from '@/components/live/ReactionBar'
import { LiveStreamPlayer } from '@/components/stream/LiveStreamPlayer'
import { useLiveChat } from '@/hooks/useLiveChat'
import { useOptimisticReactions } from '@/hooks/useOptimisticReactions'
import { useAppLiveStream } from '@/hooks/useLiveStreams'
import { useViewerStream } from '@/hooks/useViewerStream'
import { connectBridge, type Bridge, type PlayerCommand, type PlayerState } from '@/lib/embed/bridge'
import { hostRtmId } from '@/lib/stream/ids'
import type { AppLiveStreamStatus, ReactionKind, RtmTokenResponse } from '@/lib/stream/types'
import { cn } from '@/lib/utils'

/** Identity inside a ticket (iss + sub) — a refreshed ticket for the same person must not reconnect chat. */
function ticketSubject(ticket: string | null): string {
  if (!ticket) return 'guest'
  try {
    const claims = decodeJwt(ticket)
    return `${claims.iss}:${claims.sub}`
  } catch {
    return 'guest'
  }
}

/**
 * - `side`: wide (an expanded dock, a desktop page) → `[stream][chat]` side by side;
 * - `split`: tall (the dock, a phone WebView) → stream on top, chat below;
 * - `overlay`: small → chat in a sheet over the video, from the chat button.
 */
type Layout = 'side' | 'split' | 'overlay'

function useLayout(ref: React.RefObject<HTMLElement | null>, allowSide: boolean): Layout {
  const [layout, setLayout] = useState<Layout>('overlay')
  useEffect(() => {
    const node = ref.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry!.contentRect
      setLayout(allowSide && width >= 760 && height >= 360 ? 'side' : height >= width * (9 / 16) + 240 ? 'split' : 'overlay')
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref, allowSide])
  return layout
}

export function EmbedPlayer({
  initial,
  parentOrigins,
  dock = false,
  initialTheme = 'dark',
}: {
  initial: AppLiveStreamStatus
  parentOrigins: string[]
  /** Loaded by the plugin's dock (`?ui=dock`): its bar already shows LIVE, title and viewers. */
  dock?: boolean
  /** `?theme=` — the host site's theme; the plugin keeps it in sync afterwards (`THEME`). */
  initialTheme?: 'light' | 'dark'
}) {
  const [theme, setTheme] = useState<'light' | 'dark'>(initialTheme)
  // The design tokens (chat, counts) follow the host site's light / dark theme; the video stays black.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])
  const status = useAppLiveStream(initial) ?? initial
  const isLive = status.isLive
  const stream = useViewerStream(isLive, status.host?.participants)

  const [ticket, setTicket] = useState<string | null>(null)
  const ticketRef = useRef(ticket)
  ticketRef.current = ticket
  const bridgeRef = useRef<Bridge | null>(null)
  const [embedded, setEmbedded] = useState(true)
  /**
   * Embedded, the host sends a ticket (or null) right after READY. Chat waits for that first answer
   * (max 3 s) instead of signing in as a guest and immediately again as the user.
   */
  const [identityKnown, setIdentityKnown] = useState(false)

  const getRtmToken = useCallback(async (conn: string): Promise<RtmTokenResponse> => {
    const response = await fetch('/api/token/viewer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ticket: ticketRef.current, conn }),
      cache: 'no-store',
    })
    const body = (await response.json().catch(() => null)) as { rtm?: RtmTokenResponse; ticketRejected?: boolean; error?: string } | null
    if (!response.ok || !body?.rtm) throw new Error(body?.error ?? `Chat token failed (${response.status})`)
    if (body.ticketRejected) bridgeRef.current?.send({ type: 'TICKET_EXPIRED' })
    return body.rtm
  }, [])

  /** The server counts the reaction (capped per person); the totals come back with the status. */
  const sendReaction = useCallback(async (counts: Partial<Record<ReactionKind, number>>) => {
    await fetch('/api/stream/react', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ counts, ticket: ticketRef.current }),
      cache: 'no-store',
    })
  }, [])

  const chat = useLiveChat({
    enabled: isLive && identityKnown,
    sessionKey: `${status.sessionId}:${ticketSubject(ticket)}`,
    getToken: getRtmToken,
    adminUserId: status.startedBy ? hostRtmId(status.startedBy.sub) : null,
    sendReaction,
  })

  const playerState: PlayerState = {
    status: !isLive ? 'offline' : stream.status === 'live' || stream.status === 'reconnecting' ? 'live' : 'connecting',
    isLive,
    title: status.title,
    aspectRatio: stream.participants.length > 1 ? 'landscape' : stream.orientation,
    hosts: stream.participants.length,
    viewers: status.viewers ?? 0,
    muted: stream.muted,
    volume: stream.volume,
    signedIn: Boolean(chat.me?.canPost),
  }
  const stateRef = useRef(playerState)
  stateRef.current = playerState
  const streamRef = useRef(stream)
  streamRef.current = stream

  useEffect(() => {
    const bridge = connectBridge(
      parentOrigins,
      (command: PlayerCommand) => {
        if (command.type === 'VIEWER_TICKET') {
          setTicket(command.ticket)
          setIdentityKnown(true)
        }
        else if (command.type === 'THEME') setTheme(command.theme)
        else if (command.type === 'MUTE') streamRef.current.setMuted(true)
        else if (command.type === 'UNMUTE') streamRef.current.setMuted(false)
        else if (command.type === 'SET_VOLUME') streamRef.current.setVolume(command.volume)
        else bridgeRef.current?.send({ type: 'STATE', state: stateRef.current })
      },
      () => stateRef.current,
    )
    bridgeRef.current = bridge
    setEmbedded(bridge.embedded)
    bridge.send({ type: 'READY' })
    const fallback = setTimeout(() => setIdentityKnown(true), bridge.embedded ? 3_000 : 0)
    return () => {
      clearTimeout(fallback)
      bridgeRef.current = null
      bridge.dispose()
    }
  }, [parentOrigins])

  // Player → host: on every visible change.
  const { status: s, aspectRatio, hosts, viewers, muted, volume, signedIn, title } = playerState
  useEffect(() => {
    bridgeRef.current?.send({ type: 'STATE', state: stateRef.current })
  }, [s, aspectRatio, hosts, viewers, muted, volume, signedIn, title, isLive])

  const requestSignIn = useCallback(() => {
    if (bridgeRef.current?.embedded) bridgeRef.current.send({ type: 'LOGIN_REQUEST' })
  }, [])

  const rootRef = useRef<HTMLElement>(null)
  // Chat beside the video whenever there is room — like /host and the plugin's expanded dock.
  const layout = useLayout(rootRef, true)
  /** The viewer folded the chat away — the video takes the whole player (the chat button brings it back). */
  const [chatHidden, setChatHidden] = useState(false)
  const effective: Layout = chatHidden ? 'overlay' : layout
  const split = effective !== 'overlay'
  const [chatOpen, setChatOpen] = useState(false)
  const seen = useRef(0)
  const unread = chatOpen || split ? 0 : Math.max(0, chat.messages.length - seen.current)
  useEffect(() => {
    if (chatOpen || split) seen.current = chat.messages.length
  }, [chatOpen, split, chat.messages.length])

  const canReact = Boolean(chat.me?.canPost) && !(chat.me && chat.mutedUserIds.includes(chat.me.userId))
  const signInHint = !embedded && chat.me && !chat.me.canPost
  const light = theme === 'light'

  // A click shows at once; the server's real total takes over when it arrives.
  const { totals, bump } = useOptimisticReactions(status.reactions)
  const react = (kind: ReactionKind) => {
    if (chat.react(kind)) bump(kind)
  }

  /** Viewers + reactions as one aligned row (beside the chat) or column (over the video). */
  const counts = (tone: 'dark' | 'light') => (
    <div className={cn('flex gap-1.5', split ? 'flex-row items-center' : 'flex-col items-end')}>
      <ViewerCount tone={tone} count={status.viewers} className={cn(!split && 'h-auto min-w-12 flex-col gap-0 px-2 py-1.5')} />
      <ReactionBar tone={tone} totals={totals} canReact={canReact} onReact={react} onBlocked={requestSignIn} vertical={!split} />
    </div>
  )

  /** Over the video: open the chat sheet — or, when the viewer folded the chat away, bring it back. */
  const chatButton = (
    <button
      type="button"
      onClick={() => (chatHidden ? setChatHidden(false) : setChatOpen((open) => !open))}
      aria-label={chatOpen ? 'Hide chat' : 'Show chat'}
      aria-pressed={chatOpen}
      className="relative flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur hover:bg-black/70"
    >
      <MessageCircle className="h-4 w-4" />
      {unread > 0 && (
        <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-dr-live-container px-1 text-center text-[10px] font-bold leading-4">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  )

  const chatHeader = (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <span className={cn('shrink-0 whitespace-nowrap font-manrope text-xs font-semibold uppercase tracking-wider', light ? 'text-on-surface-variant' : 'text-white/70')}>Live chat</span>
      <div className="flex items-center gap-1.5">
        {counts(light ? 'light' : 'dark')}
        {split && (
          <button
            type="button"
            onClick={() => {
              setChatHidden(true)
              setChatOpen(false)
            }}
            aria-label="Collapse chat"
            title="Collapse chat"
            className={cn('flex h-10 w-10 items-center justify-center rounded-full', light ? 'text-on-surface-variant hover:bg-surface-2' : 'text-white/80 hover:bg-white/15')}
          >
            {effective === 'side' ? <PanelRightClose className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  )

  const video = useMemo(
    () => (isLive ? null : <OfflineCard lastTitle={status.lastTitle} />),
    [isLive, status.lastTitle],
  )

  return (
    <main
      ref={rootRef}
      data-embed-player
      className={cn('flex h-[100dvh] w-full overflow-hidden bg-black text-white', effective === 'side' ? 'flex-row' : 'flex-col')}
    >
      <section className={cn('relative min-h-0 min-w-0 bg-black', effective === 'split' ? 'aspect-video w-full shrink-0' : 'flex-1')}>
        {video ?? (
          <>
            <LiveStreamPlayer stream={stream} title={status.title ?? undefined} fill minimal={dock} />
            <FloatingReactions particles={chat.particles} />
            {/* One column (chat button, viewers, reactions): nothing overlaps, everything stays clickable. */}
            {!split && (
              <div className="absolute bottom-16 right-2 z-[16] flex flex-col items-end gap-1.5">
                {chatButton}
                {counts('dark')}
              </div>
            )}
            {!split && chatOpen && (
              <div className="absolute inset-x-0 bottom-0 z-20 flex h-[62%] flex-col rounded-t-2xl bg-black/75 backdrop-blur-md">
                <div className="flex items-center justify-between px-3 pt-2">
                  <span className="font-manrope text-xs font-semibold uppercase tracking-wider text-white/80">Live chat</span>
                  <button type="button" onClick={() => setChatOpen(false)} aria-label="Hide chat" className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/15">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <ChatPanel chat={chat} onSignIn={requestSignIn} className="flex-1" />
              </div>
            )}
          </>
        )}
      </section>

      {split && isLive && (
        <section
          aria-label="Live chat"
          className={cn(
            'flex min-h-0 flex-col',
            light ? 'border-outline-variant bg-background text-foreground' : 'border-white/10 bg-neutral-950',
            effective === 'side' ? 'w-[360px] shrink-0 border-l' : 'flex-1 border-t',
          )}
        >
          {chatHeader}
          <ChatPanel chat={chat} tone={light ? 'light' : 'dark'} onSignIn={requestSignIn} className="flex-1" />
          {signInHint && <SignInHint />}
        </section>
      )}

      {signInHint && !(split && isLive) && <SignInHint />}
      {/* The bare player owns the whole page: no theme background around it. */}
      <style>{`html, body { background: #000 !important; }`}</style>
    </main>
  )
}

function SignInHint() {
  return (
    <p className="shrink-0 bg-neutral-900 px-3 py-1.5 text-center font-roboto text-[11px] text-white/60">
      Open this stream from duPont Registry Live or dR Garage to sign in and chat.
    </p>
  )
}

/** Same look as the host stage's idle state (`StreamStage`): icon tile, title, one line of help. */
function OfflineCard({ lastTitle }: { lastTitle: string | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center text-white">
      <span className="flex h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-white/5">
        <Radio className="h-8 w-8 text-dr-live" />
      </span>
      <p className="font-manrope text-xl font-semibold">No live stream right now</p>
      <p className="max-w-md font-roboto text-sm text-white/70">
        {lastTitle ? `“${lastTitle}” has ended. ` : ''}The player starts by itself as soon as the next stream goes live.
      </p>
    </div>
  )
}
