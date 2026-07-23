import { useEffect, useRef } from 'react'

const FOCUSABLE = 'button, input, select, textarea, a[href], [tabindex]:not([tabindex="-1"])'

/**
 * The keyboard half of a modal, shared by every in-app dialog: focus moves in on open,
 * Escape cancels, Tab cycles inside, and focus goes back to whatever opened the dialog
 * when it closes. A modal you can Tab out of is a modal in name only, and one that drops
 * focus on the body strands keyboard users at the top of the document.
 *
 * `onCancel` is read through a ref so an inline arrow from the caller doesn't re-run the
 * effect on every render — that would re-capture "what to focus on close" as the dialog's
 * own button and refocus the dialog mid-typing.
 */
export function useDialogFocus({ open, panelRef, initialFocusRef, onCancel }) {
  const cancelRef = useRef(onCancel)
  cancelRef.current = onCancel

  useEffect(() => {
    if (!open) return

    const returnTo = document.activeElement
    const target = initialFocusRef?.current
    target?.focus()
    // Inputs get their default text selected so typing replaces it; buttons have no select().
    if (typeof target?.select === 'function') target.select()

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cancelRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef?.current
      if (!panel) return
      const items = Array.from(panel.querySelectorAll(FOCUSABLE)).filter(el => !el.disabled)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const inside = panel.contains(document.activeElement)
      if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // The opener is often unmounted by the time we close (a menu item that closed its
      // own menu), and focusing a detached node silently does nothing useful.
      if (returnTo && returnTo.isConnected && typeof returnTo.focus === 'function') {
        returnTo.focus()
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
}

/** Stable per-instance id prefix, for wiring aria-labelledby / aria-describedby. */
let seq = 0
export function useDialogIds(prefix) {
  const ref = useRef(null)
  if (!ref.current) {
    seq += 1
    ref.current = {
      title: `${prefix}-title-${seq}`,
      input: `${prefix}-input-${seq}`,
      hint: `${prefix}-hint-${seq}`,
      error: `${prefix}-error-${seq}`
    }
  }
  return ref.current
}
