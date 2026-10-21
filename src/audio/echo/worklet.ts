// AudioWorklet wrapper around the tape echo DSP. The main thread posts
// EchoDspParams to the port; the processor sums its input to mono, as the
// hardware's single input does, and adds the wet signal to both outputs.
import { ECHO_PROCESSOR, TapeEcho, type EchoDspParams } from './dsp'

declare const sampleRate: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

class EchoProcessor extends AudioWorkletProcessor {
  private echo = new TapeEcho(sampleRate)
  private mono = new Float32Array(128)

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<EchoDspParams>) => this.echo.set(e.data)
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]
    const left = out[0]
    const right = out[1] ?? out[0]
    if (this.echo.idle) return true
    const n = left.length
    if (this.mono.length < n) this.mono = new Float32Array(n)
    const mono = this.mono
    const input = inputs[0] ?? []
    if (input.length === 0) mono.fill(0, 0, n)
    else if (input.length === 1) mono.set(input[0].subarray(0, n))
    else for (let i = 0; i < n; i++) mono[i] = 0.5 * (input[0][i] + input[1][i])
    this.echo.process(mono, left, right, n)
    return true
  }
}

registerProcessor(ECHO_PROCESSOR, EchoProcessor)
