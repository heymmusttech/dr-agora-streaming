'use client'

/**
 * The broadcast (camera) panel: preview, Go live / End, flip camera, mic / camera toggles,
 * telemetry. Publishes to the stream channel. Lives in `/host` for the admin and for
 * co-hosts alike.
 */
import { useEffect, useRef, useState } from 'react'
import { ArrowRightLeft, Camera, CameraOff, Info, Loader2, Mic, MicOff, MonitorSmartphone, Radio, SwitchCamera, Video } from 'lucide-react'
import { toast } from 'sonner'
import { useHostBroadcast } from '@/hooks/useHostBroadcast'
import { useAppLiveStream } from '@/hooks/useLiveStreams'
import {
  canSignalOtherTabs,
  requestFocusOwner,
  requestYieldOwner,
  type CameraClaim,
} from '@/lib/stream/camera-lock'
import { beginCameraHandover } from '@/lib/stream/host-api'
import type { HostRole } from '@/lib/stream/types'
import { cn } from '@/lib/utils'
import { LiveBadge } from './LiveBadge'

export const formatElapsed = (seconds: number) =>
  `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`

export type Broadcast = ReturnType<typeof useHostBroadcast>

/**
 * Owns the Agora host session; mount it once per page. When the stream stops (or the admin's
 * camera goes off air, which stops it) this camera ends its broadcast too; a co-host's camera also
 * ends when the mode switches to single host.
 */
export function useBroadcast(role: HostRole = 'host'): Broadcast {
  const host = useHostBroadcast(role, (message) => toast.error('Your camera went off air', { description: message }))
  const status = useAppLiveStream()
  const isLive = status?.isLive
  const wasLive = useRef(isLive)
  const onAir = host.status === 'live'
  const endLive = host.endLive
  useEffect(() => {
    const stopped = wasLive.current === true && isLive === false
    wasLive.current = isLive
    if (stopped && onAir) void endLive()
  }, [isLive, onAir, endLive])
  const singleMode = status?.hostMode === 'single'
  useEffect(() => {
    if (role === 'host' && singleMode && onAir) {
      void endLive()
      toast.info('Switched to single host', { description: 'Only the host who started the stream stays on camera.' })
    }
  }, [role, singleMode, onAir, endLive])
  return host
}

export function BroadcastPanel({
  host,
  compact = false,
  blockedReason,
  endLabel = 'End broadcast',
  onEnd,
}: {
  host: Broadcast
  compact?: boolean
  /** When set (and not on air) Go live is disabled and this explains why. */
  blockedReason?: string | null
  endLabel?: string
  /** Replaces the default End broadcast action (e.g. to confirm first). */
  onEnd?: () => void
}) {
  const live = host.status === 'live'
  const busy = host.status === 'connecting'
  const hasCamera = host.status !== 'idle' && host.status !== 'error'
  const blocked = !live && Boolean(blockedReason)

  // One camera per browser: another tab is already on air, so this one offers to switch or take over.
  if (host.blockedByTab) return <OtherTabNotice claim={host.blockedByTab} />

  return (
    <section className="space-y-3">
        <div
          className={cn(
            'relative mx-auto w-full overflow-hidden rounded-2xl bg-black',
            host.orientation === 'portrait'
              ? compact
                ? 'aspect-[9/16] max-h-[420px] max-w-[260px]'
                : 'aspect-[9/16] max-h-[calc(100dvh-180px)] max-w-[480px]'
              : 'aspect-video',
            live && 'ring-2 ring-dr-live-container ring-offset-2 ring-offset-background',
          )}
        >
          <div ref={host.videoRef} className={cn('absolute inset-0', host.cameraOff && 'invisible')} />

          {!hasCamera && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center text-white">
              <Video className="h-10 w-10 opacity-70" />
              <p className="max-w-sm font-roboto text-sm opacity-80">
                {host.error ?? 'Allow camera and microphone to preview your broadcast before going live.'}
              </p>
              <button
                type="button"
                onClick={() => void host.preview()}
                className="rounded-full bg-white px-5 py-2.5 text-sm font-semibold text-black"
              >
                Enable camera
              </button>
            </div>
          )}
          {host.cameraOff && hasCamera && (
            <div className="absolute inset-0 flex items-center justify-center text-white/80">
              <CameraOff className="h-10 w-10" />
            </div>
          )}

          {/* Status + telemetry */}
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 bg-gradient-to-b from-black/60 to-transparent p-3">
            {live ? (
              <span className="flex items-center gap-2">
                <LiveBadge />
                <span className="rounded bg-black/50 px-2 py-1 font-mono text-xs text-white">{formatElapsed(host.elapsed)}</span>
              </span>
            ) : (
              <span className="rounded bg-black/50 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-white">
                {busy ? 'Connecting…' : hasCamera ? 'Preview · not live' : 'Offline'}
              </span>
            )}
            {host.stats && (
              <span className="rounded-full bg-black/50 px-2.5 py-1 font-mono text-[10px] text-white/90">
                {host.stats.resolution} · {host.stats.fps} fps · {host.stats.bitrate} kbps · {host.stats.rtt} ms
              </span>
            )}
          </div>

          {/* Mic level meter */}
          {hasCamera && (
            <div className="absolute bottom-24 left-3 flex h-24 w-2 flex-col-reverse overflow-hidden rounded-full bg-white/20" aria-label="Microphone level">
              <div
                className={cn('w-full rounded-full transition-[height] duration-100', host.micLevel > 0.8 ? 'bg-dr-live-container' : 'bg-success')}
                style={{ height: `${Math.min(100, Math.round(host.micLevel * 100))}%` }}
              />
            </div>
          )}

          {/* Controls */}
          {hasCamera && (
            <div className="pb-safe absolute inset-x-0 bottom-0 flex items-center justify-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-3 pt-8">
              <ControlButton label={host.micMuted ? 'Unmute microphone' : 'Mute microphone'} active={host.micMuted} onClick={() => void host.toggleMic()}>
                {host.micMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </ControlButton>
              <ControlButton label={host.cameraOff ? 'Turn camera on' : 'Turn camera off'} active={host.cameraOff} onClick={() => void host.toggleCamera()}>
                {host.cameraOff ? <CameraOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
              </ControlButton>
              <ControlButton label="Flip camera" onClick={() => void host.flipCamera()}>
                <SwitchCamera className="h-5 w-5" />
              </ControlButton>
              <button
                type="button"
                disabled={busy || blocked}
                title={blocked ? blockedReason ?? undefined : undefined}
                onClick={() => {
                  if (!live) void host.goLive()
                  else if (onEnd) onEnd()
                  else void host.endLive()
                }}
                className={cn(
                  'ml-2 inline-flex h-10 min-w-36 items-center justify-center gap-2 rounded-full px-6 text-sm font-bold uppercase tracking-wide text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                  live ? 'bg-white/20 hover:bg-white/30' : 'bg-dr-live-container enabled:hover:bg-dr-live-container-hover',
                )}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Radio className="h-4 w-4" />}
                {live ? endLabel : busy ? 'Going live…' : 'Go live'}
              </button>
            </div>
          )}
        </div>
        {blocked && hasCamera && (
          <p role="status" className="flex items-start gap-2 rounded-xl bg-support-orange/15 px-3 py-2 font-roboto text-xs text-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {blockedReason}
          </p>
        )}
        {host.error && hasCamera && (
          <p role="alert" className="rounded-xl bg-dr-live/10 px-4 py-3 text-sm text-dr-live">
            {host.error}
          </p>
        )}
      </section>
  )
}

