import 'dart:convert';

import 'package:dpr_live_garage/live/live_status.dart';
import 'package:dpr_live_garage/main.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

LiveStatusController statusFrom(Map<String, dynamic> body) => LiveStatusController(
      interval: const Duration(hours: 1),
      client: MockClient((_) async => http.Response(jsonEncode(body), 200)),
    );

void main() {
  testWidgets('offline: blank page, no LIVE pill', (tester) async {
    await tester.pumpWidget(GarageApp(status: statusFrom({'isLive': false})));
    await tester.pumpAndSettle();
    expect(find.textContaining('Welcome to dR Garage'), findsOneWidget);
    expect(find.text('Join live'), findsNothing);
  });

  testWidgets('live: the pill shows the title; ✕ hides it for the session', (tester) async {
    await tester.pumpWidget(GarageApp(status: statusFrom({'isLive': true, 'title': 'Sunday cars', 'sessionId': 's1'})));
    await tester.pumpAndSettle();
    expect(find.text('Sunday cars'), findsOneWidget);
    expect(find.text('Join live'), findsOneWidget);
    await tester.tap(find.byTooltip('Hide the live stream for this session'));
    await tester.pumpAndSettle();
    expect(find.text('Join live'), findsNothing);
  });

  testWidgets('sign in / sign out from the app bar', (tester) async {
    await tester.pumpWidget(GarageApp(status: statusFrom({'isLive': false})));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Sign in'));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField), 'Nada N.');
    await tester.tap(find.widgetWithText(FilledButton, 'Sign in'));
    await tester.pumpAndSettle();
    expect(find.text('Nada N.'), findsOneWidget);
    await tester.tap(find.text('Nada N.'));
    await tester.pumpAndSettle();
    expect(find.text('Sign in'), findsOneWidget);
  });
}
