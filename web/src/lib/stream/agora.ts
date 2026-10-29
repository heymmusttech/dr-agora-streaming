/**
 * Agora RTC wrapper (rebuilt from auction-stream's `agoraClient.ts`).
 *
 * - The SDK (~1.6 MB) is imported lazily, so only pages that actually stream download it.
 * - Tokens come from a provider (viewer: `/api/token/viewer`; host: `/api/token/host`, Keycloak)
 *   and are renewed on `token-privilege-will-expire` / `did-expire` without leaving the channel —
 *   for hosts too (auction-stream's host never renewed, so a broadcast dropped after an hour).
 * - Viewer: `live` mode audience at ultra-low latency, subscribes to every host in the channel,
 *   3 s grace per host after an unpublish (§8.3), orientation detection per host (§8.1).
 * - Host: publishes camera + mic, flips camera in place with `setDevice` (§8.2), exposes telemetry.
 *
 * Browser-only module — import it from client components.
 */
import type {
  AudienceLatencyLevelType,
  IAgoraRTC,
  IAgoraRTCClient,
  IAgoraRTCRemoteUser,
  ICameraVideoTrack,
  IMicrophoneAudioTrack,
  IRemoteAudioTrack,
  IRemoteVideoTrack,
} from 'agora-rtc-sdk-ng'
import { LIVE_CHANNEL } from './channel'
import type {
  RtcTokenResponse,
  StreamOrientation,
  StreamStats,
  ViewerStatus,
} from './types'

let sdk: Promise<IAgoraRTC> | null = null

export function loadAgora(): Promise<IAgoraRTC> {
  sdk ??= import('agora-rtc-sdk-ng').then(({ default: AgoraRTC }) => {
    AgoraRTC.setLogLevel(3) // warnings + errors
    return AgoraRTC
  })
  return sdk
}

export type RtcTokenProvider = () => Promise<RtcTokenResponse>

/** Viewer default: a subscriber token (uid 0) from `/api/token/viewer`. */
export const fetchViewerRtcToken: RtcTokenProvider = async () => {
  const response = await fetch('/api/token/viewer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rtcOnly: true }),
    cache: 'no-store',
  })
  const body = (await response.json().catch(() => null)) as { rtc?: RtcTokenResponse; error?: string } | null
  if (!response.ok || !body?.rtc) throw new Error(body?.error ?? `Token request failed (${response.status})`)
  return body.rtc
}

/** Keeps the client's token fresh for as long as it is in the channel. */
function wireTokenRenewal(client: IAgoraRTCClient, channel: string, getToken: RtcTokenProvider) {
  const renew = async (reason: string) => {
    try {
      const { token, expiresAt } = await getToken()
      await client.renewToken(token)
      console.info(`[agora] ${channel} token renewed (${reason}), expires ${new Date(expiresAt).toISOString()}`)
    } catch (error) {
      console.error(`[agora] ${channel} token renewal failed`, error)
    }
  }
  client.on('token-privilege-will-expire', () => void renew('will-expire'))
  client.on('token-privilege-did-expire', () => void renew('did-expire'))
}

const orientationOf = (width: number, height: number): StreamOrientation =>
  height > width ? 'portrait' : 'landscape'

/* ───────────────────────────── Viewer ───────────────────────────── */

/** One host on air in the channel, as the viewer sees it. */
export interface StreamParticipant {
  /** Agora uid as a string (stable key for rendering). */
  id: string
  /** "Host 1", "Host 2"… in the order they first published. */
  label: string
  orientation: StreamOrientation
  stats: StreamStats | null
  /** Unpublished / left, inside the 3 s grace period — the tile stays, showing "Reconnecting". */
  reconnecting: boolean
}

export interface ViewerSnapshot {
  status: ViewerStatus
  muted: boolean
  volume: number
  /** Orientation of the first host (the single-host layout and the embed's `aspectRatio`). */
  orientation: StreamOrientation
  /** Stats of the first host. */
  stats: StreamStats | null
  /** Every host with video in the channel, in the order they went live. */
  participants: StreamParticipant[]
  error: string | null
}

const UNPUBLISH_GRACE_MS = 3_000

