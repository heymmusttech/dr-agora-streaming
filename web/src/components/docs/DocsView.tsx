'use client'

/**
 * `/docs`: how to add the live stream to a site or app — Next.js, Flutter, a simple HTML page —
 * plus the plugin reference. Snippets are filled with this server's real origin and copy in one
 * click. The same guides live as markdown in `docs/` (INTEGRATION-NEXTJS / -FLUTTER / -HTML,
 * PLUGIN-API).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { BookOpen, Code2, Globe, Smartphone } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CopyBlock } from './CopyBlock'

type Tab = 'nextjs' | 'flutter' | 'html' | 'reference'

const TABS: Array<{ id: Tab; label: string; icon: typeof Code2 }> = [
  { id: 'nextjs', label: 'Next.js', icon: Code2 },
  { id: 'flutter', label: 'Flutter', icon: Smartphone },
  { id: 'html', label: 'Simple app (HTML)', icon: Globe },
  { id: 'reference', label: 'Reference', icon: BookOpen },
]

export function DocsView() {
  const [origin, setOrigin] = useState('https://live-stream.example.com')
  const [tab, setTab] = useState<Tab>('nextjs')
  useEffect(() => {
    setOrigin(window.location.origin)
    const hash = window.location.hash.slice(1) as Tab
    if (TABS.some((t) => t.id === hash)) setTab(hash)
  }, [])

  const choose = (id: Tab) => {
    setTab(id)
    window.history.replaceState(null, '', `#${id}`)
  }

  return (
    <div className="mx-auto w-full max-w-[960px] space-y-6 pb-8 pt-2">
      <header className="space-y-2">
        <h1 className="font-manrope text-3xl font-semibold tracking-tight text-foreground">Add the live stream</h1>
        <p className="max-w-2xl font-roboto text-sm text-on-surface-variant">
          One stream, every platform. Websites load one script (the plugin: LIVE pill, Join, player with chat and
          reactions). Apps open the same player in a WebView. Your server only tells us who is signed in, with a short-lived
          viewer ticket.
        </p>
      </header>

      <div role="tablist" aria-label="Platform" className="flex flex-wrap gap-1 rounded-xl border border-outline-variant bg-surface-1 p-1">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => choose(id)}
            className={cn(
              'inline-flex h-10 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 font-manrope text-sm font-semibold transition-colors',
              tab === id
                ? 'border border-dr-live-container/60 bg-dr-live-container/15 text-dr-live shadow-sm'
                : 'border border-transparent text-on-surface-variant hover:bg-surface-2 hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

      {tab === 'nextjs' && <NextjsGuide origin={origin} />}
      {tab === 'flutter' && <FlutterGuide origin={origin} />}
      {tab === 'html' && <HtmlGuide origin={origin} />}
      {tab === 'reference' && <Reference />}
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-2xl border border-outline-variant bg-background p-5 shadow-sm md:p-6">
      <h2 className="flex items-center gap-3 font-manrope text-base font-semibold text-foreground">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-dr-live-container font-manrope text-xs font-bold text-white">
          {n}
        </span>
        {title}
      </h2>
      <div className="space-y-3 font-roboto text-sm leading-relaxed text-on-surface-variant [&_code]:rounded [&_code]:bg-surface-2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[12px] [&_code]:text-foreground">
        {children}
      </div>
    </section>
  )
}

/* ───────────────────────── Next.js ───────────────────────── */

