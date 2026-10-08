// Audio session and background playback.
//
// iOS routes Web Audio through the "ambient" audio session by default, which
// the ring/silent switch mutes on the phone speaker (headphones are exempt).
// Asking for the "playback" session makes the speaker play regardless of the
// switch. Safari 16.4+ exposes navigator.audioSession; older iOS switches the
// session when an HTML media element plays, so a silent looping <audio> is
// started from the first user gesture instead.
//
// The same silent element plays while the sequencer runs on every platform.
// A page with a playing media element keeps running when the tab is hidden or
// the phone is locked, and the browser shows lock-screen / media-key controls
// (Media Session) for it. It carries no sound; the drums stay in Web Audio.

type AudioSessionNavigator = Navigator & { audioSession?: { type: string } }

let element: HTMLAudioElement | null = null

const isIOS = () => /iP(hone|ad|od)|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document
/** Old iOS needs the element playing at all times to hold the playback session. */
const elementHoldsSession = () => !(navigator as AudioSessionNavigator).audioSession && isIOS()

/** Silent 8 kHz mono 8-bit WAV, `seconds` long. Over 5 s so browsers treat it as media worth controls. */
function silentWavUrl(seconds: number): string {
  const samples = 8000 * seconds
  const bytes = new Uint8Array(44 + samples).fill(128, 44)
  const v = new DataView(bytes.buffer)
  const text = (o: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i) }
  text(0, 'RIFF'); v.setUint32(4, 36 + samples, true); text(8, 'WAVE')
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true)
  text(36, 'data'); v.setUint32(40, samples, true)
  return URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }))
}

function silentElement(): HTMLAudioElement {
  if (!element) {
    element = document.createElement('audio')
    element.setAttribute('x-webkit-airplay', 'deny')
    element.setAttribute('playsinline', '')
    element.preload = 'auto'
    element.loop = true
    element.src = silentWavUrl(10)
  }
  return element
}

/** Call inside a user gesture, before or after creating the AudioContext. */
export function preferPlaybackSession(): void {
  const nav = navigator as AudioSessionNavigator
  if (nav.audioSession) {
    if (nav.audioSession.type !== 'playback') nav.audioSession.type = 'playback'
    return
  }
  if (!isIOS()) return
  const el = silentElement()
  if (el.paused) void el.play().catch(() => undefined)
}

/** Start or stop background playback support. Call synchronously from play/stop (inside the gesture). */
export function setBackgroundPlayback(playing: boolean): void {
  if (typeof document === 'undefined') return
  const el = silentElement()
  if (playing) {
    if (el.paused) void el.play().catch(() => undefined)
  } else if (!elementHoldsSession()) {
    el.pause()
  }
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
}

export interface NowPlaying {
  title: string
  artist: string
  album: string
}

/** Lock-screen and media-key controls. Handlers run as user activations. */
export function setMediaSession(info: NowPlaying | null, actions: { play: () => void; stop: () => void }): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return
  const ms = navigator.mediaSession
  ms.metadata = info ? new MediaMetadata(info) : null
  const set = (a: MediaSessionAction, fn: (() => void) | null) => {
    try {
      ms.setActionHandler(a, fn)
    } catch {
      /* action not supported here */
    }
  }
  set('play', actions.play)
  set('pause', actions.stop)
  set('stop', actions.stop)
}
