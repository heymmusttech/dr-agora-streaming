'use client'

/**
 * Open / closed state of the plugin preview sheet on `/host`, shared by the header button, the
 * sidebar and the sheet itself. `?preview=1` in the URL opens it (old `/plugin/preview` links
 * redirect there), and opening / closing keeps the URL in step so a reload shows the same thing.
 */
let open = false
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function syncUrl(next: boolean) {
  const url = new URL(window.location.href)
  if (next) url.searchParams.set('preview', '1')
  else url.searchParams.delete('preview')
  window.history.replaceState(window.history.state, '', url)
}

export function setPreviewOpen(next: boolean) {
  if (open === next) return
  open = next
  if (typeof window !== 'undefined') syncUrl(next)
  emit()
}

export const getPreviewOpen = () => open
export const getPreviewOpenOnServer = () => false

export function subscribePreview(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