function NextjsGuide({ origin }: { origin: string }) {
  const env = `NEXT_PUBLIC_ENABLE_LIVE_STREAM=true
NEXT_PUBLIC_LIVESTREAM_ORIGIN=${origin}
LIVESTREAM_VIEWER_TICKET_SECRET=<same value as the stream server>   # server only, ≥ 32 chars`

  const route = `// app/api/livestream/viewer-ticket/route.ts
import { NextResponse } from 'next/server'
import { SignJWT } from 'jose'
import { getCurrentUser } from '@/lib/auth' // ← your session lookup

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getCurrentUser()
  const secret = process.env.LIVESTREAM_VIEWER_TICKET_SECRET
  if (!user || !secret) return NextResponse.json({ ticket: null }, { headers: { 'Cache-Control': 'no-store' } })

  const ticket = await new SignJWT({ name: \`\${user.firstName} \${user.lastName?.charAt(0) ?? ''}.\` })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('drlive')          // your platform id
    .setSubject(String(user.id))
    .setIssuedAt()
    .setExpirationTime('10m')     // ≤ 15 min
    .sign(new TextEncoder().encode(secret))
  return NextResponse.json({ ticket }, { headers: { 'Cache-Control': 'no-store' } })
}`

  const component = `'use client'
// components/LiveStreamPlugin.tsx — mount once, inside your auth provider (root layout / _app)
import { useEffect, useRef, useState } from 'react'
import Script from 'next/script'
import { useAuth } from '@/hooks/useAuth'               // ← your auth hook
import { openSignInModal } from '@/lib/auth-modal-events' // ← however your site opens login

const ORIGIN = process.env.NEXT_PUBLIC_LIVESTREAM_ORIGIN!
const ENABLED = process.env.NEXT_PUBLIC_ENABLE_LIVE_STREAM === 'true' && Boolean(ORIGIN)

const getViewerTicket = async () => {
  const response = await fetch('/api/livestream/viewer-ticket', { cache: 'no-store' })
  return response.ok ? ((await response.json()) as { ticket: string | null }).ticket : null
}

export function LiveStreamPlugin() {
  const { user, isLoading } = useAuth()
  const [ready, setReady] = useState(false)
  const lastUser = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    if (!ready) return
    const live = window.DprLive!
    live.init({
      origin: ORIGIN,
      platform: 'drlive',
      theme: 'auto', // follows <html data-theme="light|dark">
      getViewerTicket,
      onLoginRequest: () => openSignInModal({ redirectTo: location.pathname + location.search }),
    })
    return () => live.destroy()
  }, [ready])

  // Sign in / sign out → a new ticket, without reloading the player.
  useEffect(() => {
    if (!ready || isLoading) return
    const id = user?.id ?? null
    if (lastUser.current === undefined) return void (lastUser.current = id)
    if (lastUser.current === id) return
    lastUser.current = id
    void window.DprLive?.refreshViewer()
  }, [ready, isLoading, user?.id])

  if (!ENABLED) return null
  return <Script src={\`\${ORIGIN}/plugin/dpr-live.js\`} strategy="lazyOnload" onReady={() => setReady(true)} />
}`

  const csp = `script-src       … ${origin}
script-src-elem  … ${origin}
frame-src        … ${origin}
connect-src      … ${origin}   (only if connect-src has no https:, and always for an http:// dev origin)`

  return (
    <div className="space-y-4">
      <Step n={1} title="Environment">
        <p>
          <code>NEXT_PUBLIC_*</code> values are inlined at build time (Docker: <code>ARG</code> + <code>ENV</code>, CI:{' '}
          <code>--build-arg</code>). Ask us to add your site&apos;s origin to <code>LIVESTREAM_ALLOWED_PARENT_ORIGINS</code>.
        </p>
        <CopyBlock label=".env" lang="env" value={env} code />
      </Step>
      <Step n={2} title="Viewer ticket route (server)">
        <p>Tells the stream who is signed in, without sharing your session. Guests get <code>null</code> (they can still watch).</p>
        <CopyBlock label="Route handler" lang="ts" value={route} code />
      </Step>
      <Step n={3} title="Load the plugin">
        <p>
          The plugin handles everything else: status polling, the LIVE pill, Join, the player, chat, reactions, light / dark,
          expand. Pages Router: same component in <code>_app.tsx</code>.
        </p>
        <CopyBlock label="LiveStreamPlugin.tsx" lang="tsx" value={component} code />
      </Step>
      <Step n={4} title="Content-Security-Policy">
        <p>If your site sends a CSP, allow the stream origin. Viewers never use the camera, so <code>camera=()</code> can stay.</p>
        <CopyBlock label="CSP" lang="txt" value={csp} code />
      </Step>
      <Step n={5} title="Check it">
        <p>
          Start a stream at <a className="text-dr-live underline" href="/host">/host</a>. On your site the LIVE pill appears
          bottom-left → Join → the video plays. Sign in to chat without reloading. drlive-frontend is the worked example
          (<code>components/auctions/shared/LiveStreamPlugin.tsx</code>).
        </p>
      </Step>
    </div>
  )
}

/* ───────────────────────── Flutter ───────────────────────── */

