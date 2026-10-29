'use client'

import { useEffect, useState } from 'react'

/** `hh:mm:ss` since `startedAt`; `--:--:--` until mounted (server and first client render agree). */
export function useElapsed(startedAt: number | null): string {
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!startedAt) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [startedAt])
  if (!startedAt || now === 0) return '--:--:--'
  const total = Math.max(0, Math.floor((now - startedAt) / 1_000))
  return [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}
