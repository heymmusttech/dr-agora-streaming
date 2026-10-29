# Add the live stream to a Next.js site

This adds the LIVE pill, Join, and the floating player with chat and reactions to any Next.js app,
and connects them to the app's own login. **drlive-frontend is the worked example.** Its files are
named in each step, so you can copy them.

You need four pieces:

| # | Piece | drlive-frontend |
|---|---|---|
| 1 | Env vars | `envs/.env.example`, `Dockerfile`, `.gitlab-ci.yml` |
| 2 | A server route that signs the **viewer ticket** | `src/app/api/auctions/livestream/viewer-ticket/route.ts` + `src/lib/auction-api/livestream/server/viewer-ticket.ts` |
| 3 | A client component that loads the plugin and follows login state | `src/components/auctions/shared/LiveStreamPlugin.tsx` (mounted in `src/app/(frontend)/layout.tsx`) |
| 4 | CSP entries for the stream origin | `src/lib/security-headers.ts` |

## 1. Env

```bash
NEXT_PUBLIC_ENABLE_LIVE_STREAM=true
NEXT_PUBLIC_LIVESTREAM_ORIGIN=https://live-stream.dupontregistry.com   # local: http://localhost:5173
LIVESTREAM_VIEWER_TICKET_SECRET=<same value as on the stream server>   # server only, ≥ 32 chars
```

- `NEXT_PUBLIC_*` values are inlined at **build** time. With Docker, declare them as `ARG` + `ENV`
  before `next build` and pass `--build-arg` in CI.
- The secret is runtime-only. In drlive-frontend it is listed in the deploy job's `runtime_keys`,
  which read Secrets Manager `fe/<env>`.
- On the stream server, add the site's origin to `LIVESTREAM_ALLOWED_PARENT_ORIGINS`
  (`https://*.dupontregistry.com` and `https://*.dra.tools` are there by default).

## 2. Viewer ticket route (server)

The ticket says who is signed in, without sharing the session. Return `null` for guests.

App Router (`app/api/livestream/viewer-ticket/route.ts`):

```ts
import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { getCurrentUser } from '@/lib/auth' // ← your session lookup

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getCurrentUser()
  const secret = process.env.LIVESTREAM_VIEWER_TICKET_SECRET
  if (!user || !secret) return NextResponse.json({ ticket: null }, { headers: { 'Cache-Control': 'no-store' } })

  const name = `${user.firstName} ${user.lastName?.charAt(0) ?? ''}.`.trim() // shown in a public chat
  const ticket = await new SignJWT({ name })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('drlive') // your platform id
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime('10m') // ≤ 15 min
    .sign(new TextEncoder().encode(secret))
  return NextResponse.json({ ticket }, { headers: { 'Cache-Control': 'no-store' } })
}
```

Pages Router (`pages/api/livestream/viewer-ticket.ts`) does the same with
`export default async function handler(req, res)` and `res.setHeader('Cache-Control', 'no-store').json({ ticket })`.

drlive-frontend specifics:

- The route is built with `createAuctionRoute` and loads the user via `callBackend('/user/info')`.
  `auctionFetch` therefore refreshes an expired access token by itself.
- It returns `null` while an editor impersonates a user, so nobody posts in the public chat as
  someone else.

## 3. Load the plugin (client component)

