import 'dart:async';
import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;

import 'live_config.dart';

/// The public stream status (same endpoint the web plugin polls).
@immutable
class LiveStatus {
  const LiveStatus({required this.isLive, this.title, this.sessionId});

  final bool isLive;
  final String? title;
  final String? sessionId;

  static const offline = LiveStatus(isLive: false);

  factory LiveStatus.fromJson(Map<String, dynamic> json) => LiveStatus(
        isLive: json['isLive'] == true,
        title: json['title'] as String?,
        sessionId: json['sessionId'] as String?,
      );
}

/// Polls `GET /api/stream/status` every [interval] while the app is in the foreground — nothing
/// connects to the video until the user presses Join (same rule as the web plugin).
class LiveStatusController extends ChangeNotifier {
  LiveStatusController({this.interval = const Duration(seconds: 5), http.Client? client})
      : _client = client ?? http.Client();

  final Duration interval;
  final http.Client _client;
  Timer? _timer;
  LiveStatus _status = LiveStatus.offline;

  LiveStatus get status => _status;

  void start() {
    _timer?.cancel();
    unawaited(_poll());
    _timer = Timer.periodic(interval, (_) => unawaited(_poll()));
  }

  void stop() {
    _timer?.cancel();
    _timer = null;
  }

  Future<void> _poll() async {
    try {
      final response = await _client.get(statusUri()).timeout(const Duration(seconds: 8));
      if (response.statusCode != 200) return;
      final next = LiveStatus.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
      if (next.isLive != _status.isLive || next.title != _status.title || next.sessionId != _status.sessionId) {
        _status = next;
        notifyListeners();
      }
    } catch (_) {
      // Offline or server down: keep the last known status, try again next tick.
    }
  }

  @override
  void dispose() {
    stop();
    _client.close();
    super.dispose();
  }
}
