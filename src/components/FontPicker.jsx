import React, { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useDialogFocus, useDialogIds } from './dialogFocus'
import {
  useFontRegistry,
  useFamilyAvailable,
  refreshFontRegistry,
  rescanCustomFonts,
  findEntryByValue,
  SOURCE_LABELS,
  SOURCE_ORDER,
  SOURCE_CUSTOM,
  SOURCE_SYSTEM
} from '../utils/fontRegistry'
import {
  LOCAL_FONTS_DENIED,
  LOCAL_FONTS_GRANTED,
  LOCAL_FONTS_INSECURE,
  LOCAL_FONTS_PROMPT,
  LOCAL_FONTS_UNSUPPORTED,
  embedLocalFamily,
  isFamilyEmbedded,
  resetLocalFontsCache
} from '../utils/localFonts'

/*
 * The Google Fonts installer is the other half of this feature and may not be present in a
 * given checkout. `import.meta.glob` resolves to `{}` when the file is missing — no build
 * error, no runtime crash, the entry point just doesn't appear.
 */
const googleBrowserModule = import.meta.glob('./GoogleFontBrowser.jsx')['./GoogleFontBrowser.jsx']
const GoogleFontBrowser = googleBrowserModule ? lazy(googleBrowserModule) : null

// Rendering three thousand system families at once is a real freeze, and nobody scrolls that
// far anyway. Cap what's drawn and say so — typing is the intended way through a large library.
const RENDER_CAP = 140

/**
 * The font control. A searchable, source-grouped listbox where every entry previews in its own
 * typeface, replacing the nine-item <select> this used to be.
 *
 * ARIA is the "combobox with listbox popup" pattern: the search field is the combobox, the
 * options are never focused, and `aria-activedescendant` carries the selection. That keeps Tab
 * working as Tab — the popup closes and focus moves on, so the control can't trap anyone.
 *
 * ── Why the catalog browser is a modal and this is not ──────────────────────────────────
 * Picking a family you already have is the everyday action, and it wants to stay a popover:
 * one click, type two letters, Enter. Installing a family from Google is a task — search,
 * weights, script coverage, a size estimate, a download with progress, an upload panel — and
 * it was never going to fit beside a list of names anchored under a control in a 320px
 * inspector. It lives in `FontBrowserModal` below, reached from the popover's footer.
 */
