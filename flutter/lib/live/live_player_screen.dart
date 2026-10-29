import 'dart:async';
import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:webview_flutter/webview_flutter.dart';
import 'package:webview_flutter_android/webview_flutter_android.dart';
import 'package:webview_flutter_wkwebview/webview_flutter_wkwebview.dart';

import '../auth/app_auth.dart';
import 'live_config.dart';

/// The player: dpr-livestreaming's `/embed/live` in a WebView (video, reactions, chat), plus the
/// native side of its bridge (`DprLiveNative` JS channel ⇄ `window.DprLive.*`):
///
///   player → app   READY · TICKET_EXPIRED → send a viewer ticket
///                  LOGIN_REQUEST          → open the app's sign-in, then send the ticket
///                  STATE {viewers, isLive…} · CLOSE_REQUEST
///   app → player   DprLive.setViewer(ticket | null)  (also whenever the app's login changes)
class LivePlayerScreen extends StatefulWidget {
  const LivePlayerScreen({super.key, required this.auth, required this.title, required this.openSignIn});

  final AppAuth auth;
  final String? title;

  /// The app's own sign-in flow (same idea as drlive-frontend's `openSignInModal`).
  final Future<void> Function() openSignIn;

  @override
  State<LivePlayerScreen> createState() => _LivePlayerScreenState();
}

class _LivePlayerScreenState extends State<LivePlayerScreen> {
  late final WebViewController _controller;
  bool _ready = false;
  bool _ended = false;
  String? _title;
  Brightness? _brightness;

  @override
  void initState() {
    super.initState();
    _title = widget.title;

    final params = WebViewPlatform.instance is WebKitWebViewPlatform
        ? WebKitWebViewControllerCreationParams(
            allowsInlineMediaPlayback: true, // iOS: play inside the page, not fullscreen
            mediaTypesRequiringUserAction: const <PlaybackMediaTypes>{}, // autoplay (starts muted)
          )
        : const PlatformWebViewControllerCreationParams();

    _controller = WebViewController.fromPlatformCreationParams(params)
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.black)
      ..addJavaScriptChannel('DprLiveNative', onMessageReceived: (message) => unawaited(_onPlayerMessage(message.message)))
      ..loadRequest(playerUri(dark: WidgetsBinding.instance.platformDispatcher.platformBrightness == Brightness.dark));

    final platform = _controller.platform;
    if (platform is AndroidWebViewController) platform.setMediaPlaybackRequiresUserGesture(false);

    // Login state is dynamic: signing in or out while watching re-sends the ticket.
    widget.auth.addListener(_onAuthChanged);
  }

  @override
  void dispose() {
    widget.auth.removeListener(_onAuthChanged);
    super.dispose();
  }

  /// The player follows the app's light / dark mode, live (like the web plugin's `theme: 'auto'`).
  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    final brightness = MediaQuery.platformBrightnessOf(context);
    if (brightness == _brightness) return;
    _brightness = brightness;
    if (_ready) unawaited(_sendTheme());
  }

  Future<void> _sendTheme() => _controller.runJavaScript(
        "window.DprLive && window.DprLive.setTheme('${_brightness == Brightness.light ? 'light' : 'dark'}')",
      );

  void _onAuthChanged() {
    if (_ready) unawaited(_sendTicket());
  }

  Future<void> _sendTicket() async {
    final ticket = await widget.auth.viewerTicket();
    if (!mounted) return;
    // jsonEncode quotes and escapes the value (or writes null).
    await _controller.runJavaScript('window.DprLive && window.DprLive.setViewer(${jsonEncode(ticket)})');
  }

  Future<void> _onPlayerMessage(String raw) async {
    final Map<String, dynamic> message;
    try {
      message = jsonDecode(raw) as Map<String, dynamic>;
    } catch (_) {
      return;
    }
    if (message['source'] != 'dpr-live') return;
    switch (message['type']) {
      case 'READY': // the player mounted: tell it who is signed in, and the theme
        _ready = true;
        await _sendTheme();
        await _sendTicket();
      case 'TICKET_EXPIRED': // ticket too old / rejected: send a fresh one
        await _sendTicket();
      case 'LOGIN_REQUEST': // a guest pressed Sign in, a reaction or the chat box
        await widget.openSignIn();
        await _sendTicket(); // after sign-in (or cancel) → ticket or null
      case 'STATE':
        final state = (message['state'] as Map?)?.cast<String, dynamic>() ?? const {};
        if (!mounted) return;
        setState(() {
          _title = (state['title'] as String?) ?? _title;
          _ended = state['isLive'] == false;
        });
      case 'CLOSE_REQUEST':
        if (mounted) Navigator.of(context).maybePop();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        titleSpacing: 0,
        title: Row(
          children: [
            if (!_ended) const _LiveChip(),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                _ended ? 'Stream ended' : (_title ?? 'Live stream'),
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      ),
      body: SafeArea(top: false, child: WebViewWidget(controller: _controller)),
    );
  }
}

class _LiveChip extends StatelessWidget {
  const _LiveChip();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
      decoration: BoxDecoration(color: liveRed, borderRadius: BorderRadius.circular(4)),
      child: const Text('LIVE', style: TextStyle(fontSize: 10, fontWeight: FontWeight.w700, letterSpacing: 0.5, color: Colors.white)),
    );
  }
}

/// `dr-live-container` from the web design tokens (#C10E34).
const Color liveRed = Color(0xFFC10E34);
