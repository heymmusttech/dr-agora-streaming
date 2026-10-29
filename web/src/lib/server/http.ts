/** Small helpers shared by the API routes: JSON errors, CORS for allowed embedders, rate limits. */
import 'server-only'
import { NextResponse } from 'next/server'
import { HostAuthError } from '@/lib/auth/host-claims'
import { isAllowedOrigin, originPatterns } from '@/lib/auth/origins'
import { StreamInputError } from '@/lib/stream/state'
import { AgoraConfigError } from './agora-tokens'

export const NO_STORE = { 'Cache-Control': 'no-store' }

export const parentOrigins = (): string[] => originPatterns(process.env.LIVESTREAM_ALLOWED_PARENT_ORIGINS)

/** CORS headers for a request from an allowed embedding site (none otherwise). */
export function corsHeaders(request: Request, methods = 'GET, OPTIONS'): Record<string, string> {
  const origin = request.headers.get('origin')
  if (!isAllowedOrigin(origin, parentOrigins())) return {}
  return {
    'Access-Control-Allow-Origin': origin!,
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  }
}

export function json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return NextResponse.json(body, { status: init.status ?? 200, headers: { ...NO_STORE, ...init.headers } })
}

/** Maps known errors to JSON responses; rethrows anything else (Next logs it as a 500). */
export function errorResponse(error: unknown, headers: Record<string, string> = {}) {
  if (error instanceof HostAuthError || error instanceof StreamInputError)
    return json({ error: error.message, code: error.code }, { status: error.status, headers })
  if (error instanceof AgoraConfigError) return json({ error: error.message, code: 'AGORA_UNCONFIGURED' }, { status: 503, headers })
  console.error('[api] unexpected error', error)
  return json({ error: 'Something went wrong.', code: 'INTERNAL' }, { status: 500, headers })
}

/* ── rate limit: fixed window per key, in memory (per instance) ── */

const store = globalThis as typeof globalThis & { __dprLiveRate?: Map<string, { count: number; reset: number }> }
const windows = (store.__dprLiveRate ??= new Map())

export function rateLimited(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  if (windows.size > 10_000) windows.forEach((w, k) => w.reset < now && windows.delete(k))
  const current = windows.get(key)
  if (!current || current.reset < now) {
    windows.set(key, { count: 1, reset: now + windowMs })
    return false
  }
  current.count += 1
  return current.count > limit
}

/**
 * Up to `limit` units per window per key; returns how many of the `want` units fit (0…want). Lets a
 * batch (`{ love: 3, like: 2 }`) count partly instead of all-or-nothing.
 */
export function takeQuota(key: string, want: number, limit: number, windowMs: number): number {
  const now = Date.now()
  if (windows.size > 10_000) windows.forEach((w, k) => w.reset < now && windows.delete(k))
  let current = windows.get(key)
  if (!current || current.reset < now) {
    current = { count: 0, reset: now + windowMs }
    windows.set(key, current)
  }
  const granted = Math.max(0, Math.min(want, limit - current.count))
  current.count += granted
  return granted
}

export const clientIp = (request: Request): string =>
  request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'local'
