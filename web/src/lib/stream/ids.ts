/**
 * RTM user ids. The server binds each RTM token to one of these, so a receiver can trust a
 * message's RTM `publisher` (not anything inside the payload):
 *   host_{keycloak sub}     a Keycloak host (may moderate, publishes reaction totals)
 *   u_{platform}_{user id}  a signed-in viewer (viewer ticket) — may chat and react
 *   anon_{random}           a guest — watches and reads only
 */
/**
 * Every chat connection gets its own RTM id: `{identity}~{connection}`. Agora allows one live
 * client per id (a second one fails with -10027, or kicks the first one off), and the same person
 * often has several at once — two tabs, the host console plus its preview, a remount. Everything
 * about *who* (muting, "mine", hosts, viewer count) uses the identity part only.
 */
export const MAX_IDENTITY = 54
export const CONNECTION_SEPARATOR = '~'
export const identityOf = (rtmId: string): string => {
  const at = rtmId.lastIndexOf(CONNECTION_SEPARATOR)
  return at > 0 ? rtmId.slice(0, at) : rtmId
}
export const hostRtmId = (sub: string): string => `host_${sub.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, MAX_IDENTITY)

export const isConnectionTag = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9]{6,12}$/.test(value)

export const isHostId = (userId: string): boolean => userId.startsWith('host_')
export const isViewerId = (userId: string): boolean => userId.startsWith('u_')
/** May post chat messages and reactions. */
export const canPost = (userId: string): boolean => isHostId(userId) || isViewerId(userId)
