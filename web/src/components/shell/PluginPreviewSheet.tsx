'use client'

/**
 * Plugin preview as a sheet on `/host`: a stand-in partner site (`/sandbox/partner.html`, plain
 * HTML) running the real `dpr-live.js` in a frame — LIVE badge, pill, Join, player, the site's own
 * sign-in and the plugin's events — so a host can check what viewers get without leaving the
 * console. Slides in from the right; Esc, the backdrop or ✕ close it.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ExternalLink, Puzzle, RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getPreviewOpen, getPreviewOpenOnServer, setPreviewOpen, subscribePreview } from './preview-sheet'

const SANDBOX = '/sandbox/partner.html'

export function usePreviewOpen() {
  return useSyncExternalStore(subscribePreview, getPreviewOpen, getPreviewOpenOnServer)
}

/** Header action on /host (like the dashboard's "Add New Listing"). */
export function PluginPreviewButton() {
  return (
    <Button type="button" variant="red" onClick={() => setPreviewOpen(true)}>
      <Puzzle className="h-4 w-4" /> Plugin preview
    </Button>
  )
}

export function PluginPreviewSheet() {
  const open = usePreviewOpen()
  const [mounted, setMounted] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [theme, setTheme] = useState('light')
  const closeRef = useRef<HTMLButtonElement>(null)

  // `?preview=1` (and the old /plugin/preview links) open it on arrival.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('preview') === '1') setPreviewOpen(true)
  }, [])

  useEffect(() => {
    if (!open) return
    setMounted(true) // keep the frame (and a joined player) alive after the first open
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light')
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setPreviewOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <>
      <div
        aria-hidden
        onClick={() => setPreviewOpen(false)}
        className={cn('fixed inset-0 z-[60] bg-black/40 backdrop-blur-[1px] transition-opacity', open ? 'opacity-100' : 'pointer-events-none opacity-0')}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Plugin preview"
        aria-hidden={!open}
        className={cn(
          'fixed inset-y-0 right-0 z-[61] flex w-full max-w-[820px] flex-col border-l border-outline-variant bg-background shadow-2xl transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'pointer-events-none translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center gap-3 border-b border-outline-variant px-4">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-dr-live-container/15 text-dr-live">
            <Puzzle className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-manrope text-base font-semibold text-foreground">Plugin preview</h2>
            <p className="truncate font-roboto text-xs text-on-surface-variant">
              A partner site running <code>dpr-live.js</code>. Sign in there to try chat and reactions.
            </p>
          </div>
          <Button type="button" variant="default" size="icon" aria-label="Reload preview" title="Reload preview" onClick={() => setReloadKey((k) => k + 1)}>
            <RotateCw className="h-4 w-4" />
          </Button>
          <a
            href={`${SANDBOX}?theme=${theme}`}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in a new tab"
            title="Open in a new tab"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-outline text-on-surface-variant hover:text-foreground"
          >
            <ExternalLink className="h-4 w-4" />
          </a>
          <Button ref={closeRef} type="button" variant="default" size="icon" aria-label="Close preview" onClick={() => setPreviewOpen(false)}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        {mounted && (
          <iframe
            key={reloadKey}
            src={`${SANDBOX}?theme=${theme}`}
            title="Plugin preview — partner site"
            allow="autoplay; fullscreen; picture-in-picture"
            className="min-h-0 w-full flex-1 border-0 bg-surface-1"
          />
        )}
      </aside>
    </>
  )
}
