// Swipe left/right on the YouTube Music cover to change song, like the official
// app: the cover follows your finger, the next/previous cover peeks in from the
// side, and letting go past the middle switches the song.

const THRESHOLD_RATIO = 0.3 // fraction of the cover width needed to skip
const FLICK_SPEED = 0.5 // px/ms; a fast flick skips even if short
const LOCK_PX = 10 // movement before deciding horizontal vs vertical
const GAP = 24 // px between the cover and the peeking one

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

const getPlayer = (): any => document.getElementById('movie_player')

// Same next/previous the app uses for the notification buttons.
function skip(dir: 'next' | 'prev') {
  const app = (window as any).NouTube
  if (app && typeof app[dir] === 'function') {
    app[dir]()
    return
  }
  const player = getPlayer()
  if (dir === 'next') player?.nextVideo?.()
  else {
    player?.seekTo?.(0)
    player?.previousVideo?.()
  }
}

const thumbOf = (id: string) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

// Thumbnail of the neighbour song in the queue. Tries several places because
// the mobile web player does not always expose the same one.
function neighbourThumb(dir: 'next' | 'prev'): string | null {
  const step = dir === 'next' ? 1 : -1
  // 1) the player's own playlist
  try {
    const player = getPlayer()
    const list: string[] | undefined = player?.getPlaylist?.()
    const index: number | undefined = player?.getPlaylistIndex?.()
    if (list?.length && typeof index === 'number' && index >= 0) {
      const id = list[index + step]
      if (id) return thumbOf(id)
    }
  } catch {}
  // 2) the app state of YouTube Music
  try {
    const state = (document.querySelector('ytmusic-app') as any)?.store?.getState?.()
    const items: any[] | undefined = state?.queue?.items
    const sel = state?.queue?.selectedItem ?? state?.queue?.selected
    if (items?.length) {
      const idOf = (it: any) =>
        it?.playlistPanelVideoRenderer?.videoId ??
        it?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer?.videoId
      let index = items.findIndex(
        (it: any) =>
          it?.playlistPanelVideoRenderer?.selected ||
          it?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer?.selected,
      )
      if (index < 0 && typeof sel === 'number') index = sel
      const id = index >= 0 ? idOf(items[index + step]) : null
      if (id) return thumbOf(id)
    }
  } catch {}
  // 3) the queue list rendered in the page
  try {
    const rows = Array.from(document.querySelectorAll('ytmusic-player-queue-item'))
    const index = rows.findIndex((r) => r.hasAttribute('selected') || r.getAttribute('play-button-state') === 'playing')
    const row = index >= 0 ? rows[index + step] : null
    const img = row?.querySelector('img')?.getAttribute('src')
    if (img) return img.replace(/=w\d+-h\d+[^&]*$/, '=w544-h544-l90-rj')
  } catch {}
  return null
}

// The biggest visible image in the full player is the cover.
function findCover(target: Element): HTMLElement | null {
  const area = target.closest('ytmusic-player')
  if (!area) return null
  let best: HTMLElement | null = null
  let bestArea = 0
  for (const img of area.querySelectorAll<HTMLElement>('img')) {
    const r = img.getBoundingClientRect()
    const a = r.width * r.height
    if (r.width > 80 && a > bestArea) {
      bestArea = a
      best = img
    }
  }
  if (!best) return null
  const wrapper = best.closest<HTMLElement>('#song-image, #thumbnail, .thumbnail-image-wrapper, yt-img-shadow')
  return wrapper && area.contains(wrapper) ? wrapper : best
}

interface Drag {
  x: number
  y: number
  t: number
  cover: HTMLElement
  rect: DOMRect
  locked: 'h' | 'v' | null
  dx: number
  peek: HTMLImageElement | null
  peekDir: 'next' | 'prev' | null
}

