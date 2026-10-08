// Machine artwork thumbnail: photo, else logo, else a text monogram. Loads only
// once scrolled near the viewport, through the verified media cache.
import { useEffect, useRef, useState } from 'react'
import type { AssetRef } from '../contract/types'
import { useArtwork } from './useArtwork'
import { MachineGlyph } from './icons'

export function Art(props: {
  photo: AssetRef | null
  logo: AssetRef | null
  label: string
  resolve: (rel: string) => string
  className?: string
  /** Load immediately instead of waiting to be visible (hero images). */
  eager?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(!!props.eager)
  useEffect(() => {
    if (visible || !ref.current) return
    if (typeof IntersectionObserver === 'undefined') return setVisible(true)
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setVisible(true)
        io.disconnect()
      }
    }, { rootMargin: '200px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [visible])
  const asset = props.photo ?? props.logo
  const url = useArtwork(visible && asset ? props.resolve(asset.url) : null, asset?.sha256 ?? null)
  const kind = props.photo ? 'photo' : props.logo ? 'logo' : 'text'
  return (
    <div ref={ref} className={`art art--${kind} ${props.className ?? ''}`} aria-hidden="true">
      {asset && url ? (
        <img src={url} alt="" width={asset.width} height={asset.height} draggable={false} />
      ) : (
        kind === 'text' ? <MachineGlyph className="art__glyph" /> : <span className="art__text" />
      )}
    </div>
  )
}
