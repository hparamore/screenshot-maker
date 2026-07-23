import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialogFocus, useDialogIds } from './dialogFocus'

/**
 * The text-entry sibling of ConfirmDialog — the in-app replacement for window.prompt,
 * which can't be styled, can't be made keyboard-consistent, and reads as unfinished
 * (CLAUDE.md). Extracted from ProjectMenu so naming a project and adding a language
 * share one dialog instead of two that drift.
 *
 * `validate` returns a message string to reject the value, or null to accept it. The
 * message renders inside this dialog: stacking a second dialog to say "that isn't a
 * language code" throws away what the user just typed.
 *
 * Portals to <body> because callers can live inside CSS-transformed frames, where
 * `position: fixed` resolves against the transformed ancestor instead of the viewport.
 */
export default function PromptDialog({
  open,
  title,
  message,
  label = 'Name',
  defaultValue = '',
  placeholder,
  hint,
  confirmLabel = 'OK',
  cancelLabel = 'Cancel',
  maxLength = 64,
  validate,
  onConfirm,
  onCancel
}) {
  const [value, setValue] = useState(defaultValue)
  const [error, setError] = useState('')
  const panelRef = useRef(null)
  const inputRef = useRef(null)
  const ids = useDialogIds('prompt-dialog')

  // Reopening asks a fresh question; it doesn't resume the last one.
  useEffect(() => {
    if (!open) return
    setValue(defaultValue ?? '')
    setError('')
  }, [open, defaultValue])

  useDialogFocus({ open, panelRef, initialFocusRef: inputRef, onCancel })

  if (!open) return null

  const submit = (e) => {
    e.preventDefault()
    const trimmed = value.trim()
    const problem = validate ? validate(trimmed) : (trimmed ? null : 'Enter a value.')
    if (problem) {
      setError(problem)
      inputRef.current?.focus()
      return
    }
    onConfirm?.(trimmed)
  }

  const describedBy = error ? ids.error : (hint ? ids.hint : undefined)

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel?.() }}>
      <form
        ref={panelRef}
        className="modal prompt-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id={ids.title}>{title}</h2>
        {message && <p className="prompt-dialog-message">{message}</p>}
        <div className="row">
          <label className="lbl" htmlFor={ids.input}>{label}</label>
          <input
            id={ids.input}
            ref={inputRef}
            className="text"
            value={value}
            placeholder={placeholder}
            maxLength={maxLength}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={describedBy}
            onChange={(e) => {
              setValue(e.target.value)
              if (error) setError('')
            }}
          />
        </div>
        {hint && !error && <p className="prompt-dialog-hint" id={ids.hint}>{hint}</p>}
        {error && <p className="prompt-dialog-error" id={ids.error} role="alert">{error}</p>}
        <div className="prompt-dialog-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>{cancelLabel}</button>
          <button type="submit" className="btn primary" disabled={!value.trim()}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>,
    document.body
  )
}
