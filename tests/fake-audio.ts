// Minimal fake Web Audio graph that records scheduling calls for deterministic tests.
export class FakeParam {
  value: number
  events: { type: string; value: number; time: number }[] = []
  constructor(v: number) {
    this.value = v
  }
  cancelScheduledValues(time: number) {
    this.events = this.events.filter((e) => e.time < time)
    this.events.push({ type: 'cancel', value: 0, time })
  }
  setValueAtTime(value: number, time: number) {
    this.events.push({ type: 'set', value, time })
  }
  linearRampToValueAtTime(value: number, time: number) {
    this.events.push({ type: 'ramp', value, time })
  }
}

class FakeNode {
  connections: unknown[] = []
  connect(n: unknown) {
    this.connections.push(n)
    return n
  }
  disconnect() {
    this.connections = []
  }
}

export class FakeGain extends FakeNode {
  gain = new FakeParam(1)
}

export class FakeSource extends FakeNode {
  buffer: unknown = null
  playbackRate = new FakeParam(1)
  detune = new FakeParam(0)
  startAt: number | null = null
  stopAt: number | null = null
  onended: (() => void) | null = null
  /** Playback rate at the moment start() was called. */
  rateAtStart: number | null = null
  start(t: number) {
    this.startAt = t
    this.rateAtStart = this.playbackRate.value
  }
  stop(t = 0) {
    this.stopAt = t
  }
  /** Sounds at all: started and not stopped before its start time. */
  get audible() {
    return this.startAt !== null && (this.stopAt === null || this.stopAt > this.startAt)
  }
}

export class FakeContext {
  currentTime = 0
  sampleRate = 48000
  state = 'running'
  onstatechange: unknown = null
  destination = new FakeNode() as unknown as AudioNode
  sources: FakeSource[] = []
  gains: FakeGain[] = []
  decodes = 0
  createBufferSource() {
    const s = new FakeSource()
    this.sources.push(s)
    return s as unknown as AudioBufferSourceNode
  }
  createGain() {
    const g = new FakeGain()
    this.gains.push(g)
    return g as unknown as GainNode
  }
  async resume() {
    this.state = 'running'
  }
  async decodeAudioData(data: ArrayBuffer) {
    this.decodes++
    return fakeBuffer(data.byteLength)
  }
}

export const fakeBuffer = (length = 4800, channels = 1) =>
  ({ length, numberOfChannels: channels, duration: length / 48000, sampleRate: 48000 }) as unknown as AudioBuffer
