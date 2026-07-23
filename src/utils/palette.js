// Lightweight 2-color palette extraction from an image element.
// Samples pixels, buckets by quantized color, returns the two most common.
export async function extractPalette(imgSrc) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      const w = 100
      const h = Math.round(img.height * (w / img.width))
      canvas.width = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)
      const data = ctx.getImageData(0, 0, w, h).data
      const buckets = new Map()
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] >> 4 << 4
        const g = data[i+1] >> 4 << 4
        const b = data[i+2] >> 4 << 4
        const a = data[i+3]
        if (a < 200) continue
        const k = `${r},${g},${b}`
        buckets.set(k, (buckets.get(k) || 0) + 1)
      }
      const sorted = [...buckets.entries()].sort((a, b) => b[1] - a[1])
      const colors = sorted.slice(0, 8).map(([k]) => k.split(',').map(Number))
      const c1 = colors[0] || [60, 60, 60]
      // pick second color that's perceptually distant from first
      let c2 = colors[1] || [120, 120, 120]
      for (const c of colors.slice(1)) {
        const dist = Math.sqrt((c[0]-c1[0])**2 + (c[1]-c1[1])**2 + (c[2]-c1[2])**2)
        if (dist > 80) { c2 = c; break }
      }
      resolve({ color1: rgbHex(c1), color2: rgbHex(c2) })
    }
    img.onerror = reject
    img.src = imgSrc
  })
}

function rgbHex([r, g, b]) {
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('')
}
