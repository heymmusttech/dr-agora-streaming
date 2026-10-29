import 'package:flutter/material.dart';

import 'auth/app_auth.dart';
import 'live/live_pill.dart';
import 'live/live_player_screen.dart';
import 'live/live_status.dart';

void main() => runApp(const GarageApp());

/// A minimal dR Garage-style app: a blank page with the live-stream integration, working like the
/// plugin on drlive-frontend — LIVE pill while a stream is live, Join opens the player, the app's
/// own sign-in unlocks chat and reactions.
class GarageApp extends StatefulWidget {
  const GarageApp({super.key, this.status});

  /// Injectable for tests.
  final LiveStatusController? status;

  @override
  State<GarageApp> createState() => _GarageAppState();
}

class _GarageAppState extends State<GarageApp> with WidgetsBindingObserver {
  final AppAuth _auth = AppAuth();
  late final LiveStatusController _status = widget.status ?? LiveStatusController();
  final GlobalKey<NavigatorState> _navigator = GlobalKey<NavigatorState>();

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _status.start();
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // Poll only while the app is visible.
    if (state == AppLifecycleState.resumed) {
      _status.start();
    } else if (state == AppLifecycleState.paused) {
      _status.stop();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _status.dispose();
    _auth.dispose();
    super.dispose();
  }

  /// The app's own sign-in (a name is enough for this sample).
  Future<void> _openSignIn() async {
    final context = _navigator.currentContext;
    if (context == null) return;
    final name = await showDialog<String>(context: context, builder: (_) => const _SignInDialog());
    if (name != null) _auth.signIn(name);
  }

  void _join(String? title) {
    _navigator.currentState?.push(
      MaterialPageRoute<void>(builder: (_) => LivePlayerScreen(auth: _auth, title: title, openSignIn: _openSignIn)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      navigatorKey: _navigator,
      title: 'dR Garage',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(colorSchemeSeed: liveRed, useMaterial3: true),
      darkTheme: ThemeData(colorSchemeSeed: liveRed, useMaterial3: true, brightness: Brightness.dark),
      themeMode: ThemeMode.system,
      home: ListenableBuilder(
        listenable: Listenable.merge([_auth, _status]),
        builder: (context, _) {
          final status = _status.status;
          final user = _auth.user;
          final showPill = status.isLive;
          return Scaffold(
            appBar: AppBar(
              title: const Text('dR Garage'),
              actions: [
                if (user == null)
                  TextButton.icon(onPressed: _openSignIn, icon: const Icon(Icons.login), label: const Text('Sign in'))
                else
                  TextButton.icon(onPressed: _auth.signOut, icon: const Icon(Icons.logout), label: Text(user.name)),
              ],
            ),
            body: Stack(
              children: [
                const Center(
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Text(
                      'Welcome to dR Garage.\nWhen a live stream starts, the LIVE pill appears below.',
                      textAlign: TextAlign.center,
                      style: TextStyle(fontSize: 16),
                    ),
                  ),
                ),
                if (showPill)
                  Positioned(
                    left: 12,
                    right: 12,
                    bottom: 16,
                    child: SafeArea(
                      child: Align(
                        alignment: Alignment.bottomLeft,
                        child: LivePill(
                          title: status.title,
                          onJoin: () => _join(status.title),
                        ),
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

class _SignInDialog extends StatefulWidget {
  const _SignInDialog();

  @override
  State<_SignInDialog> createState() => _SignInDialogState();
}

class _SignInDialogState extends State<_SignInDialog> {
  final TextEditingController _name = TextEditingController(text: 'Garage Viewer');

  @override
  void dispose() {
    _name.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Sign in to dR Garage'),
      content: TextField(controller: _name, autofocus: true, decoration: const InputDecoration(labelText: 'Your name')),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
        FilledButton(onPressed: () => Navigator.pop(context, _name.text), child: const Text('Sign in')),
      ],
    );
  }
}
