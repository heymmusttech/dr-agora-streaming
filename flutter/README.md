# dpr_live_garage — Flutter sample

A minimal dR Garage-style app: a blank page with the duPont REGISTRY Live integration, working
like the plugin on drlive-frontend:

| Web (drlive-frontend) | This app |
|---|---|
| `dpr-live.js` polls `/api/stream/status` | `LiveStatusController` polls the same endpoint (every 5 s, foreground only) |
| LIVE pill · Join live · ✕ (hidden for the session) | `LivePill`, same pattern and colours |
| Join → dock iframe `/embed/live?ui=dock` | Join → `LivePlayerScreen`, a WebView of `/embed/live?platform=garage&ui=dock` |
| postMessage bridge | `DprLiveNative` JS channel ⇄ `window.DprLive.setViewer(ticket)` |
| `onLoginRequest` → `openSignInModal()` | `LOGIN_REQUEST` → the app's sign-in dialog, then a new ticket |
| `getViewerTicket` → drlive BFF route | `AppAuth.viewerTicket()` — see "Tickets" below |
| login changes → `refreshViewer()` | `AppAuth` listener → `setViewer` again, without reloading the player |

Video, reactions, chat, viewer count and moderation all happen inside the player page, the same one
the web plugin uses, so behaviour matches across platforms.

## Run it locally

### 0. Once: tools

| For | Install |
|---|---|
| Flutter | `brew install --cask flutter` (if Avast / Malwarebytes delete `dart` / `dartvm`, allow-list `/opt/homebrew/share/flutter`, then `brew reinstall --cask flutter`) |
| iOS simulator | Xcode from the App Store, then `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`, `sudo xcodebuild -runFirstLaunch`, `brew install cocoapods` |
| Android emulator | Android Studio → SDK Manager (SDK + command-line tools) → Device Manager (create a Pixel emulator), then `flutter doctor --android-licenses` |

`flutter doctor` should show ✓ for the platform you want.

### 1. Start the stream server

```bash
cd ../web
npm run dev                        # http://localhost:5173
```

Open `http://localhost:5173/host`, press **Preview camera** → **Start stream**. The app shows the
LIVE pill while a stream is live. The sample's sign-in uses the dev-only ticket endpoint, so the
server must run in dev mode (`npm run dev`), not `npm start`.

### 2. Prepare the app (once, and after pulling changes)

```bash
cd dpr-livestreaming/flutter
./tool/setup.sh                    # generates ios/ + android/, network settings, flutter pub get
flutter analyze                    # → No issues found
flutter test                       # → All tests passed
```

### 3. Run it

```bash
flutter devices                    # pick the device id

# iOS simulator (start one first: open -a Simulator)
flutter run -d ios --dart-define=LIVESTREAM_ORIGIN=http://localhost:5173

# Android emulator (the computer is 10.0.2.2 from inside the emulator)
flutter run -d emulator-5554 --dart-define=LIVESTREAM_ORIGIN=http://10.0.2.2:5173

# A real phone on the same Wi-Fi: use the computer's LAN address and https (camera-free viewing
# works on http too, but Agora prefers a secure context)
cd ../web && npm run dev:https     # https://<LAN-IP>:5173
flutter run -d <phone-id> --dart-define=LIVESTREAM_ORIGIN=https://192.168.1.174:5173
```

Find your LAN address with `ipconfig getifaddr en0`. On a real phone the dev certificate is
self-signed: open the URL once in the phone's browser and accept it.

### 4. Try it

1. Blank page → when the stream is live, the **LIVE pill** appears at the bottom → **Join live**.
2. The player opens: video, ❤️ 👍 😄, chat. As a guest, tap a reaction → the app's **Sign in** dialog.
3. Sign in with any name → chat and reactions unlock without reloading; your message shows in
   `/host`'s chat column, your reaction animates on the host's stage.
4. Sign out from the app bar while watching → back to guest.
5. Switch the phone to dark / light mode → the player follows.
6. End the stream in `/host` → the app bar says "Stream ended" and the pill disappears.

### Troubleshooting

| Symptom | Fix |
|---|---|
| No pill | Is a stream live? Is `LIVESTREAM_ORIGIN` reachable from the device (open `<origin>/api/stream/status` in its browser)? |
| Sign in does nothing to the chat | The server must be `npm run dev` (dev ticket endpoint) and `LIVESTREAM_VIEWER_TICKET_SECRET` set in `web/.env.local`. |
| Black video on iOS | `allowsInlineMediaPlayback` is set in code; check the stream has a camera on air in `/host`. |
| `Cleartext HTTP not permitted` (Android) | Re-run `./tool/setup.sh` (adds `usesCleartextTraffic` for dev). |

## Tickets

In production, dR Garage's **backend** signs the viewer ticket (HS256, `iss: "garage"`, ≤ 15 min)
with the secret it shares with dpr-livestreaming (`LIVESTREAM_VIEWER_TICKET_SECRET`, or
`LIVESTREAM_VIEWER_TICKET_SECRET_GARAGE`). Examples are in `../web/docs/INTEGRATION-FLUTTER.md`.

So that this sample runs without a Garage server, `AppAuth.viewerTicket()` asks dpr-livestreaming's
**dev-only** `/api/dev/viewer-ticket` instead. That endpoint is off in production builds, and it
signs with the shared secret. If you set `LIVESTREAM_VIEWER_TICKET_SECRET_GARAGE`, it won't match, so
leave that unset for local testing. Replace this one method with a call to your backend.

## Files

- `lib/main.dart`: the blank page, sign-in / sign-out, the LIVE pill.
- `lib/live/live_status.dart`: the status poller.
- `lib/live/live_player_screen.dart`: the WebView player and the native bridge.
- `lib/live/live_pill.dart`: the pill.
- `lib/live/live_config.dart`: `LIVESTREAM_ORIGIN` and the player URL.
- `lib/auth/app_auth.dart`: the stand-in sign-in and the viewer ticket.
- `tool/setup.sh`: generates the platform folders and patches the Android manifest / iOS Info.plist.
