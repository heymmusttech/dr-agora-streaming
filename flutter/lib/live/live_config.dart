/// Where dpr-livestreaming runs. Set at build time:
///   flutter run --dart-define=LIVESTREAM_ORIGIN=http://192.168.1.174:5173
///
/// iOS simulator: `http://localhost:5173` works. Android emulator: the host machine is
/// `http://10.0.2.2:5173`. A real phone: the computer's LAN address (or an https origin).
const String liveStreamOrigin = String.fromEnvironment(
  'LIVESTREAM_ORIGIN',
  defaultValue: 'http://localhost:5173',
);

/// `iss` of this app's viewer tickets; the stream server checks it (and its secret).
const String liveStreamPlatform = 'garage';

/// The player page for apps. `ui=dock`: the app's own bar shows LIVE and the title, so the player
/// doesn't repeat them (same as the web plugin's dock). `theme`: the app's light / dark mode.
Uri playerUri({bool dark = true}) => Uri.parse('$liveStreamOrigin/embed/live').replace(
      queryParameters: {'platform': liveStreamPlatform, 'ui': 'dock', 'theme': dark ? 'dark' : 'light'},
    );

Uri statusUri() => Uri.parse('$liveStreamOrigin/api/stream/status');