interface RemoteHost {
  id: string
  label: string
  order: number
  video: IRemoteVideoTrack | null
  audio: IRemoteAudioTrack | null
  orientation: StreamOrientation
  stats: StreamStats | null
  graceTimer: ReturnType<typeof setTimeout> | null
}

/**
 * Audience side of the channel. Subscribes to **every** host that publishes (co-hosts,
 * a second camera…), each with its own 3 s grace period, so one host leaving never hides the others.
 */
export class ViewerSession {
  readonly channel: string
  private client: IAgoraRTCClient | null = null
  private hosts = new Map<string, RemoteHost>()
  private containers = new Map<string, HTMLElement>()
  private nextLabel = 1
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private names = new Map<string, string>()
  private state: ViewerSnapshot = {
    status: 'idle',
    // Autoplay policy: start muted, the viewer taps to unmute (§8.5).
    muted: true,
    volume: 0,
    orientation: 'landscape',
    stats: null,
    participants: [],
    error: null,
  }

  constructor(
    private readonly onChange: (snapshot: ViewerSnapshot) => void,
    private readonly getToken: RtcTokenProvider = fetchViewerRtcToken,
  ) {
    this.channel = LIVE_CHANNEL
  }

  get snapshot(): ViewerSnapshot {
    return this.state
  }

  /** Host names by RTC uid (from the stream status), so tiles read "Jane Doe" instead of "Host 1". */
  setNames(names: Map<string, string>) {
    const changed = names.size !== this.names.size || [...names].some(([uid, name]) => this.names.get(uid) !== name)
    if (!changed) return
    this.names = names
    if (this.hosts.size > 0) this.publish()
  }

  private set(patch: Partial<ViewerSnapshot>) {
    this.state = { ...this.state, ...patch }
    this.onChange(this.state)
  }

  /** Where one host's video renders (one element per tile). `null` detaches it. */
  attachParticipant(id: string, container: HTMLElement | null) {
    if (container) {
      if (this.containers.get(id) === container) return
      this.containers.set(id, container)
      this.hosts.get(id)?.video?.play(container, { fit: 'contain' })
    } else {
      this.containers.delete(id)
    }
  }

  /** Recomputes the public state from the hosts map. */
  private publish(extra: Partial<ViewerSnapshot> = {}) {
    const hosts = [...this.hosts.values()]
      .filter((host) => host.video || host.graceTimer)
      .sort((a, b) => a.order - b.order)
    const participants: StreamParticipant[] = hosts.map((host) => ({
      id: host.id,
      label: this.names.get(host.id) ?? host.label,
      orientation: host.orientation,
      stats: host.stats,
      reconnecting: !host.video || host.graceTimer !== null,
    }))
    const first = participants[0]
    let status = this.state.status
    if (!this.stopped && this.client && status !== 'connecting' && status !== 'error') {
      status = participants.some((p) => !p.reconnecting)
        ? 'live'
        : participants.length > 0
          ? 'reconnecting'
          : 'waiting'
    }
    this.set({
      status,
      participants,
      orientation: first?.orientation ?? this.state.orientation,
      stats: first?.stats ?? null,
      ...extra,
    })
  }

  private hostFor(uid: IAgoraRTCRemoteUser['uid']): RemoteHost {
    const id = String(uid)
    let host = this.hosts.get(id)
    if (!host) {
      host = {
        id,
        label: `Host ${this.nextLabel}`,
        order: this.nextLabel++,
        video: null,
        audio: null,
        orientation: 'landscape',
        stats: null,
        graceTimer: null,
      }
      this.hosts.set(id, host)
    }
    return host
  }

  private clearGrace(host: RemoteHost) {
    if (host.graceTimer) clearTimeout(host.graceTimer)
    host.graceTimer = null
  }

  /** A camera flip or a short drop shouldn't flicker the tile away (§8.3). */
  private startGrace(host: RemoteHost) {
    this.clearGrace(host)
    host.graceTimer = setTimeout(() => {
      host.graceTimer = null
      if (host.video) return // republished in the meantime
      host.audio?.stop()
      this.hosts.delete(host.id)
      this.publish()
    }, UNPUBLISH_GRACE_MS)
  }