```tsx
'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import Script from 'next/script'
import { useAuth } from '@/hooks/useAuth' // ← your auth hook
import { openSignInModal } from '@/lib/auth-modal-events' // ← however your site opens login

const ORIGIN = process.env.NEXT_PUBLIC_LIVESTREAM_ORIGIN!
const ENABLED = process.env.NEXT_PUBLIC_ENABLE_LIVE_STREAM === 'true' && Boolean(ORIGIN)

const getViewerTicket = async () => {
  const response = await fetch('/api/livestream/viewer-ticket', { cache: 'no-store' })
  return response.ok ? ((await response.json()) as { ticket: string | null }).ticket : null
}

export function LiveStreamPlugin() {
  const pathname = usePathname() ?? ''
  const { user, isLoading } = useAuth()
  const [ready, setReady] = useState(false)
  const hidden = pathname.startsWith('/editor') || pathname.startsWith('/admin')
  const lastUser = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (!ready || hidden) return
    const live = window.DprLive!
    live.init({
      origin: ORIGIN,
      platform: 'drlive',
      getViewerTicket,
      onLoginRequest: () => openSignInModal({ redirectTo: location.pathname + location.search }),
    })
    return () => live.destroy()
  }, [ready, hidden])

  // Sign in / sign out → new ticket, without reloading the player.
  useEffect(() => {
    if (!ready || hidden || isLoading) return
    const id = user?.id ?? null
    if (lastUser.current === undefined) return void (lastUser.current = id)
    if (lastUser.current === id) return
    lastUser.current = id
    void window.DprLive?.refreshViewer()
  }, [ready, hidden, isLoading, user?.id])

  if (!ENABLED) return null
  return <Script src={`${ORIGIN}/plugin/dpr-live.js`} strategy="lazyOnload" onReady={() => setReady(true)} />
}
```

Mount it once, inside your auth provider:

- **App Router:** the root layout (`<Providers>…<LiveStreamPlugin />…</Providers>`).
- **Pages Router:** `_app.tsx`, next to `<Component {...pageProps} />`.

Optional extras:

- A LIVE badge in your header: `DprLive.mountBadge(document.getElementById('live-badge')!)` after
  `init`. Clicking it is Join.
- A typed `window.DprLive`: declare the subset you use (see `DprLiveApi` in drlive-frontend's
  component), or read `docs/PLUGIN-API.md`.

## 4. CSP

If the site sends a Content-Security-Policy, add the stream origin to:

```
script-src       … https://live-stream.dupontregistry.com
script-src-elem  … https://live-stream.dupontregistry.com
frame-src        … https://live-stream.dupontregistry.com
connect-src      … https://live-stream.dupontregistry.com   (only needed if connect-src has no `https:`, and in dev for http://localhost:5173)
```

drlive-frontend builds these from `NEXT_PUBLIC_LIVESTREAM_ORIGIN` (`LIVESTREAM_SOURCES` in
`src/lib/security-headers.ts`), so nothing is added while the plugin is off. `Permissions-Policy:
camera=()` can stay: viewers never use the camera (hosts use the stream app itself).

## Check it

1. Run the stream app: `npm run dev` in dpr-livestreaming (`:5173`). In the site's `.env`, set
   `NEXT_PUBLIC_LIVESTREAM_ORIGIN=http://localhost:5173`.
2. Start a stream at `http://localhost:5173/host` (Preview camera → Start stream).
3. On the site: the LIVE pill appears bottom-left → Join → the video plays.
   - As a guest, Sign in to chat opens the site's login.
   - After signing in, the chat box unlocks without a reload.
4. Automated: `SITE=http://localhost:3005 STREAM=http://localhost:5174 START_HOST=1 node e2e/host-site.mjs`.
   This works against a stream server in dev-bypass mode.

## Troubleshooting

| Symptom | Cause |
|---|---|
| No pill, console says `Refused to load the script` | `script-src` / `script-src-elem` lacks the origin |
| Pill never appears, `Refused to connect … /api/stream/status` | `connect-src` (dev: http origin), or the site's origin is missing from the stream server's `LIVESTREAM_ALLOWED_PARENT_ORIGINS` (no CORS header) |
| Dock is blank, `frame-ancestors` error inside the frame | Add the site's origin to `LIVESTREAM_ALLOWED_PARENT_ORIGINS` |
| Signed in but chat says "Sign in to chat" | The ticket route returned `null`, or the secret differs between the two apps (the player logs `ticketRejected`). Check that `iss` matches a configured secret. |
| No sound | Autoplay starts muted. Tap to unmute, or use the dock's speaker button. |