function makePeek(rect: DOMRect, src: string): HTMLImageElement {
  const img = document.createElement('img')
  img.src = src
  Object.assign(img.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    objectFit: 'cover',
    borderRadius: '12px',
    zIndex: '2147483647',
    pointerEvents: 'none',
    willChange: 'transform',
  } as CSSStyleDeclaration)
  document.body.appendChild(img)
  return img
}

export function attachMusicSwipe(doc: Document, win: Window) {
  let drag: Drag | null = null
  let busy = false

  const peekOffset = (d: Drag, dir: 'next' | 'prev') => (dir === 'next' ? 1 : -1) * (d.rect.width + GAP)

  const place = (d: Drag, animate: boolean) => {
    const t = animate ? 'transform 0.25s ease-out' : 'none'
    d.cover.style.transition = t
    d.cover.style.transform = `translateX(${d.dx}px)`
    if (d.peek && d.peekDir) {
      d.peek.style.transition = t
      d.peek.style.transform = `translateX(${peekOffset(d, d.peekDir) + d.dx}px)`
    }
  }

  const cleanup = (d: Drag) => {
    d.cover.style.transition = ''
    d.cover.style.transform = ''
    d.cover.style.opacity = ''
    d.peek?.remove()
  }

  doc.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      drag = null
      if (busy || e.touches.length !== 1) return
      const target = e.target as Element | null
      if (!target?.closest || target.closest(IGNORED_TARGET_SELECTOR)) return
      const cover = findCover(target)
      if (!cover) return
      const rect = cover.getBoundingClientRect()
      const touch = e.touches[0]
      // only when the finger is on (or right next to) the cover
      if (touch.clientY < rect.top - 20 || touch.clientY > rect.bottom + 20) return
      drag = { x: touch.clientX, y: touch.clientY, t: Date.now(), cover, rect, locked: null, dx: 0, peek: null, peekDir: null }
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
      }
      if (e.cancelable) e.preventDefault()
      e.stopPropagation()
      d.dx = dx
      // show the song we are heading to on the other side
      const dir: 'next' | 'prev' = dx < 0 ? 'next' : 'prev'
      if (d.peekDir !== dir) {
        d.peek?.remove()
        d.peek = null
        d.peekDir = dir
        const src = neighbourThumb(dir)
        if (src) d.peek = makePeek(d.rect, src)
      }
      place(d, false)
      if (!d.peek) d.cover.style.opacity = String(1 - Math.min(Math.abs(dx) / d.rect.width, 1) * 0.7)
    },
    { capture: true, passive: false },
  )

  const finish = (cancelled: boolean) => {
    const d = drag
    drag = null
    if (!d || d.locked !== 'h') return
    const speed = Math.abs(d.dx) / Math.max(Date.now() - d.t, 1)
    const go = !cancelled && (Math.abs(d.dx) > d.rect.width * THRESHOLD_RATIO || (speed > FLICK_SPEED && Math.abs(d.dx) > 30))
    busy = true

    if (!go) {
      d.dx = 0
      place(d, true)
      win.setTimeout(() => {
        cleanup(d)
        busy = false
      }, 260)
      return
    }

    const dir: 'next' | 'prev' = d.dx < 0 ? 'next' : 'prev'
    // slide everything so the peeking cover lands where the cover was
    d.dx = -peekOffset(d, dir)
    if (d.peekDir !== dir) {
      d.peek?.remove()
      d.peek = null
    }
    place(d, true)
    if (!d.peek) {
      d.cover.style.transition = 'transform 0.25s ease-out, opacity 0.25s ease-out'
      d.cover.style.opacity = '0'
    }
    win.setTimeout(() => {
      skip(dir)
      // put the real cover back (it now shows the new song) and fade out the copy
      d.cover.style.transition = 'none'
      d.cover.style.transform = ''
      d.cover.style.opacity = ''
      if (d.peek) {
        d.peek.style.transition = 'opacity 0.3s ease'
        win.setTimeout(() => d.peek && (d.peek.style.opacity = '0'), 350)
        win.setTimeout(() => d.peek?.remove(), 700)
      }
      busy = false
    }, 250)
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
