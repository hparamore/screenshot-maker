import React from 'react'

// [-10] [-1] [input] [+1] [+10] [↺] — precise typing plus coarse increments,
// because these values are fiddly to set by dragging at 18% workspace zoom.
//
// `label` renders a visible label above the row. Pass `ariaLabel` instead when a
// sibling heading already provides the visible name, so the control is still
// announced without duplicating the heading on screen.
export default function Stepper({
  id,
  label,
  ariaLabel,
  value,
  steps = [-10, -1, +1, +10],
  suffix = '',
  disabled = false,
  min,
  max,
  onChange,
  onReset
}) {
  const name = label || ariaLabel || 'Value'

  const clamp = (n) => {
    let v = Number(n)
    if (!Number.isFinite(v)) v = 0
    if (Number.isFinite(min)) v = Math.max(min, v)
    if (Number.isFinite(max)) v = Math.min(max, v)
    return v
  }

  const change = (delta) => onChange(clamp(Number(value || 0) + delta))

  const onInput = (e) => {
    const raw = e.target.value.replace(/[^\d.\-]/g, '')
    onChange(raw === '' || raw === '-' ? 0 : clamp(raw))
  }

  return (
    <div className="stepper" aria-disabled={disabled || undefined}>
      {label && (
        <label className="lbl stepper-label" htmlFor={id}>{label}</label>
      )}
      <div className="row stepper-controls">
        {steps.filter(s => s < 0).map(s => (
          <button key={s} type="button" className="btn small" disabled={disabled}
                  aria-label={`${name} ${s}`} onClick={() => change(s)}>{s}</button>
        ))}
        <input
          id={id}
          className="text stepper-input"
          type="text"
          inputMode="decimal"
          disabled={disabled}
          aria-label={label ? undefined : name}
          value={Math.round(Number(value) * 100) / 100}
          onChange={onInput}
        />
        {suffix && <span className="stepper-suffix">{suffix}</span>}
        {steps.filter(s => s > 0).map(s => (
          <button key={s} type="button" className="btn small" disabled={disabled}
                  aria-label={`${name} +${s}`} onClick={() => change(s)}>+{s}</button>
        ))}
        {onReset && (
          <button type="button" className="btn small ghost" disabled={disabled} onClick={onReset}
                  aria-label={`Reset ${name} to default`} title="Reset to default">↺</button>
        )}
      </div>
    </div>
  )
}
