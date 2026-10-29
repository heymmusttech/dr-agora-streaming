/**
 * The layout of every page: `[sidebar][header + content]` — the sidebar runs the full height on
 * the left, the header sits beside it (page action · logo · theme + account), the content scrolls
 * below the header. Same pattern as the duPont REGISTRY dashboard.
 */
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ThemeToggle } from '@/components/site/ThemeToggle'
import { AppSidebar } from './AppSidebar'

export function AppShell({ action, account, children }: { action?: ReactNode; account?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background lg:h-svh lg:flex-row lg:overflow-hidden">
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col lg:h-full lg:overflow-hidden">
        <header className="grid h-16 shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 md:px-6">
          <div className="flex min-w-0 items-center">{action}</div>
          <Link href="/host" className="flex items-center gap-2" aria-label="duPont REGISTRY Live — host console">
            <span className="whitespace-nowrap font-manrope text-lg font-bold tracking-tight text-foreground">
              duPont <span className="text-dr-live">REGISTRY</span> Live
            </span>
          </Link>
          <div className="flex items-center justify-end gap-2">
            <ThemeToggle />
            {account}
          </div>
        </header>
        <main className="min-w-0 flex-1 px-4 pb-24 md:px-6 lg:overflow-y-auto lg:pb-4">{children}</main>
      </div>
    </div>
  )
}
