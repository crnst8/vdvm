// Fine line-art instrument icons and panel glyphs. Stroke uses currentColor.
import type { SVGProps } from 'react'

const line = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
type P = SVGProps<SVGSVGElement>
const Svg = ({ children, ...p }: P) => (
  <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true" focusable="false" {...p}>
    <g {...line}>{children}</g>
  </svg>
)

export const MixerIcon = (p: P) => <Svg {...p}><path d="M10 7v26M20 7v26M30 7v26" /><path d="M6 13h8v5H6zM16 24h8v5h-8zM26 10h8v5h-8z" fill="currentColor" /></Svg>
export const StepsIcon = (p: P) => <Svg {...p}>{[0, 1, 2, 3].map((i) => <rect key={i} x={5 + i * 8} y={i % 2 ? 17 : 10} width="5" height={i % 2 ? 15 : 22} rx="1" />)}</Svg>
export const SwingIcon = (p: P) => <Svg {...p}><path d="M5 25c8 0 7-14 14-14s6 14 16 14M6 32h28" /><circle cx="12" cy="32" r="2" fill="currentColor" /><circle cx="29" cy="32" r="2" fill="currentColor" /></Svg>
export const StraightIcon = (p: P) => <Svg {...p}><path d="M6 25h28M10 10v10M20 10v10M30 10v10" /></Svg>
export const CollapseIcon = (p: P) => <Svg {...p}><path d="m24 10-10 10 10 10M14 20h20" /></Svg>
export const MidiExportIcon = (p: P) => <Svg {...p}><path d="M7 8h26v17H7zM12 8v10h5V8M23 8v10h5V8M20 25v10m-5-5 5 5 5-5" /></Svg>
export const AudioExportIcon = (p: P) => <Svg {...p}><path d="M5 19h4l3-9 5 19 5-24 5 19 3-5h5M20 29v8m-4-4 4 4 4-4" /></Svg>

/** Bass drum, front view: shell, head lugs, pedal beater. */
export const KickIcon = (p: P) => (
  <Svg {...p}>
    <circle cx="20" cy="18" r="11" />
    <circle cx="20" cy="18" r="9.6" strokeWidth="0.6" />
    {[0, 60, 120, 180, 240, 300].map((a) => {
      const r = (a * Math.PI) / 180
      return <circle key={a} cx={20 + 11.8 * Math.cos(r)} cy={18 + 11.8 * Math.sin(r)} r="0.9" />
    })}
    <circle cx="20" cy="20" r="1.6" />
    <path d="M20 21.6v6.4M17 34h6l-1-5.5h-4z" />
  </Svg>
)

/** Snare, side view: shell with lugs and rims. */
export const SnareIcon = (p: P) => (
  <Svg {...p}>
    <ellipse cx="20" cy="15" rx="12" ry="2.6" />
    <path d="M8 15v9c0 1.5 5.4 2.6 12 2.6s12-1.1 12-2.6v-9" />
    <path d="M8 23.2c0 1.5 5.4 2.6 12 2.6s12-1.1 12-2.6" strokeWidth="0.6" />
    <path d="M12 17.2v6.4M20 17.6v7.2M28 17.2v6.4" />
    <path d="M11 19h2M19 19.6h2M27 19h2" />
  </Svg>
)

/** Closed hi-hat: two cymbals together on a stand. */
export const HatClosedIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 6v28" />
    <path d="M6 20.2c4-1.6 24-1.6 28 0-4 1.2-24 1.2-28 0z" />
    <path d="M7 21.2c4 1.4 22 1.4 26 0" />
    <rect x="18.6" y="16.6" width="2.8" height="2.2" rx="0.4" />
    <rect x="18.6" y="22.6" width="2.8" height="1.8" rx="0.4" />
  </Svg>
)

/** Open hi-hat: two cymbals apart on a stand. */
export const HatOpenIcon = (p: P) => (
  <Svg {...p}>
    <path d="M20 6v28" />
    <path d="M7 16.8c4-1.4 22-1.4 26 0-4 1-22 1-26 0z" />
    <path d="M7 23.4c4-1.4 22-1.4 26 0-4 1-22 1-26 0z" />
    <rect x="18.6" y="13.6" width="2.8" height="2" rx="0.4" />
    <rect x="18.6" y="19.6" width="2.8" height="2" rx="0.4" />
  </Svg>
)

/** Cymbal on a stand. */
export const CymbalIcon = (p: P) => (
  <Svg {...p}>
    <path d="M9 14.6c4-2 18-2 22 0-4 1.2-18 1.2-22 0z" />
    <path d="M18.8 11.2h2.4l.6 2h-3.6z" />
    <path d="M20 15.6v18" />
  </Svg>
)

