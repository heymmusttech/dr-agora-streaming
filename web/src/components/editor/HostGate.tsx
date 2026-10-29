'use client'

/**
 * Keycloak gate for the host console (`/host`), same flow as auction-stream's `HostGate`:
 * sign in (redirect to Keycloak), then ask the server who we are — it re-verifies the token and
 * the dr / drg email rule, so the page never trusts the browser's own reading of the token.
 *
 * Dev bypass (`NEXT_PUBLIC_HOST_AUTH=false`): asks for a display name instead.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { Loader2, LogIn, LogOut, ShieldAlert, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { HostIdentity } from '@/lib/auth/host-claims'
import {
  getDevHostName,
  HOST_AUTH_ENABLED,
  HostApiError,
  hostFetch,
  setDevHostName,
  signInHost,
  signOutHost,
} from '@/lib/auth/host-session'

interface HostContextValue {
  host: HostIdentity
  bypass: boolean
  signOut: () => void
}

const HostContext = createContext<HostContextValue | null>(null)

export function useHost(): HostContextValue {
  const value = useContext(HostContext)
  if (!value) throw new Error('useHost() outside <HostGate>')
  return value
}

/** Optional variant for chrome that renders outside the gate's loading states. */
export const useOptionalHost = () => useContext(HostContext)

type GateState =
  | { phase: 'loading' }
  | { phase: 'dev-name' }
  | { phase: 'ready'; host: HostIdentity; bypass: boolean }
  | { phase: 'denied'; message: string; email?: string }
  | { phase: 'error'; message: string }

export function HostGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<GateState>({ phase: 'loading' })

  const run = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      await signInHost()
      const me = await hostFetch<{ host: HostIdentity; bypass: boolean }>('/api/editor/me', { method: 'GET' })
      setState({ phase: 'ready', host: me.host, bypass: me.bypass })
    } catch (error) {
      if (error instanceof HostApiError && error.status === 403) {
        setState({ phase: 'denied', message: error.message })
        return
      }
      setState({ phase: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }, [])

  useEffect(() => {
    if (!HOST_AUTH_ENABLED && !localStorage.getItem('dpr-live-dev-host')) {
      setState({ phase: 'dev-name' })
      return
    }
    void run()
  }, [run])

  if (state.phase === 'ready')
    return (
      <HostContext.Provider value={{ host: state.host, bypass: state.bypass, signOut: () => void signOutHost() }}>
        {children}
      </HostContext.Provider>
    )

  return (
    <div className="flex min-h-svh items-center justify-center px-4">
      <section className="w-full max-w-md space-y-4 rounded-2xl border border-outline-variant bg-background p-6 text-center shadow-sm">
        {state.phase === 'loading' && (
          <>
            <Loader2 className="mx-auto h-7 w-7 animate-spin text-dr-live" />
            <p className="font-manrope text-base font-semibold text-foreground">Signing you in…</p>
            <p className="font-roboto text-xs text-on-surface-variant">duPont Registry SSO (Keycloak)</p>
          </>
        )}
        {state.phase === 'dev-name' && <DevNameForm onDone={() => void run()} />}
        {state.phase === 'denied' && (
          <>
            <ShieldAlert className="mx-auto h-8 w-8 text-dr-live" />
            <h1 className="font-manrope text-lg font-semibold text-foreground">Hosting is restricted</h1>
            <p className="font-roboto text-sm text-on-surface-variant">{state.message}</p>
            <Button type="button" variant="red" onClick={() => void signOutHost()}>
              <LogOut className="h-4 w-4" /> Use another account
            </Button>
          </>
        )}
        {state.phase === 'error' && (
          <>
            <ShieldAlert className="mx-auto h-8 w-8 text-on-surface-variant" />
            <h1 className="font-manrope text-lg font-semibold text-foreground">Could not sign you in</h1>
            <p className="break-words font-roboto text-sm text-on-surface-variant">{state.message}</p>
            <Button type="button" variant="red" onClick={() => void run()}>
              <LogIn className="h-4 w-4" /> Sign in with duPont Registry
            </Button>
          </>
        )}
      </section>
    </div>
  )
}

function DevNameForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState(getDevHostName())
  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault()
        setDevHostName(name)
        onDone()
      }}
    >
      <ShieldCheck className="mx-auto h-8 w-8 text-support-orange" />
      <h1 className="font-manrope text-lg font-semibold text-foreground">Dev mode — no Keycloak</h1>
      <p className="font-roboto text-xs text-on-surface-variant">
        <code>NEXT_PUBLIC_HOST_AUTH=false</code>: the server accepts any host (never in production). Pick a name; use a
        different one per browser to test co-hosting.
      </p>
      <input
        value={name}
        onChange={(event) => setName(event.target.value)}
        maxLength={40}
        aria-label="Host name"
        className="h-10 w-full rounded-lg border border-outline-variant bg-background px-3 font-roboto text-sm text-foreground focus:border-dr-live-container focus:outline-none"
      />
      <Button type="submit" variant="red" className="w-full">
        Continue
      </Button>
    </form>
  )
}
