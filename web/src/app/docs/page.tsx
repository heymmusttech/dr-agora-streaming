/** `/docs` — integration guides (Next.js, Flutter, simple HTML) and the plugin reference. */
import type { Metadata } from 'next'
import { DocsView } from '@/components/docs/DocsView'

export const metadata: Metadata = { title: 'Docs — duPont REGISTRY Live' }

export default function DocsPage() {
  return <DocsView />
}
