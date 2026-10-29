#!/usr/bin/env bash
# Generates the iOS / Android projects for this sample (lib/, test/ and pubspec are kept) and
# applies the settings the WebView player needs. Safe to run again.
#   cd flutter && ./tool/setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

command -v flutter >/dev/null || { echo "flutter not found — install it first (see README.md)"; exit 1; }

flutter create --project-name dpr_live_garage --org com.dupontregistry --platforms=ios,android . >/dev/null
flutter pub get

# Android: network access, and plain http to the dev server (localhost / LAN). Remove
# usesCleartextTraffic for production (https origin).
MANIFEST=android/app/src/main/AndroidManifest.xml
grep -q 'android.permission.INTERNET' "$MANIFEST" ||
  sed -i.bak 's#<application#<uses-permission android:name="android.permission.INTERNET"/>\n    <application#' "$MANIFEST"
grep -q 'usesCleartextTraffic' "$MANIFEST" ||
  sed -i.bak 's#<application#<application android:usesCleartextTraffic="true"#' "$MANIFEST"
rm -f "$MANIFEST.bak"

# iOS: allow the http dev server (use an https origin in production instead).
PLIST=ios/Runner/Info.plist
/usr/libexec/PlistBuddy -c 'Print :NSAppTransportSecurity' "$PLIST" >/dev/null 2>&1 ||
  plutil -insert NSAppTransportSecurity -json '{"NSAllowsArbitraryLoads":true,"NSAllowsLocalNetworking":true}' "$PLIST"

echo "Ready. Run, e.g.:"
echo "  flutter run --dart-define=LIVESTREAM_ORIGIN=http://localhost:5173        # iOS simulator"
echo "  flutter run --dart-define=LIVESTREAM_ORIGIN=http://10.0.2.2:5173         # Android emulator"
echo "  flutter run --dart-define=LIVESTREAM_ORIGIN=http://<your-LAN-IP>:5173     # real phone"
