/**
 * `/embed/live` — the bare player: what the plugin's dock iframe loads, what the mobile apps' WebView
 * loads, and what a browser tab shows when the Viewer link is opened. Who may frame it:
 * `LIVESTREAM_ALLOWED_PARENT_ORIGINS` (CSP `frame-ancestors`, next.config.ts).
 */
import type { Metadata } from 'next'
import { EmbedPlayer } from '@/components/embed/EmbedPlayer'
import { parentOrigins } from '@/lib/server/http'
import { getStatus } from '@/lib/stream/state'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Live — duPont REGISTRY', robots: { index: false } }

export default async function EmbedLivePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { ui, theme } = await searchParams
  // `ui=dock`: loaded by the plugin, whose bar already shows LIVE, title and viewers.
  // `theme`: the host site's light / dark theme (default dark).
  return (
    <EmbedPlayer
      initial={getStatus()}
      parentOrigins={parentOrigins()}
      dock={ui === 'dock'}
      initialTheme={theme === 'light' ? 'light' : 'dark'}
    />
  )
}
