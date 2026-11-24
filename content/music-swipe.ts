// Swipe left/right on the YouTube Music player (cover art or mini bar) to skip
// to the next/previous song, like the official YouTube Music app.

const SWIPE_THRESHOLD_PX = 70
const HORIZONTAL_DOMINANCE_RATIO = 1.5
const MAX_DURATION_MS = 800

const AREA_SELECTOR = 'ytmusic-player, ytmusic-player-bar'

const IGNORED_TARGET_SELECTOR = [
  'button',
  'a',
  'input',
  'tp-yt-paper-slider',
  '#progress-bar',
  '.progress-bar',
  '[role="slider"]',
  '[role="dialog"]',
  'ytmusic-menu-popup-renderer',
].join(', ')

function findButton(doc: Document, area: Element, kind: 'next' | 'previous'): HTMLElement | null {
  const selector = `.${kind}-button`
  return (
    area.querySelector<HTMLElement>(selector) ||
    doc.querySelector<HTMLElement>(`ytmusic-player-controls ${selector}`) ||
    doc.querySelector<HTMLElement>(`ytmusic-player-bar ${selector}`)
  )
}

export function attachMusicSwipe(doc: Document) {
  let start: { x: number; y: number; t: number; area: Element } | null = null

  doc.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      start = null
      if (e.touches.length !== 1) return
      const target = e.target as Element | null
      if (!target?.closest) return
      if (target.closest(IGNORED_TARGET_SELECTOR)) return
      const area = target.closest(AREA_SELECTOR)
      if (!area) return
      const touch = e.touches[0]
      start = { x: touch.clientX, y: touch.clientY, t: Date.now(), area }
    },
    { capture: true, passive: true },
  )

  doc.addEventListener(
    'touchend',
    (e: TouchEvent) => {
      const s = start
      start = null
      if (!s || e.changedTouches.length !== 1) return
      if (Date.now() - s.t > MAX_DURATION_MS) return
      const touch = e.changedTouches[0]
      const dx = touch.clientX - s.x
      const dy = touch.clientY - s.y
      if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return
      if (Math.abs(dx) < Math.abs(dy) * HORIZONTAL_DOMINANCE_RATIO) return
      const button = findButton(doc, s.area, dx < 0 ? 'next' : 'previous')
      if (!button || button.getAttribute('aria-disabled') === 'true') return
      button.click()
    },
    { capture: true, passive: true },
  )

  doc.addEventListener('touchcancel', () => (start = null), { capture: true, passive: true })
}

export function installMusicSwipe() {
  if (document.location.host !== 'music.youtube.com') return
  if (!window.isAndroid) return
  const root = window as Window & { __noutubeMusicSwipeInit?: boolean }
  if (root.__noutubeMusicSwipeInit) return
  root.__noutubeMusicSwipeInit = true
  attachMusicSwipe(document)
}
