import React, { useId, useState } from 'react'
import { useStore } from '../../store'
import Stepper from '../Stepper'
import { useImageNatural } from '../../utils/useImageNatural'
import { computeDeviceWidth, computeScreenBounds, cropNaturalCanvasSize } from '../../utils/layout'

export default function OverlaysPanel({ screenshot }) {
  const selectedOverlayId = useStore(s => s.selectedOverlayId)
  const selectOverlay = useStore(s => s.selectOverlay)
  const updateOverlay = useStore(s => s.updateOverlay)
  const removeOverlay = useStore(s => s.removeOverlay)
  const setZoomMode = useStore(s => s.setZoomMode)
  const zoomMode = useStore(s => s.zoomMode)
  const cropEditingId = useStore(s => s.cropEditingId)
  const setCropEditing = useStore(s => s.setCropEditing)
  const exportSize = useStore(s => s.exportSize)

  const overlay = screenshot.overlays.find(o => o.id === selectedOverlayId)
  const imgNatural = useImageNatural(screenshot.image)

  // There is no "paste" button to press — the browser only hands us clipboard image data
  // from a real paste. So this affordance explains itself in place rather than throwing an
  // alert the user has to dismiss before they can follow the instructions.
  const [showPasteHint, setShowPasteHint] = useState(false)
  const pasteHintId = useId()

  return (
    <div className="section">
      <h3>Overlays</h3>
      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <button
          className={'btn' + (zoomMode ? ' primary' : '')}
          onClick={() => setZoomMode(!zoomMode)}
          disabled={!screenshot.image}
          title={!screenshot.image ? 'Drop a screenshot first' : 'Drag a region to zoom'}
        >
          {zoomMode ? 'Cancel zoom' : '⊕ Pop-out zoom'}
        </button>
        <button
          className={'btn ghost' + (showPasteHint ? ' primary' : '')}
          aria-expanded={showPasteHint}
          aria-controls={pasteHintId}
          onClick={() => setShowPasteHint(v => !v)}
        >
          📋 Paste image…
        </button>
      </div>

      {showPasteHint && (
        <p id={pasteHintId} className="panel-hint">
          Press <kbd>⌘V</kbd> while this frame is selected to drop the image on your clipboard
          onto it. PNG and SVG copied out of Figma both work.
        </p>
      )}

      {screenshot.overlays.length === 0 && (
        <p style={{ color: '#7c8595', fontSize: 11, marginTop: 8 }}>
          No overlays yet. Use Pop-out zoom to call attention to part of the screen, or paste a PNG/SVG from Figma to drop an element on top.
        </p>
      )}

      {screenshot.overlays.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 }}>
          {screenshot.overlays.map(o => (
            <div key={o.id}
                 onClick={() => selectOverlay(o.id)}
                 style={{
                   padding: '6px 10px',
                   borderRadius: 5,
                   background: selectedOverlayId === o.id ? '#2c323d' : '#1a1d24',
                   cursor: 'pointer',
                   fontSize: 12,
                   display: 'flex',
                   justifyContent: 'space-between',
                   alignItems: 'center'
                 }}>
              <span>{o.type === 'zoom' ? '🔍 Zoom region' : '🖼 Image'}</span>
              <button className="btn small danger" onClick={(e) => { e.stopPropagation(); removeOverlay(screenshot.id, o.id) }}>×</button>
            </div>
          ))}
        </div>
      )}

      {overlay && (
        <div style={{ marginTop: 12 }}>
          <h3>Selected Overlay</h3>
          <div className="row">
            <label className="lbl">X</label>
            <input className="text num" type="number" value={Math.round(overlay.x)}
                   onChange={e => updateOverlay(screenshot.id, overlay.id, { x: Number(e.target.value) })}/>
            <label className="lbl" style={{minWidth:20}}>Y</label>
            <input className="text num" type="number" value={Math.round(overlay.y)}
                   onChange={e => updateOverlay(screenshot.id, overlay.id, { y: Number(e.target.value) })}/>
          </div>
          <div className="row">
            <label className="lbl">W</label>
            <input className="text num" type="number" value={Math.round(overlay.w)}
                   onChange={e => updateOverlay(screenshot.id, overlay.id, { w: Number(e.target.value) })}/>
            <label className="lbl" style={{minWidth:20}}>H</label>
            <input className="text num" type="number" value={Math.round(overlay.h)}
                   onChange={e => updateOverlay(screenshot.id, overlay.id, { h: Number(e.target.value) })}/>
          </div>

          {overlay.type === 'zoom' && (
            <ZoomScale overlay={overlay} screenshot={screenshot}
                       imgNatural={imgNatural} exportSize={exportSize}
                       updateOverlay={updateOverlay}/>
          )}

          <h3 style={{ marginTop: 12 }}>Rotation</h3>
          <Stepper
            ariaLabel="Overlay rotation"
            value={overlay.rotation || 0}
            steps={[-10, -1, +1, +10]}
            suffix="°"
            onChange={(v) => updateOverlay(screenshot.id, overlay.id, { rotation: v })}
            onReset={() => updateOverlay(screenshot.id, overlay.id, { rotation: 0 })}
          />

          <div className="row" style={{ marginTop: 10 }}>
            <label className="lbl">Radius</label>
            <input className="text num" type="number" value={overlay.radius || 0}
                   onChange={e => updateOverlay(screenshot.id, overlay.id, { radius: Number(e.target.value) })}/>
          </div>

          {overlay.type === 'zoom' && (
            <CropControls overlay={overlay} screenshot={screenshot}
                          updateOverlay={updateOverlay}
                          cropEditingId={cropEditingId}
                          setCropEditing={setCropEditing}/>
          )}

          <h3 style={{ marginTop: 12 }}>Shadow</h3>
          <div className="row">
            <label className="lbl">Y</label>
            <input className="text num" type="number" value={overlay.shadow?.y || 0}
                   onChange={e => updateOverlay(screenshot.id, overlay.id, { shadow: { ...(overlay.shadow||{}), y: Number(e.target.value) } })}/>
            <label className="lbl" style={{minWidth:30}}>Blur</label>
            <input className="text num" type="number" value={overlay.shadow?.blur || 0}
                   onChange={e => updateOverlay(screenshot.id, overlay.id, { shadow: { ...(overlay.shadow||{}), blur: Number(e.target.value) } })}/>
          </div>
          <div className="row">
            <label className="lbl">Opacity</label>
            <input className="text" type="range" min={0} max={1} step={0.05} value={overlay.shadow?.opacity ?? 0}
                   onChange={e => updateOverlay(screenshot.id, overlay.id, { shadow: { ...(overlay.shadow||{}), opacity: Number(e.target.value) } })}/>
            <span style={{fontSize:11, color:'#7c8595'}}>{Math.round((overlay.shadow?.opacity ?? 0) * 100)}%</span>
          </div>

          <h3 style={{ marginTop: 12 }}>Border</h3>
          <div className="row">
            <label className="lbl">Width</label>
            <input className="text num" type="number" value={overlay.border?.width || 0}
                   onChange={e => updateOverlay(screenshot.id, overlay.id, { border: { ...(overlay.border||{}), width: Number(e.target.value) } })}/>
          </div>
          <div className="row">
            <label className="lbl">Color</label>
            <input type="color" className="color" value={overlay.border?.color || '#ffffff'}
                   onChange={e => updateOverlay(screenshot.id, overlay.id, { border: { ...(overlay.border||{}), color: e.target.value } })}/>
            <input type="text" className="text" value={overlay.border?.color || '#ffffff'}
                   onChange={e => updateOverlay(screenshot.id, overlay.id, { border: { ...(overlay.border||{}), color: e.target.value } })}/>
          </div>
          <div className="row">
            <label className="lbl">Opacity</label>
            <input className="text" type="range" min={0} max={1} step={0.05} value={overlay.border?.opacity ?? 1}
                   onChange={e => updateOverlay(screenshot.id, overlay.id, { border: { ...(overlay.border||{}), opacity: Number(e.target.value) } })}/>
            <span style={{fontSize:11, color:'#7c8595'}}>{Math.round((overlay.border?.opacity ?? 1) * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  )
}

// Zoom-overlay scale control. 100% = same size as the cropped region would appear
// on the underlying screen. Slider range 10–300%; type-in supported; reset to 100%.
function ZoomScale({ overlay, screenshot, imgNatural, exportSize, updateOverlay }) {
  const deviceWidth = computeDeviceWidth(screenshot, exportSize)
  const screenBounds = computeScreenBounds(screenshot, exportSize, deviceWidth)
  const natural = cropNaturalCanvasSize(overlay, screenBounds, imgNatural)

  if (!natural || natural.w <= 0) {
    return (
      <p style={{ fontSize: 11, color: '#7c8595', marginTop: 6 }}>
        (Scale unavailable — drop a screenshot first.)
      </p>
    )
  }

  const currentScale = overlay.w / natural.w  // multiplier
  const currentPct = Math.round(currentScale * 100)

  const setScale = (pct) => {
    const s = Math.max(0.05, pct / 100)
    const newW = natural.w * s
    const newH = natural.h * s
    const cx = overlay.x + overlay.w / 2
    const cy = overlay.y + overlay.h / 2
    updateOverlay(screenshot.id, overlay.id, {
      x: cx - newW / 2,
      y: cy - newH / 2,
      w: newW,
      h: newH
    })
  }

  return (
    <>
      <h3 style={{ marginTop: 12 }}>Scale</h3>
      <div className="row">
        <input type="range" className="text"
               min={10} max={300} step={1}
               value={Math.min(300, Math.max(10, currentPct))}
               onChange={e => setScale(Number(e.target.value))}/>
      </div>
      <div className="row" style={{ gap: 4 }}>
        <button className="btn small" onClick={() => setScale(currentPct - 10)}>-10</button>
        <button className="btn small" onClick={() => setScale(currentPct - 1)}>-1</button>
        <input className="text" style={{ width: 70, textAlign: 'center' }}
               type="number"
               value={currentPct}
               onChange={e => setScale(Number(e.target.value) || 0)}/>
        <span style={{ fontSize: 11, color: '#7c8595' }}>%</span>
        <button className="btn small" onClick={() => setScale(currentPct + 1)}>+1</button>
        <button className="btn small" onClick={() => setScale(currentPct + 10)}>+10</button>
        <button className="btn small ghost" onClick={() => setScale(100)} title="Reset to 100%">↺</button>
      </div>
      <p style={{ fontSize: 10, color: '#7c8595', margin: '4px 0 0' }}>
        100% = same size as the original region on the screen. Slider goes 10–300%.
      </p>
    </>
  )
}

function CropControls({ overlay, screenshot, updateOverlay, cropEditingId, setCropEditing }) {
  const sr = overlay.srcRect || { x: 0, y: 0, w: 0, h: 0 }
  const editing = cropEditingId === overlay.id

  const setSr = (k, v) => updateOverlay(screenshot.id, overlay.id, {
    srcRect: { ...sr, [k]: Math.max(0, Number(v) || 0) }
  })

  return (
    <>
      <h3 style={{ marginTop: 12 }}>Crop (source region)</h3>
      <div className="row">
        <button className={'btn' + (editing ? ' primary' : '')}
                onClick={() => setCropEditing(editing ? null : overlay.id)}>
          {editing ? 'Cancel · drag region' : '✂ Re-select crop region'}
        </button>
      </div>
      {editing && (
        <p style={{ fontSize: 11, color: '#9aa3b2', margin: '4px 0 8px' }}>
          Drag a new rectangle on the screenshot to replace the current crop.
        </p>
      )}
      <div className="row">
        <label className="lbl">Src X</label>
        <input className="text num" type="number" value={Math.round(sr.x)}
               onChange={e => setSr('x', e.target.value)}/>
        <label className="lbl" style={{minWidth:30}}>Src Y</label>
        <input className="text num" type="number" value={Math.round(sr.y)}
               onChange={e => setSr('y', e.target.value)}/>
      </div>
      <div className="row">
        <label className="lbl">Src W</label>
        <input className="text num" type="number" value={Math.round(sr.w)}
               onChange={e => setSr('w', e.target.value)}/>
        <label className="lbl" style={{minWidth:30}}>Src H</label>
        <input className="text num" type="number" value={Math.round(sr.h)}
               onChange={e => setSr('h', e.target.value)}/>
      </div>
    </>
  )
}
