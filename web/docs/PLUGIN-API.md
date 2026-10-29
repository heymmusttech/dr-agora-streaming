# dpr-live.js — plugin API

The plugin is a ~19 kB script with no dependencies. It renders in a Shadow DOM, so the host site's
CSS can't break it and its CSS can't leak out.

| State | What the visitor sees |
|---|---|
| Stream live, not joined | LIVE pill: `● LIVE · title — [▶ Join live] [✕]` |
| Joined | Floating player (the iframe `/embed/live?ui=dock`). Phones get a bottom sheet. The bar holds LIVE, title, minimise, expand and close; viewers and reactions sit in one row above the chat. Nothing is shown twice. |
| Expanded | The same dock, larger in the page: `[stream][chat]` side by side. |
| Minimised | `● LIVE — Back to stream` (audio keeps playing) |
| ✕ pressed | Hidden until the next session |

**Nothing connects to the video before Join.** Until then, the plugin only polls
`GET {origin}/api/stream/status` every 5 s.

## Load

```html
<script src="https://<stream-origin>/plugin/dpr-live.js" async></script>
<script>
  window.addEventListener('dpr-live:loaded', function () {
    DprLive.init({
      platform: 'drlive',
      getViewerTicket: () => fetch('/api/livestream/viewer-ticket').then((r) => r.json()).then((b) => b.ticket),
      onLoginRequest: () => openMyLogin(),
    })
  })
</script>
```

### Zero-code setup

Put data attributes on the script tag:

```html
<script src="https://<stream-origin>/plugin/dpr-live.js" async data-auto-init
        data-platform="partner" data-ticket-url="/api/livestream/viewer-ticket" data-login-url="/login"></script>
```

- The plugin fetches `data-ticket-url` with cookies and expects `{ "ticket": "…" | null }`.
- `data-login-url` gets `?returnTo=<current path>` appended.
- Alternatively, set `window.DprLiveConfig = { … }` before the script loads.

## `DprLive.init(options)`

| Option | Default | |
|---|---|---|
| `origin` | origin of the script | Where `/embed/live` and `/api/stream/status` live |
| `platform` | `'web'` | Sent to the player. Use the same value as the ticket's `iss`. |
| `getViewerTicket` | — | `() => Promise<string \| null>`. Called on Join, when the player says the ticket expired, and every 10 min while joined. |
| `onLoginRequest` | — | Called when a guest presses Sign in, a reaction, or the chat box. Open your site's login here. |
| `position` | `'bottom-left'` | or `'bottom-right'` |
| `autoOpen` | `false` | Open the player as soon as a stream is live (otherwise the pill shows) |
| `pollMs` | `5000` | Status poll interval (min 2000) |
| `container` | `document.body` | Where the widget element is appended |
| `headless` | `false` | No pill or dock. Use `mountBadge` + `open()` with your own UI. |
| `theme` | `'auto'` | `auto` follows the host page's light / dark theme live; `light` / `dark` force one. Also available as `data-theme` on the script tag. |

`init` is idempotent: calling it again replaces the widget.

## Methods

| | |
|---|---|
| `DprLive.setViewer(ticket \| null)` | **Login state changed.** Pass a new ticket on sign-in, `null` on sign-out. Chat unlocks or locks without a reload. |
| `DprLive.refreshViewer()` | Calls `getViewerTicket` again and sends the result (same effect as `setViewer`) |
| `DprLive.setTheme('auto' \| 'light' \| 'dark')` | `auto` (default) follows the page: `<html data-theme>` (drlive-frontend), else a `dark` class, else the OS, and keeps following it. `light` / `dark` force one. The pill stays brand red; the dock and the player's chat switch surfaces. |
| `DprLive.open()` / `close()` / `minimize()` / `restore()` | Dock control. `open` is Join. |
| `DprLive.expand(true \| false)` | Enlarges the dock **inside the page** (stream and chat side by side), or shrinks it back. It's the bar's Expand button. It isn't browser fullscreen, so there's no Esc trap; Esc collapses it. |
| `DprLive.mute(true \| false)`, `DprLive.setVolume(0–100)` | Player audio |
| `DprLive.mountBadge(element)` | Renders a LIVE badge (a Join button) inside `element` while live. Returns an unmount function. |
| `DprLive.on(event, cb)` | Returns an unsubscribe function. Each event is also dispatched as a `window` event `dpr-live:<event>`. |
| `DprLive.getStatus()` / `getState()` | Last stream status / last player state |
| `DprLive.destroy()` | Removes everything |

