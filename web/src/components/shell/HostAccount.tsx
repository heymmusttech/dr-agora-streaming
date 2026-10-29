'use client'

/** Header avatar of the signed-in host (initial), with name and email on hover. */
import { useHost } from '@/components/editor/HostGate'

export function HostAccount() {
  const { host, bypass } = useHost()
  return (
    <span
      title={`${host.name} · ${bypass ? 'dev mode' : host.email}`}
      aria-label={`Signed in as ${host.name}`}
      className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-3 font-manrope text-sm font-bold uppercase text-foreground"
    >
      {host.name.slice(0, 1)}
    </span>
  )
}
