# dpr-livestreaming

Live streaming for duPont REGISTRY: one stream at a time, hosted by staff (Keycloak), watched on any
site through one embeddable plugin — dR Live (Next.js) first, then dR Garage (Flutter).

| | |
|---|---|
| **Hosts** | `/host` — Keycloak sign-in, `@dupontregistry.com` / `@dupontregistrygroup.com` only. Laid out as sidebar · stage · chat: nobody goes on air untested — **Preview camera** opens the device check (camera / mic pickers, mic level with a "Mic OK" check, Hear myself), then **Start stream** starts the stream and goes live in one press; the stage shows your camera and the co-hosts as viewers see them (Agora split, 2–4 cameras), with viewers and reactions on top; chat with moderation on the right; Embed & share in a modal. |
| **Viewers** | `/embed/live` — video (one tile per host), ❤️ 👍 😄 with live totals, live chat. Guests watch and read; signed-in users of the host site chat and react. |
| **Plugin** | `/plugin/dpr-live.js` — the LIVE pill, Join, the floating player and the bridge to the host site's login. One script for every website; mobile apps load `/embed/live` in a WebView. |
| **Plugin preview** | A sheet on `/host` (header button or sidebar → Plugin): a plain partner page (`public/sandbox/partner.html`) running the real plugin, with a local sign-in (dev tickets only) and the plugin's events. `/plugin/preview` redirects there. |
| **Layout** | Every page uses one shell: sidebar · header (action · logo · theme + account) · content. `/embed/live` is always the bare player (plugin dock, app WebView, or a tab from the sidebar's Viewer link). Sidebar links open in a new tab; Log out sits at the bottom. |

It replaces two prototypes; what was kept and what was fixed is in [docs/AUDIT.md](docs/AUDIT.md).

## Run it

```bash
npm install
cp .env.example .env.local     # fill in the Agora certificate + ticket secret (see below)
npm run dev                    # http://localhost:5173  (builds the plugin first)
```

- **Port 5173 matters:** the dev Keycloak client `auction-stream` (realm `mrkt`) accepts redirects to
  `http://localhost:5173/*` and `:3000/*`, not other ports.
- **No Keycloak account?** `NEXT_PUBLIC_HOST_AUTH=false` gives a dev bypass: you type a host name, any
  request is accepted. The server ignores it when `NODE_ENV=production`.
- Phones on the LAN (camera needs HTTPS): `npm run dev:https`.

| Script | |
|---|---|
| `npm run dev` / `build` / `start` | Next.js on 5173 (`build:plugin` runs first) |
| `npm run build:plugin` | `src/plugin/*` → `public/plugin/dpr-live.js` (+ `.css`) |
| `npm run typecheck` · `lint` · `test` | tsc · eslint · vitest (auth rules, tickets, origins, stream rules) |
| `npm run e2e` | real Agora end to end (see [Verify](#verify)) |

## How it works

```
Host (Keycloak) ─ /host ─────────────► Next API ─ tokens ─► Agora RTC (video) + RTM (chat, reactions, viewers)
                                          │ SSE status feed                    ▲
Host site (dR Live, Garage, …) ─ dpr-live.js ─ iframe /embed/live ─────────────┘
   └─ its server signs a viewer ticket ─► plugin ─► player ─► /api/token/viewer
```

- **Stream record** (`src/lib/stream/state.ts`): live / title / host mode / max hosts / session /
  who started it. Persisted to `.data/stream.json`. Status reaches the console and the player over
  SSE (`/api/live-stream/events`); cross-origin sites poll `/api/stream/status` (CORS allow-list).
- **Cameras** (`registry.ts`): each host heartbeats every 10 s, keyed by Keycloak subject, so
  `maxHosts` counts people. The host who pressed Start is the **admin**: their camera going off air
  ends the stream; co-hosts can leave but not Stop.
- **Tokens** (`src/lib/server/agora-tokens.ts`, the App Certificate never leaves the server):
  - publisher RTC tokens need Keycloak, a live stream and a free slot;
  - viewers get subscriber tokens;
  - RTM tokens are bound to an id the server picks: `host_{sub}`, `u_{platform}_{userId}` (valid
    viewer ticket) or `anon_…` (guest).
- **Chat and reactions** (`src/lib/stream/rtm.ts`, Agora RTM client-side): receivers trust RTM's
  `publisher`, not the payload, so guests can't post and only hosts can moderate. One host client
  (the admin, else the first host) counts reactions (≤ 5/s per user), broadcasts totals and saves
  the last 50 messages + muted list + totals to `/api/stream/snapshot` for late joiners.

## Configuration

All variables are in [.env.example](.env.example).

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` | Agora project |
| `NEXT_PUBLIC_KEYCLOAK_URL` / `_REALM` / `_CLIENT_ID` | Same as auction-stream: realm `mrkt`, client `auction-stream` |
| `HOST_ALLOWED_EMAIL_DOMAINS` | Who may host |
| `NEXT_PUBLIC_HOST_AUTH` | `false` = dev bypass |
| `LIVESTREAM_VIEWER_TICKET_SECRET` | Shared with the host sites. A per-platform override is `LIVESTREAM_VIEWER_TICKET_SECRET_<ISS>` |
| `LIVESTREAM_ALLOWED_PARENT_ORIGINS` | Sites that may frame the player (CSP `frame-ancestors`) and poll the status (CORS) |

## Integrate

- Any Next.js site (dR Live is the worked example): [docs/INTEGRATION-NEXTJS.md](docs/INTEGRATION-NEXTJS.md)
- Flutter / dR Garage (WebView): [docs/INTEGRATION-FLUTTER.md](docs/INTEGRATION-FLUTTER.md)
- Simple website (one script tag): [docs/INTEGRATION-HTML.md](docs/INTEGRATION-HTML.md)
- Plugin API, events, postMessage protocol, ticket format, theming: [docs/PLUGIN-API.md](docs/PLUGIN-API.md)
- In the app: **`/docs`** (the same guides, snippets filled with the server's origin)

## Verify

```bash
# 1. unit
npm run typecheck && npm run lint && npm test

# 2. end to end with real Agora (fake camera, 6 browsers): second server, dev bypass, own .next and data
NEXT_PUBLIC_HOST_AUTH=false NEXT_PUBLIC_LIVESTREAM_CHANNEL=Live-e2e NEXT_DIST_DIR=.next-e2e LIVESTREAM_DATA_DIR=.data-e2e npx next dev -p 5174
E2E_BASE=http://localhost:5174 npm run e2e

# 3. the plugin on a real host site (e.g. drlive-frontend dev on :3005 with NEXT_PUBLIC_LIVESTREAM_ORIGIN=http://localhost:5174)
SITE=http://localhost:3005 STREAM=http://localhost:5174 START_HOST=1 node e2e/host-site.mjs
```

`npm run e2e` covers:

1. The admin starts a stream (multi host, max 2) and goes live.
2. A guest sees the pill and the header badge, joins, and video plays.
3. The guest reacts, and the host site's sign-in opens.
4. A signed-in viewer chats and reacts.
5. The host and the guest see the message and ❤️ 3.
6. The viewer count updates.
7. A co-host joins, and viewers see 2 tiles.
8. A third host is refused.
9. The co-host can't Stop.
10. The host mutes a viewer: their messages vanish and they can't post.
11. A late joiner gets the history and the totals.
12. `/host` redirects to the console.
13. Stop closes every player.

Screenshots land in `e2e/artifacts/`.

Real Keycloak sign-in has to be checked by hand with a dr / drg account at `http://localhost:5173/host` (`/editor/live-stream` redirects there).

## Before production

- **State is single-instance** (file + in-memory registry, SSE bus). Move `state.ts` / `registry.ts`
  / `bus.ts` to Redis (or the backend) before running more than one instance.
- **Deploy:** an image/env per environment (dev/stage/prod). Use the production Agora project
  (`auction-stream/<env>/agora`).
- **Keycloak:** register each deployed origin's `/host` redirect on the client (or
  create a dedicated client and change `NEXT_PUBLIC_KEYCLOAK_CLIENT_ID`).
- **RTM limits:** RTM is client-side (as chosen). Chat sender ids are trusted, but a signed-in user
  could still send crafted reaction messages. The leader caps each user at 5/s, so the effect is
  bounded. Mutes are enforced by every receiver, not by Agora.

## Scale (thousands of viewers)

- **Plugin status poll:** `GET /api/stream/status` is cacheable for 2 s by a CDN
  (`s-maxage=2, stale-while-revalidate=5`). Put CloudFront in front, and the origin answers about
  once per 2 s however many sites poll. The plugin polls every 5 s while live, 10 s otherwise.
- **Reactions:** each device sends one batch per second (`{ counts: { love: 3 } }`) to the server
  and one chat message to Agora, never one per tap. The server caps each person at 5 per second.
- **Viewer count:** measured once by the leading host (Agora presence) and pushed to everyone in the
  status. Viewers no longer ask Agora themselves.
- **Live feed:** reactions / viewers go out as a small `app-livestream-counts` event at most once
  a second. One hub serialises each event once for all connections.
- **Still single-instance:** state, the feed and rate limits live in one process. Move them to Redis
  before running several instances.

Load test (no browsers, no Agora):

```bash
# a production build with a live stream (start one at /host), then:
BASE=http://localhost:5173 VIEWERS=3000 SITE_VISITORS=3000 REACTORS=500 SECONDS=30 RAMP_SECONDS=15 \
  TICKET_SECRET=<LIVESTREAM_VIEWER_TICKET_SECRET> npm run load
```

Run the load generator from a different machine than the server for real numbers. On one laptop,
the OS connection queue (macOS `somaxconn` 128) and the generator itself become the bottleneck
before the app does.

