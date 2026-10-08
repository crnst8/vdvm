import { useEffect, useState } from 'react'
import { platform } from '@platform'

/**
 * Artwork uses the same verified cache as offline-kit downloads. The plugin
 * has no media cache: its resource provider serves the library's files directly.
 */
export function useArtwork(url: string | null, sha256: string | null) {
  const [image, setImage] = useState<{ url: string; objectUrl: string } | null>(null)
  useEffect(() => {
    setImage(null)
    if (!url || !sha256) return
    const mediaCache = platform.mediaCache
    if (!mediaCache) {
      setImage({ url, objectUrl: url })
      return
    }
    let active = true
    let objectUrl: string | undefined
    void mediaCache.fetch(url, sha256).then((bytes) => {
      if (!active) return
      objectUrl = URL.createObjectURL(new Blob([bytes]))
      setImage({ url, objectUrl })
    }).catch(() => { /* Keep the text fallback when artwork is unavailable. */ })
    return () => {
      active = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [url, sha256])
  return image?.url === url ? image.objectUrl : null
}
