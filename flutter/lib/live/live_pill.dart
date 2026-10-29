import 'package:flutter/material.dart';

import 'live_player_screen.dart';

/// The LIVE pill (same pattern as the web plugin): `● LIVE · title — [▶ Join live]`.
/// No close button: it stays while the stream is live.
class LivePill extends StatelessWidget {
  const LivePill({super.key, required this.title, required this.onJoin});

  final String? title;
  final VoidCallback onJoin;

  @override
  Widget build(BuildContext context) {
    return Material(
      color: liveRed,
      elevation: 8,
      shape: const StadiumBorder(),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 6, 6, 6),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            const Icon(Icons.circle, size: 10, color: Colors.white),
            const SizedBox(width: 8),
            const Text('LIVE', style: TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.w700, letterSpacing: 0.6)),
            const SizedBox(width: 8),
            Flexible(
              child: Text(
                title?.isNotEmpty == true ? title! : 'Live stream now',
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(color: Colors.white, fontSize: 14),
              ),
            ),
            const SizedBox(width: 8),
            FilledButton.icon(
              onPressed: onJoin,
              style: FilledButton.styleFrom(
                backgroundColor: Colors.white,
                foregroundColor: liveRed,
                visualDensity: VisualDensity.compact,
                textStyle: const TextStyle(fontWeight: FontWeight.w700),
              ),
              icon: const Icon(Icons.play_arrow_rounded, size: 18),
              label: const Text('Join live'),
            ),
          ],
        ),
      ),
    );
  }
}