function FlutterGuide({ origin }: { origin: string }) {
  const pubspec = `dependencies:
  http: ^1.2.2
  webview_flutter: ^4.10.0
  webview_flutter_android: ^4.3.0
  webview_flutter_wkwebview: ^3.18.0`

  const status = `final res = await http.get(Uri.parse('${origin}/api/stream/status'));
final status = jsonDecode(res.body) as Map<String, dynamic>;
final isLive = status['isLive'] == true;   // show your LIVE pill while true
final title = status['title'] as String?;`

  const player = `// Join → a screen with the player. theme: follow the app (light / dark).
final controller = WebViewController.fromPlatformCreationParams(
  WebViewPlatform.instance is WebKitWebViewPlatform
      ? WebKitWebViewControllerCreationParams(
          allowsInlineMediaPlayback: true,
          mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{},
        )
      : const PlatformWebViewControllerCreationParams(),
)
  ..setJavaScriptMode(JavaScriptMode.unrestricted)
  ..addJavaScriptChannel('DprLiveNative', onMessageReceived: (m) => onPlayerMessage(m.message))
  ..loadRequest(Uri.parse('${origin}/embed/live?platform=garage&ui=dock&theme=dark'));

Future<void> sendTicket() async {
  final ticket = await myBackend.viewerTicket(); // null when signed out
  await controller.runJavaScript('window.DprLive && window.DprLive.setViewer(\${jsonEncode(ticket)})');
}

Future<void> onPlayerMessage(String raw) async {
  final msg = jsonDecode(raw) as Map<String, dynamic>;
  if (msg['source'] != 'dpr-live') return;
  switch (msg['type']) {
    case 'READY':
    case 'TICKET_EXPIRED':
      await sendTicket();
    case 'LOGIN_REQUEST':          // a guest pressed Sign in / a reaction
      await openMyLogin();
      await sendTicket();
    case 'STATE':                  // { isLive, viewers, title, … }
      break;
  }
}
// Login changed while watching → sendTicket(). Theme changed → runJavaScript("DprLive.setTheme('light')").`

  const ticket = `// Your backend (never the app: the secret would ship in the binary)
import { SignJWT } from 'jose'
const ticket = await new SignJWT({ name: 'Jane D.' })
  .setProtectedHeader({ alg: 'HS256' }).setIssuer('garage').setSubject(String(user.id))
  .setIssuedAt().setExpirationTime('10m')
  .sign(new TextEncoder().encode(process.env.LIVESTREAM_VIEWER_TICKET_SECRET_GARAGE))`

  return (
    <div className="space-y-4">
      <Step n={1} title="Packages">
        <CopyBlock label="pubspec.yaml" lang="yaml" value={pubspec} code />
      </Step>
      <Step n={2} title="Is a stream live?">
        <p>Poll every ~10 s while your screen is visible; nothing connects to the video before Join.</p>
        <CopyBlock label="Status" lang="dart" value={status} code />
      </Step>
      <Step n={3} title="The player screen">
        <p>
          The same player the web plugin uses (video, ❤️ 👍 😄, chat). It talks to your app through the{' '}
          <code>DprLiveNative</code> JS channel.
        </p>
        <CopyBlock label="Player + bridge" lang="dart" value={player} code />
      </Step>
      <Step n={4} title="Viewer ticket (your backend)">
        <CopyBlock label="Backend" lang="ts" value={ticket} code />
      </Step>
      <Step n={5} title="Platform settings and the sample app">
        <p>
          iOS: <code>allowsInlineMediaPlayback</code>, no user action for media. Android: <code>INTERNET</code>,{' '}
          <code>setMediaPlaybackRequiresUserGesture(false)</code>. Use an https origin in production.
        </p>
        <p>
          A complete, runnable sample is in <code>dpr-livestreaming/flutter</code> (<code>./tool/setup.sh</code>, then{' '}
          <code>flutter run --dart-define=LIVESTREAM_ORIGIN={origin}</code>).
        </p>
      </Step>
    </div>
  )
}

/* ───────────────────────── Simple HTML ───────────────────────── */

