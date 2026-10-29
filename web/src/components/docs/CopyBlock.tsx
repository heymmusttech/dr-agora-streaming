'use client'

/** A value or a code block with its own Copy button (docs page). */
import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

export function CopyBlock({
  label,
  value,
  ready = true,
  code = false,
  lang = 'html',
}: {
  label: string
  value: string
  ready?: boolean
  code?: boolean
  lang?: string
}) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1_800)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
    } catch {
      toast.error(`Could not copy the ${label.toLowerCase()}`)
    }
  }

  const button = (
    <button
      type="button"
      disabled={!ready}
      onClick={() => void copy()}
      aria-label={`Copy ${label}`}
      className={cn(
        'inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full px-3 font-roboto text-xs font-semibold transition-colors disabled:opacity-50',
        copied ? 'text-success' : 'text-on-surface-variant hover:bg-surface-2 hover:text-foreground',
      )}
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )

  return (
    <div className="space-y-1.5">
      <span className="block font-roboto text-xs font-medium text-on-surface-variant">{label}</span>
      {code ? (
        <div className="overflow-hidden rounded-lg border border-outline-variant bg-surface-1">
          <div className="flex items-center justify-between gap-2 border-b border-outline-variant/70 bg-surface-2/40 py-1 pl-3 pr-1.5">
            <span className="font-mono text-[10px] uppercase tracking-wider text-on-surface-variant">{lang}</span>
            {button}
          </div>
          <pre className="max-h-[420px] overflow-auto whitespace-pre px-3 py-2.5 font-mono text-xs leading-relaxed text-foreground">
            {ready ? value : '…'}
          </pre>
        </div>
      ) : (
        <div className="flex h-12 items-center gap-2 rounded-lg border border-outline-variant bg-surface-1 pl-3 pr-1">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground" title={value}>
            {ready ? value : '…'}
          </code>
          {button}
        </div>
      )}
    </div>
  )
}
