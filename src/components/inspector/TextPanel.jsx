import React, { useState } from 'react'
import { useStore } from '../../store'
import FontPicker from '../FontPicker'
import ConfirmDialog from '../ConfirmDialog'
import Stepper from '../Stepper'
import {
  resolveTextTransform,
  isVariantUnlocked,
  isPrimaryLanguage,
  DEFAULT_TEXT_TRANSFORM
} from '../../utils/variants'
import {
  readTextMetrics,
  TEXT_METRIC_DEFAULTS,
  isOverflowing,
  overflowAmount,
  overflowByLanguage
} from '../../utils/textMetrics'

export default function TextPanel({ screenshot }) {
  const patch = useStore(s => s.patchScreenshot)
  const setText = useStore(s => s.setScreenshotText)
  const activeLanguage = useStore(s => s.activeLanguage)
  const t = screenshot.texts[activeLanguage] || { preheader: '', heading: '' }

  const txt = screenshot.text
  const metrics = readTextMetrics(txt)

  return (
    <div className="section">
      <h3>Text · {activeLanguage.toUpperCase()}</h3>

      <label className="lbl" htmlFor={`preheader-${screenshot.id}`} style={{ display: 'block', marginBottom: 4 }}>Pre-header</label>
      <input id={`preheader-${screenshot.id}`} type="text" className="text" value={t.preheader || ''}
             onChange={e => setText(screenshot.id, activeLanguage, 'preheader', e.target.value)} />
      <label className="lbl" htmlFor={`heading-${screenshot.id}`} style={{ display: 'block', margin: '10px 0 4px' }}>Heading (use *italics* for accent)</label>
      <textarea id={`heading-${screenshot.id}`} className="text" rows={3} value={t.heading || ''}
                onChange={e => setText(screenshot.id, activeLanguage, 'heading', e.target.value)} />

      <h3 style={{ marginTop: 16 }}>Style</h3>
      <div className="row">
        <label className="lbl" htmlFor={`font-${screenshot.id}`}>Font</label>
        <FontPicker
          id={`font-${screenshot.id}`}
          value={txt.fontFamily}
          onChange={(value) => patch(screenshot.id, ['text', 'fontFamily'], value)}
        />
      </div>
      <div className="row">
        <label className="lbl">Primary</label>
        <input type="color" className="color" aria-label="Primary text color" value={txt.primaryColor}
               onChange={e => patch(screenshot.id, ['text', 'primaryColor'], e.target.value)} />
        <input type="text" className="text" aria-label="Primary text color hex" value={txt.primaryColor}
               onChange={e => patch(screenshot.id, ['text', 'primaryColor'], e.target.value)} />
      </div>
      <div className="row">
        <label className="lbl">Accent</label>
        <input type="color" className="color" aria-label="Accent text color" value={txt.secondaryColor}
               onChange={e => patch(screenshot.id, ['text', 'secondaryColor'], e.target.value)} />
        <input type="text" className="text" aria-label="Accent text color hex" value={txt.secondaryColor}
               onChange={e => patch(screenshot.id, ['text', 'secondaryColor'], e.target.value)} />
      </div>
      <div className="row">
        <label className="lbl">Pre size</label>
        <input type="number" className="text num" aria-label="Pre-header size" value={txt.preheaderSize}
               onChange={e => patch(screenshot.id, ['text', 'preheaderSize'], Number(e.target.value))} />
        <label className="lbl" style={{minWidth:50}}>Weight</label>
        <input type="number" className="text num" aria-label="Pre-header weight" min={100} max={900} step={100} value={txt.preheaderWeight}
               onChange={e => patch(screenshot.id, ['text', 'preheaderWeight'], Number(e.target.value))} />
      </div>
      <div className="row">
        <label className="lbl">Heading</label>
        <input type="number" className="text num" aria-label="Heading size" value={txt.headingSize}
               onChange={e => patch(screenshot.id, ['text', 'headingSize'], Number(e.target.value))} />
        <label className="lbl" style={{minWidth:50}}>Weight</label>
        <input type="number" className="text num" aria-label="Heading weight" min={100} max={900} step={100} value={txt.headingWeight}
               onChange={e => patch(screenshot.id, ['text', 'headingWeight'], Number(e.target.value))} />
      </div>
      <div className="row">
        <label className="lbl">Area H</label>
        <input type="number" className="text num" aria-label="Text area height" value={txt.textAreaHeight}
               onChange={e => patch(screenshot.id, ['text', 'textAreaHeight'], Number(e.target.value))} />
        <label className="lbl" style={{minWidth:40}}>Align</label>
        <select className="text" aria-label="Text alignment" value={txt.textAlign}
                onChange={e => patch(screenshot.id, ['text', 'textAlign'], e.target.value)}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      </div>

      <h3 style={{ marginTop: 16 }}>Metrics</h3>
      <div className="row">
        <label className="lbl" htmlFor={`tracking-${screenshot.id}`}>Tracking</label>
        <input id={`tracking-${screenshot.id}`} type="number" className="text num" step={0.01}
               value={metrics.preheaderTracking}
               onChange={e => patch(screenshot.id, ['text', 'preheaderTracking'], toNumber(e.target.value, TEXT_METRIC_DEFAULTS.preheaderTracking))} />
        <label className="lbl" htmlFor={`pregap-${screenshot.id}`} style={{minWidth:40}}>Gap</label>
        <input id={`pregap-${screenshot.id}`} type="number" className="text num"
               value={metrics.preheaderGap}
               onChange={e => patch(screenshot.id, ['text', 'preheaderGap'], toNumber(e.target.value, TEXT_METRIC_DEFAULTS.preheaderGap))} />
      </div>
      <div className="row">
        <label className="lbl" htmlFor={`lineheight-${screenshot.id}`}>Line height</label>
        <input id={`lineheight-${screenshot.id}`} type="number" className="text num" step={0.01} min={0.5}
               value={metrics.headingLineHeight}
               onChange={e => patch(screenshot.id, ['text', 'headingLineHeight'], toNumber(e.target.value, TEXT_METRIC_DEFAULTS.headingLineHeight))} />
        <button className="btn small ghost" title="Reset metrics to defaults"
                onClick={() => {
                  patch(screenshot.id, ['text', 'preheaderTracking'], TEXT_METRIC_DEFAULTS.preheaderTracking)
                  patch(screenshot.id, ['text', 'preheaderGap'], TEXT_METRIC_DEFAULTS.preheaderGap)
                  patch(screenshot.id, ['text', 'headingLineHeight'], TEXT_METRIC_DEFAULTS.headingLineHeight)
                }}>↺ Reset</button>
      </div>
      <p className="variant-hint">
        Pre-header letter-spacing in em, the gap under it in canvas pixels, and the heading’s line height.
      </p>

      <TextFit screenshot={screenshot} activeLanguage={activeLanguage} />

      <PositionAndScale screenshot={screenshot} activeLanguage={activeLanguage} />
    </div>
  )
}

