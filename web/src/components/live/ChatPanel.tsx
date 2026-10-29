'use client'

/**
 * Live chat with WhatsApp's layout in the platform's own colours: your messages in brand-red
 * bubbles on the right, everyone else's in neutral bubbles on the left with their name (hosts in
 * brand red with a shield), consecutive messages from one person grouped under one tail, the time
 * inside the bubble. Newest at the bottom; auto-scroll unless the reader scrolled up. Hosts also
 * moderate (delete a message, mute a viewer) from buttons beside each viewer bubble.
 *
 * `tone="dark"` sits on the player (embed / plugin); `tone="light"` is the host console. Guests see
 * "Sign in to chat" instead of the composer.
 */
import { useEffect, useRef, useState } from 'react'
import { Loader2, LogIn, MessageCircle, MicOff, Send, ShieldCheck, Trash2, Volume2 } from 'lucide-react'
import type { LiveChat } from '@/hooks/useLiveChat'
import { MAX_CHAT_TEXT } from '@/lib/stream/rules'
import type { ChatMessage } from '@/lib/stream/types'
import { cn } from '@/lib/utils'

const time = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' })

export function ChatPanel({
  chat,
  tone = 'dark',
  moderation = false,
  onSignIn,
  displayName,
  className,
  emptyHint = 'No messages yet. Say hi!',
}: {
  chat: LiveChat
  tone?: 'dark' | 'light'
  /** Host view: delete / mute on each viewer message, and the muted list. */
  moderation?: boolean
  onSignIn?: () => void
  /** Name sent with messages (falls back to the token's name). */
  displayName?: string | null
  className?: string
  emptyHint?: string
}) {
  const listRef = useRef<HTMLOListElement>(null)
  const stickRef = useRef(true)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [notSent, setNotSent] = useState(false)
  const dark = tone === 'dark'
  const me = chat.me
  const mutedMe = Boolean(me && chat.mutedUserIds.includes(me.userId))
  const connecting = chat.status === 'connecting' || chat.status === 'idle'

  useEffect(() => {
    const list = listRef.current
    if (list && stickRef.current) list.scrollTop = list.scrollHeight
  }, [chat.messages.length])

  const send = async () => {
    if (!text.trim() || sending) return
    setSending(true)
    const ok = await chat.sendChat(text, displayName)
    setSending(false)
    // Kept in the box when it didn't go out (connection dropped), so a second press retries.
    setNotSent(!ok)
    if (ok) {
      setText('')
      stickRef.current = true
    }
  }

  return (
    <div className={cn('flex min-h-0 flex-col', className)}>
      <ol
        ref={listRef}
        aria-label="Chat messages"
        aria-live="polite"
        onScroll={(event) => {
          const el = event.currentTarget
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
        }}
        className={cn(
          'min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-2',
          !dark && 'bg-surface-1',
        )}
      >
        {chat.messages.length === 0 && (
          <li className={cn('flex h-full flex-col items-center justify-center gap-1 py-6 text-center font-roboto text-xs', dark ? 'text-white/60' : 'text-on-surface-variant')}>
            {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <MessageCircle className="h-4 w-4" />}
            {connecting ? 'Connecting to chat…' : emptyHint}
          </li>
        )}
        {chat.messages.map((message, index) => {
          const previous = chat.messages[index - 1]
          // WhatsApp groups a burst from one person: name and tail only on the first bubble.
          const first = !previous || previous.userId !== message.userId || message.at - previous.at > GROUP_MS
          return (
            <MessageRow
              key={message.id}
              message={message}
              dark={dark}
              first={first}
              mine={message.userId === me?.userId}
              moderation={moderation && !message.host}
              onDelete={() => void chat.deleteMessage(message.id)}
              onMute={() => void chat.setMuted(message.userId, true)}
            />
          )
        })}
      </ol>

      {moderation && chat.mutedUserIds.length > 0 && (
        <MutedList ids={chat.mutedUserIds} onUnmute={(id) => void chat.setMuted(id, false)} />
      )}

      <div className={cn('shrink-0 border-t px-2 py-2', dark ? 'border-white/10' : 'border-outline-variant bg-background')}>
        {me && !me.canPost ? (
          <button
            type="button"
            onClick={onSignIn}
            className={cn(
              'inline-flex h-10 w-full items-center justify-center gap-2 rounded-full font-manrope text-sm font-semibold transition-colors',
              dark ? 'bg-white text-black hover:bg-white/90' : 'bg-dr-live-container text-white hover:bg-dr-live-container-hover',
            )}
          >
            <LogIn className="h-4 w-4" /> Sign in to chat and react
          </button>
        ) : mutedMe ? (
          <p className={cn('flex h-10 items-center justify-center gap-2 font-roboto text-xs', dark ? 'text-white/70' : 'text-on-surface-variant')}>
            <MicOff className="h-3.5 w-3.5" /> The host muted you in this chat.
          </p>
        ) : (
          <>
          {(notSent || chat.status === 'reconnecting') && (
            <p role="status" className={cn('px-2 pb-1.5 font-roboto text-[11px]', dark ? 'text-white/70' : 'text-on-surface-variant')}>
              {chat.status === 'reconnecting' ? 'Reconnecting to chat…' : 'Not sent — press send to retry.'}
            </p>
          )}
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void send()
            }}
          >
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={MAX_CHAT_TEXT}
              disabled={chat.status !== 'connected' || !me}
              placeholder={chat.status === 'connected' && me ? 'Say something…' : 'Connecting…'}
              aria-label="Chat message"
              className={cn(
                'h-10 min-w-0 flex-1 rounded-full px-4 font-roboto text-sm focus:outline-none disabled:opacity-60',
                dark
                  ? 'bg-white/15 text-white placeholder:text-white/55 focus:ring-1 focus:ring-white/60'
                  : 'border border-outline-variant bg-background text-foreground placeholder:text-on-surface-variant focus:border-dr-live-container focus:ring-1 focus:ring-dr-live-container',
              )}
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={!text.trim() || sending || chat.status !== 'connected' || !me}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-dr-live-container text-white transition-colors hover:bg-dr-live-container-hover disabled:opacity-50"
            >
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </form>
          </>
        )}
      </div>
    </div>
  )
}