export function ControlButton({
  label,
  active = false,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-full text-white backdrop-blur transition-colors',
        active ? 'bg-dr-live-container' : 'bg-white/20 hover:bg-white/30',
      )}
    >
      {children}
    </button>
  )
}


/**
 * Shown in place of the camera when another tab of this browser is broadcasting.
 *
 * **Switch** flags the other tab so it can be found in the tab strip (a background tab cannot raise
 * itself; see `flagThisTab`). **Take over** ends the camera there so this tab can go live — offered
 * only for a co-host. The admin's camera is the stream: handing it over would leave the
 * broadcast dark until someone pressed Enable camera and Go live again, so that tab is switch-only.
 */
export function OtherTabNotice({ claim }: { claim: CameraClaim }) {
  const [now, setNow] = useState(() => Date.now())
  const [taking, setTaking] = useState(false)
  const [flagged, setFlagged] = useState(false)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.floor((now - claim.since) / 1_000))
  const canSignal = canSignalOtherTabs()
  // The admin camera carries the stream; moving it would interrupt the broadcast.
  const canTakeOver = claim.role !== 'admin'

  return (
    <section className="flex aspect-video flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-outline-variant bg-surface-1 px-6 text-center">
      <MonitorSmartphone className="h-7 w-7 text-on-surface-variant" aria-hidden />
      <div>
        <p role="status" className="font-manrope text-sm font-semibold text-foreground">
          You are already live in another tab
        </p>
        <p className="mt-1 font-roboto text-xs text-on-surface-variant">
          On camera for {formatElapsed(seconds)}. One camera per browser, so this tab cannot go live too.
        </p>
        {canSignal && !canTakeOver && (
          <p className="mt-1 font-roboto text-[11px] text-on-surface-variant">
            That tab is running the broadcast — switch to it rather than moving the camera.
          </p>
        )}
      </div>
      {canSignal ? (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={() => {
              requestFocusOwner()
              setFlagged(true)
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-dr-live-container px-4 py-2 font-manrope text-xs font-semibold text-white transition-colors hover:bg-dr-live-container-hover"
          >
            <ArrowRightLeft className="h-3.5 w-3.5" /> Switch to that tab
          </button>
          {canTakeOver && (
            <button
              type="button"
              disabled={taking}
              onClick={() => {
                setTaking(true)
                // Hold the stream open while the camera moves here, then ask the other tab to stop.
                beginCameraHandover()
                requestYieldOwner()
                // The other tab ends and releases; this one unblocks when the claim clears.
                setTimeout(() => setTaking(false), 4_000)
              }}
              className="inline-flex items-center gap-1.5 rounded-full border border-outline-variant px-4 py-2 font-manrope text-xs font-semibold text-foreground transition-colors hover:border-dr-live-container hover:text-dr-live disabled:opacity-60"
            >
              {taking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Video className="h-3.5 w-3.5" />}
              {taking ? 'Taking over…' : 'Take over here'}
            </button>
          )}
        </div>
      ) : (
        <p className="font-roboto text-[11px] text-on-surface-variant">
          Close the other tab (or end the broadcast there) to use the camera here.
        </p>
      )}
      {flagged && (
        <p role="status" className="font-roboto text-[11px] text-on-surface-variant">
          Look for the tab blinking <span className="font-medium text-foreground">👉 Your camera is here</span> in the tab strip.
        </p>
      )}
    </section>
  )
}
