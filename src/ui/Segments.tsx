// Segmented LED displays drawn as SVG. Decorative: callers supply accessible text.

// ---- Seven-segment digits (tempo) ------------------------------------------
// Cell 0..12 x 0..22. Segments a b c d e f g as hexagonal bars.
const SEG7: Record<string, string> = {
  a: '2.2,1 9.8,1 11,2 9.8,3 2.2,3 1,2',
  b: '11,2.2 12,3.4 12,9.8 11,11 10,9.8 10,3.4',
  c: '11,11 12,12.2 12,18.6 11,19.8 10,18.6 10,12.2',
  d: '2.2,19.8 9.8,19.8 11,20.8 9.8,21.8 2.2,21.8 1,20.8',
  e: '1,11 2,12.2 2,18.6 1,19.8 0,18.6 0,12.2',
  f: '1,2.2 2,3.4 2,9.8 1,11 0,9.8 0,3.4',
  g: '2.2,10 9.8,10 11,11 9.8,12 2.2,12 1,11',
}
const DIGITS: Record<string, string> = {
  '0': 'abcdef', '1': 'bc', '2': 'abdeg', '3': 'abcdg', '4': 'bcfg',
  '5': 'acdfg', '6': 'acdefg', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', '-': 'g', ' ': '',
}

export function SevenSegment({ text, cells, className }: { text: string; cells: number; className?: string }) {
  const chars = text.padStart(cells, ' ').slice(-cells).split('')
  const w = 16
  return (
    <svg className={className} viewBox={`-2 0 ${cells * w + 2} 23`} aria-hidden="true" focusable="false">
      <g transform="skewX(-8) translate(3 0)">
        {chars.map((ch, i) => {
          const on = DIGITS[ch] ?? ''
          return (
            <g key={i} transform={`translate(${i * w} 0)`}>
              {Object.entries(SEG7).map(([s, pts]) => (
                <polygon key={s} points={pts} className={on.includes(s) ? 'seg-on' : 'seg-off'} />
              ))}
            </g>
          )
        })}
      </g>
    </svg>
  )
}

// ---- Fourteen-segment alphanumerics (name) -----------------------------------
// Cell 0..10 x 0..16. Outer a-f, middle g1/g2, inner verticals vt/vb, diagonals dh dj dk dl.
const SEG14: Record<string, string> = {
  a: 'M1.4 0.8H8.6',
  b: 'M9.2 1.4V7.4',
  c: 'M9.2 8.6V14.6',
  d: 'M1.4 15.2H8.6',
  e: 'M0.8 8.6V14.6',
  f: 'M0.8 1.4V7.4',
  g1: 'M1.4 8H4.6',
  g2: 'M5.4 8H8.6',
  vt: 'M5 1.6V7.2',
  vb: 'M5 8.8V14.4',
  dh: 'M1.8 1.8L4.4 7',
  dj: 'M8.2 1.8L5.6 7',
  dk: 'M4.4 9L1.8 14.2',
  dl: 'M5.6 9L8.2 14.2',
}
const ALNUM: Record<string, string[]> = {
  A: ['a', 'b', 'c', 'e', 'f', 'g1', 'g2'], B: ['a', 'b', 'c', 'd', 'g2', 'vt', 'vb'], C: ['a', 'd', 'e', 'f'],
  D: ['a', 'b', 'c', 'd', 'vt', 'vb'], E: ['a', 'd', 'e', 'f', 'g1'], F: ['a', 'e', 'f', 'g1'],
  G: ['a', 'c', 'd', 'e', 'f', 'g2'], H: ['b', 'c', 'e', 'f', 'g1', 'g2'], I: ['a', 'd', 'vt', 'vb'],
  J: ['b', 'c', 'd', 'e'], K: ['e', 'f', 'g1', 'dj', 'dl'], L: ['d', 'e', 'f'],
  M: ['b', 'c', 'e', 'f', 'dh', 'dj'], N: ['b', 'c', 'e', 'f', 'dh', 'dl'], O: ['a', 'b', 'c', 'd', 'e', 'f'],
  P: ['a', 'b', 'e', 'f', 'g1', 'g2'], Q: ['a', 'b', 'c', 'd', 'e', 'f', 'dl'], R: ['a', 'b', 'e', 'f', 'g1', 'g2', 'dl'],
  S: ['a', 'c', 'd', 'f', 'g1', 'g2'], T: ['a', 'vt', 'vb'], U: ['b', 'c', 'd', 'e', 'f'],
  V: ['e', 'f', 'dk', 'dj'], W: ['b', 'c', 'e', 'f', 'dk', 'dl'], X: ['dh', 'dj', 'dk', 'dl'],
  Y: ['dh', 'dj', 'vb'], Z: ['a', 'd', 'dj', 'dk'],
  '0': ['a', 'b', 'c', 'd', 'e', 'f', 'dj', 'dk'], '1': ['b', 'c'], '2': ['a', 'b', 'd', 'e', 'g1', 'g2'],
  '3': ['a', 'b', 'c', 'd', 'g2'], '4': ['b', 'c', 'f', 'g1', 'g2'], '5': ['a', 'c', 'd', 'f', 'g1', 'g2'],
  '6': ['a', 'c', 'd', 'e', 'f', 'g1', 'g2'], '7': ['a', 'b', 'c'], '8': ['a', 'b', 'c', 'd', 'e', 'f', 'g1', 'g2'],
  '9': ['a', 'b', 'c', 'd', 'f', 'g1', 'g2'], '-': ['g1', 'g2'], _: ['d'], '/': ['dj', 'dk'],
  '+': ['g1', 'g2', 'vt', 'vb'], "'": ['vt'], '*': ['dh', 'dj', 'dk', 'dl', 'vt', 'vb'], ' ': [],
}

/** Uppercase, fold accents, replace unsupported characters with a space. */
export const toSegmentText = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/./g, (c) => (c in ALNUM ? c : ' '))

export function FourteenSegment({ text, cells, className }: { text: string; cells: number; className?: string }) {
  const t = toSegmentText(text)
  const shown = t.length > cells ? t.slice(0, cells - 1) + '-' : t
  const pad = Math.floor((cells - shown.length) / 2)
  const chars = (' '.repeat(pad) + shown).padEnd(cells, ' ').split('')
  const w = 12
  return (
    <svg className={className} viewBox={`-1 -1 ${cells * w + 2} 18`} aria-hidden="true" focusable="false">
      <g transform="skewX(-10) translate(2 0)" strokeLinecap="round" fill="none">
        {chars.map((ch, i) => {
          const on = ALNUM[ch] ?? []
          if (!on.length) return null
          return (
            <g key={i} transform={`translate(${i * w} 0)`}>
              {on.map((s) => <path key={s} d={SEG14[s]} className="seg14-on" />)}
            </g>
          )
        })}
      </g>
    </svg>
  )
}