function toNumber(raw, fallback) {
  const n = Number(raw)
  return Number.isFinite(n) ? n : fallback
}

// Text fit — the answer to "why does the Spanish headline look wrong?".
//
// The measurement itself happens on the canvas (Screenshot.jsx renders a hidden
// copy per language and reports the heights), because only the canvas knows the
// real font metrics. This panel just reads and explains them.
function TextFit({ screenshot, activeLanguage }) {
  const languages = useStore(s => s.languages)
  const setActiveLanguage = useStore(s => s.setActiveLanguage)
  const metrics = useStore(s => s.textMetrics[screenshot.id])

  const active = metrics?.[activeLanguage]
  const over = isOverflowing(active)
  const rows = overflowByLanguage(metrics, languages)
  const anyOver = rows.some(r => r.over)

  return (
    <>
      <h3 style={{ marginTop: 16 }}>Fit</h3>

      {!active && (
        <p className="variant-hint">Measuring the text block…</p>
      )}

      {active && (
        <div className={'fit-status' + (over ? ' is-over' : '')} role="status">
          <span className="fit-dot" aria-hidden="true" />
          <span className="fit-text">
            Content is {active.contentHeight}px tall, area is {active.areaHeight}px
            {over
              ? ` — ${overflowAmount(active)}px over.`
              : ` — ${active.areaHeight - active.contentHeight}px to spare.`}
          </span>
        </div>
      )}

      {over && (
        <p className="variant-hint">
          Raise Area H, reduce the heading size or line height, or scale this
          language’s block down below.
        </p>
      )}

      {rows.length > 1 && (
        <>
          <div className="fit-pills" role="group" aria-label="Text fit by language">
            {rows.map(r => (
              <button
                key={r.lang}
                type="button"
                className={
                  'fit-pill' +
                  (r.over ? ' over' : r.measured ? ' ok' : '') +
                  (r.lang === activeLanguage ? ' active' : '')
                }
                aria-pressed={r.lang === activeLanguage}
                title={
                  r.measured
                    ? `${r.lang.toUpperCase()}: ${r.entry.contentHeight}px of ${r.entry.areaHeight}px` +
                      (r.over ? ` — ${r.by}px over` : '')
                    : `${r.lang.toUpperCase()}: not measured yet`
                }
                onClick={() => setActiveLanguage(r.lang)}
              >
                <span className="fit-pill-dot" aria-hidden="true" />
                {r.lang.toUpperCase()}
                <span className="sr-only">
                  {r.over ? ` overflows by ${r.by} pixels` : ' fits'}
                </span>
              </button>
            ))}
          </div>
          <p className="variant-hint">
            {anyOver
              ? 'Amber languages spill outside the text area. Click one to switch to it.'
              : 'Every language fits inside the text area.'}
          </p>
        </>
      )}
    </>
  )
}

