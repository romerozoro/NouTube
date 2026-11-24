// Swipe left/right on the YouTube Music player to skip songs, like the official
// app: the cover follows your finger, flies out, and the next one slides in.

const THRESHOLD_RATIO = 0.25 // fraction of the cover width needed to skip
const FLICK_SPEED = 0.5 // px/ms; a fast flick skips even if short
const LOCK_PX = 10 // movement before deciding horizontal vs vertical

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

// The element that visually is "the cover": the biggest visible image in the
// player, or its wrapper so rounded corners move together.
function findCover(area: Element): HTMLElement | null {
  if (area.tagName.toLowerCase() !== 'ytmusic-player') return null
  let best: HTMLElement | null = null
  let bestArea = 0
  for (const img of area.querySelectorAll<HTMLElement>('img')) {
    const r = img.getBoundingClientRect()
    const a = r.width * r.height
    if (a > bestArea) {
      bestArea = a
      best = img
    }
  }
  if (!best) return null
  const wrapper = best.closest<HTMLElement>('#song-image, #thumbnail, .thumbnail-image-wrapper, yt-img-shadow')
  return wrapper && area.contains(wrapper) ? wrapper : best
}

function setStyle(el: HTMLElement, transform: string, opacity: string, transition: string) {
  el.style.transition = transition
  el.style.transform = transform
  el.style.opacity = opacity
}

function resetStyle(el: HTMLElement) {
  el.style.transition = ''
  el.style.transform = ''
  el.style.opacity = ''
  el.style.willChange = ''
}

interface Drag {
  x: number
  y: number
  t: number
  area: Element
  cover: HTMLElement | null
  width: number
  locked: 'h' | 'v' | null
  dx: number
}

export function attachMusicSwipe(doc: Document, win: Window) {
  let drag: Drag | null = null
  let animating = false

  doc.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      drag = null
      if (animating || e.touches.length !== 1) return
      const target = e.target as Element | null
      if (!target?.closest) return
      if (target.closest(IGNORED_TARGET_SELECTOR)) return
      const area = target.closest(AREA_SELECTOR)
      if (!area) return
      const touch = e.touches[0]
      const cover = findCover(area)
      const width = cover?.getBoundingClientRect().width || win.innerWidth
      drag = { x: touch.clientX, y: touch.clientY, t: Date.now(), area, cover, width, locked: null, dx: 0 }
    },
    { capture: true, passive: true },
  )

  doc.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      const d = drag
      if (!d || e.touches.length !== 1) return
      const touch = e.touches[0]
      const dx = touch.clientX - d.x
      const dy = touch.clientY - d.y
      if (!d.locked) {
        if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return
        d.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
        if (d.locked === 'v') {
          drag = null
          return
        }
        if (d.cover) d.cover.style.willChange = 'transform, opacity'
      }
      // Keep the page/WebView from taking over the gesture (that was what made
      // the swipe work only sometimes).
      if (e.cancelable) e.preventDefault()
      e.stopPropagation()
      d.dx = dx
      if (d.cover) {
        const progress = Math.min(Math.abs(dx) / d.width, 1)
        setStyle(d.cover, `translateX(${dx}px) rotate(${dx / 40}deg)`, String(1 - progress * 0.5), 'none')
      }
    },
    { capture: true, passive: false },
  )

  const finish = (cancelled: boolean) => {
    const d = drag
    drag = null
    if (!d || d.locked !== 'h') return
    const dx = d.dx
    const speed = Math.abs(dx) / Math.max(Date.now() - d.t, 1)
    const skip = !cancelled && (Math.abs(dx) > d.width * THRESHOLD_RATIO || (speed > FLICK_SPEED && Math.abs(dx) > 30))
    const dir = dx < 0 ? -1 : 1
    const button = skip ? findButton(doc, d.area, dir < 0 ? 'next' : 'previous') : null
    const canSkip = !!button && button.getAttribute('aria-disabled') !== 'true'
    const cover = d.cover

    if (!canSkip) {
      if (cover) {
        setStyle(cover, 'translateX(0) rotate(0)', '1', 'transform 0.25s ease, opacity 0.25s ease')
        win.setTimeout(() => resetStyle(cover), 260)
      }
      return
    }

    if (!cover) {
      button!.click()
      return
    }

    animating = true
    // 1) fly out in the swipe direction
    setStyle(cover, `translateX(${dir * d.width * 1.2}px) rotate(${dir * 12}deg)`, '0', 'transform 0.2s ease-in, opacity 0.2s ease-in')
    win.setTimeout(() => {
      button!.click()
      // 2) jump to the opposite side, invisible
      setStyle(cover, `translateX(${-dir * d.width * 0.6}px)`, '0', 'none')
      // force layout so the next transition runs
      void cover.offsetWidth
      // 3) slide the new cover in
      setStyle(cover, 'translateX(0) rotate(0)', '1', 'transform 0.25s ease-out, opacity 0.25s ease-out')
      win.setTimeout(() => {
        resetStyle(cover)
        animating = false
      }, 270)
    }, 200)
  }

  doc.addEventListener('touchend', () => finish(false), { capture: true, passive: true })
  doc.addEventListener('touchcancel', () => finish(true), { capture: true, passive: true })
}

export function installMusicSwipe() {
  if (document.location.host !== 'music.youtube.com') return
  if (!window.isAndroid) return
  const root = window as Window & { __noutubeMusicSwipeInit?: boolean }
  if (root.__noutubeMusicSwipeInit) return
  root.__noutubeMusicSwipeInit = true
  attachMusicSwipe(document, window)
}
