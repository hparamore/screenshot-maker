import React from 'react'
import { useStore } from '../../store'

export default function PaddingPanel({ screenshot }) {
  const patch = useStore(s => s.patchScreenshot)
  const p = screenshot.padding

  const set = (k, v) => patch(screenshot.id, ['padding', k], Number(v))

  return (
    <div className="section">
      <h3>Padding</h3>
      <div className="padbox">
        <div className="pad-cell">
          <span>Top</span>
          <input className="text" type="number" value={p.top} onChange={e => set('top', e.target.value)}/>
        </div>
        <div className="pad-cell">
          <span>Bottom</span>
          <input className="text" type="number" value={p.bottom} onChange={e => set('bottom', e.target.value)}/>
        </div>
        <div className="pad-cell">
          <span>Left</span>
          <input className="text" type="number" value={p.left} onChange={e => set('left', e.target.value)}/>
        </div>
        <div className="pad-cell">
          <span>Right</span>
          <input className="text" type="number" value={p.right} onChange={e => set('right', e.target.value)}/>
        </div>
      </div>
    </div>
  )
}
