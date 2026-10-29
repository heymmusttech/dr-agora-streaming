'use client'

/**
 * Viewer player (implementation.md §3 `ViewerEmbedView.tsx`): the remote video, a LIVE pill,
 * telemetry, a tap-to-unmute overlay (autoplay starts muted, §8.5), volume, fullscreen, and a
 * 9:16 frame when the host broadcasts from an upright phone (§8.1).
 *
 * Every host on air gets a tile: one host fills the frame (as before), two sit side by side
 * (stacked on phones), three or more form a grid. Tiles are keyed by host, so hosts joining or
 * leaving never re-mount the others' video.
 */
import { useRef } from 'react'
import { Loader2, Maximize, RefreshCw, Volume2, VolumeX, WifiOff } from 'lucide-react'
import type { useViewerStream } from '@/hooks/useViewerStream'
import { cn } from '@/lib/utils'
import { LiveBadge } from './LiveBadge'

type Stream = ReturnType<typeof useViewerStream>

/** Grid for N tiles (absolute frame, so rows are explicit and fill the height). */
function gridFor(count: number): string {
  if (count <= 1) return 'grid-cols-1 grid-rows-1'
  if (count === 2) return 'grid-cols-1 grid-rows-2 sm:grid-cols-2 sm:grid-rows-1'
  if (count <= 4) return 'grid-cols-2 grid-rows-2'
  if (count <= 6) return 'grid-cols-3 grid-rows-2'
  return 'grid-cols-3 grid-rows-3'
}

export function LiveStreamPlayer({
  stream,
  title,
  className,
  fill = false,
  minimal = false,
  topBar = true,
}: {
  stream: Stream
  title?: string
  className?: string
  /** Fill the parent (embed) instead of the page's 16:10 frame. */
  fill?: boolean
  /**
   * Inside the plugin dock: its bar already shows LIVE, the title and the size controls, so the
   * player drops its own LIVE badge, title, channel name and fullscreen button (no duplicates).
   */
  minimal?: boolean
  /** False when the page draws its own top bar over the player (the viewer page). */
  topBar?: boolean
}) {
  const frameRef = useRef<HTMLDivElement>(null)
  const { status, muted, volume, orientation, stats, participants } = stream
  const showVideo = status === 'live' || status === 'reconnecting'
  const multi = participants.length > 1
  const portrait = orientation === 'portrait' && !multi

  const enterFullscreen = () => {
    const frame = frameRef.current
    if (!frame) return
    if (frame.requestFullscreen) {
      void frame.requestFullscreen().catch(() => undefined)
      return
    }
    // iPhone Safari only fullscreens <video> elements.
    const video = frame.querySelector('video') as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null
    video?.webkitEnterFullscreen?.()
  }

  return (
    <div
      ref={frameRef}
      className={cn(
        'relative w-full overflow-hidden bg-black',
        fill ? 'h-full' : 'rounded-2xl',
        !fill &&
          (multi
            ? 'aspect-[4/5] sm:aspect-[16/10]'
            : portrait && showVideo
              ? 'mx-auto aspect-[9/16] max-h-[78vh] max-w-[440px]'
              : 'aspect-[16/10]'),
        className,
      )}
    >
      {/* One tile per host; Agora renders each host's <video> inside its tile. */}
      <div className={cn('absolute inset-0 grid', multi && 'gap-1', gridFor(participants.length), !showVideo && 'invisible')}>
        {participants.map((participant) => (
          <div key={participant.id} className="relative min-h-0 min-w-0 overflow-hidden bg-black">
            <div ref={stream.participantRef(participant.id)} className="absolute inset-0" />
            {multi && (
              // Top-left, below the player's top bar (LIVE · N hosts live), so the two never overlap.
              <span className="absolute left-2 top-12 z-[5] inline-flex max-w-[calc(100%-1rem)] items-center gap-1.5 truncate rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
                {participant.reconnecting ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-dr-live-container" />
                )}
                {participant.label}
                {participant.stats && !participant.reconnecting && !fill && (
                  <span className="hidden truncate font-mono font-normal text-white/80 md:inline">
                    · {participant.stats.resolution} · {participant.stats.fps} fps
                  </span>
                )}
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Top bar: LIVE + title, telemetry */}
      {topBar && (
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 bg-gradient-to-b from-black/60 to-transparent p-3">
        <div className="flex min-w-0 items-center gap-2">
          {showVideo && !minimal && <LiveBadge />}
          {/* With several tiles the title would sit on top of them; the dock / page already shows it. */}
          {title && !multi && !minimal && <span className="truncate font-manrope text-sm font-semibold text-white drop-shadow">{title}</span>}
        </div>
        {showVideo && multi && (
          <span className="shrink-0 rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-white/90 backdrop-blur">
            {participants.length} hosts live
          </span>
        )}
        {showVideo && !multi && stats && (
          <span className="hidden shrink-0 rounded-full bg-black/50 px-2.5 py-1 font-mono text-[10px] text-white/90 backdrop-blur sm:inline">
            {stats.resolution} · {stats.fps} fps · {stats.bitrate} kbps · {stats.rtt} ms
          </span>
        )}
      </div>
      )}

      {/* States */}
      {!showVideo && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white">
          {status === 'connecting' ? (
            <>
              <Loader2 className="h-8 w-8 animate-spin" />
              <p className="font-roboto text-sm">Joining the broadcast…</p>
            </>
          ) : status === 'error' ? (
            <>
              <WifiOff className="h-8 w-8" />
              <p className="font-roboto text-sm">{stream.error ?? 'The broadcast could not be joined.'}</p>
              <button
                type="button"
                onClick={stream.retry}
                className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-semibold text-black"
              >
                <RefreshCw className="h-4 w-4" /> Retry
              </button>
            </>
          ) : (
            <>
              <WifiOff className="h-8 w-8 opacity-70" />
              <p className="font-roboto text-sm opacity-80">Waiting for the host to go live…</p>
            </>
          )}
        </div>
      )}
      {status === 'reconnecting' && (
        <div className="absolute inset-x-0 bottom-16 z-10 flex justify-center">
          <span className="inline-flex items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white backdrop-blur">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Reconnecting…
          </span>
        </div>
      )}

      {/* Tap to unmute */}
      {showVideo && muted && (
        <button
          type="button"
          onClick={() => stream.setMuted(false)}
          className="absolute left-1/2 top-1/2 z-10 inline-flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-black/60 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur transition hover:bg-black/75"
        >
          <VolumeX className="h-4 w-4" /> Tap to unmute
        </button>
      )}

      {/* Control bar */}
      {showVideo && (
        <div className="pb-safe absolute inset-x-0 bottom-0 z-10 flex items-center gap-3 bg-gradient-to-t from-black/70 to-transparent px-3 pt-6 text-white">
          <button
            type="button"
            onClick={() => stream.setMuted(!muted)}
            aria-label={muted ? 'Unmute' : 'Mute'}
            className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/15"
          >
            {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
          </button>
          <input
            type="range"
            min={0}
            max={100}
            value={muted ? 0 : volume}
            onChange={(event) => stream.setVolume(Number(event.target.value))}
            aria-label="Volume"
            className="h-1 w-24 cursor-pointer accent-dr-live-container"
          />
          {!minimal && (
            <>
              <span className="ml-auto font-mono text-[10px] text-white/70">{stream.channel}</span>
              <button
                type="button"
                onClick={enterFullscreen}
                aria-label="Fullscreen"
                className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-white/15"
              >
                <Maximize className="h-5 w-5" />
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
