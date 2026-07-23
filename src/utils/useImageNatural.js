import { useEffect, useState } from 'react'

export function useImageNatural(src) {
  const [info, setInfo] = useState(null)
  useEffect(() => {
    if (!src) { setInfo(null); return }
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (!cancelled) setInfo({
        src,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight
      })
    }
    img.src = src
    return () => { cancelled = true }
  }, [src])
  return info
}
