import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

const IS_APPLE = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '')
const MOD = IS_APPLE ? '⌘' : 'Ctrl'

const GROUPS = [
  {
    title: 'Project',
    items: [
      [[MOD, 'S'], 'Save the current project'],
      [[MOD, 'D'], 'Duplicate the selected frame'],
      [['?'], 'Show or hide this list']
    ]
  },
  {
    title: 'Selected overlay',
    items: [
      [['←', '→', '↑', '↓'], 'Nudge by 10px'],
      [['Shift', '←→↑↓'], 'Nudge by 100px'],
      [['Backspace'], 'Delete the overlay']
    ]
  },
  {
    title: 'Canvas',
    items: [
      [['Drag'], 'Move the text block · Shift locks an axis'],
      [['Drag'], 'Pan the screenshot inside the device'],
      [[MOD, 'V'], 'Paste an image as an overlay'],
      [['Esc'], 'Cancel zoom or crop selection, close dialogs']
    ]
  },
  {
    title: 'Navigation',
    items: [
      [['Space', 'Drag'], 'Pan around the workspace'],
      [[MOD, 'Scroll'], 'Zoom the workspace toward the cursor'],
      [['Scroll'], 'Scroll the row · Shift for sideways'],
      [['Shift', 'Scroll'], 'Scroll left / right']
    ]
  }
]

// Every shortcut here is guarded against firing while a text field has focus —
// see utils/keyboard.js. The list is the contract; keep them in step.
export default function ShortcutsOverlay({ open, onClose }) {
  const closeRef = useRef(null)

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        className="modal shortcuts-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        {GROUPS.map(group => (
          <div key={group.title} className="shortcuts-group">
            <h3>{group.title}</h3>
            <dl className="shortcuts-list">
              {group.items.map(([keys, description], i) => (
                <div className="shortcuts-row" key={group.title + i}>
                  <dt>
                    {keys.map((k, ki) => <kbd key={ki}>{k}</kbd>)}
                  </dt>
                  <dd>{description}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
        <p className="shortcuts-note">
          Shortcuts stand down while you are typing in a field.
        </p>
        <div className="confirm-dialog-actions">
          <button ref={closeRef} type="button" className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>,
    document.body
  )
}
