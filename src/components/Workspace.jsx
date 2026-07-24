import React, { useCallback, useEffect, useState, useRef } from 'react'
import { useStore } from '../store'
import Screenshot from './Screenshot'
import ShortcutsOverlay from './ShortcutsOverlay'
import { isTypingContext, isModalOpen } from '../utils/keyboard'

// Canvas pixels, not screen pixels — 1px is invisible at an 18% workspace zoom.
const NUDGE = 10
const NUDGE_LARGE = 100

// Apple text fields bind Ctrl+D to forward-delete, so that one chord has to survive
// inside an input even though the app claims Cmd/Ctrl+D everywhere else.
const IS_APPLE = typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '')

const ARROW_DELTAS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1]
}

export default function Workspace() {
  const screenshots = useStore(s => s.screenshots)
  const selectedId = useStore(s => s.selectedId)
  const selectedOverlayId = useStore(s => s.selectedOverlayId)
  const exportSize = useStore(s => s.exportSize)
  const zoomMode = useStore(s => s.zoomMode)
  const setZoomMode = useStore(s => s.setZoomMode)
  const cropEditingId = useStore(s => s.cropEditingId)
  const setCropEditing = useStore(s => s.setCropEditing)
  const updateOverlay = useStore(s => s.updateOverlay)
  const removeOverlay = useStore(s => s.removeOverlay)
  const duplicateScreenshot = useStore(s => s.duplicateScreenshot)
  const ref = useRef(null)
  const [displayScale, setDisplayScale] = useState(0.18)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [spacePan, setSpacePan] = useState(false)
  // The wheel/pan listeners are native (non-passive) and read the current zoom, so mirror
  // displayScale into a ref rather than re-attaching them on every zoom change.
  const scaleRef = useRef(displayScale)
  const spaceRef = useRef(false)
  useEffect(() => { scaleRef.current = displayScale }, [displayScale])

  // Auto-fit a sensible scale based on workspace height
  useEffect(() => {
    const calc = () => {
      if (!ref.current) return
      const h = ref.current.clientHeight - 60
      const targetH = exportSize.height
      const scale = Math.max(0.08, Math.min(0.5, h / targetH))
      setDisplayScale(scale)
    }
    calc()
    const ro = new ResizeObserver(calc)
    if (ref.current) ro.observe(ref.current)
    return () => ro.disconnect()
  }, [exportSize.height])

  const ownerOfSelectedOverlay = useCallback(() => {
    if (!selectedOverlayId) return null
    return useStore.getState().screenshots
      .find(sc => sc.overlays.some(o => o.id === selectedOverlayId)) || null
  }, [selectedOverlayId])

  // One window listener for every canvas shortcut. Registered once, torn down on
  // unmount, and gated on `isTypingContext` so nothing fires mid-keystroke in an
  // inspector field — an unguarded Backspace here deletes the user's overlay
  // while they are editing a heading.
  useEffect(() => {
    const onKeyDown = (e) => {
      // Cmd/Ctrl+D belongs to the app in every focus context. Duplicating a frame is still
      // gated below — but letting the keystroke reach the browser opens the bookmark dialog
      // over the canvas, which is jarring whether or not anything was going to happen.
      const duplicateChord = (e.metaKey || e.ctrlKey) && !e.altKey && (e.key === 'd' || e.key === 'D')
      const macForwardDelete = IS_APPLE && e.ctrlKey && !e.metaKey
      let claimedDefault = false
      if (duplicateChord && !macForwardDelete) {
        e.preventDefault()
        claimedDefault = true
      }

      // Respect a default some *other* handler consumed — but not the one just claimed here.
      if (e.defaultPrevented && !claimedDefault) return
      if (isTypingContext(e)) return

      if (e.key === 'Escape') {
        if (showShortcuts) {
          e.preventDefault()
          setShowShortcuts(false)
          return
        }
        // A dialog owns Escape while it is up; it closes itself.
        if (isModalOpen()) return
        if (cropEditingId) { e.preventDefault(); setCropEditing(null); return }
        if (zoomMode) { e.preventDefault(); setZoomMode(false) }
        return
      }

      if (e.key === '?') {
        e.preventDefault()
        setShowShortcuts(v => !v)
        return
      }

      if (isModalOpen()) return

      if (duplicateChord) {
        if (!selectedId) return
        e.preventDefault()
        duplicateScreenshot(selectedId)
        return
      }

      // Everything below is a bare keypress; a modifier means it belongs to the
      // browser or the OS.
      if (e.metaKey || e.ctrlKey || e.altKey) return

      const owner = ownerOfSelectedOverlay()
      if (!owner) return
      const overlay = owner.overlays.find(o => o.id === selectedOverlayId)
      if (!overlay) return

      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault()
        removeOverlay(owner.id, overlay.id)
        return
      }

      const delta = ARROW_DELTAS[e.key]
      if (!delta) return
      e.preventDefault()
      const step = e.shiftKey ? NUDGE_LARGE : NUDGE
      updateOverlay(owner.id, overlay.id, {
        x: overlay.x + delta[0] * step,
        y: overlay.y + delta[1] * step
      })
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    showShortcuts, cropEditingId, zoomMode, selectedId, selectedOverlayId,
    setCropEditing, setZoomMode, duplicateScreenshot, removeOverlay, updateOverlay,
    ownerOfSelectedOverlay
  ])

  // Figma-style canvas navigation: hold Space to drag-pan the view, Cmd/Ctrl+wheel to zoom
  // toward the cursor, wheel to scroll the row. Listeners are native so wheel can preventDefault
  // (React's onWheel is passive and can't). The mousedown is capture-phase so a Space-drag pans
  // the view instead of selecting or dragging whatever frame is under the cursor.
  useEffect(() => {
    const el = ref.current
    if (!el) return

    const onWheel = (e) => {
      if (e.metaKey || e.ctrlKey) {
        e.preventDefault()
        const old = scaleRef.current
        const next = Math.max(0.05, Math.min(0.6, old * Math.exp(-e.deltaY * 0.0015)))
        if (next === old) return
        const rect = el.getBoundingClientRect()
        const cx = e.clientX - rect.left
        const cy = e.clientY - rect.top
        const ratio = next / old
        const nextLeft = (el.scrollLeft + cx) * ratio - cx
        const nextTop = (el.scrollTop + cy) * ratio - cy
        scaleRef.current = next
        setDisplayScale(next)
        // Re-anchor after the frames re-layout at the new scale.
        requestAnimationFrame(() => { el.scrollLeft = nextLeft; el.scrollTop = nextTop })
        return
      }
      const overflowX = el.scrollWidth - el.clientWidth > 1
      const overflowY = el.scrollHeight - el.clientHeight > 1
      if (e.shiftKey && overflowX) { el.scrollLeft += e.deltaY; e.preventDefault() }
      else if (overflowX && !overflowY && e.deltaX === 0) { el.scrollLeft += e.deltaY; e.preventDefault() }
    }

    const onMouseDown = (e) => {
      if (!spaceRef.current || e.button !== 0) return
      e.preventDefault()
      e.stopPropagation()
      const sl = el.scrollLeft, st = el.scrollTop
      const sx = e.clientX, sy = e.clientY
      const onMove = (ev) => {
        el.scrollLeft = sl - (ev.clientX - sx)
        el.scrollTop = st - (ev.clientY - sy)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    }

    const onKeyDown = (e) => {
      if (e.code !== 'Space' || spaceRef.current) return
      if (isTypingContext(e) || isModalOpen()) return
      spaceRef.current = true
      setSpacePan(true)
      // Stop Space from page-scrolling — unless focus is on a control it should still activate.
      const ae = document.activeElement
      if (!(ae && ae.closest && ae.closest('button, a, input, textarea, select, [role="button"]'))) {
        e.preventDefault()
      }
    }
    const onKeyUp = (e) => {
      if (e.code !== 'Space') return
      spaceRef.current = false
      setSpacePan(false)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  return (
    <main
      className="workspace"
      ref={ref}
      style={spacePan ? { cursor: 'grab' } : undefined}
    >
      {zoomMode && (
        <div className="zoom-mode-banner" onClick={() => setZoomMode(false)}>
          Drag a region on a screenshot to create a pop-out zoom · Esc to cancel
        </div>
      )}
      {cropEditingId && (
        <div className="zoom-mode-banner" style={{ background: '#c66a4d' }} onClick={() => setCropEditing(null)}>
          Drag a new region to replace the crop · Esc to cancel
        </div>
      )}
      <div className="workspace-inner" style={{ paddingTop: 24 }}>
        {screenshots.map((sc, i) => (
          <Screenshot
            key={sc.id}
            screenshot={sc}
            displayScale={displayScale}
            selected={selectedId === sc.id}
            index={i}
            count={screenshots.length}
          />
        ))}
      </div>

      <div className="workspace-dock">
        <label className="lbl" htmlFor="workspace-zoom" style={{ minWidth: 0 }}>Zoom</label>
        <input id="workspace-zoom" type="range" min={0.05} max={0.6} step={0.01} value={displayScale}
               aria-label="Workspace zoom"
               onChange={e => setDisplayScale(Number(e.target.value))}/>
        <span>{Math.round(displayScale * 100)}%</span>
        <button
          type="button"
          className="btn small ghost"
          aria-label="Keyboard shortcuts"
          title="Keyboard shortcuts (?)"
          onClick={() => setShowShortcuts(true)}
        >
          ⌘ ?
        </button>
      </div>

      <ShortcutsOverlay open={showShortcuts} onClose={() => setShowShortcuts(false)} />
    </main>
  )
}