  async start() {
    if (this.client) return
    this.stopped = false
    this.set({ status: 'connecting', error: null })
    try {
      const AgoraRTC = await loadAgora()
      const client = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' })
      this.client = client
      await client.setClientRole('audience', {
        level: 2 as AudienceLatencyLevelType, // AUDIENCE_LEVEL_ULTRA_LOW_LATENCY
      })
      wireTokenRenewal(client, this.channel, this.getToken)

      client.on('user-published', async (user, mediaType) => {
        await client.subscribe(user, mediaType)
        const host = this.hostFor(user.uid)
        if (mediaType === 'video' && user.videoTrack) {
          this.clearGrace(host)
          host.video = user.videoTrack
          const container = this.containers.get(host.id)
          if (container) user.videoTrack.play(container, { fit: 'contain' })
          this.startStats()
        }
        if (mediaType === 'audio' && user.audioTrack) {
          host.audio = user.audioTrack
          this.applyAudio()
        }
        this.publish()
      })

      client.on('user-unpublished', (user, mediaType) => {
        const host = this.hosts.get(String(user.uid))
        if (!host) return
        if (mediaType === 'audio') {
          host.audio = null
          return
        }
        host.video = null
        this.startGrace(host)
        this.publish()
      })

      client.on('user-left', (user) => {
        const host = this.hosts.get(String(user.uid))
        if (!host) return
        host.video = null
        host.audio = null
        this.startGrace(host)
        this.publish()
      })

      const { token, appId } = await this.getToken()
      if (this.stopped) return
      await client.join(appId, this.channel, token, null)
      if (this.state.status === 'connecting') this.set({ status: 'waiting' })
      this.publish()
    } catch (error) {
      console.error('[agora] viewer failed to join', error)
      this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      await this.leaveClient()
    }
  }

  /** One mute / volume for the whole broadcast — applied to every host's audio. */
  private applyAudio() {
    this.hosts.forEach((host) => {
      if (!host.audio) return
      if (this.state.muted || this.state.volume === 0) {
        host.audio.stop()
      } else {
        host.audio.setVolume(this.state.volume)
        host.audio.play()
      }
    })
  }

  setMuted(muted: boolean) {
    // Unmuting from volume 0 restores an audible level.
    this.set({ muted, volume: !muted && this.state.volume === 0 ? 100 : this.state.volume })
    this.applyAudio()
  }

  setVolume(volume: number) {
    const clamped = Math.max(0, Math.min(100, Math.round(volume)))
    this.set({ volume: clamped, muted: clamped === 0 })
    this.applyAudio()
  }

  private startStats() {
    if (this.statsTimer) return
    const read = () => {
      const client = this.client
      if (!client) return
      const remote = client.getRemoteVideoStats()
      const rtt = Math.round(client.getRTCStats().RTT ?? 0)
      this.hosts.forEach((host) => {
        const video = host.video ? remote[host.id] : undefined
        if (!video) return
        const width = video.receiveResolutionWidth
        const height = video.receiveResolutionHeight
        if (width && height) host.orientation = orientationOf(width, height)
        host.stats = {
          rtt,
          fps: Math.round(video.renderFrameRate ?? video.receiveFrameRate ?? 0),
          bitrate: Math.round((video.receiveBitrate ?? 0) / 1000),
          resolution: width && height ? `${width}x${height}` : '—',
        }
      })
      if (this.hosts.size > 0) this.publish()
    }
    read()
    this.statsTimer = setInterval(read, 1_000)
  }

  private stopStats() {
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.statsTimer = null
  }

  private async leaveClient() {
    const client = this.client
    this.client = null
    this.hosts.forEach((host) => {
      this.clearGrace(host)
      host.audio?.stop()
    })
    this.hosts.clear()
    if (client) {
      client.removeAllListeners()
      await client.leave().catch(() => undefined)
    }
  }

  async stop() {
    this.stopped = true
    this.stopStats()
    await this.leaveClient()
    this.set({ status: 'idle', stats: null, participants: [] })
  }
}

/* ───────────────────────────── Host ───────────────────────────── */

export type HostStatus = 'idle' | 'previewing' | 'connecting' | 'live' | 'error'

