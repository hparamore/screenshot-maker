// Every global shortcut goes through this guard. Without it, "Backspace deletes
// the selected overlay" fires while the user is backspacing inside an inspector
// field — the single most destructive way to get shortcuts wrong.

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function isTypingTarget(node) {
  const el = node && node.nodeType === 1 ? node : null
  if (!el) return false
  if (el.isContentEditable) return true
  if (TYPING_TAGS.has(el.tagName)) return true
  // Focus can sit on a wrapper inside a contenteditable region.
  return typeof el.closest === 'function' && el.closest('[contenteditable="true"]') !== null
}

// Checks the event target AND the live focus owner — they normally agree, but a
// handler bound to window during a drag can see a stale target.
export function isTypingContext(event) {
  if (isTypingTarget(event?.target)) return true
  return isTypingTarget(typeof document !== 'undefined' ? document.activeElement : null)
}

// A modal owns the keyboard while it is open; canvas shortcuts must stand down.
export function isModalOpen() {
  if (typeof document === 'undefined') return false
  return document.querySelector('.modal-backdrop') !== null
}
