'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { HostSession, type HostSnapshot } from '@/lib/stream/agora'
import {
  acquireCameraLock,
  claimedByOtherTab,
  flagThisTab,
  getSharedHostId,
  listenAsCameraOwner,
  watchCameraLock,
  type CameraClaim,
} from '@/lib/stream/camera-lock'
import { LIVE_CHANNEL } from '@/lib/stream/channel'
import { endHostPresence, fetchPublisherTokens, sendHostHeartbeat } from '@/lib/stream/host-api'
import { HostApiError } from '@/lib/auth/host-session'
import type { HostRole } from '@/lib/stream/types'

const HEARTBEAT_MS = 10_000

const INITIAL: HostSnapshot = {
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

/**
 * Host side of the broadcast: preview, go live (publisher token from `/api/token/host`, Keycloak),
 * heartbeat into the camera registry, and a keepalive stop when the tab closes. The server decides
 * the role (admin = who started the stream) and refuses a camera when every slot is taken.
 *
 * One camera per browser: while this tab is live it holds the camera lock
 * (`lib/stream/camera-lock.ts`). Another tab of the same browser sees `blockedByTab` instead of its
 * own Go live, and can ask this one to come forward or to hand the camera over.
 */
export function useHostBroadcast(role: HostRole = 'host', onRejected?: (message: string) => void) {
  const sessionRef = useRef<HostSession | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [snapshot, setSnapshot] = useState<HostSnapshot>(INITIAL)
  const orientationRef = useRef(snapshot.orientation)
  orientationRef.current = snapshot.orientation
  // Shared across the browser's tabs, so a takeover replaces the same host in the registry.
  const hostIdRef = useRef<string | null>(null)
  hostIdRef.current ??= typeof window === 'undefined' ? null : getSharedHostId()
  /** Set while another tab of this browser is the camera tab. */
  const [blockedByTab, setBlockedByTab] = useState<CameraClaim | null>(null)

  const rejectedRef = useRef(onRejected)
  rejectedRef.current = onRejected

  useEffect(() => {
    const session = new HostSession(setSnapshot, async () => (await fetchPublisherTokens()).rtc)
    sessionRef.current = session
    session.attach(containerRef.current)
    return () => {
      sessionRef.current = null
      void session.dispose()
    }
  }, [])

  const live = snapshot.status === 'live'

  // Not live: watch for another tab taking the camera, so the UI can explain itself.
  useEffect(() => {
    if (live) {
      setBlockedByTab(null)
      return
    }
    return watchCameraLock(setBlockedByTab)
  }, [live])

  // Live: hold the lock, and answer the other tabs' Switch / Take over requests.
  useEffect(() => {
    if (!live) return
    const release = acquireCameraLock(hostIdRef.current!, role === 'admin' ? 'admin' : 'host')
    let unflag: (() => void) | null = null
    const stopListening = listenAsCameraOwner({
      // A background tab cannot raise itself, so flag the title instead (see `flagThisTab`).
      onFocus: () => {
        unflag?.()
        unflag = flagThisTab()
      },
      onYield: () => void sessionRef.current?.endLive(),
    })
    return () => {
      unflag?.()
      stopListening()
      release()
    }
  }, [live, role])

  useEffect(() => {
    if (!live) return
    let cancelled = false
    const beat = async () => {
      try {
        await sendHostHeartbeat(orientationRef.current)
      } catch (error) {
        // Offline, single mode for a co-host, or no free slot: this camera must go off air.
        if (!cancelled && error instanceof HostApiError && error.status === 409) {
          void sessionRef.current?.endLive()
          rejectedRef.current?.(error.message)
        }
      }
    }
    void beat()
    const timer = setInterval(() => void beat(), HEARTBEAT_MS)
    // sendBeacon can't carry the Authorization header; a keepalive fetch can.
    const onHide = () => void endHostPresence(true)
    window.addEventListener('pagehide', onHide)
    return () => {
      cancelled = true
      clearInterval(timer)
      window.removeEventListener('pagehide', onHide)
      void endHostPresence()
    }
  }, [live])

  // Stable per-co-host callback refs (a new function each render would replay the video).
  const remoteRefs = useRef(new Map<string, (node: HTMLDivElement | null) => void>())
  const remoteRef = useCallback((id: string) => {
    let ref = remoteRefs.current.get(id)
    if (!ref) {
      ref = (node: HTMLDivElement | null) => sessionRef.current?.attachRemote(id, node)
      remoteRefs.current.set(id, ref)
    }
    return ref
  }, [])

  const videoRef = useCallback((node: HTMLDivElement | null) => {
    containerRef.current = node
    sessionRef.current?.attach(node)
  }, [])

  return {
    ...snapshot,
    channel: LIVE_CHANNEL,
    /** Another tab of this browser owns the camera; `null` when this tab may go live. */
    blockedByTab,
    videoRef,
    remoteRef,
    setNames: (names: Map<string, string>) => sessionRef.current?.setNames(names),
    preview: () => sessionRef.current?.preview() ?? Promise.resolve(false),
    stopPreview: () => sessionRef.current?.stopPreview(),
    listDevices: () => sessionRef.current?.listDevices() ?? Promise.resolve({ cameras: [], mics: [] }),
    setCamera: (deviceId: string) => sessionRef.current?.setCamera(deviceId),
    setMicrophone: (deviceId: string) => sessionRef.current?.setMicrophone(deviceId),
    setLoopback: (on: boolean) => sessionRef.current?.setLoopback(on),
    goLive: () => {
      // Last check before publishing: the claim may have been taken since the UI rendered.
      if (claimedByOtherTab()) return setBlockedByTab(claimedByOtherTab())
      return sessionRef.current?.goLive()
    },
    endLive: () => sessionRef.current?.endLive(),
    flipCamera: () => sessionRef.current?.flipCamera(),
    toggleMic: () => sessionRef.current?.toggleMic(),
    toggleCamera: () => sessionRef.current?.toggleCamera(),
  }
}
