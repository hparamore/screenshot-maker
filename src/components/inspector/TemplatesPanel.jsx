import React, { useState } from 'react'
import { useStore } from '../../store'

export default function TemplatesPanel() {
  const templates = useStore(s => s.templates)
  const saveTemplate = useStore(s => s.saveTemplate)
  const applyTemplate = useStore(s => s.applyTemplate)
  const applyTemplateAll = useStore(s => s.applyTemplateAll)
  const removeTemplate = useStore(s => s.removeTemplate)
  const selectedId = useStore(s => s.selectedId)

  const [name, setName] = useState('')

  const onSave = () => {
    const n = name.trim()
    if (!n) return
    saveTemplate(n)
    setName('')
  }

  return (
    <div className="section">
      <h3>Templates</h3>
      <div className="row">
        <input className="text" placeholder="Template name…" value={name} onChange={e => setName(e.target.value)}/>
        <button className="btn primary" onClick={onSave} disabled={!selectedId}>Save</button>
      </div>
      {!selectedId && <p style={{ fontSize: 11, color: '#7c8595' }}>Select a screenshot to save its style as a template.</p>}
      <div className="template-list" style={{ marginTop: 8 }}>
        {templates.map(t => (
          <div key={t.id} className="template-item">
            <span style={{fontSize: 12}}>{t.name}</span>
            <div style={{display:'flex', gap:4}}>
              <button className="btn small" onClick={() => applyTemplate(t.id)} disabled={!selectedId}>Apply</button>
              <button className="btn small ghost" onClick={() => applyTemplateAll(t.id)}>All</button>
              <button className="btn small danger" onClick={() => removeTemplate(t.id)}>×</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
