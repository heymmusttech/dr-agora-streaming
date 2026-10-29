'use client'

/**
 * The icon rail of every page (same pattern as the duPont REGISTRY dashboard): Live Stream, Viewer,
 * Plugin (opens the preview sheet on /host), Docs — and Log out pinned to the bottom while a host
 * is signed in. Every link opens in a new tab, so the console you are on keeps running (camera,
 * chat). On phones it becomes a bottom tab bar.
 */
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ComponentType, ReactNode } from 'react'
import { BookOpen, LogOut, MonitorPlay, Puzzle, Radio } from 'lucide-react'
import { useOptionalHost } from '@/components/editor/HostGate'
import { cn } from '@/lib/utils'
import { setPreviewOpen } from './preview-sheet'

interface NavItem {
  id: string
  label: string
  icon: ComponentType<{ className?: string }>
  href: string
  active: (pathname: string) => boolean
}

const NAV_ITEMS: NavItem[] = [
  { id: 'live-stream', label: 'Live Stream', icon: Radio, href: '/host', active: (p) => p === '/host' },
  { id: 'viewer', label: 'Viewer', icon: MonitorPlay, href: '/embed/live', active: (p) => p.startsWith('/embed') },
  { id: 'plugin', label: 'Plugin', icon: Puzzle, href: '/host?preview=1', active: () => false },
  { id: 'docs', label: 'Docs', icon: BookOpen, href: '/docs', active: (p) => p.startsWith('/docs') },
]

function ItemBody({ icon: Icon, label, active }: { icon: ComponentType<{ className?: string }>; label: string; active: boolean }) {
  return (
    <>
      <span
        className={cn(
          'flex h-8 w-14 items-center justify-center rounded-full transition-colors',
          active ? 'bg-dr-live-container text-white' : 'group-hover:bg-surface-3',
        )}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="text-[10px] font-medium leading-none">{label}</span>
    </>
  )
}

const ITEM = 'group flex shrink-0 flex-col items-center gap-1 rounded-xl px-2 py-1.5 no-underline'

export function AppSidebar() {
  const pathname = usePathname() ?? ''
  const host = useOptionalHost()

  const items: ReactNode[] = NAV_ITEMS.map((item) => {
    const active = item.active(pathname)
    const className = cn(ITEM, active ? 'text-dr-live' : 'text-on-surface-variant hover:text-foreground')
    // On /host the plugin preview is a sheet on the same page: open it in place.
    if (item.id === 'plugin' && pathname === '/host')
      return (
        <button key={item.id} type="button" className={className} onClick={() => setPreviewOpen(true)}>
          <ItemBody icon={item.icon} label={item.label} active={false} />
        </button>
      )
    return (
      <Link key={item.id} href={item.href} target="_blank" rel="noopener" className={className} aria-current={active ? 'page' : undefined}>
        <ItemBody icon={item.icon} label={item.label} active={active} />
      </Link>
    )
  })

  return (
    <nav
      aria-label="Main"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 flex shrink-0 flex-row items-center justify-around gap-1 border-t border-outline-variant bg-surface-1 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:static lg:h-full lg:w-[88px] lg:flex-col lg:items-stretch lg:justify-start lg:gap-2 lg:overflow-y-auto lg:border-r lg:border-t-0 lg:px-2 lg:pt-4',
        // Dev only: Next's dev badge sits bottom-left; keep Log out above it.
        process.env.NODE_ENV === 'development' ? 'lg:pb-20' : 'lg:pb-4',
      )}
    >
      {items}
      {host && (
        <button type="button" onClick={host.signOut} className={cn(ITEM, 'text-on-surface-variant hover:text-foreground lg:mt-auto')}>
          <ItemBody icon={LogOut} label="Log out" active={false} />
        </button>
      )}
    </nav>
  )
}