const GROUP_MS = 2 * 60_000

function MessageRow({
  message,
  dark,
  first,
  mine,
  moderation,
  onDelete,
  onMute,
}: {
  message: ChatMessage
  dark: boolean
  /** First bubble of a burst from this person: name + tail. */
  first: boolean
  mine: boolean
  moderation: boolean
  onDelete: () => void
  onMute: () => void
}) {
  // Bubble background and its tail share one colour class (the tail fills with currentColor).
  const tone = mine
    ? { bubble: 'bg-dr-live-container text-white', tail: 'text-dr-live-container', time: 'text-white/70' }
    : dark
      ? { bubble: 'bg-white/10 text-white', tail: 'text-white/10', time: 'text-white/50' }
      : { bubble: 'bg-background text-foreground', tail: 'text-background', time: 'text-on-surface-variant' }
  return (
    <li className={cn('group flex items-center gap-1 motion-safe:animate-note-in', mine ? 'justify-end' : 'justify-start', first ? 'mt-2' : 'mt-0.5')}>
      <div
        className={cn(
          'relative max-w-[82%] rounded-lg px-2 pb-1 pt-1.5 font-roboto text-[13.5px] leading-[19px] shadow-sm',
          tone.bubble,
          first && (mine ? 'rounded-tr-none' : 'rounded-tl-none'),
        )}
      >
        {first && <BubbleTail mine={mine} className={tone.tail} />}
        {first && !mine && (
          <p className={cn('mb-0.5 flex items-center gap-1 font-manrope text-[12.5px] font-semibold leading-4', message.host ? 'text-dr-live' : dark ? 'text-white/75' : 'text-on-surface-variant')}>
            <span>{message.name}</span>
            {message.host && <ShieldCheck className="h-3 w-3" aria-label="Host" />}
          </p>
        )}
        <p className="whitespace-pre-wrap break-words">
          {message.text}
          {/* Reserves room so the time never overlaps the last line (WhatsApp's trick). */}
          <span className="inline-block w-12" aria-hidden />
        </p>
        <time className={cn('absolute bottom-0 right-2 font-roboto text-[10.5px] leading-[1.8em]', tone.time)} dateTime={new Date(message.at).toISOString()}>
          {time.format(message.at)}
        </time>
      </div>
      {moderation && (
        <span className="flex shrink-0 gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
          <IconButton label={`Mute ${message.name}`} onClick={onMute}>
            <MicOff className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="Delete message" onClick={onDelete} danger>
            <Trash2 className="h-3.5 w-3.5" />
          </IconButton>
        </span>
      )}
    </li>
  )
}

/** The little triangle on the first bubble of a burst. */
function BubbleTail({ mine, className }: { mine: boolean; className: string }) {
  return (
    <svg aria-hidden viewBox="0 0 8 13" width="8" height="13" className={cn('absolute top-0', mine ? '-right-2' : '-left-2 -scale-x-100', className)}>
      <path d="M0 0h8L1.5 8.5C.8 9.4 0 9 0 8V0z" fill="currentColor" />
    </svg>
  )
}

function IconButton({ label, onClick, danger = false, children }: { label: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-2',
        danger ? 'hover:text-dr-live' : 'hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

function MutedList({ ids, onUnmute }: { ids: string[]; onUnmute: (id: string) => void }) {
  return (
    <details className="shrink-0 border-t border-outline-variant px-3 py-2 font-roboto text-xs text-on-surface-variant">
      <summary className="cursor-pointer select-none">
        {ids.length} muted viewer{ids.length > 1 ? 's' : ''}
      </summary>
      <ul className="mt-2 space-y-1">
        {ids.map((id) => (
          <li key={id} className="flex items-center justify-between gap-2">
            <code className="truncate font-mono text-[11px] text-foreground">{id}</code>
            <button type="button" onClick={() => onUnmute(id)} className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 hover:bg-surface-2 hover:text-foreground">
              <Volume2 className="h-3 w-3" /> Unmute
            </button>
          </li>
        ))}
      </ul>
    </details>
  )
}