export default function FontPicker({ id, value, onChange }) {
  const registry = useFontRegistry()
  const [open, setOpen] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [libraryChanged, setLibraryChanged] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [busy, setBusy] = useState(false)
  const [rescanning, setRescanning] = useState(false)

  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const searchRef = useRef(null)
  const scrollRef = useRef(null)

  const current = findEntryByValue(value)
  const { family: currentFamily, available: currentAvailable } = useFamilyAvailable(value)

  // One pass at startup so bundled + already-permitted system + installed fonts are all there
  // before the picker is ever opened.
  useEffect(() => { refreshFontRegistry() }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const hits = q
      ? registry.entries.filter(e =>
          e.label.toLowerCase().includes(q) || e.family.toLowerCase().includes(q))
      : registry.entries
    return hits
  }, [registry.entries, query])

  const shown = matches.slice(0, RENDER_CAP)

  const groups = useMemo(() => {
    const bySource = new Map()
    for (const entry of shown) {
      if (!bySource.has(entry.source)) bySource.set(entry.source, [])
      bySource.get(entry.source).push(entry)
    }
    return SOURCE_ORDER.filter(s => bySource.has(s)).map(s => ({ source: s, entries: bySource.get(s) }))
  }, [shown])

  // The flat order the arrow keys walk, which has to match the visual order the groups produce.
  const flat = useMemo(() => groups.flatMap(g => g.entries), [groups])

  const close = useCallback((refocus = true) => {
    setOpen(false)
    setQuery('')
    if (refocus) triggerRef.current?.focus()
  }, [])

  const select = useCallback((entry) => {
    if (!entry) return
    onChange(entry.value)
    close()
  }, [onChange, close])

  const openPicker = () => {
    setOpen(true)
    // Index into the same flat order the arrow keys walk — the grouped order, not the
    // registry's. Reading from `registry.entries` here pointed activeDescendant at whatever
    // happened to sit at that offset once system fonts pushed the groups apart.
    setActiveIndex(Math.max(0, flat.findIndex(e => e.id === current?.id)))
  }

  /* ---- outside click / escape ------------------------------------- */

  useEffect(() => {
    if (!open) return
    const onDown = (e) => {
      if (popoverRef.current?.contains(e.target) || triggerRef.current?.contains(e.target)) return
      close(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open, close])

  /*
   * Focus the search field on open so typing works immediately, which is the whole point of
   * replacing a <select> that only did first-letter matching. It has to hang off the ref rather
   * than an `open` effect: Popover renders nothing on its first pass while it measures the
   * trigger, so on the tick `open` flips there is no input to focus yet.
   */
  const attachSearch = useCallback((node) => {
    searchRef.current = node
    node?.focus()
  }, [])

  // Same story for revealing the already-chosen font: the effect below only fires on later
  // activeIndex changes, and on the first one there was no scroll container to act on. A
  // callback ref runs once the node — and its options — are actually in the document.
  const attachScroll = useCallback((node) => {
    scrollRef.current = node
    node?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [])

  useEffect(() => { setActiveIndex(0) }, [query])

  // Keep the active option on screen while arrowing through a few hundred families.
  useEffect(() => {
    if (!open) return
    const el = scrollRef.current?.querySelector('[data-active="true"]')
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open, query])

  /*
   * Escape has to be swallowed here, not merely handled. Workspace's global shortcut listener
   * is bound to window and React's synthetic stopPropagation does not stop the native event
   * from reaching it — `preventDefault` is what that handler actually checks.
   */
  const swallowEscape = (e) => {
    e.preventDefault()
    e.stopPropagation()
    close()
  }

  const onSearchKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(flat.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(0, i - 1))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActiveIndex(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActiveIndex(Math.max(0, flat.length - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      select(flat[activeIndex])
    } else if (e.key === 'Escape') {
      swallowEscape(e)
    }
    // Tab is deliberately untouched: it closes on blur and moves on like any other control.
  }

  // Escape from anywhere else in the popover — the grant button, the browse button — closes it
  // too. The search field stops propagation first, so this never fires twice.
  const onPopoverKeyDown = (e) => {
    if (e.key === 'Escape') swallowEscape(e)
  }

  const onTriggerKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      openPicker()
    }
  }

  /* ---- system fonts ----------------------------------------------- */

  const systemState = registry.systemState
  const grantSystemFonts = async () => {
    setBusy(true)
    // queryLocalFonts needs the transient activation from this click. That's a ~5s window
    // rather than a same-tick rule, so the permission read on the way there is fine — but
    // nothing slow (a fetch, a dialog) may sit between the click and the query.
    resetLocalFontsCache()
    await refreshFontRegistry({ askForSystemFonts: true })
    setBusy(false)
    searchRef.current?.focus()
  }

  /* ---- custom drop folder ----------------------------------------- */

  // Re-scan public/fonts/custom/ so a file dropped in just now is picked up without relaunching.
  // Degrades to a plain refresh when the dev server isn't there, so the button is never a trap.
  const rescanCustom = async () => {
    setRescanning(true)
    await rescanCustomFonts()
    setRescanning(false)
    searchRef.current?.focus()
  }

  /* ---- catalog browser -------------------------------------------- */

  // Close the popover *before* the modal mounts, refocusing the trigger on the way out, so the
  // focus trap records the trigger as where focus goes when the modal is dismissed.
  const openBrowser = () => {
    close(true)
    setBrowsing(true)
  }

  const closeBrowser = useCallback(() => {
    setBrowsing(false)
    // Installing a family is only ever a step towards choosing it, so land back on the list
    // with the new name in it. Dismissing without changing anything just returns to the panel.
    if (libraryChanged) {
      setLibraryChanged(false)
      setOpen(true)
      setActiveIndex(0)
    }
  }, [libraryChanged])

  const onInstalled = useCallback(async () => {
    await refreshFontRegistry()
    setLibraryChanged(true)
  }, [])

  const activeId = flat[activeIndex]?.id
  const listboxId = `${id}-listbox`
  // Entry ids carry the real family name ("system:Helvetica Neue"), and a DOM id with a space
  // in it silently breaks the aria-activedescendant reference the whole keyboard model rests on.
  const optionDomId = (entryId) => `${id}-opt-${entryId.replace(/[^A-Za-z0-9_-]+/g, '-')}`

  return (
    <div className="font-picker">
      <button
        type="button"
        id={id}
        ref={triggerRef}
        className={'font-picker-trigger' + (currentAvailable === false ? ' is-missing' : '')}
        role="combobox"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        onClick={() => (open ? close() : openPicker())}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="font-picker-trigger-name" style={{ fontFamily: value }}>
          {current?.label || currentFamily || 'Choose a font'}
        </span>
        {currentAvailable === false && (
          <span className="font-picker-warn" aria-hidden="true">missing</span>
        )}
        <span className="font-picker-caret" aria-hidden="true">▾</span>
      </button>

      {currentAvailable === false && (
        <p className="font-picker-missing-note" role="status">
          “{currentFamily}” isn’t on this machine — frames are drawing a fallback and will export
          that way. Open the picker to install it, allow your system fonts, or choose another.
        </p>
      )}

      {open && (
        <Popover triggerRef={triggerRef} popoverRef={popoverRef} onKeyDown={onPopoverKeyDown}>
          <div className="font-picker-panel">
            <div className="font-picker-search">
              <input
                ref={attachSearch}
                type="text"
                className="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={listboxId}
                aria-activedescendant={activeId ? optionDomId(activeId) : undefined}
                aria-autocomplete="list"
                aria-label="Search fonts"
                placeholder={`Search ${registry.entries.length} fonts…`}
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onSearchKeyDown}
              />
            </div>

            {/* One scroll region for everything under the search field. The list used to own
                the scrolling, but it sat inside a plain block wrapper where `flex: 1` meant
                nothing, so anything past the popover's max height was clipped rather than
                reachable. */}
            <div className="font-picker-scroll" ref={attachScroll}>
              <ul
                className="font-picker-list"
                id={listboxId}
                role="listbox"
                aria-label="Fonts"
              >
                {groups.map(group => (
                  <li key={group.source} role="presentation">
                    <div className="font-picker-group-label" role="presentation">
                      {SOURCE_LABELS[group.source]}
                    </div>
                    <ul role="group" aria-label={SOURCE_LABELS[group.source]} className="font-picker-group">
                      {group.entries.map(entry => {
                        const isActive = entry.id === activeId
                        const isSelected = entry.id === current?.id
                        return (
                          <li
                            key={entry.id}
                            id={optionDomId(entry.id)}
                            role="option"
                            aria-selected={isSelected}
                            data-active={isActive}
                            className={
                              'font-picker-option' +
                              (isActive ? ' active' : '') +
                              (isSelected ? ' selected' : '')
                            }
                            onMouseEnter={() => setActiveIndex(flat.indexOf(entry))}
                            onClick={() => select(entry)}
                          >
                            <span className="font-picker-option-name" style={{ fontFamily: entry.value }}>
                              {entry.label}
                            </span>
                            <span className="font-picker-option-meta">
                              {entry.detail}
                              {!entry.portable && <span className="font-picker-chip">this Mac only</span>}
                            </span>
                          </li>
                        )
                      })}
                    </ul>
                    {group.source === SOURCE_CUSTOM && (
                      <CustomFontsHint busy={rescanning} onRescan={rescanCustom} />
                    )}
                  </li>
                ))}

                {!flat.length && (
                  <li role="presentation" className="font-picker-empty">
                    No font matches “{query}”.
                    {GoogleFontBrowser && <> Try <strong>Add a font…</strong> below.</>}
                  </li>
                )}
              </ul>

              {matches.length > shown.length && (
                <p className="font-picker-note">
                  Showing {shown.length} of {matches.length}. Keep typing to narrow it down.
                </p>
              )}

              <SystemFontsFooter
                state={systemState}
                busy={busy}
                onGrant={grantSystemFonts}
                count={registry.entries.filter(e => e.source === SOURCE_SYSTEM).length}
              />

              {current?.source === SOURCE_SYSTEM && (
                <EmbedRow family={current.family} />
              )}
            </div>
          </div>

          {GoogleFontBrowser && (
            <div className="font-picker-footer">
              <button type="button" className="font-picker-browse" onClick={openBrowser}>
                Add a font…
                <span className="font-picker-browse-sub">Google Fonts, or your own files</span>
              </button>
            </div>
          )}
        </Popover>
      )}

      {GoogleFontBrowser && (
        <FontBrowserModal open={browsing} onClose={closeBrowser} onInstalled={onInstalled} />
      )}
    </div>
  )
}

