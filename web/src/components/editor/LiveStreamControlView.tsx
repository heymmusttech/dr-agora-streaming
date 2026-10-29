'use client'

/**
 * The host studio (`/host`), laid out as `[sidebar][stream][chat]`:
 * - stream column: title + status on top, then the stage (`StreamStage`) — your
 *   camera and the co-hosts as viewers see them, with the setup and one primary action at the bottom;
 * - chat column: live chat with moderation (delete, mute).
 *
 * Nobody goes on air untested: Preview camera opens the device check first (pickers, mic level,
 * Hear myself); then Start stream starts the stream and goes live in one step.
 *
 * Roles: whoever presses Start is the **admin** — their camera is the stream (ending it stops the
 * stream). Any other signed-in host who opens this page while it is live in multi-host mode is a
 * **co-host**: they can join on camera (up to the max-hosts limit), chat and moderate, and leave —
 * but not stop the stream while the admin is on camera.
 *
 * Everything flips in real time from the SSE feed, including when another host acts.
 */
import { useEffect, useState } from 'react'
import { MessageCircle, Radio } from 'lucide-react'
import { toast } from 'sonner'
import { ChatPanel } from '@/components/live/ChatPanel'
import { useBroadcast } from '@/components/stream/BroadcastPanel'
import { useElapsed } from '@/hooks/useElapsed'
import { useLiveChat } from '@/hooks/useLiveChat'
import { useAppLiveStream, useLiveStreamFeedStatus } from '@/hooks/useLiveStreams'
import {
  fetchHostRtmToken,
  reportViewerCount,
  saveSessionSnapshot,
  sendHostReaction,
  startLiveStream,
  stopLiveStream,
} from '@/lib/stream/host-api'
import { hostRtmId } from '@/lib/stream/ids'
import type { AppLiveStreamStatus, HostRole, LiveStreamHostMode } from '@/lib/stream/types'
import { cn } from '@/lib/utils'
import { ConfirmDialog } from './ConfirmDialog'
import { useHost } from './HostGate'
import { StreamStage, type StageAction } from './StreamStage'

const DEFAULT_STREAM_TITLE = 'duPont REGISTRY Live'

const errorText = (error: unknown) => (error instanceof Error ? error.message : undefined)

/** Who is on camera, e.g. "You · Jane Doe". */
function describeHosts(status: AppLiveStreamStatus, meSub: string): string | null {
  const participants = status.host?.participants ?? []
  if (participants.length === 0) return null
  const mine = status.startedBy?.sub === meSub
  return participants.map((p) => (mine && p.role === 'admin' ? 'You' : p.name)).join(' · ')
}

