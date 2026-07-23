import React from 'react'
import { useStore } from '../store'
import BackgroundPanel from './inspector/BackgroundPanel'
import TextPanel from './inspector/TextPanel'
import PaddingPanel from './inspector/PaddingPanel'
import DevicePanel from './inspector/DevicePanel'
import OverlaysPanel from './inspector/OverlaysPanel'
import TemplatesPanel from './inspector/TemplatesPanel'

export default function Inspector() {
  const screenshots = useStore(s => s.screenshots)
  const selectedId = useStore(s => s.selectedId)
  const updateScreenshot = useStore(s => s.updateScreenshot)
  const screenshot = screenshots.find(s => s.id === selectedId)

  if (!screenshot) {
    return (
      <aside className="inspector">
        <div className="empty-state">
          Select a screenshot to edit its background, text, padding, device mockup, and overlays.
        </div>
        <TemplatesPanel/>
      </aside>
    )
  }

  return (
    <aside className="inspector">
      <div className="section">
        <h3>Frame</h3>
        <div className="row">
          <label className="lbl">Name</label>
          <input className="text" value={screenshot.name}
                 onChange={e => updateScreenshot(screenshot.id, { name: e.target.value })}/>
        </div>
      </div>
      <BackgroundPanel screenshot={screenshot}/>
      <TextPanel screenshot={screenshot}/>
      <PaddingPanel screenshot={screenshot}/>
      <DevicePanel screenshot={screenshot}/>
      <OverlaysPanel screenshot={screenshot}/>
      <TemplatesPanel/>
    </aside>
  )
}
