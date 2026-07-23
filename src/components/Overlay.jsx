import React, { useRef, useCallback } from 'react'
import { useStore } from '../store'

// Overlay supports two types:
//   { type: 'image', src, x, y, w, h, rotation, shadow, radius, border }
//   { type: 'zoom',  srcRef, srcRect:{x,y,w,h}, x, y, w, h, shadow, radius, border }
// All coordinates and sizes are in NATIVE canvas pixels.
//
// scale = displayScale (workspace zoom). Drag math divides screen pixels by scale to get native delta.
export default function Overlay({ overlay, screenshot, scale, selected, onSelect, sourceImage }) {
  const updateOverlay = useStore(s => s.updateOverlay)
  const removeOverlay = useStore(s => s.removeOverlay)
  const dragState = useRef(null)

  const handleMouseDown = useCallback((e, mode) => {
    e.stopPropagation()
    e.preventDefault()
    onSelect(overlay.id)
    dragState.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startW: overlay.w,
      startH: overlay.h,
      startOX: overlay.x,
      startOY: overlay.y
    }
    const onMove = (ev) => {
      const ds = dragState.current
      if (!ds) return
      const dx = (ev.clientX - ds.startX) / scale
      const dy = (ev.clientY - ds.startY) / scale
      if (ds.mode === 'move') {
        updateOverlay(screenshot.id, overlay.id, {
          x: ds.startOX + dx,
          y: ds.startOY + dy
        })
      } else if (ds.mode === 'resize') {
        const aspect = ds.startW / ds.startH
        const newW = Math.max(40, ds.startW + dx)
        const newH = newW / aspect
        updateOverlay(screenshot.id, overlay.id, { w: newW, h: newH })
      }
    }
    const onUp = () => {
      dragState.current = null
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }, [overlay, screenshot.id, scale, onSelect, updateOverlay])

  const onKeyDown = (e) => {
    if (!selected) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      removeOverlay(screenshot.id, overlay.id)
    }
  }

  const baseStyle = {
    left: overlay.x,
    top: overlay.y,
    width: overlay.w,
    height: overlay.h,
    transform: overlay.rotation ? `rotate(${overlay.rotation}deg)` : undefined,
    borderRadius: overlay.radius || 0,
    boxShadow: overlay.shadow
      ? `0 ${overlay.shadow.y || 20}px ${overlay.shadow.blur || 40}px rgba(0,0,0,${overlay.shadow.opacity ?? 0.35})`
      : 'none',
    border: overlay.border
      ? `${overlay.border.width}px solid ${overlay.border.color}${alphaHex(overlay.border.opacity ?? 1)}`
      : 'none',
    overflow: 'hidden',
    background: '#000'
  }

  return (
    <div
      className={'overlay' + (selected ? ' selected' : '')}
      style={baseStyle}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onMouseDown={(e) => handleMouseDown(e, 'move')}
      onClick={(e) => e.stopPropagation()}
    >
      {overlay.type === 'image' && (
        <img src={overlay.src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      )}
      {overlay.type === 'zoom' && sourceImage && (
        <ZoomContent overlay={overlay} sourceImage={sourceImage} />
      )}
      {selected && (
        <div className="resize-handle" onMouseDown={(e) => handleMouseDown(e, 'resize')} />
      )}
    </div>
  )
}

function ZoomContent({ overlay, sourceImage }) {
  // sourceImage = { src, naturalWidth, naturalHeight }
  // overlay.srcRect is in source-image pixel coordinates.
  const { src, naturalWidth, naturalHeight } = sourceImage
  const sx = overlay.srcRect.x
  const sy = overlay.srcRect.y
  const sw = overlay.srcRect.w
  const sh = overlay.srcRect.h
  // We render the full image inside, scaled so srcRect fits overlay box.
  const scaleX = overlay.w / sw
  const scaleY = overlay.h / sh
  // Use whichever scale fills the box (cover); but for a true zoom we want both axes to match the same scale.
  // We'll lock to scaleX (preserve aspect of source rect — UI handles aspect in selection).
  const s = scaleX
  return (
    <img
      src={src}
      alt=""
      style={{
        position: 'absolute',
        width: naturalWidth * s,
        height: naturalHeight * s,
        left: -sx * s,
        top: -sy * s,
        maxWidth: 'none',
        maxHeight: 'none'
      }}
    />
  )
}

function alphaHex(a) {
  const n = Math.round(Math.max(0, Math.min(1, a)) * 255)
  return n.toString(16).padStart(2, '0')
}