export function LiveStreamControlView({ initial, agoraConfigured }: { initial: AppLiveStreamStatus; agoraConfigured: boolean }) {
  const status = useAppLiveStream(initial) ?? initial
  const feed = useLiveStreamFeedStatus()
  const { host: me } = useHost()
  const live = status.isLive
  const role: HostRole = live && status.startedBy && status.startedBy.sub !== me.sub ? 'host' : 'admin'
  const adminName = status.startedBy?.name ?? 'The admin'
  const host = useBroadcast(role)
  const onAir = host.status === 'live'
  const elapsed = useElapsed(live ? status.startedAt : null)

  // Hosts are in the chat for the whole session — on camera or not — so they can moderate.
  const chat = useLiveChat({
    enabled: live,
    sessionKey: status.sessionId ?? 'offline',
    getToken: async (conn) => (await fetchHostRtmToken(conn)).rtm,
    adminUserId: status.startedBy ? hostRtmId(status.startedBy.sub) : null,
    persist: saveSessionSnapshot,
    sendReaction: sendHostReaction,
    reportViewers: reportViewerCount,
  })

  // Co-host tiles on the stage carry the host's name.
  const namesKey = (status.host?.participants ?? []).map((p) => `${p.uid}:${p.name}`).join('|')
  const setNames = host.setNames
  useEffect(() => {
    setNames(new Map((status.host?.participants ?? []).map((p) => [String(p.uid), p.name])))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey])

  // Setup: a draft while offline, the live values (changed by the admin) while live.
  const [title, setTitle] = useState(status.title ?? status.lastTitle ?? DEFAULT_STREAM_TITLE)
  const [draftMode, setDraftMode] = useState<LiveStreamHostMode>(status.hostMode ?? 'single')
  const [draftMax, setDraftMax] = useState(status.maxHosts > 1 ? status.maxHosts : 2)
  useEffect(() => {
    if (live) setTitle(status.title ?? '')
  }, [live, status.title])
  const hostMode = live ? status.hostMode : draftMode
  const maxHosts = live ? status.maxHosts : draftMax

  const [busy, setBusy] = useState<'start' | 'live' | 'stop' | 'update' | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)

  const update = async (patch: { title?: string; hostMode?: LiveStreamHostMode; maxHosts?: number }) => {
    setBusy('update')
    try {
      await startLiveStream({ title: status.title ?? undefined, hostMode: status.hostMode, maxHosts: status.maxHosts, ...patch })
      toast.success('Stream updated', { description: 'Viewers keep their player (same session).' })
    } catch (error) {
      toast.error('Could not update the stream', { description: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  /** Previewing → stream + on air in one press. The stream only starts once the camera is open. */
  const startAll = async () => {
    setBusy('start')
    try {
      if (!(await host.preview())) {
        toast.error('Camera unavailable', { description: 'Allow camera and microphone, then press Start stream again.' })
        return
      }
      await startLiveStream({ title: title.trim() || DEFAULT_STREAM_TITLE, hostMode: draftMode, maxHosts: draftMax })
      await host.goLive()
    } catch (error) {
      toast.error('Could not start the stream', { description: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  /** Live already: put this camera on air (admin back on camera, or a co-host joining). */
  const goOnAir = async () => {
    setBusy('live')
    try {
      if (await host.preview()) await host.goLive()
    } finally {
      setBusy(null)
    }
  }

  const endStream = async () => {
    setBusy('stop')
    try {
      // Stop first: every camera (this one included) ends when it sees the stream go offline.
      await stopLiveStream()
      await host.endLive()
      // Done: release the camera (its light goes off) — the next stream starts with a fresh check.
      await host.stopPreview()
      setConfirmEnd(false)
      toast.success('Stream ended', { description: "Every viewer's player closed and every camera went off air." })
    } catch (error) {
      toast.error('Could not end the stream', { description: errorText(error) })
    } finally {
      setBusy(null)
    }
  }

  // What the bottom bar offers.
  const adminOnAir = (status.host?.admins ?? 0) > 0
  const canStop = role === 'admin' || !adminOnAir
  const camerasOnAir = status.host?.hosts ?? 0
  const full = !onAir && camerasOnAir >= status.maxHosts
  const coHostBlock =
    role === 'host' && !onAir
      ? status.hostMode === 'single'
        ? `Single host mode: only ${adminName} is on camera.`
        : full
          ? `All ${status.maxHosts} camera slot${status.maxHosts > 1 ? 's are' : ' is'} taken.`
          : null
      : null
  const endAction: StageAction = { label: 'End stream', icon: 'stop', tone: 'quiet', onClick: () => setConfirmEnd(true) }

  const hasCamera = host.status === 'previewing' || onAir || host.status === 'connecting'
  /** Before any camera goes on air it is previewed and tested (camera, mic, Hear myself). */
  const previewAction: StageAction = {
    label: 'Preview camera',
    icon: 'camera',
    onClick: () => void host.preview(),
    disabled: Boolean(coHostBlock) || (!live && !agoraConfigured),
  }

  let primary: StageAction
  let secondary: StageAction | null = null
  if (!hasCamera && !onAir) {
    primary = previewAction
    if (live && canStop) secondary = endAction
  } else if (!live) {
    primary = { label: 'Start stream', icon: 'start', onClick: () => void startAll(), busy: busy === 'start', disabled: !agoraConfigured }
  } else if (role === 'admin') {
    if (onAir) primary = { ...endAction, tone: 'danger' }
    else {
      primary = { label: 'Go live', icon: 'live', onClick: () => void goOnAir(), busy: busy === 'live' || host.status === 'connecting', disabled: full }
      secondary = endAction
    }
  } else {
    primary = onAir
      ? { label: 'Leave stage', icon: 'leave', tone: 'danger', onClick: () => void host.endLive() }
      : { label: 'Join as co-host', icon: 'live', onClick: () => void goOnAir(), busy: busy === 'live' || host.status === 'connecting', disabled: Boolean(coHostBlock) }
    if (canStop && !onAir) secondary = endAction
  }

  // While Go live / Join is loading, it is the only action: no End stream beside it.
  if (primary.busy) secondary = null

  const idle = !live
    ? { title: 'Ready to go live', text: 'Preview your camera and test your mic first. Then Start stream puts you on air, and viewers on dR Live get the LIVE pill right away.' }
    : role === 'admin'
      ? { title: 'You are not on camera', text: 'The stream is live. Preview your camera, then Go live to put it back on air.' }
      : { title: `${adminName} is live`, text: coHostBlock ?? 'Preview your camera, then join as a co-host to appear next to them. Viewers see the cameras side by side.' }

  const who = describeHosts(status, me.sub)

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 pb-2 lg:h-full lg:flex-row">
      {/* ── Stream ── */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        <header className="flex flex-col gap-3 rounded-2xl border border-outline-variant bg-background p-3 shadow-sm md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <input
              aria-label="Stream title"
              value={title}
              maxLength={120}
              disabled={live && role !== 'admin'}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => live && role === 'admin' && title.trim() && title !== (status.title ?? '') && void update({ title: title.trim() })}
              onKeyDown={(event) => event.key === 'Enter' && (event.target as HTMLInputElement).blur()}
              placeholder="Stream title"
              className="h-10 w-full rounded-xl border border-transparent bg-surface-1 px-3 font-manrope text-lg font-semibold text-foreground transition-colors hover:border-outline-variant focus:border-dr-live-container focus:outline-none disabled:opacity-80"
            />
            {/* <p className="mt-1 truncate px-1 font-roboto text-xs text-on-surface-variant">
              {live
                ? role === 'host'
                  ? `${adminName} is running this stream — join as a co-host.`
                  : `Started by you · session ${status.sessionId?.slice(0, 8)} · ${status.hostMode === 'multi' ? `multi host (max ${status.maxHosts})` : 'single host'}`
                : status.stoppedAt
                  ? `Last stream ended${status.stopReason === 'admin-ended' ? ' when the admin camera went off air' : ''}.`
                  : 'One stream for dR Live and dR Garage.'}
            </p> */}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span
              role="status"
              className={cn(
                'inline-flex h-10 max-w-[320px] items-center truncate rounded-full px-3 font-roboto text-xs font-medium',
                !live ? 'border border-outline-variant text-on-surface-variant' : who ? 'bg-success text-white' : 'border border-outline-variant text-on-surface-variant',
              )}
            >
              {!live ? 'Offline' : who ? `On camera: ${who}` : 'Waiting for a camera'}
            </span>
            <span className="inline-flex h-10 items-center gap-1.5 rounded-full border border-dashed border-outline-variant px-3 font-roboto text-xs text-on-surface-variant" title="Real-time status feed">
              <Radio className="h-3.5 w-3.5" />
              <span className={cn('h-1.5 w-1.5 rounded-full', feed === 'connected' || feed === 'polling' ? 'bg-success' : 'bg-outline')} />
              {feed === 'connected' || feed === 'polling' ? 'Synced' : feed === 'disconnected' ? 'Offline' : 'Connecting…'}
            </span>
          </div>
        </header>

        {!agoraConfigured && (
          <p role="alert" className="rounded-xl bg-dr-live/10 px-4 py-3 font-roboto text-sm text-dr-live">
            Agora is not configured on this server (NEXT_PUBLIC_AGORA_APP_ID / AGORA_APP_CERTIFICATE). Start is disabled.
          </p>
        )}

        <StreamStage
          host={host}
          chat={chat}
          totals={status.reactions}
          live={live}
          elapsed={elapsed}
          hostMode={hostMode}
          maxHosts={maxHosts}
          setupLocked={busy !== null || (live && role !== 'admin')}
          onHostMode={(mode) => (live ? void update({ hostMode: mode }) : setDraftMode(mode))}
          onMaxHosts={(value) => (live ? void update({ maxHosts: value }) : setDraftMax(value))}
          primary={primary}
          secondary={secondary}
          notice={role === 'host' ? coHostBlock : !onAir && live && full ? `All ${status.maxHosts} camera slots are taken.` : null}
          idleTitle={idle.title}
          idleText={idle.text}
        />
      </div>

      {/* ── Chat ── */}
      <aside className="flex h-[520px] w-full shrink-0 flex-col overflow-hidden rounded-2xl border border-outline-variant bg-background shadow-sm lg:h-full lg:w-[360px]">
        <div className="flex items-center justify-between gap-2 border-b border-outline-variant px-4 py-3">
          <h2 className="flex items-center gap-2 font-manrope text-sm font-semibold text-foreground">
            <MessageCircle className="h-4 w-4" /> Live chat
          </h2>
          <span className="font-roboto text-xs text-on-surface-variant">
            {live ? `${chat.messages.length} message${chat.messages.length === 1 ? '' : 's'}` : 'Opens when you start'}
          </span>
        </div>
        {live ? (
          <ChatPanel chat={chat} tone="light" moderation displayName={me.name} emptyHint="No messages yet. Viewers' messages appear here." className="min-h-0 flex-1" />
        ) : (
          <p className="flex flex-1 items-center justify-center px-6 text-center font-roboto text-sm text-on-surface-variant">
            Chat opens when the stream starts. Hover a message to delete it or mute its author.
          </p>
        )}
      </aside>

      <ConfirmDialog
        open={confirmEnd}
        title="End the stream?"
        confirmLabel="End stream"
        destructive
        busy={busy === 'stop'}
        onConfirm={() => void endStream()}
        onClose={() => setConfirmEnd(false)}
      >
        <p>Every viewer&apos;s player closes immediately and every camera goes off air. Chat history is kept with the session.</p>
        {status.title && <p className="font-medium text-foreground">{status.title}</p>}
      </ConfirmDialog>
    </div>
  )
}
