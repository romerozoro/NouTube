// ChuTube: turn off YouTube's "press and hold for 2x speed". If the speed
// changes while a finger is on the screen, put it back when that happens.
// Speeds chosen from the settings menu are kept: those change on a tap, after
// the finger is already up.

const getPlayer = (): any => document.getElementById('movie_player')

function currentRate(video?: HTMLVideoElement | null): number {
  const fromPlayer = getPlayer()?.getPlaybackRate?.()
  if (typeof fromPlayer === 'number') return fromPlayer
  return video?.playbackRate ?? 1
}

function setRate(video: HTMLVideoElement, rate: number) {
  getPlayer()?.setPlaybackRate?.(rate)
  if (video.playbackRate !== rate) video.playbackRate = rate
}

export function installNoHoldSpeed() {
  if (!window.isAndroid) return
  const root = window as Window & { __chuNoHoldSpeed?: boolean }
  if (root.__chuNoHoldSpeed) return
  root.__chuNoHoldSpeed = true

  let fingers = 0
  let savedRate = 1
  let changed: HTMLVideoElement | null = null

  window.addEventListener(
    'touchstart',
    (e: TouchEvent) => {
      if (fingers === 0) {
        savedRate = currentRate(document.querySelector('video'))
        changed = null
      }
      fingers = e.touches.length
    },
    { capture: true, passive: true },
  )

  const up = (e: TouchEvent) => {
    fingers = e.touches.length
    if (fingers > 0) return
    const video = changed
    changed = null
    // YouTube usually restores the speed itself on release; make sure.
    if (video) setTimeout(() => setRate(video, savedRate), 50)
  }
  window.addEventListener('touchend', up, { capture: true, passive: true })
  window.addEventListener('touchcancel', up, { capture: true, passive: true })

  // ratechange does not bubble, but capture listeners on document still see it
  document.addEventListener(
    'ratechange',
    (e) => {
      if (fingers === 0) return
      const video = e.target
      if (!(video instanceof HTMLVideoElement)) return
      if (video.playbackRate === savedRate) return
      changed = video
      setRate(video, savedRate)
    },
    true,
  )
}
