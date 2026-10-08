// Reference loudness values from the browser implementation (src/audio/loudness.ts)
// for real catalog samples, measured at their source rate. The C++ core tests
// compare their port against plugin/source/tests/data/loudness-reference.json.
//   npx tsx plugin/scripts/loudness-reference.ts
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { measureHit, normalisationDb } from '../../src/audio/loudness.ts'
import { readWavInfo } from '../../src/contract/wav.ts'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(here, '../..')
const media = path.join(root, 'public/media/audio')
const out = path.join(here, '../source/tests/data/loudness-reference.json')

function decode(bytes: Uint8Array) {
  const info = readWavInfo(bytes)
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let off = 12
  while (off + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(...bytes.subarray(off, off + 4))
    const size = dv.getUint32(off + 4, true)
    if (id === 'data') break
    off += 8 + size + (size & 1)
  }
  const start = off + 8
  const bps = info.bitsPerSample / 8
  const channels = Array.from({ length: info.channels }, () => new Float32Array(info.frames))
  for (let f = 0; f < info.frames; f++) for (let c = 0; c < info.channels; c++) {
    const p = start + (f * info.channels + c) * bps
    let v: number
    if (info.format === 'float') v = bps === 4 ? dv.getFloat32(p, true) : dv.getFloat64(p, true)
    else if (bps === 1) v = (dv.getUint8(p) - 128) / 128
    else if (bps === 2) v = dv.getInt16(p, true) / 32768
    else if (bps === 3) v = (dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getInt8(p + 2) << 16)) / 8388608
    else v = dv.getInt32(p, true) / 2147483648
    channels[c][f] = v
  }
  return { numberOfChannels: info.channels, sampleRate: info.sampleRate, length: info.frames, getChannelData: (c: number) => channels[c] }
}

const files = readdirSync(media).filter((f) => f.endsWith('.wav')).sort()
// A spread of files: every n-th, so the set covers rates, widths and channel counts without depending on order.
const pick = files.filter((_, i) => i % Math.max(1, Math.floor(files.length / 24)) === 0).slice(0, 24)
const rows = pick.map((f) => {
  const bytes = new Uint8Array(readFileSync(path.join(media, f)))
  const buf = decode(bytes)
  const level = measureHit(buf)
  const info = readWavInfo(bytes)
  return {
    file: `public/media/audio/${f}`,
    channels: info.channels, sampleRate: info.sampleRate, bitsPerSample: info.bitsPerSample, format: info.format,
    lufs: Number.isFinite(level.lufs) ? level.lufs : null,
    peakDb: Number.isFinite(level.peakDb) ? level.peakDb : null,
    normalisationDb: normalisationDb(level),
  }
})
mkdirSync(path.dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(rows, null, 2) + '\n')
console.log(`wrote ${rows.length} reference rows to ${out}`)
