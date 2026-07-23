import React, { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDialogFocus, useDialogIds } from './dialogFocus'

// Small reusable confirm modal. Portals to <body> because callers live inside
// CSS-transformed frames, where `position: fixed` would resolve against the
// transformed ancestor instead of the viewport.
export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel
}) {
  const panelRef = useRef(null)
  const confirmRef = useRef(null)
  const ids = useDialogIds('confirm-dialog')

  useDialogFocus({ open, panelRef, initialFocusRef: confirmRef, onCancel })

  if (!open) return null

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel?.() }}>
      <div
        ref={panelRef}
        className="modal confirm-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        aria-describedby={message ? ids.hint : undefined}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id={ids.title}>{title}</h2>
        {message && <p className="confirm-dialog-body" id={ids.hint}>{message}</p>}
        <div className="confirm-dialog-actions">
          <button className="btn ghost" onClick={onCancel}>{cancelLabel}</button>
          <button
            ref={confirmRef}
            className={'btn ' + (danger ? 'danger' : 'primary')}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
