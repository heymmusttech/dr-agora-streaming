/**
 * Host console (`/host`) behind the Keycloak gate (dr / drg emails only), in the shared shell:
 * sidebar, header (Plugin preview · logo · theme + account), content. The plugin preview opens as
 * a sheet on this page.
 */
import type { Metadata } from 'next'
import { HostGate } from '@/components/editor/HostGate'
import { AppShell } from '@/components/shell/AppShell'
import { HostAccount } from '@/components/shell/HostAccount'
import { PluginPreviewButton, PluginPreviewSheet } from '@/components/shell/PluginPreviewSheet'

export const metadata: Metadata = { title: 'Live Stream — duPont REGISTRY Live', robots: { index: false } }

export default function HostLayout({ children }: { children: React.ReactNode }) {
  return (
    <HostGate>
      <AppShell action={<PluginPreviewButton />} account={<HostAccount />}>
        {children}
      </AppShell>
      <PluginPreviewSheet />
    </HostGate>
  )
}
