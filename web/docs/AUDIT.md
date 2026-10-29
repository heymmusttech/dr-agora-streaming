# Audit: the two prototypes, and what dpr-livestreaming does about each finding

Audited on 2026-10-28:

1. **App-wide demo**: `dr-auction-streamt/plan-and-architacture-implementation/app-wide/app` (Next 15).
2. **auction-stream**: `auction-stream` (Vite SPA + token Lambda + Pulumi, deployed as stream.dupontregistry.com).

## Requirements (Slack, Antoine Tessier) → where they are met

| # | Requirement | Answer | dpr-livestreaming |
|---|---|---|---|
| 1 | Host, viewers on dR Live FE first, then dR Garage | Yes | The plugin on drlive-frontend (wired), and the WebView player for Garage ([INTEGRATION-FLUTTER.md](INTEGRATION-FLUTTER.md)) |
| 2 | Host logs in with Keycloak, dr / drg emails only; viewers use dR Live auth to chat and react | Yes | Keycloak (realm `mrkt`, client `auction-stream`) is verified server-side, with `azp`, `email_verified` and domain checks. Viewers get a ticket signed by drlive-frontend from its session. |
| 3 | Multi host in the same stream, Agora splits the screen | Yes | Single or multi mode, with 2–4 cameras chosen at Start. One tile per host, labelled with the host's name. The limit is enforced on the server. |
| 4 | Streams in parallel? | No | One channel (`Live`), one record |
| 5 | Chat | Yes | RTM chat: history of the last 50 messages, host delete and mute |
| — | Reactions (love, like, smile) with real data | Requested | Host-counted totals, live for everyone and saved per session |
| — | One host page | Requested | `/host`: admin and co-host on one Keycloak-protected page (`/editor/live-stream` redirects there). |

## Findings, prototype (1): the app-wide demo

| Finding | Fix |
|---|---|
| No auth anywhere. Start, Stop, handover and presence were open, and the console showed a hard-coded "demo editor" chip. | Every host route calls `requireHost()` (Keycloak bearer token, verified with JWKS). The console sits behind `HostGate`. |
| `/api/token` issued **publisher** tokens to anyone, for any `auction-*` channel | `/api/token/host` needs Keycloak, a live stream and a free slot. The token is bound to the host's uid. Viewers only get subscriber tokens. |
| The host role came from the request body. Presence used CORS `*`, so anyone could fake or stop hosts. | The server decides the role (admin = who pressed Start), keyed by Keycloak subject. Presence needs auth. |
| `hostMode` and "only while live" were enforced in the UI only | Enforced on token issue and on heartbeat (409). Switching to single mode takes co-hosts off air. |
| State was in memory only and lost on restart | Persisted to `.data/stream.json`. Admin grace and handover timers moved to `globalThis`, where they were module variables before. |
| The widget loaded `/embed/{auctionId}`, which doesn't exist (404). `hostUrl: '/host'` pointed nowhere. | A new plugin loads `/embed/live`. `/host` is the console. |
| No chat, no reactions, no viewer count | Added (RTM) |
| Hard-coded demo values: `startedBy: 'editor-demo'`, demo title, default host mode `multi` | `startedBy` is the real host. The default title is neutral. The default mode is `single`. |
| `.env.local` and `.env.example` used different Agora App IDs | Documented. Dev uses `5febe019…` (it has a certificate); prod uses `677d4dd9…`. |

**Kept from (1):** the UI/UX and design system (tailwind tokens, fonts, `components/ui`), the
editor layout (status band, steps, tabs, `ConfirmDialog`), `BroadcastPanel`, `LiveStreamPlayer`
(tiles, 9:16, unmute, fullscreen), `agora.ts` (sessions, grace, stats), `camera-lock.ts`, the SSE
`live-store`, and the dock's pill → player → minimised pattern (now inside the plugin).

## Findings, prototype (2): auction-stream

| Finding | Fix |
|---|---|
| Pulumi never sets `KEYCLOAK_ISSUER` on the Lambda, so SSO probably can't verify and only `x-stream-key` works. Function URL CORS lacks `x-idp-token`. | The issuer is derived from the Keycloak env and verified in-app. There is no stream-key path. |
| Any realm token with a matching email can host: no `aud`/`azp` or `email_verified` check, and it falls back to `preferred_username` / `username` | `checkHostClaims`: `azp`/`aud` must be our client, `email_verified` must be true, and only the `email` claim counts. Unit-tested, including the look-alike domain `evildupontregistry.com`. |
| Function URL had `authorizationType: NONE`. Subscriber and RTM tokens were free for any channel or uid, with no rate limit. | One channel only. Viewer and host token routes are rate-limited. RTM ids are chosen by the server. |
| Reaction counts could be faked: an uncapped `count`, max-merge sync, and any peer could reset the session | Only one host (the leader) counts reactions, capped at 5/s per user. Viewers display the leader's totals. Sync is the server-saved snapshot, which only hosts may write. |
| The stream key was accepted from the URL and kept in localStorage, compared with `===`. 500 errors leaked `err.message`. | No stream key. Errors are mapped to codes and messages. |
| The Vite dev plugin signed publisher tokens for anyone on the LAN | Tokens are always behind the same auth, dev included. The bypass is an explicit flag that production ignores. |
| postMessage allowed `null` origins and localhost in production, and sent with `'*'`. The widget didn't check `event.origin`. It rejected `*.dra.tools` parents. | Exact origin + `event.source` checks on both sides, using an env allow-list (`*.dupontregistry.com`, `*.dra.tools`, localhost in dev). |
| The host never renewed its RTC token (drops after about 1 h). RTM tokens were never renewed. | Both renew on `*-will-expire`. |
| Multiple hosts stacked in one element: one remote track was kept and the last one won | One tile per host |
| Reactions were counted twice (RTM batch + data stream, no shared id). The viewer count could freeze. Hosts counted as viewers. | One transport (RTM). Presence counts non-`host_` ids. |
| README and infra drift (regions, scripts, ports); leftover `main.ts`; Tailwind loaded from CDN | n/a, because it's a new app. auction-stream itself was **not changed**. |

**Kept from (2):** the Keycloak realm and client, and the dr/drg domain rule, so hosts sign in
exactly as on stream.dupontregistry.com `/host`. Also kept: the `Live` channel, the heart / like /
smile reaction set and floating particles, and the RTM presence viewer count.

## Remaining risks

- **Client-side RTM** (the chosen option): message senders are trusted. A signed-in user can still
  send reaction messages outside the UI. The leader caps each user at 5/s, so the effect is bounded.
  Mutes are enforced by every client, not by Agora. A server-side relay would close both gaps.
- **Single instance:** move the record, the camera registry and the SSE bus to Redis before scaling out.
- **Keycloak redirect URIs:** the dev client accepts `localhost:5173/*` and `:3000/*`. Each deployed
  origin must be registered.
- **dprauctions-be is unchanged.** The legacy `livestream_url` setting (dprauctions-fe's PiP) is not
  driven by this app.
