/**
 * `/host` — the host studio: Start / Stop, go on camera (admin or co-host), chat
 * moderation, reactions and viewers. Keycloak-gated by `host/layout.tsx`; every action is
 * re-checked by the API.
 */
import type { Metadata } from 'next'
import { LiveStreamControlView } from '@/components/editor/LiveStreamControlView'
import { getStatus } from '@/lib/stream/state'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Live Stream — duPont REGISTRY Live' }

export default function HostPage() {
  const agoraConfigured = Boolean(process.env.NEXT_PUBLIC_AGORA_APP_ID && process.env.AGORA_APP_CERTIFICATE)
  return <LiveStreamControlView initial={getStatus()} agoraConfigured={agoraConfigured} />
}
