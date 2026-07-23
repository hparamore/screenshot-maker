import React, { useState } from 'react'
import { useStore, EXPORT_PRESETS } from '../store'
import { exportScreenshotPng, downloadDataUrl, batchExport, sanitizeFilename } from '../utils/export'
import ProjectMenu from './ProjectMenu'
import ConfirmDialog from './ConfirmDialog'
import PromptDialog from './PromptDialog'

const LANG_CODE = /^[a-z]{2,3}(-[a-z]{2,4})?$/

export default function Toolbar() {
  const exportSize = useStore(s => s.exportSize)
  const setExportSize = useStore(s => s.setExportSize)
  const screenshots = useStore(s => s.screenshots)
  const selectedId = useStore(s => s.selectedId)
  const addScreenshot = useStore(s => s.addScreenshot)
  const languages = useStore(s => s.languages)
  const activeLanguage = useStore(s => s.activeLanguage)
  const setActiveLanguage = useStore(s => s.setActiveLanguage)
  const addLanguage = useStore(s => s.addLanguage)
  const removeLanguage = useStore(s => s.removeLanguage)

  const [exportProgress, setExportProgress] = useState(null)
  // Export failures used to go to window.alert. They stay on screen until dismissed —
  // a half-finished batch is worth reading the reason for.
  const [exportError, setExportError] = useState(null)
  const [askAddLang, setAskAddLang] = useState(false)
  const [langToRemove, setLangToRemove] = useState(null)

  const matchingPreset = EXPORT_PRESETS.find(p =>
    p.width === exportSize.width && p.height === exportSize.height
  )

  const onPresetChange = (label) => {
    const p = EXPORT_PRESETS.find(p => p.label === label)
    if (!p) return
    if (p.label === 'Custom') return // keep current values
    setExportSize(p.width, p.height)
  }

  const onExportSelected = async () => {
    if (!selectedId) return
    const sc = screenshots.find(s => s.id === selectedId)
    try {
      const url = await exportScreenshotPng(selectedId, exportSize)
      downloadDataUrl(url, `${sanitizeFilename(sc.name)}_${activeLanguage.toUpperCase()}.png`)
    } catch (e) {
      setExportError('Export failed: ' + (e?.message || String(e)))
    }
  }

  const onBatchExport = async () => {
    setExportError(null)
    setExportProgress({ count: 0, total: screenshots.length * languages.length })
    try {
      await batchExport(
        screenshots,
        languages,
        exportSize,
        setActiveLanguage,
        sanitizeFilename,
        (count, total, filename) => setExportProgress({ count, total, filename })
      )
    } catch (e) {
      setExportError('Batch export failed: ' + (e?.message || String(e)))
    } finally {
      setExportProgress(null)
    }
  }

  // Rejections render inside the dialog, so a typo doesn't cost the user what they typed.
  const validateLangCode = (raw) => {
    const code = raw.toLowerCase()
    if (!LANG_CODE.test(code)) return 'Use a short language code like “es” or “pt-br”.'
    return null
  }

  const onAddLang = (raw) => {
    const code = raw.toLowerCase()
    setAskAddLang(false)
    addLanguage(code)
    setActiveLanguage(code)
  }

  return (
    <header className="toolbar">
      <div className="title">Screenshot Maker</div>
      <ProjectMenu />
      <div className="divider"/>

      <div className="group">
        <label className="lbl" style={{ color: '#9aa3b2', fontSize: 11 }}>Size</label>
        <select className="text" style={{ width: 240 }}
                value={matchingPreset?.label || 'Custom'}
                onChange={e => onPresetChange(e.target.value)}>
          {EXPORT_PRESETS.map(p => <option key={p.label} value={p.label}>{p.label}</option>)}
        </select>
        <input className="text num" style={{ width: 70 }} type="number" value={exportSize.width}
               onChange={e => setExportSize(Number(e.target.value), exportSize.height)} />
        <span style={{ color: '#7c8595' }}>×</span>
        <input className="text num" style={{ width: 70 }} type="number" value={exportSize.height}
               onChange={e => setExportSize(exportSize.width, Number(e.target.value))} />
      </div>

      <div className="divider"/>

      <div className="group">
        <label className="lbl" style={{ color: '#9aa3b2', fontSize: 11 }}>Lang</label>
        {languages.map(l => {
          const active = activeLanguage === l
          return (
            <span key={l} className={'lang-pill-group' + (active ? ' active' : '')}>
              <button
                type="button"
                className={'lang-pill' + (active ? ' active' : '')}
                aria-pressed={active}
                onClick={() => setActiveLanguage(l)}
                // Right-click still removes a language; it was the only way before, and
                // muscle memory shouldn't break just because there's a button now.
                onContextMenu={(e) => {
                  e.preventDefault()
                  if (languages.length > 1) setLangToRemove(l)
                }}
              >
                {l.toUpperCase()}
              </button>
              {active && languages.length > 1 && (
                <button
                  type="button"
                  className="lang-pill-remove"
                  aria-label={`Remove language ${l.toUpperCase()}`}
                  title={`Remove ${l.toUpperCase()}`}
                  onClick={() => setLangToRemove(l)}
                >
                  ×
                </button>
              )}
            </span>
          )
        })}
        <button className="btn small ghost" onClick={() => setAskAddLang(true)}>+ Lang</button>
      </div>

      <div className="spacer"/>

      <div className="group">
        <button className="btn" onClick={addScreenshot}>+ Add Screenshot</button>
        <button className="btn" onClick={onExportSelected} disabled={!selectedId}>Export PNG</button>
        <button className="btn primary" onClick={onBatchExport} disabled={screenshots.length === 0}>
          Export All ({screenshots.length}×{languages.length})
        </button>
      </div>

      {exportProgress && (
        <div style={{
          position: 'fixed', top: 60, right: 24,
          background: '#14171d', border: '1px solid #232831',
          padding: 12, borderRadius: 8, fontSize: 12, zIndex: 200
        }}>
          Exporting {exportProgress.count} / {exportProgress.total}…
          {exportProgress.filename && <div style={{ color: '#7c8595', marginTop: 4 }}>{exportProgress.filename}</div>}
        </div>
      )}

      {exportError && (
        <div className="project-notice error" role="alert"
             style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span>{exportError}</span>
          <button className="btn small ghost" onClick={() => setExportError(null)}>Dismiss</button>
        </div>
      )}

      <PromptDialog
        open={askAddLang}
        title="Add a language"
        message="Frames keep one set of words per language. Style stays shared across all of them."
        label="Code"
        defaultValue=""
        placeholder="es"
        hint="Two or three letters, optionally with a region — es, fr, ja, pt-br."
        confirmLabel="Add language"
        maxLength={8}
        validate={validateLangCode}
        onConfirm={onAddLang}
        onCancel={() => setAskAddLang(false)}
      />

      <ConfirmDialog
        open={!!langToRemove}
        title={`Remove “${(langToRemove || '').toUpperCase()}”?`}
        message="Every frame's text for this language is removed with it. The other languages are untouched."
        confirmLabel="Remove language"
        danger
        onConfirm={() => { removeLanguage(langToRemove); setLangToRemove(null) }}
        onCancel={() => setLangToRemove(null)}
      />
    </header>
  )
}
