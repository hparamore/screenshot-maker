import React from 'react'
import { useStore, DEVICE_TYPES } from '../../store'
import Stepper from '../Stepper'
import { useImageNatural } from '../../utils/useImageNatural'
import {
  computeDeviceWidth,
  computeScreenBounds,
  imagePanBounds,
  clampImageOffset
} from '../../utils/layout'

const QUICK_COLORS = [
  '#1d1d1f', // graphite black
  '#f5f5f0', // silver white
  '#5c4934', // titanium natural
  '#2d4f4a', // titanium dark green
  '#3a3a3c', // space black
  '#cfa44b', // gold
  '#4a90e2', // blue
  '#e85a4f', // orange-red
  '#d97744'  // warm orange
]

const MIN_ZOOM = 50
const MAX_ZOOM = 400

export default function DevicePanel({ screenshot }) {
  const patch = useStore(s => s.patchScreenshot)
  const d = screenshot.device

  return (
    <div className="section">
      <h3>Device Mockup</h3>
      <div className="row">
        <label className="lbl" htmlFor={`device-type-${screenshot.id}`}>Type</label>
        <select id={`device-type-${screenshot.id}`} className="text" value={d.type}
                onChange={e => patch(screenshot.id, ['device', 'type'], e.target.value)}>
          {DEVICE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>
      {d.type !== 'none' && (
        <>
          <div className="row">
            <label className="lbl">Color</label>
            <input type="color" className="color" aria-label="Device color" value={d.color}
                   onChange={e => patch(screenshot.id, ['device', 'color'], e.target.value)} />
            <input type="text" className="text" aria-label="Device color hex" value={d.color}
                   onChange={e => patch(screenshot.id, ['device', 'color'], e.target.value)} />
          </div>
          <div className="row" style={{ flexWrap: 'wrap', gap: 4 }}>
            {QUICK_COLORS.map(c => (
              <button key={c}
                      aria-label={`Device color ${c}`}
                      aria-pressed={d.color === c}
                      title={c}
                      onClick={() => patch(screenshot.id, ['device', 'color'], c)}
                      style={{
                        width: 24, height: 24, borderRadius: 6,
                        background: c, border: d.color === c ? '2px solid #4a7cff' : '1px solid #2a2f3a',
                        cursor: 'pointer'
                      }}/>
            ))}
          </div>
          <div className="row">
            <label className="lbl">
              <input type="checkbox" checked={d.showButtons}
                     onChange={e => patch(screenshot.id, ['device', 'showButtons'], e.target.checked)}/>
              {' '}Side buttons
            </label>
          </div>
          <div className="row">
            <label className="lbl">
              <input type="checkbox" checked={d.shadow}
                     onChange={e => patch(screenshot.id, ['device', 'shadow'], e.target.checked)}/>
              {' '}Drop shadow
            </label>
          </div>
        </>
      )}

      <ScreenshotFit screenshot={screenshot} />
    </div>
  )
}

// Pan & zoom for the dropped screenshot inside the device screen.
//
// `object-fit: cover` remains the base fit; this composes a transform on top of
// it, so scale 100% / offset 0,0 paints exactly what the tool always painted.
// Offsets are clamped to the slack that cover leaves — you cannot drag the image
// far enough to open a gap at an edge.
function ScreenshotFit({ screenshot }) {
  const exportSize = useStore(s => s.exportSize)
  const update = useStore(s => s.updateScreenshot)
  const imgNatural = useImageNatural(screenshot.image)

  const scale = Number.isFinite(screenshot.imageScale) ? screenshot.imageScale : 1
  const offset = {
    x: Number(screenshot.imageOffset?.x) || 0,
    y: Number(screenshot.imageOffset?.y) || 0
  }
  const pct = Math.round(scale * 100)

  const deviceWidth = computeDeviceWidth(screenshot, exportSize)
  const screenBounds = computeScreenBounds(screenshot, exportSize, deviceWidth)
  const bounds = imagePanBounds(screenBounds, imgNatural, scale)
  const maxX = Math.round(bounds.maxX)
  const maxY = Math.round(bounds.maxY)

  if (!screenshot.image) {
    return (
      <>
        <h3 style={{ marginTop: 16 }}>Screenshot Fit</h3>
        <p className="variant-hint">Drop a screenshot on this frame to pan and zoom it.</p>
      </>
    )
  }

  // Zooming out can strand an offset outside the new bounds, so every write
  // re-clamps rather than trusting the stored value.
  const setScale = (nextPct) => {
    const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Number(nextPct) || 100)) / 100
    update(screenshot.id, {
      imageScale: next,
      imageOffset: clampImageOffset(offset, imagePanBounds(screenBounds, imgNatural, next))
    })
  }

  const setOffset = (axis, value) => {
    update(screenshot.id, {
      imageOffset: clampImageOffset({ ...offset, [axis]: value }, bounds)
    })
  }

  const reset = () => update(screenshot.id, { imageScale: 1, imageOffset: { x: 0, y: 0 } })
  const isDefault = scale === 1 && offset.x === 0 && offset.y === 0

  return (
    <>
      <h3 style={{ marginTop: 16 }}>Screenshot Fit</h3>

      <div className="row">
        <label className="lbl" htmlFor={`img-zoom-range-${screenshot.id}`}>Zoom</label>
        <input
          id={`img-zoom-range-${screenshot.id}`}
          className="text"
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={1}
          value={Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pct))}
          onChange={e => setScale(e.target.value)}
        />
        <span style={{ fontSize: 11, color: '#7c8595', minWidth: 34, textAlign: 'right' }}>{pct}%</span>
      </div>

      <Stepper
        id={`img-zoom-${screenshot.id}`}
        label="Zoom"
        value={pct}
        suffix="%"
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        onChange={setScale}
        onReset={() => setScale(100)}
      />
      <Stepper
        id={`img-x-${screenshot.id}`}
        label={`Offset X (±${maxX}px)`}
        value={offset.x}
        suffix="px"
        min={-maxX}
        max={maxX}
        disabled={maxX === 0}
        onChange={(v) => setOffset('x', v)}
        onReset={() => setOffset('x', 0)}
      />
      <Stepper
        id={`img-y-${screenshot.id}`}
        label={`Offset Y (±${maxY}px)`}
        value={offset.y}
        suffix="px"
        min={-maxY}
        max={maxY}
        disabled={maxY === 0}
        onChange={(v) => setOffset('y', v)}
        onReset={() => setOffset('y', 0)}
      />

      <div className="row">
        <button className="btn small" onClick={reset} disabled={isDefault}>
          ↺ Reset pan &amp; zoom
        </button>
      </div>
      <p className="variant-hint">
        Drag the screenshot on the canvas to pan — hold Shift to lock an axis. An
        axis with no slack is disabled: zoom in to free it up.
      </p>
    </>
  )
}
