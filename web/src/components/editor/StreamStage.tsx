'use client'

/**
 * The host's stage (like auction-stream's `/host`): one view that is both "your camera" and "what
 * viewers see" — your camera plus every co-host on air, side by side as Agora splits them, with
 * the LIVE timer, viewers, reaction totals and floating reactions on top.
 *
 * The bottom bar holds the setup (host mode, cameras) and **one** primary action. Nobody goes on
 * air untested: the first press is Preview camera, which opens the device check (camera and mic
 * pickers, mic level with a "Mic OK" check, Hear myself). Then Start stream starts the stream and
 * goes live in one step.
 *
 * Reactions and the viewer chip are the same components the viewer's player uses, so the host
 * sees exactly the numbers and look viewers see.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Camera, CameraOff, Check, Headphones, Info, Loader2, Mic, MicOff, Play, Radio, Settings2, Square, SwitchCamera, Video, VideoOff, X } from 'lucide-react'
import { FloatingReactions } from '@/components/live/FloatingReactions'
import { ReactionBar, ViewerCount } from '@/components/live/ReactionBar'
import { ControlButton, OtherTabNotice, type Broadcast } from '@/components/stream/BroadcastPanel'
import { LiveBadge } from '@/components/stream/LiveBadge'
import type { LiveChat } from '@/hooks/useLiveChat'
import { useOptimisticReactions } from '@/hooks/useOptimisticReactions'
import type { MediaDeviceOption } from '@/lib/stream/agora'
import { MAX_HOSTS_LIMIT, type LiveStreamHostMode, type ReactionTotals } from '@/lib/stream/types'
import { cn } from '@/lib/utils'

/** Grid for N tiles (absolute frame, so rows are explicit and fill the height). */
function gridFor(count: number): string {
  if (count <= 1) return 'grid-cols-1 grid-rows-1'
  if (count === 2) return 'grid-cols-1 grid-rows-2 md:grid-cols-2 md:grid-rows-1'
  return 'grid-cols-2 grid-rows-2'
}

const SELECT =
  'h-10 appearance-none rounded-full border border-white/20 bg-black/40 pl-4 pr-9 font-roboto text-sm text-white backdrop-blur transition-colors focus:border-white/60 focus:outline-none disabled:opacity-50 [&>option]:text-black'

export interface StageAction {
  label: string
  icon: 'start' | 'live' | 'stop' | 'leave' | 'camera'
  onClick: () => void
  busy?: boolean
  disabled?: boolean
  tone?: 'primary' | 'danger' | 'quiet'
}

