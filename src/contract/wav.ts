// Minimal RIFF/WAVE header reader for build-time validation and tests.
// Supports PCM (1), IEEE float (3) and WAVE_FORMAT_EXTENSIBLE (0xFFFE).

export interface WavInfo {
  format: 'pcm' | 'float'
  channels: number
  sampleRate: number
  bitsPerSample: number
  dataBytes: number
  frames: number
  durationSec: number
}

export function readWavInfo(buf: Uint8Array): WavInfo {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const tag = (o: number) => String.fromCharCode(buf[o], buf[o + 1], buf[o + 2], buf[o + 3])
  if (buf.byteLength < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('not a RIFF/WAVE file')
  let off = 12
  let fmt: Omit<WavInfo, 'dataBytes' | 'frames' | 'durationSec'> | null = null
  let dataBytes = -1
  while (off + 8 <= buf.byteLength) {
    const id = tag(off)
    const size = dv.getUint32(off + 4, true)
    const body = off + 8
    if (id === 'fmt ') {
      let code = dv.getUint16(body, true)
      const channels = dv.getUint16(body + 2, true)
      const sampleRate = dv.getUint32(body + 4, true)
      const bitsPerSample = dv.getUint16(body + 14, true)
      if (code === 0xfffe && size >= 40) code = dv.getUint16(body + 24, true)
      if (code !== 1 && code !== 3) throw new Error(`unsupported WAV format code ${code}`)
      fmt = { format: code === 1 ? 'pcm' : 'float', channels, sampleRate, bitsPerSample }
    } else if (id === 'data') {
      dataBytes = Math.min(size, buf.byteLength - body)
      if (fmt) break
    }
    off = body + size + (size & 1)
  }
  if (!fmt) throw new Error('missing fmt chunk')
  if (dataBytes < 0) throw new Error('missing data chunk')
  const frameBytes = (fmt.bitsPerSample / 8) * fmt.channels
  if (!(frameBytes > 0) || !(fmt.sampleRate > 0)) throw new Error('invalid fmt values')
  const frames = Math.floor(dataBytes / frameBytes)
  return { ...fmt, dataBytes, frames, durationSec: frames / fmt.sampleRate }
}