export interface HostSnapshot {
  status: HostStatus
  micMuted: boolean
  cameraOff: boolean
  facing: 'user' | 'environment'
  orientation: StreamOrientation
  micLevel: number
  stats: StreamStats | null
  /** Seconds on air. */
  elapsed: number
  error: string | null
  /** The other cameras on air (co-hosts), as this host sees them while live. */
  remotes: Array<{ id: string; label: string }>
  /** Devices in use (for the pickers); null until the preview opened them. */
  cameraId: string | null
  micId: string | null
  /** The host hears their own microphone (local only, never sent). */
  loopback: boolean
  /** The microphone picked up sound since the preview opened — the "Mic OK" check. */
  micHeard: boolean
}

export interface MediaDeviceOption {
  deviceId: string
  label: string
}

interface RemoteCamera {
  id: string
  video: IRemoteVideoTrack | null
  audio: IRemoteAudioTrack | null
}

export class HostSession {
  readonly channel: string
  private client: IAgoraRTCClient | null = null
  private mic: IMicrophoneAudioTrack | null = null
  private camera: ICameraVideoTrack | null = null
  private container: HTMLElement | null = null
  private meterTimer: ReturnType<typeof setInterval> | null = null
  private statsTimer: ReturnType<typeof setInterval> | null = null
  private liveSince = 0
  private remotes = new Map<string, RemoteCamera>()
  private remoteContainers = new Map<string, HTMLElement>()
  private names = new Map<string, string>()
  private state: HostSnapshot = {
    status: 'idle',
    micMuted: false,
    cameraOff: false,
    facing: 'user',
    orientation: 'landscape',
    micLevel: 0,
    stats: null,
    elapsed: 0,
    error: null,
    remotes: [],
    cameraId: null,
    micId: null,
    loopback: false,
    micHeard: false,
  }

  constructor(
    private readonly onChange: (snapshot: HostSnapshot) => void,
    private readonly getToken: RtcTokenProvider,
  ) {
    this.channel = LIVE_CHANNEL
  }

  get snapshot(): HostSnapshot {
    return this.state
  }

  private set(patch: Partial<HostSnapshot>) {
    this.state = { ...this.state, ...patch }
    this.onChange(this.state)
  }

  attach(container: HTMLElement | null) {
    this.container = container
    if (container && this.camera) this.camera.play(container, { fit: 'cover', mirror: this.state.facing === 'user' })
  }

  /** Where a co-host's camera renders on this host's stage. `null` detaches it. */
  attachRemote(id: string, container: HTMLElement | null) {
    if (!container) {
      this.remoteContainers.delete(id)
      return
    }
    if (this.remoteContainers.get(id) === container) return
    this.remoteContainers.set(id, container)
    this.remotes.get(id)?.video?.play(container, { fit: 'cover' })
  }

  /** Host names by RTC uid (from the stream status) for the co-host tiles. */
  setNames(names: Map<string, string>) {
    this.names = names
    this.publishRemotes()
  }

  private publishRemotes() {
    const remotes = [...this.remotes.values()]
      .filter((remote) => remote.video)
      .map((remote, index) => ({ id: remote.id, label: this.names.get(remote.id) ?? `Unlisted camera ${index + 1}` }))
    const same =
      remotes.length === this.state.remotes.length &&
      remotes.every((remote, index) => remote.id === this.state.remotes[index]?.id && remote.label === this.state.remotes[index]?.label)
    if (!same) this.set({ remotes })
  }

  /** Co-hosts publishing in the same channel: subscribe so the stage shows what viewers see. */
  private wireRemotes(client: IAgoraRTCClient) {
    client.on('user-published', async (user, mediaType) => {
      await client.subscribe(user, mediaType)
      const id = String(user.uid)
      const remote = this.remotes.get(id) ?? { id, video: null, audio: null }
      this.remotes.set(id, remote)
      if (mediaType === 'video' && user.videoTrack) {
        remote.video = user.videoTrack
        const container = this.remoteContainers.get(id)
        if (container) user.videoTrack.play(container, { fit: 'cover' })
      }
      if (mediaType === 'audio' && user.audioTrack) {
        // Hosts hear each other (they are talking together on air).
        remote.audio = user.audioTrack
        user.audioTrack.play()
      }
      this.publishRemotes()
    })
    const drop = (uid: string | number, mediaType?: 'audio' | 'video' | 'datachannel') => {
      const remote = this.remotes.get(String(uid))
      if (!remote) return
      if (mediaType !== 'video') {
        remote.audio?.stop()
        remote.audio = null
      }
      if (mediaType !== 'audio') remote.video = null
      if (!remote.video && !remote.audio) this.remotes.delete(remote.id)
      this.publishRemotes()
    }
    client.on('user-unpublished', (user, mediaType) => drop(user.uid, mediaType))
    client.on('user-left', (user) => drop(user.uid))
  }

