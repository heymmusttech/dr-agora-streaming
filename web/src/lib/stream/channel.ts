/**
 * One Agora RTC (video) channel for the whole platform (one stream at a time). Defaults to `Live`,
 * the default channel of `auction-stream` (stream.dupontregistry.com). Chat, reactions and
 * presence use a per-session RTM channel instead (`chatChannelFor`).
 */
export const LIVE_CHANNEL = process.env.NEXT_PUBLIC_LIVESTREAM_CHANNEL || 'Live'

/**
 * RTM channel for one stream session: chat, reactions and viewer presence of *this* session only.
 * The RTC channel `Live` is shared with every app on the Agora project (auction-stream, other
 * servers), so presence and messages there are not ours to count.
 */
export const chatChannelFor = (sessionId: string): string => `dprlive-${sessionId}`.slice(0, 64)

/** Agora channel names: letters, digits and a few symbols, max 64 bytes. */
export const isAllowedChannel = (channel: string): boolean => channel === LIVE_CHANNEL
