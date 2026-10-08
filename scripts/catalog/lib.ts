// Node-side helpers shared by catalog scripts.
import { createHash } from 'node:crypto'
import { canonicalJson, REVISION_HEX_LENGTH } from '../../src/contract/canonical.ts'
import { readWavInfo } from '../../src/contract/wav.ts'

export const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest('hex')

export const revisionOf = (value: unknown) => sha256(canonicalJson(value)).slice(0, REVISION_HEX_LENGTH)

/** Pretty, key-stable JSON for generated files. */
export const stableJson = (value: unknown) => JSON.stringify(JSON.parse(canonicalJson(value, false)), null, 2) + '\n'

/** Peak level of a PCM/float WAV in dBFS, or null when the format is not handled. */
export function peakDbfs(buf: Uint8Array): number | null {
  const info = readWavInfo(buf)
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  // Locate data chunk.
  let off = 12
  while (off + 8 <= buf.byteLength) {
    const id = String.fromCharCode(buf[off], buf[off + 1], buf[off + 2], buf[off + 3])
    const size = dv.getUint32(off + 4, true)
    if (id === 'data') break
    off += 8 + size + (size & 1)
  }
  const start = off + 8
  const end = start + info.dataBytes
  const bps = info.bitsPerSample / 8
  let peak = 0
  for (let p = start; p + bps <= end; p += bps) {
    let v: number
    if (info.format === 'float' && bps === 4) v = dv.getFloat32(p, true)
    else if (info.format === 'float' && bps === 8) v = dv.getFloat64(p, true)
    else if (bps === 2) v = dv.getInt16(p, true) / 32768
    else if (bps === 3) v = ((dv.getUint8(p) | (dv.getUint8(p + 1) << 8) | (dv.getInt8(p + 2) << 16)) / 8388608)
    else if (bps === 4) v = dv.getInt32(p, true) / 2147483648
    else if (bps === 1) v = (dv.getUint8(p) - 128) / 128
    else return null
    const a = Math.abs(v)
    if (a > peak) peak = a
  }
  if (peak === 0) return null
  return Math.min(0, Math.round(20 * Math.log10(peak) * 100) / 100)
}

export function parseArgs(argv: string[]) {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      args[k] = v ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true')
    }
  }
  return args
}

/** Output roots per build mode. Fixture and full never share a directory. */
export const OUTPUT_ROOTS = { fixture: 'public/fixture', full: 'public' } as const