function HtmlGuide({ origin }: { origin: string }) {
  const zero = `<!-- Anywhere in your page (before </body>) — no code needed -->
<script
  src="${origin}/plugin/dpr-live.js" async
  data-auto-init
  data-platform="partner"
  data-ticket-url="/api/livestream/viewer-ticket"
  data-login-url="/login"
  data-theme="auto"></script>`

  const manual = `<script src="${origin}/plugin/dpr-live.js" async></script>
<script>
  window.addEventListener('dpr-live:loaded', function () {
    DprLive.init({
      origin: '${origin}',
      platform: 'partner',
      theme: 'auto',            // or 'light' / 'dark'
      getViewerTicket: function () {
        return fetch('/api/livestream/viewer-ticket', { credentials: 'include' })
          .then(function (r) { return r.json() })
          .then(function (b) { return b.ticket })
      },
      onLoginRequest: function () { window.location.href = '/login' },
    })
    // Optional: a LIVE badge in your header
    DprLive.mountBadge(document.getElementById('live-badge'))
  })

  // After your own sign-in / sign-out:
  //   DprLive.refreshViewer()
</script>`

  const endpoint = `GET /api/livestream/viewer-ticket   (same origin as your page, with its cookies)
→ 200 { "ticket": "<HS256 JWT: iss, sub, name, iat, exp ≤ 15 min>" }   signed in
→ 200 { "ticket": null }                                               guest`

  return (
    <div className="space-y-4">
      <Step n={1} title="Zero-code: one script tag">
        <p>
          The plugin polls the status, shows the LIVE pill and opens the player on Join. <code>data-ticket-url</code> is
          fetched with your cookies; <code>data-login-url</code> gets <code>?returnTo=</code> added.
        </p>
        <CopyBlock label="index.html" lang="html" value={zero} code />
      </Step>
      <Step n={2} title="Or: init yourself (login in a modal, header badge, events)">
        <CopyBlock label="index.html" lang="html" value={manual} code />
      </Step>
      <Step n={3} title="The ticket endpoint (your server)">
        <p>Any backend language: sign an HS256 JWT with the secret you share with us (see the Next.js tab for an example).</p>
        <CopyBlock label="Contract" lang="http" value={endpoint} code />
      </Step>
      <Step n={4} title="Try it">
        <p>
          <a className="text-dr-live underline" href="/sandbox/partner.html" target="_blank" rel="noreferrer">
            Plugin preview
          </a>{' '}
          is a plain page using exactly this, with a local sign-in. Viewer page for links:{' '}
          <code>{origin}/embed/live</code>.
        </p>
      </Step>
    </div>
  )
}

/* ───────────────────────── Reference ───────────────────────── */

function Reference() {
  const rows: Array<[string, string]> = [
    ['DprLive.init(options)', 'origin, platform, theme (auto | light | dark), getViewerTicket, onLoginRequest, position, autoOpen, pollMs, container, headless'],
    ['DprLive.setViewer(ticket | null)', 'The login changed: chat and reactions unlock / lock without a reload'],
    ['DprLive.refreshViewer()', 'Calls getViewerTicket again'],
    ['DprLive.setTheme(theme)', 'auto follows <html data-theme> / a dark class / the OS; light or dark force one'],
    ['DprLive.open() · close() · minimize() · restore()', 'Dock control (open = Join)'],
    ['DprLive.expand(true | false)', 'Enlarge in the page: stream + chat side by side (Esc collapses)'],
    ['DprLive.mute(bool) · setVolume(0–100)', 'Player audio'],
    ['DprLive.mountBadge(element)', 'A LIVE badge (Join button) while live'],
    ['DprLive.on(event, cb)', 'status · live · offline · open · close · ready · state · login-request (also window "dpr-live:<event>")'],
  ]
  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-2xl border border-outline-variant bg-background shadow-sm">
        <table className="w-full text-left font-roboto text-sm">
          <thead className="bg-surface-1 font-manrope text-xs uppercase tracking-wider text-on-surface-variant">
            <tr>
              <th className="px-4 py-3">Plugin API</th>
              <th className="px-4 py-3">What it does</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([api, what]) => (
              <tr key={api} className="border-t border-outline-variant align-top">
                <td className="whitespace-nowrap px-4 py-3 font-mono text-[12px] text-foreground">{api}</td>
                <td className="px-4 py-3 text-on-surface-variant">{what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <Step n={1} title="Viewer ticket">
        <p>
          HS256 JWT signed by your server: <code>{'{ iss: "<platform>", sub: "<user id>", name, iat, exp }'}</code>,{' '}
          <code>exp − iat ≤ 15 min</code>. No email (the name shows in a public chat). Expired or forged tickets are treated
          as guests, and the plugin asks for a new one.
        </p>
      </Step>
      <Step n={2} title="Player messages (web postMessage and the app JS channel)">
        <p>
          To the player: <code>VIEWER_TICKET</code>, <code>THEME</code>, <code>MUTE</code>, <code>UNMUTE</code>,{' '}
          <code>SET_VOLUME</code>, <code>GET_STATUS</code>. From the player: <code>READY</code>, <code>STATE</code>,{' '}
          <code>LOGIN_REQUEST</code>, <code>TICKET_EXPIRED</code>, <code>CLOSE_REQUEST</code>. Every message has{' '}
          <code>source: &quot;dpr-live&quot;</code>.
        </p>
      </Step>
      <Step n={3} title="Counts">
        <p>
          Reactions are counted by the stream server (at most 5 per person per second) and pushed to every screen; a click
          shows at once and is confirmed by the real total. Viewers are counted per stream session, signed-in and guests,
          hosts excluded.
        </p>
      </Step>
    </div>
  )
}
