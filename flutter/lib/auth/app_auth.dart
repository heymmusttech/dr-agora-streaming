import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import '../live/live_config.dart';

@immutable
class AppUser {
  const AppUser({required this.id, required this.name});
  final String id;
  final String name;
}

/// The app's own sign-in (stand-in for dR Garage's real auth), like drlive-frontend's `useAuth`.
///
/// [viewerTicket] is what dR Garage's **backend** must provide in production: a short-lived HS256
/// JWT `{ iss: "garage", sub, name }` signed with the secret it shares with dpr-livestreaming
/// (docs/INTEGRATION-FLUTTER.md). Here it comes from dpr-livestreaming's dev-only
/// `/api/dev/viewer-ticket`, so the sample works without a Garage server. Never sign tickets in the
/// app itself: the secret would ship inside the binary.
class AppAuth extends ChangeNotifier {
  AppUser? _user;
  AppUser? get user => _user;

  void signIn(String name) {
    final clean = name.trim().isEmpty ? 'Garage Viewer' : name.trim();
    final id = 'garage-${clean.toLowerCase().replaceAll(RegExp(r'[^a-z0-9]+'), '-')}';
    _user = AppUser(id: id, name: clean);
    notifyListeners();
  }

  void signOut() {
    _user = null;
    notifyListeners();
  }

  /// A ticket for the signed-in user, or null (guest / failure → the player stays a guest).
  Future<String?> viewerTicket() async {
    final user = _user;
    if (user == null) return null;
    try {
      final response = await http
          .post(
            Uri.parse('$liveStreamOrigin/api/dev/viewer-ticket'),
            headers: {'Content-Type': 'application/json'},
            body: jsonEncode({'userId': user.id, 'name': user.name, 'platform': liveStreamPlatform}),
          )
          .timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return null;
      return (jsonDecode(response.body) as Map<String, dynamic>)['ticket'] as String?;
    } catch (_) {
      return null;
    }
  }
}