/*
 * The inspector is an `overflow-y: auto` column, so an absolutely-positioned popover would be
 * clipped by it. Fixed positioning off the trigger's rect escapes that, at the cost of having
 * to re-measure whenever anything scrolls or resizes.
 */

const POPOVER_MIN_WIDTH = 340
const VIEWPORT_MARGIN = 8
const TRIGGER_GAP = 6
// Below this there is no useful list left, so stop hanging off the trigger and take the band.
const MIN_USABLE_HEIGHT = 240

function Popover({ triggerRef, popoverRef, onKeyDown, children }) {
  const [pos, setPos] = useState(null)

  useLayoutEffect(() => {
    const place = () => {
      const rect = triggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const vw = window.innerWidth
      const vh = window.innerHeight

      const width = Math.min(Math.max(rect.width, POPOVER_MIN_WIDTH), vw - VIEWPORT_MARGIN * 2)
      /*
       * Anchor to the trigger, then pull back inside the viewport. This control lives in an
       * inspector flush against the right edge, so a popover wider than its trigger always
       * overhangs — left-aligning to `rect.left` and stopping there put ~55px of the panel,
       * including the Remove button and the category filter, past the window.
       */
      const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, vw - width - VIEWPORT_MARGIN))

      const below = vh - rect.bottom - TRIGGER_GAP - VIEWPORT_MARGIN
      const above = rect.top - TRIGGER_GAP - VIEWPORT_MARGIN
      const flip = below < MIN_USABLE_HEIGHT && above > below
      const room = flip ? above : below

      if (room < MIN_USABLE_HEIGHT) {
        setPos({ left, width, top: VIEWPORT_MARGIN, maxHeight: vh - VIEWPORT_MARGIN * 2 })
        return
      }

      setPos({
        left,
        width,
        top: flip ? undefined : rect.bottom + TRIGGER_GAP,
        bottom: flip ? vh - rect.top + TRIGGER_GAP : undefined,
        maxHeight: room
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [triggerRef])

  if (!pos) return null
  return (
    <div
      ref={popoverRef}
      className="font-picker-popover"
      style={{ position: 'fixed', ...pos }}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}

/*
 * The catalog browser's own container. It portals to <body> for the same reason every other
 * dialog here does — callers sit inside CSS-transformed frames where `position: fixed` resolves
 * against the transform, not the viewport — and it reuses `.modal-backdrop` deliberately:
 * `isModalOpen()` in utils/keyboard.js keys off that class to stand the canvas shortcuts down.
 */
function FontBrowserModal({ open, onClose, onInstalled }) {
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const ids = useDialogIds('font-browser')

  useDialogFocus({ open, panelRef, initialFocusRef: closeRef, onCancel: onClose })

  if (!open) return null

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        ref={panelRef}
        className="modal font-browser-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={ids.title}
        aria-describedby={ids.hint}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="font-browser-modal-head">
          <div>
            <h2 id={ids.title}>Add a font</h2>
            <p className="font-browser-modal-sub" id={ids.hint}>
              Downloaded into <code>public/fonts/</code> and served locally — exports never touch
              the network.
            </p>
          </div>
          <button ref={closeRef} type="button" className="btn ghost small" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="font-browser-modal-body">
          <Suspense fallback={<p className="panel-hint">Loading the Google Fonts browser…</p>}>
            <GoogleFontBrowser onInstalled={onInstalled} />
          </Suspense>
        </div>
      </div>
    </div>,
    document.body
  )
}

/*
 * The permission affordance. A browser permission prompt with no preamble is hostile — the user
 * gets a dialog about "seeing the fonts installed on your device" with no idea who asked or
 * why — so the explanation goes first and the prompt only fires from the button under it.
 */
function SystemFontsFooter({ state, busy, onGrant, count }) {
  if (state === LOCAL_FONTS_GRANTED) {
    return (
      <p className="font-picker-note">
        {count} font{count === 1 ? '' : 's'} from this Mac are in the list. They export correctly
        here, but a machine without them will substitute — the picker marks them “this Mac only”.
      </p>
    )
  }

  if (state === LOCAL_FONTS_UNSUPPORTED) {
    return (
      <p className="font-picker-note">
        Your browser can’t list installed fonts — that API is Chrome and Edge only. Everything
        above still works, and you can add families from Google or drop font files in
        <code> public/fonts/</code>.
      </p>
    )
  }

  if (state === LOCAL_FONTS_INSECURE) {
    return (
      <p className="font-picker-note">
        Listing installed fonts needs a secure context. Open the app on <code>localhost</code>
        {' '}rather than a raw IP address and this becomes available.
      </p>
    )
  }

  if (state === LOCAL_FONTS_DENIED) {
    return (
      <p className="font-picker-note">
        Font access is blocked for this site. Chrome remembers that, so re-asking won’t do
        anything — clear it under the icon at the left of the address bar (Site settings →
        Fonts) and reload.
      </p>
    )
  }

  // PROMPT, or we haven't looked yet.
  return (
    <div className="font-picker-grant">
      <p className="font-picker-note" id="font-picker-grant-note">
        Use the fonts already installed on this Mac — Adobe Fonts, licensed families, anything in
        Font Book. Chrome will ask permission to read the list; the names never leave your
        machine, and exports are generated locally either way.
      </p>
      <button
        type="button"
        className="btn small primary"
        disabled={busy || state === null}
        aria-describedby="font-picker-grant-note"
        onClick={onGrant}
      >
        {busy ? 'Waiting for permission…' : 'Use my installed fonts'}
      </button>
      {state === LOCAL_FONTS_PROMPT && !busy && (
        <p className="font-picker-note subtle">
          If you dismissed the prompt, clicking again brings it back.
        </p>
      )}
    </div>
  )
}

/*
 * The drop-folder affordance. It rides under the "Your fonts (dropped in)" group so the model is
 * legible at a glance: this is the folder you own in Finder, separate from what the app installs.
 * The path is shown so nobody has to go hunting for where to drop a file, and Rescan saves a
 * relaunch when the dev server is running.
 */
function CustomFontsHint({ busy, onRescan }) {
  return (
    <div className="font-picker-custom-hint">
      <p className="font-picker-note">
        Drop font files into <code>public/fonts/custom/</code> — one subfolder per family is the
        reliable way. Relaunch to pick them up, or:
      </p>
      <button
        type="button"
        className="btn small"
        disabled={busy}
        onClick={onRescan}
      >
        {busy ? 'Rescanning…' : 'Rescan folder'}
      </button>
    </div>
  )
}

/*
 * Byte-embedding is opt-in, not default, because it isn't needed for export to look right — it
 * is needed for export to look right *somewhere else*. See utils/localFonts.js for the weight
 * and licence costs, both of which are the user's call rather than the app's.
 */
function EmbedRow({ family }) {
  const [state, setState] = useState(() => (isFamilyEmbedded(family) ? 'done' : 'idle'))

  useEffect(() => { setState(isFamilyEmbedded(family) ? 'done' : 'idle') }, [family])

  if (state === 'done') {
    return (
      <p className="font-picker-note">
        {family} is embedded for this session, so exports carry the font with them.
      </p>
    )
  }

  return (
    <div className="font-picker-grant">
      <p className="font-picker-note" id={`embed-note-${family}`}>
        Exports of {family} are correct on this Mac. To make them correct anywhere, its bytes can
        be embedded in the capture — heavier files, and redistributing a licensed typeface is
        your call to make.
      </p>
      <button
        type="button"
        className="btn small"
        disabled={state === 'working'}
        aria-describedby={`embed-note-${family}`}
        onClick={async () => {
          setState('working')
          const ok = await embedLocalFamily(family)
          setState(ok ? 'done' : 'idle')
        }}
      >
        {state === 'working' ? 'Embedding…' : `Embed ${family} in exports`}
      </button>
    </div>
  )
}