// Position & Scale — the master/variant transform controls.
//
// On a mirrored non-primary language the numeric controls are DISABLED rather
// than routed through the unlock modal. A modal firing on a keystroke or a step
// button (and again on the next one) reads as a bug, and the inspector already
// has room for a single unambiguous [Unlock] affordance. The outcome matches the
// canvas: nothing edits the master by accident, and unlocking is always explicit.
function PositionAndScale({ screenshot, activeLanguage }) {
  const languages = useStore(s => s.languages)
  const setTextTransform = useStore(s => s.setTextTransform)
  const unlockTextVariant = useStore(s => s.unlockTextVariant)
  const resetTextVariant = useStore(s => s.resetTextVariant)
  const [askReset, setAskReset] = useState(false)

  const tf = resolveTextTransform(screenshot, activeLanguage, languages)
  const primary = isPrimaryLanguage(activeLanguage, languages)
  const unlocked = isVariantUnlocked(screenshot, activeLanguage, languages)
  const mirrored = !primary && !unlocked
  const masterLang = (languages[0] || '').toUpperCase()
  const lang = activeLanguage.toUpperCase()

  const apply = (partial) => setTextTransform(screenshot.id, activeLanguage, languages, partial)
  const scalePct = Math.round(tf.scale * 100)

  return (
    <>
      <h3 style={{ marginTop: 16 }}>Position &amp; Scale</h3>

      <div className={'variant-status' + (primary ? ' is-master' : unlocked ? ' is-unlocked' : '')}>
        <span className="variant-dot" aria-hidden="true" />
        <span className="variant-text">
          {primary && <>Master — changes apply to all mirrored languages.</>}
          {mirrored && <>Mirrored from {masterLang}</>}
          {unlocked && <>Unlocked — independent of {masterLang}</>}
        </span>
        {mirrored && (
          <button className="btn small primary" onClick={() => unlockTextVariant(screenshot.id, activeLanguage)}>
            Unlock {lang}
          </button>
        )}
        {unlocked && (
          <button className="btn small" onClick={() => setAskReset(true)}>
            Reset to master
          </button>
        )}
      </div>

      {mirrored && (
        <p className="variant-hint">
          Unlock {lang} to give it its own offset, scale and rotation. Wording stays synced either way.
        </p>
      )}

      <Stepper
        id={`tf-x-${screenshot.id}`}
        label="Offset X"
        value={tf.x}
        suffix="px"
        disabled={mirrored}
        onChange={(v) => apply({ x: v })}
        onReset={() => apply({ x: DEFAULT_TEXT_TRANSFORM.x })}
      />
      <Stepper
        id={`tf-y-${screenshot.id}`}
        label="Offset Y"
        value={tf.y}
        suffix="px"
        disabled={mirrored}
        onChange={(v) => apply({ y: v })}
        onReset={() => apply({ y: DEFAULT_TEXT_TRANSFORM.y })}
      />
      <Stepper
        id={`tf-s-${screenshot.id}`}
        label="Scale"
        value={scalePct}
        suffix="%"
        disabled={mirrored}
        onChange={(v) => apply({ scale: Math.max(0.05, (Number(v) || 0) / 100) })}
        onReset={() => apply({ scale: DEFAULT_TEXT_TRANSFORM.scale })}
      />
      <Stepper
        id={`tf-r-${screenshot.id}`}
        label="Rotation"
        value={tf.rotation}
        suffix="°"
        disabled={mirrored}
        onChange={(v) => apply({ rotation: v })}
        onReset={() => apply({ rotation: DEFAULT_TEXT_TRANSFORM.rotation })}
      />
      <p className="variant-hint" style={{ marginTop: 2 }}>
        Offsets are in canvas pixels. You can also drag the text block directly on the frame — hold Shift to lock an axis.
      </p>

      <ConfirmDialog
        open={askReset}
        title={`Reset ${lang} to the master?`}
        message={`${lang}'s own position, scale and rotation will be discarded and it will mirror ${masterLang} again. Wording is unaffected.`}
        confirmLabel={`Reset ${lang}`}
        danger
        onConfirm={() => { resetTextVariant(screenshot.id, activeLanguage); setAskReset(false) }}
        onCancel={() => setAskReset(false)}
      />
    </>
  )
}