  /** Opens camera + mic and shows the local preview (no publishing yet). Resolves true when the camera is open. */
  async preview(): Promise<boolean> {
    if (this.camera) return true
    try {
      const AgoraRTC = await loadAgora()
      const [mic, camera] = await AgoraRTC.createMicrophoneAndCameraTracks(
        { AEC: true, ANS: true },
        { encoderConfig: '720p_2', facingMode: 'user' },
      )
      this.mic = mic
      this.camera = camera
      if (this.container) camera.play(this.container, { fit: 'cover', mirror: true })
      this.startMeters()
      this.set({
        status: 'previewing',
        error: null,
        cameraId: camera.getMediaStreamTrack().getSettings().deviceId ?? null,
        micId: mic.getMediaStreamTrack().getSettings().deviceId ?? null,
        micHeard: false,
      })
      return true
    } catch (error) {
      console.error('[agora] camera/mic unavailable', error)
      this.set({ status: 'error', error: describeMediaError(error) })
      return false
    }
  }

  /** Cameras and microphones the browser offers (labels need the permission the preview asked for). */
  async listDevices(): Promise<{ cameras: MediaDeviceOption[]; mics: MediaDeviceOption[] }> {
    const AgoraRTC = await loadAgora()
    const [cameras, mics] = await Promise.all([AgoraRTC.getCameras().catch(() => []), AgoraRTC.getMicrophones().catch(() => [])])
    const option = (device: MediaDeviceInfo, index: number, kind: string) => ({
      deviceId: device.deviceId,
      label: device.label || `${kind} ${index + 1}`,
    })
    return {
      cameras: cameras.map((device, index) => option(device, index, 'Camera')),
      mics: mics.map((device, index) => option(device, index, 'Microphone')),
    }
  }

  /** Switches camera in place (also while live: viewers see the new one, no reconnect). */
  async setCamera(deviceId: string) {
    if (!this.camera || deviceId === this.state.cameraId) return
    await this.camera.setDevice(deviceId)
    this.set({ cameraId: deviceId })
  }

  /** Switches microphone in place; the "Mic OK" check starts again for the new one. */
  async setMicrophone(deviceId: string) {
    if (!this.mic || deviceId === this.state.micId) return
    await this.mic.setDevice(deviceId)
    this.set({ micId: deviceId, micHeard: false })
  }

  /** "Hear myself": plays the microphone locally to test it (use headphones). Never sent. */
  setLoopback(on: boolean) {
    if (!this.mic) return
    if (on) this.mic.play()
    else this.mic.stop()
    this.set({ loopback: on })
  }

  /** Closes the preview (camera light off) without going live. */
  async stopPreview() {
    if (this.client) return
    if (this.meterTimer) clearInterval(this.meterTimer)
    if (this.statsTimer) clearInterval(this.statsTimer)
    this.meterTimer = this.statsTimer = null
    this.mic?.stop()
    this.mic?.close()
    this.camera?.close()
    this.mic = null
    this.camera = null
    this.set({ status: 'idle', micLevel: 0, stats: null, cameraId: null, micId: null, loopback: false, micHeard: false, error: null })
  }

