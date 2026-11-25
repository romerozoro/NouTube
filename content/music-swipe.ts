// Swipe left/right on the YouTube Music cover to change song, like the official
// app: the cover follows your finger, the next/previous cover peeks in from the
// side, and letting go past a third switches the song.
//
// The real cover is never moved: YouTube animates it itself (minimize, queue),
// so we hide it during the drag and move copies of it on top. Every new touch
// first wipes whatever a previous gesture left, so it can not get stuck.

const THRESHOLD_RATIO = 0.3 // fraction of the cover width needed to skip
const FLICK_SPEED = 0.5 // px/ms; a fast flick skips even if short
const LOCK_PX = 10 // movement before deciding horizontal vs vertical
const GAP = 24 // px between the cover and the peeking one
const CLONE_CLASS = '_chu_swipe_clone'

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

// Thumbnail of the neighbour song in the queue, from wherever it is available.
function neighbourThumb(dir: 'next' | 'prev'): string | null {
  const step = dir === 'next' ? 1 : -1
  try {
    const player = getPlayer()
    const list: string[] | undefined = player?.getPlaylist?.()
    const index: number | undefined = player?.getPlaylistIndex?.()
    if (list?.length && typeof index === 'number' && index >= 0) {
      const id = list[index + step]
      if (id) return thumbOf(id)
    }
  } catch {}
  try {
    const state = (document.querySelector('ytmusic-app') as any)?.store?.getState?.()
    const items: any[] | undefined = state?.queue?.items
    if (items?.length) {
      const r = (it: any) =>
        it?.playlistPanelVideoRenderer ?? it?.playlistPanelVideoWrapperRenderer?.primaryRenderer?.playlistPanelVideoRenderer
      const index = items.findIndex((it: any) => r(it)?.selected)
      const id = index >= 0 ? r(items[index + step])?.videoId : null
      if (id) return thumbOf(id)
    }
  } catch {}
  try {
    const rows = Array.from(document.querySelectorAll('ytmusic-player-queue-item'))
    const index = rows.findIndex((row) => row.hasAttribute('selected') || row.getAttribute('play-button-state') === 'playing')
    const src = index >= 0 ? rows[index + step]?.querySelector('img')?.getAttribute('src') : null
    if (src) return src.replace(/=w\d+-h\d+[^&]*$/, '=w544-h544-l90-rj')
  } catch {}
  return null
}

// The biggest visible image in the full (expanded) player is the cover.
function findCover(target: Element): { el: HTMLElement; src: string } | null {
  const area = target.closest('ytmusic-player')
  if (!area) return null
  let best: HTMLImageElement | null = null
  let bestArea = 0
  for (const img of area.querySelectorAll<HTMLImageElement>('img')) {
    const r = img.getBoundingClientRect()
    const a = r.width * r.height
    if (a > bestArea) {
      bestArea = a
      best = img
    }
  }
  if (!best) return null
  const rect = best.getBoundingClientRect()
  // only the big expanded cover, not the mini player or a cover mid-animation
  if (rect.width < window.innerWidth * 0.5) return null
  const wrapper = best.closest<HTMLElement>('#song-image, #thumbnail, .thumbnail-image-wrapper, yt-img-shadow')
  const el = wrapper && area.contains(wrapper) ? wrapper : best
  return { el, src: best.currentSrc || best.src }
}

function makeClone(rect: DOMRect, src: string): HTMLImageElement {
  const img = document.createElement('img')
  img.className = CLONE_CLASS
  img.src = src
  Object.assign(img.style, {
    position: 'fixed',
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    objectFit: 'cover',
    borderRadius: '8px',
    zIndex: '2147483646',
    pointerEvents: 'none',
    willChange: 'transform, opacity',
  } as CSSStyleDeclaration)
  document.body.appendChild(img)
  return img
}

type Dir = 'next' | 'prev'

interface Drag {
  x: number
  y: number
  t: number
  cover: HTMLElement
  coverSrc: string
  rect: DOMRect
  locked: 'h' | 'v' | null
  dx: number
  current: HTMLImageElement | null
  peek: HTMLImageElement | null
  peekDir: Dir | null
}