/** Tom, angled side view. */
export const TomIcon = (p: P) => (
  <Svg {...p}>
    <ellipse cx="20" cy="13" rx="10" ry="3" />
    <path d="M10 13v11c0 1.7 4.5 3 10 3s10-1.3 10-3V13" />
    <path d="M14 15.6v10M20 16v11M26 15.6v10" strokeWidth="0.7" />
  </Svg>
)

/** Clap: two open hands. */
export const ClapIcon = (p: P) => (
  <Svg {...p}>
    <path d="M14 30l-3-9c-.5-1.4 1.4-2.2 2-.9l2 4V10.5c0-1.4 2-1.4 2 0V20v-11c0-1.4 2-1.4 2 0v11" />
    <path d="M26 30l3-9c.5-1.4-1.4-2.2-2-.9l-2 4V12c0-1.4-2-1.4-2 0v8" />
    <path d="M9 11l-2-2M31 11l2-2M20 5.5V3" />
  </Svg>
)

/** Rim shot: stick across a drum rim. */
export const RimIcon = (p: P) => (
  <Svg {...p}>
    <ellipse cx="20" cy="22" rx="12" ry="3" />
    <path d="M8 22v6c0 1.7 5.4 3 12 3s12-1.3 12-3v-6" />
    <path d="M9 10l22 13" strokeWidth="1.6" />
  </Svg>
)

/** Percussion fallback: cowbell-like shape. */
export const PercussionIcon = (p: P) => (
  <Svg {...p}>
    <path d="M15 11h10l4 18H11z" />
    <path d="M17.5 11V8h5v3" />
    <path d="M13.5 24h13" strokeWidth="0.6" />
  </Svg>
)

export const INSTRUMENT_ICONS: Record<string, (p: P) => React.JSX.Element> = {
  kick: KickIcon,
  snare: SnareIcon,
  'hat-closed': HatClosedIcon,
  'hat-open': HatOpenIcon,
  cymbal: CymbalIcon,
  tom: TomIcon,
  clap: ClapIcon,
  rim: RimIcon,
  percussion: PercussionIcon,
}

/** Three book spines: two upright, one leaning. */
export const BooksIcon = (p: P) => (
  <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false" {...p}>
    <g fill="currentColor">
      <rect x="4" y="4.5" width="5" height="23" rx="1.2" />
      <rect x="10.8" y="4.5" width="5" height="23" rx="1.2" />
      <rect x="18.6" y="4.8" width="5" height="23.4" rx="1.2" transform="rotate(-18 21 16.5)" />
    </g>
  </svg>
)

/** Bookmark with a V-cut bottom. Filled when saved, outlined when not. */
export const BookmarkIcon = ({ filled, ...p }: P & { filled: boolean }) => (
  <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false" {...p}>
    <path
      d="M8 4.5h16a1 1 0 0 1 1 1v22l-9-6.8-9 6.8v-22a1 1 0 0 1 1-1z"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : 2}
      strokeLinejoin="round"
    />
  </svg>
)

/** The V.D.V.M mark: seven overlapping ellipses. Stroke comes from CSS (currentColor). */
export const BrandRings = (p: P) => (
  <svg viewBox="0 0 180 90" aria-hidden="true" focusable="false" {...p}>
    {[0, 1, 2, 3, 4, 5, 6].map((i) => <ellipse key={i} cx={54 + i * 12} cy="45" rx="43" ry="35" />)}
  </svg>
)

/** Bin with lid and handle; the three slots are cut out of the body. */
export const TrashIcon = (p: P) => (
  <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false" {...p}>
    <path fill="currentColor" d="M12.5 3h7a1.5 1.5 0 0 1 1.5 1.5V6h5.5a1.5 1.5 0 0 1 0 3h-21a1.5 1.5 0 0 1 0-3H11V4.5A1.5 1.5 0 0 1 12.5 3zm1.5 2.6V6h4v-.4z" />
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M7.2 11h17.6l-1.4 16.3a2 2 0 0 1-2 1.7H10.6a2 2 0 0 1-2-1.7zM11.6 14.2a1 1 0 0 0-1 1.1l.7 9.2a1 1 0 0 0 2-.1l-.7-9.3a1 1 0 0 0-1-.9zm4.4 0a1 1 0 0 0-1 1v9.2a1 1 0 0 0 2 0v-9.2a1 1 0 0 0-1-1zm4.4 0a1 1 0 0 0-1 .9l-.7 9.3a1 1 0 0 0 2 .1l.7-9.2a1 1 0 0 0-1-1.1z"
    />
  </svg>
)