export function StreamStage({
  host,
  chat,
  totals,
  live,
  elapsed,
  hostMode,
  maxHosts,
  onHostMode,
  onMaxHosts,
  setupLocked,
  primary,
  secondary,
  notice,
  idleTitle,
  idleText,
}: {
  host: Broadcast
  chat: LiveChat
  /** Reaction totals counted by the server (the status), the same numbers viewers see. */
  totals: ReactionTotals
  /** The stream is started (not necessarily this camera). */
  live: boolean
  elapsed: string
  hostMode: LiveStreamHostMode
  maxHosts: number
  onHostMode: (mode: LiveStreamHostMode) => void
  onMaxHosts: (value: number) => void
  setupLocked: boolean
  primary: StageAction
  secondary?: StageAction | null
  /** Why the primary action is unavailable (e.g. slots taken). */
  notice?: string | null
  idleTitle: string
  idleText: string
}) {
  const onAir = host.status === 'live'
  const connecting = host.status === 'connecting'
  const hasCamera = host.status === 'previewing' || onAir || connecting
  const tiles = (hasCamera ? 1 : 0) + host.remotes.length
  // The device check is open while testing (camera on, not on air); on air it opens from the gear.
  const [devicesOpen, setDevicesOpen] = useState(false)
  const showDevices = hasCamera && (!onAir || devicesOpen)
  // A click shows at once; the server's real total takes over when it arrives.
  const reactions = useOptimisticReactions(totals)

  return (
    <section
      aria-label="Stage"
      className={cn(
        'relative min-h-[420px] flex-1 overflow-hidden rounded-2xl bg-black',
        onAir && 'ring-2 ring-dr-live-container ring-offset-2 ring-offset-background',
      )}
    >
      {/* Cameras: yours first, then the co-hosts — the same split viewers see. */}
      <div className={cn('absolute inset-0 grid', tiles > 1 && 'gap-1', gridFor(tiles), tiles === 0 && 'invisible')}>
        <div className={cn('relative min-h-0 min-w-0 overflow-hidden bg-black', !hasCamera && 'hidden')}>
          <div ref={host.videoRef} className={cn('absolute inset-0', host.cameraOff && 'invisible')} />
          {host.cameraOff && (
            <div className="absolute inset-0 flex items-center justify-center text-white/80">
              <CameraOff className="h-10 w-10" />
            </div>
          )}
          {tiles > 1 && <TileLabel>You</TileLabel>}
        </div>
        {host.remotes.map((remote) => (
          <div key={remote.id} className="relative min-h-0 min-w-0 overflow-hidden bg-black">
            <div ref={host.remoteRef(remote.id)} className="absolute inset-0" />
            <TileLabel>{remote.label}</TileLabel>
          </div>
        ))}
      </div>

      {/* Nothing on camera yet */}
      {tiles === 0 && !host.blockedByTab && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 pb-24 text-center text-white">
          <span className="flex h-16 w-16 items-center justify-center rounded-3xl border border-white/10 bg-white/5">
            {host.status === 'error' ? <VideoOff className="h-8 w-8 text-dr-live" /> : <Radio className="h-8 w-8 text-dr-live" />}
          </span>
          <p className="font-manrope text-xl font-semibold">{host.status === 'error' ? 'Camera unavailable' : idleTitle}</p>
          <p className="max-w-md font-roboto text-sm text-white/70">{host.error ?? idleText}</p>
        </div>
      )}

      {host.blockedByTab && (
        <div className="absolute inset-0 flex items-center justify-center bg-background/95 p-6 pb-24">
          <div className="w-full max-w-lg">
            <OtherTabNotice claim={host.blockedByTab} />
          </div>
        </div>
      )}

      {/* Top: LIVE · timer, viewers, reactions, telemetry */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-start justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-3">
        <div className="flex items-center gap-2">
          {live ? (
            <>
              <LiveBadge className="h-10 rounded-full px-3" />
              <span className="inline-flex h-10 items-center rounded-full bg-black/55 px-3 font-mono text-xs tabular-nums text-white ring-1 ring-white/15 backdrop-blur">{elapsed}</span>
            </>
          ) : (
            <span className="inline-flex h-10 items-center rounded-full bg-black/50 px-3 text-[11px] font-bold uppercase tracking-wider text-white backdrop-blur">
              {connecting ? 'Connecting…' : hasCamera ? 'Preview · not live' : 'Offline'}
            </span>
          )}
          {onAir && host.stats && (
            <span className="hidden h-10 items-center rounded-full bg-black/50 px-3 font-mono text-[11px] text-white/90 backdrop-blur md:inline-flex">
              {host.stats.resolution} · {host.stats.fps} fps · {host.stats.bitrate} kbps · {host.stats.rtt} ms
            </span>
          )}
        </div>
        {live && (
          <div role="group" aria-label="Live stats" className="pointer-events-auto flex items-center gap-1.5">
            {/* Same reaction bar and viewer chip as the viewer's player (`EmbedPlayer`). */}
            <ReactionBar
              totals={reactions.totals}
              canReact={Boolean(chat.me?.canPost)}
              onReact={(kind) => {
                if (chat.react(kind)) reactions.bump(kind)
              }}
            />
            {/* Last measured value; "—" only before the first measurement (never a made-up 0). */}
            <ViewerCount count={chat.viewersKnown ? chat.viewers : null} testId="viewer-count" />
          </div>
        )}
      </div>

      <FloatingReactions particles={chat.particles} className="bottom-28" />

      {/* Mic level (the device check shows its own while open) */}
      {hasCamera && !showDevices && (
        <div className="absolute bottom-32 left-4 z-10 flex h-24 w-2 flex-col-reverse overflow-hidden rounded-full bg-white/20" aria-label="Microphone level">
          <div
            className={cn('w-full rounded-full transition-[height] duration-100', host.micLevel > 0.8 ? 'bg-dr-live-container' : 'bg-success')}
            style={{ height: `${Math.min(100, Math.round(host.micLevel * 100))}%` }}
          />
        </div>
      )}

      {/* Bottom bar: device check · setup · camera controls · primary action */}
      <div className="absolute inset-x-3 bottom-3 z-20 space-y-2">
        {showDevices && <DeviceCheck host={host} onAir={onAir} onClose={() => setDevicesOpen(false)} />}
        {(notice || (host.error && hasCamera)) && (
          <p role="status" className="mx-auto flex w-fit max-w-full items-start gap-2 rounded-xl bg-black/70 px-3 py-2 font-roboto text-xs text-white backdrop-blur">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {host.error && hasCamera ? host.error : notice}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/60 p-2 backdrop-blur-md">
          <label className="relative">
            <span className="sr-only">Hosts</span>
            <select aria-label="Hosts" value={hostMode} disabled={setupLocked} onChange={(event) => onHostMode(event.target.value as LiveStreamHostMode)} className={SELECT}>
              <option value="single">Single host</option>
              <option value="multi">Multi host</option>
            </select>
            <Caret />
          </label>
          <label className="relative">
            <span className="sr-only">Cameras on air (max)</span>
            <select
              aria-label="Cameras on air (max)"
              value={hostMode === 'single' ? 1 : maxHosts}
              disabled={setupLocked || hostMode === 'single'}
              onChange={(event) => onMaxHosts(Number(event.target.value))}
              className={SELECT}
            >
              {hostMode === 'single' && <option value={1}>1 camera</option>}
              {Array.from({ length: MAX_HOSTS_LIMIT - 1 }, (_, index) => index + 2).map((n) => (
                <option key={n} value={n}>
                  {n} cameras
                </option>
              ))}
            </select>
            <Caret />
          </label>

          {hasCamera && (
            <div className="flex items-center gap-1.5 md:ml-2">
              <ControlButton label={host.micMuted ? 'Unmute microphone' : 'Mute microphone'} active={host.micMuted} onClick={() => void host.toggleMic()}>
                {host.micMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </ControlButton>
              <ControlButton label={host.cameraOff ? 'Turn camera on' : 'Turn camera off'} active={host.cameraOff} onClick={() => void host.toggleCamera()}>
                {host.cameraOff ? <CameraOff className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
              </ControlButton>
              <ControlButton label="Flip camera" onClick={() => void host.flipCamera()}>
                <SwitchCamera className="h-5 w-5" />
              </ControlButton>
              {onAir && (
                <ControlButton label={devicesOpen ? 'Hide camera & mic settings' : 'Camera & mic settings'} active={devicesOpen} onClick={() => setDevicesOpen((open) => !open)}>
                  <Settings2 className="h-5 w-5" />
                </ControlButton>
              )}
            </div>
          )}

          <div className="ml-auto flex items-center gap-2">
            {secondary && <ActionButton action={secondary} />}
            <ActionButton action={primary} />
          </div>
        </div>
      </div>
    </section>
  )
}

function Caret() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/70" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

function TileLabel({ children }: { children: ReactNode }) {
  return (
    <span className="absolute left-3 top-16 z-[5] inline-flex max-w-[calc(100%-1rem)] items-center gap-1.5 truncate rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
      <span className="h-1.5 w-1.5 rounded-full bg-dr-live-container" />
      {children}
    </span>
  )
}

const ICONS = { start: Play, live: Video, stop: Square, leave: VideoOff, camera: Camera }

function ActionButton({ action }: { action: StageAction }) {
  const Icon = ICONS[action.icon]
  const tone = action.tone ?? 'primary'
  return (
    <button
      type="button"
      disabled={action.disabled || action.busy}
      onClick={action.onClick}
      className={cn(
        'inline-flex h-10 min-w-32 items-center justify-center gap-2 rounded-full px-5 font-manrope text-sm font-bold uppercase tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'primary' && 'bg-dr-live-container text-white enabled:hover:bg-dr-live-container-hover',
        tone === 'danger' && 'border border-white/30 bg-white/15 text-white enabled:hover:bg-white/25',
        tone === 'quiet' && 'border border-white/20 text-white/85 enabled:hover:bg-white/10',
      )}
    >
      {action.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className={cn('h-4 w-4', action.icon === 'start' && 'fill-current')} />}
      {action.label}
    </button>
  )
}

const DEVICE_SELECT =
  'h-10 w-full min-w-0 appearance-none rounded-full border border-white/20 bg-black/40 pl-3 pr-8 font-roboto text-xs text-white focus:border-white/60 focus:outline-none [&>option]:text-black'

/**
 * Check before going live: pick the camera and microphone, watch the mic level (the "Mic OK" tick
 * appears once it picks up sound), and optionally hear yourself. Device labels need the camera
 * permission, which the preview just asked for; plugging a device in refreshes the lists.
 */
function DeviceCheck({ host, onAir, onClose }: { host: Broadcast; onAir: boolean; onClose: () => void }) {
  const [devices, setDevices] = useState<{ cameras: MediaDeviceOption[]; mics: MediaDeviceOption[] }>({ cameras: [], mics: [] })
  const listDevices = host.listDevices
  useEffect(() => {
    let alive = true
    const load = () => void listDevices().then((list) => alive && setDevices(list))
    load()
    navigator.mediaDevices?.addEventListener?.('devicechange', load)
    return () => {
      alive = false
      navigator.mediaDevices?.removeEventListener?.('devicechange', load)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const level = Math.min(100, Math.round(host.micLevel * 100))

  return (
    <section aria-label="Camera and microphone check" className="mx-auto w-full max-w-2xl rounded-2xl border border-white/10 bg-black/70 p-3 text-white backdrop-blur-md">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="font-manrope text-sm font-semibold">{onAir ? 'Camera & mic' : 'Check your camera and mic'}</p>
        {onAir ? (
          <button type="button" onClick={onClose} aria-label="Close camera and mic settings" className="flex h-10 w-10 items-center justify-center rounded-full text-white/80 hover:bg-white/15">
            <X className="h-4 w-4" />
          </button>
        ) : (
          <button type="button" onClick={() => void host.stopPreview()} className="font-roboto text-[11px] text-white/70 underline hover:text-white">
            Turn off preview
          </button>
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="relative block">
          <span className="mb-1 flex items-center gap-1 font-roboto text-[11px] text-white/70">
            <Camera className="h-3 w-3" /> Camera
          </span>
          <select aria-label="Camera" value={host.cameraId ?? ''} onChange={(event) => void host.setCamera(event.target.value)} className={DEVICE_SELECT}>
            {devices.cameras.length === 0 && <option value={host.cameraId ?? ''}>Default camera</option>}
            {devices.cameras.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
        <label className="relative block">
          <span className="mb-1 flex items-center gap-1 font-roboto text-[11px] text-white/70">
            <Mic className="h-3 w-3" /> Microphone
          </span>
          <select aria-label="Microphone" value={host.micId ?? ''} onChange={(event) => void host.setMicrophone(event.target.value)} className={DEVICE_SELECT}>
            {devices.mics.length === 0 && <option value={host.micId ?? ''}>Default microphone</option>}
            {devices.mics.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <div className="flex min-w-40 flex-1 items-center gap-2">
          <span className="h-2 flex-1 overflow-hidden rounded-full bg-white/15" role="meter" aria-label="Microphone level" aria-valuenow={level} aria-valuemin={0} aria-valuemax={100}>
            <span className={cn('block h-full rounded-full transition-[width] duration-100', level > 80 ? 'bg-dr-live-container' : 'bg-success')} style={{ width: `${level}%` }} />
          </span>
          <span className={cn('inline-flex shrink-0 items-center gap-1 font-roboto text-[11px]', host.micHeard ? 'text-success' : 'text-white/70')}>
            {host.micMuted ? (
              <>
                <MicOff className="h-3 w-3" /> Mic muted
              </>
            ) : host.micHeard ? (
              <>
                <Check className="h-3 w-3" /> Mic OK
              </>
            ) : (
              'Say something to test the mic…'
            )}
          </span>
        </div>
        {!onAir && (
          <button
            type="button"
            aria-pressed={host.loopback}
            onClick={() => host.setLoopback(!host.loopback)}
            className={cn(
              'inline-flex h-10 items-center gap-1.5 rounded-full border px-4 font-roboto text-xs font-semibold transition-colors',
              host.loopback ? 'border-dr-live-container bg-dr-live-container text-white' : 'border-white/25 text-white/85 hover:bg-white/10',
            )}
            title="Plays your microphone back to you — use headphones"
          >
            <Headphones className="h-3.5 w-3.5" /> {host.loopback ? 'Stop hearing myself' : 'Hear myself'}
          </button>
        )}
      </div>
    </section>
  )
}