### Events

| Event | When |
|---|---|
| `status` | Every status poll result |
| `live` / `offline` | The stream started / ended |
| `open` / `close` | The player opened / closed |
| `ready` | The player iframe is ready |
| `state` | The player state changed (see `PlayerState`) |
| `login-request` | A guest asked to sign in |

```ts
interface PlayerState {
  status: 'live' | 'connecting' | 'offline'
  isLive: boolean
  title: string | null
  aspectRatio: 'portrait' | 'landscape'
  hosts: number
  viewers: number
  muted: boolean
  volume: number
  signedIn: boolean
}
```

## Viewer ticket

Your **server** signs the ticket (never the browser), with HS256 and the shared secret
`LIVESTREAM_VIEWER_TICKET_SECRET`. If a platform needs its own secret, the stream server reads
`LIVESTREAM_VIEWER_TICKET_SECRET_<ISS>` instead.

```json
{ "iss": "drlive", "sub": "<user id>", "name": "Jane D.", "avatar": "https://… (optional)", "iat": 1730000000, "exp": 1730000600 }
```

- `exp − iat` ≤ 15 min (we use 10).
- `iss` must match `[a-z][a-z0-9-]{0,19}`; `sub` must match `[A-Za-z0-9_.:@-]{1,64}`.
- Don't put the email in it. The name is shown in a public chat.
- Expired, forged, too long-lived or malformed tickets are treated as guests. The player then sends
  `TICKET_EXPIRED`, and the plugin asks `getViewerTicket` again.

Node example:

```ts
import { SignJWT } from 'jose'
const ticket = await new SignJWT({ name: 'Jane D.' })
  .setProtectedHeader({ alg: 'HS256' }).setIssuer('drlive').setSubject(user.id)
  .setIssuedAt().setExpirationTime('10m')
  .sign(new TextEncoder().encode(process.env.LIVESTREAM_VIEWER_TICKET_SECRET))
```

## postMessage protocol (plugin ⇄ `/embed/live`)

Every message carries `source: 'dpr-live'`. Both sides check the exact origin and `event.source`.
The parent must match `LIVESTREAM_ALLOWED_PARENT_ORIGINS`.

| Direction | Messages |
|---|---|
| parent → player | `VIEWER_TICKET {ticket}` · `THEME {theme}` · `MUTE` · `UNMUTE` · `SET_VOLUME {volume}` · `GET_STATUS` |
| player → parent | `READY` · `STATE {state}` · `LOGIN_REQUEST` · `TICKET_EXPIRED` · `CLOSE_REQUEST` |

Native apps use the same messages, through the `DprLiveNative` JS channel. See
[INTEGRATION-FLUTTER.md](INTEGRATION-FLUTTER.md).

## Theming

Set CSS variables on the widget element, e.g. `dpr-live-widget { --dpr-live-accent: #C10E34; }`:

- `--dpr-live-accent`, `--dpr-live-accent-hover`, `--dpr-live-text`
- `--dpr-live-font`, `--dpr-live-body-font`
- `--dpr-live-dock-width` (400px), `--dpr-live-dock-height` (520px)
- `--dpr-live-offset` (20px), `--dpr-live-z`

The defaults match dR Live: `dr-live-container` red, Manrope, rounded pills. They follow the
`LiveStreamDock` / `HeaderLiveBadge` pattern and the `public-*.svg` wireframes.

## What the host site must allow (CSP)

| Directive | Add `https://<stream-origin>` |
|---|---|
| `script-src` and `script-src-elem` | The plugin script |
| `frame-src` | The player |
| `connect-src` | The status poll. `https:` already covers it. In dev, add `http://localhost:5173` explicitly. |

The plugin's styles are inline in its Shadow DOM, so `style-src 'unsafe-inline'` is required (most
sites already have it). The player never asks for the camera, so `Permissions-Policy` can stay
`camera=()`.