export function attachMusicSwipe(doc: Document, win: Window) {
  let drag: Drag | null = null
  let hidden: { el: HTMLElement; prev: string } | null = null
  let timers: number[] = []

  const later = (fn: () => void, ms: number) => timers.push(win.setTimeout(fn, ms))

  const showCover = () => {
    if (hidden) {
      hidden.el.style.visibility = hidden.prev
      hidden = null
    }
  }

  // Wipe everything any earlier gesture left behind.
  const reset = () => {
    timers.forEach((id) => win.clearTimeout(id))
    timers = []
    doc.querySelectorAll(`.${CLONE_CLASS}`).forEach((n) => n.remove())
    showCover()
    drag = null
  }

  const offset = (d: Drag, dir: Dir) => (dir === 'next' ? 1 : -1) * (d.rect.width + GAP)

  const place = (d: Drag, animate: boolean) => {
    const t = animate ? 'transform 0.25s ease-out, opacity 0.25s ease-out' : 'none'
    if (d.current) {
      d.current.style.transition = t
      d.current.style.transform = `translateX(${d.dx}px)`
    }
    if (d.peek && d.peekDir) {
      d.peek.style.transition = t
      d.peek.style.transform = `translateX(${offset(d, d.peekDir) + d.dx}px)`
    }
  }

  doc.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      reset()
      if (e.touches.length !== 1) return
      const target = e.target as Element | null
      if (!target?.closest || target.closest(IGNORED_TARGET_SELECTOR)) return
      const found = findCover(target)
      if (!found) return
      const rect = found.el.getBoundingClientRect()
      const touch = e.touches[0]
      if (touch.clientY < rect.top - 20 || touch.clientY > rect.bottom + 20) return
      drag = {
        x: touch.clientX,
        y: touch.clientY,
        t: Date.now(),
        cover: found.el,
        coverSrc: found.src,
        rect,
        locked: null,
        dx: 0,
        current: null,
        peek: null,
        peekDir: null,
      }
    },
    { capture: true, passive: true },
  )

  doc.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      const d = drag
      if (!d) return
      if (e.touches.length !== 1) {
        reset()
        return
      }
      const touch = e.touches[0]
      const dx = touch.clientX - d.x
      const dy = touch.clientY - d.y
      if (!d.locked) {
        if (Math.abs(dx) < LOCK_PX && Math.abs(dy) < LOCK_PX) return
        d.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v'
        if (d.locked === 'v') {
          // vertical belongs to YouTube (minimize / queue)
          drag = null
          return
        }
        d.current = makeClone(d.rect, d.coverSrc)
        hidden = { el: d.cover, prev: d.cover.style.visibility }
        d.cover.style.visibility = 'hidden'
      }
      if (e.cancelable) e.preventDefault()
      e.stopPropagation()
      d.dx = dx
      const dir: Dir = dx < 0 ? 'next' : 'prev'
      if (d.peekDir !== dir) {
        d.peek?.remove()
        d.peekDir = dir
        const src = neighbourThumb(dir)
        d.peek = src ? makeClone(d.rect, src) : null
      }
      place(d, false)
      if (!d.peek && d.current) d.current.style.opacity = String(1 - Math.min(Math.abs(dx) / d.rect.width, 1) * 0.7)
    },
    { capture: true, passive: false },
  )

  const finish = (cancelled: boolean) => {
    const d = drag
    drag = null
    if (!d || d.locked !== 'h') return
    const speed = Math.abs(d.dx) / Math.max(Date.now() - d.t, 1)
    const go = !cancelled && (Math.abs(d.dx) > d.rect.width * THRESHOLD_RATIO || (speed > FLICK_SPEED && Math.abs(d.dx) > 30))

    if (!go) {
      d.dx = 0
      place(d, true)
      if (d.current) d.current.style.opacity = '1'
      later(reset, 260)
      return
    }

    const dir: Dir = d.dx < 0 ? 'next' : 'prev'
    if (d.peekDir !== dir) {
      d.peek?.remove()
      d.peek = null
    }
    d.dx = -offset(d, dir)
    place(d, true)
    if (!d.peek && d.current) d.current.style.opacity = '0'
    later(() => {
      skip(dir)
      // the real cover now loads the new song; keep the copy on top briefly,
      // then fade it away
      showCover()
      d.current?.remove()
      if (d.peek) {
        d.peek.style.transition = 'opacity 0.3s ease'
        later(() => d.peek && (d.peek.style.opacity = '0'), 300)
      }
      later(reset, 650)
    }, 250)
  }

  doc.addEventListener('touchend', () => finish(false), { capture: true, passive: true })
  doc.addEventListener('touchcancel', () => finish(true), { capture: true, passive: true })
  // never leave copies around if the page changes or the app is hidden
  doc.addEventListener('visibilitychange', reset)
  win.addEventListener('popstate', reset)
}

export function installMusicSwipe() {
  if (document.location.host !== 'music.youtube.com') return
  if (!window.isAndroid) return
  const root = window as Window & { __noutubeMusicSwipeInit?: boolean }
  if (root.__noutubeMusicSwipeInit) return
  root.__noutubeMusicSwipeInit = true
  attachMusicSwipe(document, window)
}