  async goLive() {
    if (!this.camera || !this.mic) await this.preview()
    if (!this.camera || !this.mic || this.client) return
    // Hearing yourself while on air is distracting; the test is over.
    if (this.state.loopback) this.setLoopback(false)
    this.set({ status: 'connecting', error: null })
    try {
      const AgoraRTC = await loadAgora()
      const client = AgoraRTC.createClient({ mode: 'live', codec: 'vp8' })
      this.client = client
      await client.setClientRole('host')
      wireTokenRenewal(client, this.channel, this.getToken)
      this.wireRemotes(client)
      // Publisher tokens are bound to the host's own uid (named tiles for viewers).
      const { token, appId, uid } = await this.getToken()
      await client.join(appId, this.channel, token, uid || null)
      await client.publish([this.mic, this.camera])
      this.liveSince = Date.now()
      this.set({ status: 'live', elapsed: 0 })
    } catch (error) {
      console.error('[agora] go live failed', error)
      await this.leaveClient()
      this.set({ status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  async endLive() {
    await this.leaveClient()
    this.set({ status: this.camera ? 'previewing' : 'idle', stats: null, elapsed: 0 })
  }

  /** Front ↔ back without unpublishing (~50 ms on iPhone). Falls back to cycling devices. */
  async flipCamera() {
    if (!this.camera) return
    const facing = this.state.facing === 'user' ? 'environment' : 'user'
    try {
      await this.camera.setDevice({ facingMode: facing })
    } catch {
      const AgoraRTC = await loadAgora()
      const cameras = await AgoraRTC.getCameras()
      if (cameras.length < 2) return
      const current = this.camera.getTrackLabel()
      const index = cameras.findIndex((camera) => camera.label === current)
      await this.camera.setDevice(cameras[(index + 1) % cameras.length]!.deviceId)
    }
    this.set({ facing })
    if (this.container) this.camera.play(this.container, { fit: 'cover', mirror: facing === 'user' })
  }

  async toggleMic() {
    if (!this.mic) return
    const micMuted = !this.state.micMuted
    await this.mic.setMuted(micMuted)
    this.set({ micMuted })
  }

  async toggleCamera() {
    if (!this.camera) return
    const cameraOff = !this.state.cameraOff
    await this.camera.setMuted(cameraOff)
    this.set({ cameraOff })
  }

  private startMeters() {
    this.meterTimer = setInterval(() => {
      const micLevel = this.mic && !this.state.micMuted ? this.mic.getVolumeLevel() : 0
      this.set({ micLevel, micHeard: this.state.micHeard || micLevel > 0.04 })
    }, 150)
    this.statsTimer = setInterval(() => {
      const camera = this.camera
      if (!camera) return
      const local = camera.getStats()
      const width = local.sendResolutionWidth || local.captureResolutionWidth
      const height = local.sendResolutionHeight || local.captureResolutionHeight
      const orientation = width && height ? orientationOf(width, height) : this.state.orientation
      if (!this.client || this.state.status !== 'live') {
        this.set({ orientation })
        return
      }
      const rtc = this.client.getRTCStats()
      this.set({
        orientation,
        elapsed: Math.floor((Date.now() - this.liveSince) / 1000),
        stats: {
          rtt: Math.round(rtc.RTT ?? 0),
          fps: Math.round(local.sendFrameRate ?? 0),
          bitrate: Math.round((local.sendBitrate ?? 0) / 1000),
          resolution: width && height ? `${width}x${height}` : '—',
        },
      })
    }, 1_000)
  }

  private async leaveClient() {
    const client = this.client
    this.client = null
    this.remotes.forEach((remote) => remote.audio?.stop())
    this.remotes.clear()
    if (this.state.remotes.length) this.set({ remotes: [] })
    if (!client) return
    client.removeAllListeners()
    await client.unpublish().catch(() => undefined)
    await client.leave().catch(() => undefined)
  }

  /** Leaves the channel and releases camera + mic. */
  async dispose() {
    if (this.meterTimer) clearInterval(this.meterTimer)
    if (this.statsTimer) clearInterval(this.statsTimer)
    await this.leaveClient()
    this.mic?.close()
    this.camera?.close()
    this.mic = null
    this.camera = null
  }
}

function describeMediaError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (/PERMISSION_DENIED|NotAllowedError/i.test(message))
    return 'Camera / microphone permission was denied.'
  if (/NOT_SUPPORTED|secure|https/i.test(message))
    return 'Camera access needs HTTPS (or localhost). Run `npm run dev:https` for phones on the LAN.'
  if (/HOSTS_FULL|camera slot/i.test(message)) return message
  return message
}
