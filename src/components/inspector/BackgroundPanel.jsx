import React, { useRef, useState } from 'react'
import { useStore } from '../../store'
import { extractPalette } from '../../utils/palette'

export default function BackgroundPanel({ screenshot }) {
  const patch = useStore(s => s.patchScreenshot)
  const fileRef = useRef(null)
  // Palette extraction failures used to go to window.alert. They stay on screen until
  // dismissed, matching the export-failure notice in Toolbar.jsx — a genuine error is
  // worth reading the reason for, not a toast that vanishes on its own.
  const [matchError, setMatchError] = useState(null)

  const bg = screenshot.background
  const hasImage = !!screenshot.image

  const setType = (type) => patch(screenshot.id, ['background', 'type'], type)

  const onUploadBg = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      patch(screenshot.id, ['background', 'image'], ev.target.result)
      patch(screenshot.id, ['background', 'type'], 'image')
    }
    reader.readAsDataURL(file)
  }

  const matchBackground = async () => {
    if (!hasImage) return
    setMatchError(null)
    try {
      const { color1, color2 } = await extractPalette(screenshot.image)
      patch(screenshot.id, ['background', 'color1'], color1)
      patch(screenshot.id, ['background', 'color2'], color2)
      patch(screenshot.id, ['background', 'type'], 'gradient')
    } catch (e) {
      setMatchError('Could not extract palette: ' + e.message)
    }
  }

  return (
    <div className="section">
      <h3>Background</h3>
      <div className="tabs">
        <button className={'tab' + (bg.type === 'solid' ? ' active' : '')} onClick={() => setType('solid')}>Solid</button>
        <button className={'tab' + (bg.type === 'gradient' ? ' active' : '')} onClick={() => setType('gradient')}>Gradient</button>
        <button className={'tab' + (bg.type === 'image' ? ' active' : '')} onClick={() => setType('image')}>Image</button>
      </div>

      {bg.type === 'solid' && (
        <div className="row">
          <label className="lbl">Color</label>
          <input type="color" className="color" value={bg.color1}
                 onChange={e => patch(screenshot.id, ['background', 'color1'], e.target.value)} />
          <input type="text" className="text" value={bg.color1}
                 onChange={e => patch(screenshot.id, ['background', 'color1'], e.target.value)} />
        </div>
      )}

      {bg.type === 'gradient' && (
        <>
          <div className="gradient-preview" style={{
            background: `linear-gradient(${bg.angle}deg, ${bg.color1}, ${bg.color2})`
          }}/>
          <div className="row">
            <label className="lbl">Color 1</label>
            <input type="color" className="color" value={bg.color1}
                   onChange={e => patch(screenshot.id, ['background', 'color1'], e.target.value)} />
            <input type="text" className="text" value={bg.color1}
                   onChange={e => patch(screenshot.id, ['background', 'color1'], e.target.value)} />
          </div>
          <div className="row">
            <label className="lbl">Color 2</label>
            <input type="color" className="color" value={bg.color2}
                   onChange={e => patch(screenshot.id, ['background', 'color2'], e.target.value)} />
            <input type="text" className="text" value={bg.color2}
                   onChange={e => patch(screenshot.id, ['background', 'color2'], e.target.value)} />
          </div>
          <div className="row">
            <label className="lbl">Angle</label>
            <AngleDial angle={bg.angle}
                       onChange={(deg) => patch(screenshot.id, ['background', 'angle'], deg)}/>
            <input type="number" className="text num" value={Math.round(bg.angle)}
                   onChange={e => patch(screenshot.id, ['background', 'angle'], Number(e.target.value))} />
          </div>
        </>
      )}

      {bg.type === 'image' && (
        <>
          {bg.image && (
            <img src={bg.image} alt="" style={{ width: '100%', borderRadius: 6, marginBottom: 8 }}/>
          )}
          <div className="row">
            <button className="btn" onClick={() => fileRef.current?.click()}>Upload image…</button>
            {bg.image && (
              <button className="btn ghost" onClick={() => patch(screenshot.id, ['background', 'image'], null)}>Clear</button>
            )}
            <input type="file" accept="image/*" ref={fileRef} style={{display:'none'}} onChange={onUploadBg}/>
          </div>
          <div className="row">
            <label className="lbl">Fit</label>
            <select className="text" value={bg.imageFit || 'cover'}
                    onChange={e => patch(screenshot.id, ['background', 'imageFit'], e.target.value)}>
              <option value="cover">Cover</option>
              <option value="contain">Contain</option>
              <option value="100% 100%">Stretch</option>
            </select>
          </div>
        </>
      )}

      <button className="btn" style={{ marginTop: 8, width: '100%' }} onClick={matchBackground}
              disabled={!hasImage}
              title={hasImage ? undefined : 'Drop a phone screenshot first to extract its colors.'}>
        ✦ Match Background to screenshot
      </button>
      {!hasImage && (
        <p className="variant-hint" style={{ marginTop: 6 }}>
          Drop a phone screenshot first to extract its colors.
        </p>
      )}

      {matchError && (
        <div className="project-notice error" role="alert"
             style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>{matchError}</span>
          <button className="btn small ghost" onClick={() => setMatchError(null)}>Dismiss</button>
        </div>
      )}
    </div>
  )
}

function AngleDial({ angle, onChange }) {
  const ref = useRef(null)
  const onMouseDown = (e) => {
    e.preventDefault()
    const el = ref.current
    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const update = (ev) => {
      const dx = ev.clientX - cx
      const dy = ev.clientY - cy
      // angle 0 = up
      let deg = Math.atan2(dx, -dy) * 180 / Math.PI
      if (deg < 0) deg += 360
      onChange(deg)
    }
    update(e)
    const onMove = (ev) => update(ev)
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }
  return (
    <div ref={ref} className="angle-dial" onMouseDown={onMouseDown}>
      <div className="needle" style={{ transform: `translate(-50%, 0) rotate(${angle}deg)` }}/>
      <div className="center-dot"/>
    </div>
  )
}
