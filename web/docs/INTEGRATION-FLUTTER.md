# Add the live stream to a Flutter app (dR Garage)

> A runnable sample of everything below is in [`dpr-livestreaming/flutter`](../../flutter/README.md).

A mobile app doesn't run the web plugin. It opens the **player** (`/embed/live`) in a WebView and
talks to it through a JavaScript channel. The player is the same one the plugin uses: video, ❤️ 👍 😄,
live chat, viewer count. On a phone it uses the split layout, with video on top and chat below.

```
Flutter app ── GET /api/stream/status ─────────────────────────► show a LIVE entry point
            ── WebView: {origin}/embed/live?platform=garage ───► player
               ◄── DprLiveNative.postMessage(JSON) ── READY / STATE / LOGIN_REQUEST / TICKET_EXPIRED
               ──► runJavaScript("DprLive.setViewer('<ticket>')")   after login / logout / expiry
Garage backend ── signs the viewer ticket (iss "garage") ──► app
```

## 1. Stream server config

The ticket secret for Garage can be shared or separate:

- Shared: `LIVESTREAM_VIEWER_TICKET_SECRET`.
- Separate: set `LIVESTREAM_VIEWER_TICKET_SECRET_GARAGE`. Tickets with `iss: "garage"` are then
  verified with that secret.

No origin allow-list is needed for the WebView. It loads the page top-level, not in a frame.

## 2. Garage backend: sign the viewer ticket

Add an endpoint for signed-in app users, e.g. `GET /live/viewer-ticket` → `{ "ticket": "…" }`. Its
claims are HS256 `{ iss: "garage", sub: <user id>, name: "Jane D.", iat, exp ≤ 15 min }`. Never sign
the ticket in the app itself: the secret would ship inside the binary.

Node / NestJS:

```ts
import { SignJWT } from 'jose'
const ticket = await new SignJWT({ name: `${user.firstName} ${user.lastName[0]}.` })
  .setProtectedHeader({ alg: 'HS256' }).setIssuer('garage').setSubject(String(user.id))
  .setIssuedAt().setExpirationTime('10m')
  .sign(new TextEncoder().encode(process.env.LIVESTREAM_VIEWER_TICKET_SECRET_GARAGE))
```

Dart backend (`dart_jsonwebtoken`):

```dart
final jwt = JWT({'name': 'Jane D.'}, issuer: 'garage', subject: user.id);
final ticket = jwt.sign(SecretKey(secret), algorithm: JWTAlgorithm.HS256, expiresIn: const Duration(minutes: 10));
```

`dart_jsonwebtoken` adds `iat` by default, and the stream server requires it.

## 3. App: is a stream live?

Poll the public status, e.g. every 10 s while the home screen is visible, and show a LIVE pill or
banner while `isLive` is true:

```dart
final res = await http.get(Uri.parse('$streamOrigin/api/stream/status'));
final status = jsonDecode(res.body) as Map<String, dynamic>;
final isLive = status['isLive'] == true;
final title = status['title'] as String?;
```

## 4. App: the player screen

`pubspec.yaml`: `webview_flutter: ^4.10.0` (plus `webview_flutter_wkwebview` /
`webview_flutter_android` for the platform settings below).

```dart
import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

class LiveStreamScreen extends StatefulWidget {
  const LiveStreamScreen({super.key, required this.streamOrigin, required this.getTicket, required this.openLogin});
  final String streamOrigin;                       // e.g. https://live-stream.dupontregistry.com
  final Future<String?> Function() getTicket;      // calls the Garage backend; null when signed out
  final Future<void> Function() openLogin;         // your app's login flow
  @override
  State<LiveStreamScreen> createState() => _LiveStreamScreenState();
}

class _LiveStreamScreenState extends State<LiveStreamScreen> {
  late final WebViewController _controller;
  int _viewers = 0;

  @override
  void initState() {
    super.initState();
    final params = WebViewPlatform.instance is WebKitWebViewPlatform
        ? WebKitWebViewControllerCreationParams(
            allowsInlineMediaPlayback: true,                 // iOS: play inside the page
            mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{}, // autoplay (starts muted)
          )
        : const PlatformWebViewControllerCreationParams();
    _controller = WebViewController.fromPlatformCreationParams(params)
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.black)
      ..addJavaScriptChannel('DprLiveNative', onMessageReceived: (m) => _onPlayerMessage(m.message))
      ..loadRequest(Uri.parse('${widget.streamOrigin}/embed/live?platform=garage'));
    if (_controller.platform is AndroidWebViewController) {
      (_controller.platform as AndroidWebViewController).setMediaPlaybackRequiresUserGesture(false);
    }
  }

  Future<void> _sendTicket() async {
    final ticket = await widget.getTicket();
    // jsonEncode quotes and escapes the value (or writes null).
    await _controller.runJavaScript('window.DprLive && window.DprLive.setViewer(${jsonEncode(ticket)})');
  }

  Future<void> _onPlayerMessage(String raw) async {
    final msg = jsonDecode(raw) as Map<String, dynamic>;
    if (msg['source'] != 'dpr-live') return;
    switch (msg['type']) {
      case 'READY':            // player mounted: tell it who is signed in
      case 'TICKET_EXPIRED':   // ticket too old: send a fresh one
        await _sendTicket();
        break;
      case 'LOGIN_REQUEST':    // guest pressed Sign in / a reaction / the chat box
        await widget.openLogin();
        await _sendTicket();   // after login (or cancel) → ticket or null
        break;
      case 'STATE':
        final state = msg['state'] as Map<String, dynamic>;
        setState(() => _viewers = (state['viewers'] as num?)?.toInt() ?? 0);
        if (state['isLive'] == false) { /* stream ended: pop or show "ended" */ }
        break;
      case 'CLOSE_REQUEST':
        if (mounted) Navigator.of(context).maybePop();
        break;
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        backgroundColor: Colors.black,
        appBar: AppBar(backgroundColor: Colors.black, foregroundColor: Colors.white, title: Text('Live · $_viewers watching')),
        body: SafeArea(child: WebViewWidget(controller: _controller)),
      );
}
```

**When the app's login changes while the player is open** (sign-out from a menu, token refresh),
call `_sendTicket()` again. The player reconnects the chat with the new identity, or as a guest.

Other commands you can send with `runJavaScript`:

- `DprLive.mute()` / `DprLive.unmute()`
- `DprLive.setVolume(80)`
- `DprLive.getState()`, which returns the same `STATE` object.

## 5. Platform settings

| | |
|---|---|
| iOS | `allowsInlineMediaPlayback: true` (or the video goes fullscreen), no user action for media. The player never uses the camera, so no `NSCameraUsageDescription` is needed. |
| Android | `android:hardwareAccelerated="true"` (the default), `INTERNET` permission, `setMediaPlaybackRequiresUserGesture(false)` |
| Both | HTTPS origin in production (Agora needs a secure context). In dev, use a LAN HTTPS origin (`npm run dev:https` in dpr-livestreaming) or allow cleartext only for debug builds. |

## 6. Test it

1. Start a stream at `{origin}/host` (Preview camera → Start stream).
2. Open `LiveStreamScreen` as a guest: the video plays and you can read the chat.
   - Tapping ❤️ or "Sign in to chat" sends `LOGIN_REQUEST` and opens your login.
3. After login, the ticket goes to the player: the chat box unlocks, and your messages and reactions
   reach the host console (`/host`: chat column and the stage reactions).
4. Ask the host to mute you: the player shows "The host muted you in this chat."