/** Speaker with sound waves: output volume. Waves dim with `level` (0 none, 1 one, 2 two). */
export const SpeakerIcon = ({ level = 2, ...p }: P & { level?: 0 | 1 | 2 }) => (
  <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false" {...p}>
    <path fill="currentColor" d="M4 12h5l7-6v20l-7-6H4z" />
    <g fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M20 12.2a5 5 0 0 1 0 7.6" opacity={level >= 1 ? 1 : 0.3} />
      <path d="M23.6 8.6a10 10 0 0 1 0 14.8" opacity={level >= 2 ? 1 : 0.3} />
    </g>
  </svg>
)

/** Arrow turning back on itself: undo. */
export const UndoIcon = (p: P) => (
  <svg viewBox="0 0 32 32" width="32" height="32" aria-hidden="true" focusable="false" {...p}>
    <path d="M10 13h10.5a6.5 6.5 0 0 1 0 13H13" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    <path d="M12.5 6.5 5.5 13l7 6.5z" fill="currentColor" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
)

export const TriangleIcon =({ dir, ...p }: P & { dir: 'left' | 'right' }) => (
  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" {...p}>
    <path d={dir === 'left' ? 'M12 2.5v11L3 8z' : 'M4 2.5v11L13 8z'} fill="currentColor" />
  </svg>
)

/** Five-point star; filled for a favourite, outlined otherwise. */
export const StarIcon = ({ filled, ...p }: P & { filled: boolean }) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" {...p}>
    <path
      d="M12 2.8l2.75 5.9 6.45.72-4.8 4.38 1.33 6.36L12 16.9l-5.73 3.26 1.33-6.36-4.8-4.38 6.45-.72z"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinejoin="round"
    />
  </svg>
)

export const InfoIcon = (p: P) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" {...p}>
    <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    <path d="M12 10.6v6.2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="12" cy="7.4" r="1.15" fill="currentColor" />
  </svg>
)

export const BackIcon = (p: P) => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false" {...p}>
    <path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const ShuffleIcon = (p: P) => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false" {...p}>
    <g fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 7h3.5c4.5 0 6.5 10 11 10H21M3 17h3.5c1.7 0 2.9-1.4 3.9-3.2M13.6 10.2C14.6 8.4 15.8 7 17.5 7H21" />
      <path d="M18.5 4.5L21 7l-2.5 2.5M18.5 14.5L21 17l-2.5 2.5" />
    </g>
  </svg>
)

export const ChevronIcon = ({ open, ...p }: P & { open: boolean }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" {...p}>
    <path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

/** Placeholder for machines without a photo: a small panel with display, knobs and a row of step keys. */
export const MachineGlyph = (p: P) => (
  <svg viewBox="0 0 96 64" width="96" height="64" aria-hidden="true" focusable="false" {...p}>
    <rect x="4" y="10" width="88" height="44" rx="5" fill="#2f2d2c" stroke="#4a4640" />
    <rect x="11" y="17" width="22" height="9" rx="1.5" fill="#0a0a0a" />
    <rect x="14" y="20" width="10" height="3" rx="0.5" fill="#8a1020" />
    <circle cx="44" cy="21.5" r="3.6" fill="#1a1918" stroke="#6b6450" />
    <circle cx="56" cy="21.5" r="3.6" fill="#1a1918" stroke="#6b6450" />
    <circle cx="68" cy="21.5" r="3.6" fill="#1a1918" stroke="#6b6450" />
    <circle cx="82" cy="21.5" r="2" fill="#ff2a1a" />
    <g fill="#e4dfcd">
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <rect key={i} x={11 + i * 9.6} y="34" width="7.2" height="12" rx="1.6" />
      ))}
    </g>
    <path d="M11 30h74" stroke="#ff5200" strokeOpacity="0.5" strokeWidth="0.8" />
  </svg>
)

/** Circuit: a chip with pins and traces, for hardware timing. */
export const CircuitIcon = (p: P) => (
  <Svg {...p}>
    <rect x="13" y="13" width="14" height="14" rx="1.5" />
    <path d="M17 13V8M23 13V8M17 27v5M23 27v5M13 17H8M13 23H8M27 17h5M27 23h5" />
    <path d="M8 8h-3M32 32h3" strokeWidth="0.8" />
    <circle cx="17" cy="17" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
)
