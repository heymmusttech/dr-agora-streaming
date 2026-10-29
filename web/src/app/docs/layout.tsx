/** Docs in the shared shell (sidebar, header, content). Public: nothing secret in the guides. */
import { AppShell } from '@/components/shell/AppShell'

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>
}
