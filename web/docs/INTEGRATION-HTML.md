# Add the live stream to a simple website (plain HTML)

No framework needed: one script tag. The plugin polls the stream status, shows the LIVE pill,
opens the player (video, ❤️ 👍 😄, chat) on Join, follows your page's light / dark theme, and expands
in the page. Your server only answers one question, "who is signed in?", with a viewer ticket.

The same guide, with snippets filled with the real stream origin, is at `{stream-origin}/docs#html`.

## 1. Zero code

```html
<script
  src="https://<stream-origin>/plugin/dpr-live.js" async
  data-auto-init
  data-platform="partner"
  data-ticket-url="/api/livestream/viewer-ticket"
  data-login-url="/login"
  data-theme="auto"></script>
```

- `data-ticket-url` is fetched with your cookies and must answer `{ "ticket": "…" }`, or
  `{ "ticket": null }` for guests.
- `data-login-url` gets `?returnTo=<current page>` added when a guest presses Sign in in the player.
- `data-theme`: `auto` (default) follows `<html data-theme="light|dark">`, else a `dark` class on
  `<html>`, else the OS. `light` / `dark` force one.

## 2. Or init it yourself

```html
<script src="https://<stream-origin>/plugin/dpr-live.js" async></script>
<script>
  window.addEventListener('dpr-live:loaded', function () {
    DprLive.init({
      platform: 'partner',
      theme: 'auto',
      getViewerTicket: function () {
        return fetch('/api/livestream/viewer-ticket', { credentials: 'include' })
          .then(function (r) { return r.json() })
          .then(function (b) { return b.ticket })
      },
      onLoginRequest: function () { openMyLoginModal() },
    })
    DprLive.mountBadge(document.getElementById('live-badge')) // optional header badge
  })
  // After your own sign-in / sign-out: DprLive.refreshViewer()
</script>
```

## 3. The ticket endpoint (any backend)

The ticket is HS256, signed with the secret you share with the stream server. Claims:
`{ iss: "<platform>", sub: "<user id>", name: "Jane D.", iat, exp }`, with `exp − iat ≤ 15 min`.
Never put the email in it. See [INTEGRATION-NEXTJS.md](INTEGRATION-NEXTJS.md) for a Node example.

## 4. CSP (if your site sends one)

Add the stream origin to `script-src`, `script-src-elem` and `frame-src`. Add it to `connect-src` too
if that directive has no `https:`.

Try it in the host console: **Plugin preview** (`/host`) opens a plain partner page (`/sandbox/partner.html`) that does exactly this.
