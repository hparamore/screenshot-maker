# Screenshot Maker — Project Instructions

A local, browser-based tool for producing App Store / Play Store marketing screenshots.
Drop a phone screenshot in, get a composed marketing frame out: background, headline text,
a procedural device mockup, and floating overlays — exported as PNG at native store resolution.

This is a **public portfolio project**. It should look and feel like a polished product, not a
prototype. Visual quality, interaction detail, and code clarity all count as deliverables.

---

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build → dist/
npm run preview  # preview the production build
```

There is no test suite and no linter configured. "Verified" means: the Vite build succeeds
**and** the behavior was checked in a browser. Don't claim a UI change works without loading it.

---

## Architecture

Vite + React 18 + Zustand (`persist` middleware → localStorage key `screenshot-maker-v1`).
No backend in production; the Vite dev server hosts a small file API for project save/load.

Rendering is **vanilla DOM + CSS at native export resolution**. Each frame is a real
`width × height` element (e.g. 1284×2778) with a CSS `transform: scale()` applied by the
wrapper purely for on-screen display. `html-to-image` captures the unscaled DOM, which is why
exports come out crisp at full size. Nothing renders to `<canvas>`.

```
vite-plugin-project-files.js  dev-only REST API backing projects/ (loopback only)
projects/                     saved *.smproj.json project files (git-ignored)
Launch Screenshot Maker.command / launch.sh   double-click launchers

src/
  store.js                  zustand store — model, defaults, all mutations
                            exports normalizeScreenshots + migratePersistedState
  App.jsx                   three-panel shell (toolbar / workspace / inspector)
  components/
    Toolbar.jsx             export size, language pills, add/export actions
    ProjectMenu.jsx         New / Open / Save / Save As, dirty flag, Cmd+S
    Workspace.jsx           frame row, zoom, global keyboard shortcuts
    Screenshot.jsx          ONE frame: background, text, device, overlays, drop/paste/zoom
    DeviceFrame.jsx         procedural iPhone/Android mockups; exports DEVICE_SPECS
    Overlay.jsx             image + zoom overlay rendering, drag, resize
    TextRender.jsx          *asterisk* → italic + accent-color parser renderer
    Inspector.jsx           right panel container
    inspector/*.jsx         Background, Text, Padding, Device, Overlays, Templates panels
    ConfirmDialog.jsx       styled confirm — use instead of window.confirm
    PromptDialog.jsx        styled text entry — use instead of window.prompt
    dialogFocus.js          shared focus trap + aria wiring for both dialogs
    Stepper.jsx             [-10][-1][input][+1][+10][↺] numeric control
    ShortcutsOverlay.jsx    the "?" help sheet
  utils/
    layout.js               screen-bounds + image-pan math — SINGLE SOURCE OF TRUTH
    variants.js             per-language transform override resolution (see below)
    projectFile.js          serialize / validate / apply project files
    textMetrics.js          text overflow measurement
    keyboard.js             isTypingContext() guard for shortcuts
    export.js               html-to-image PNG + jszip batch export
    text.js                 *asterisk* parser
    palette.js              2-color palette extraction from a dropped image
    fonts.js                font list
    useImageNatural.js      loads an <img>, returns natural dimensions
  styles.css                all styling (no CSS modules, no Tailwind)
```

---

## Load-bearing invariants

Break these and things go subtly wrong rather than loudly failing.

**`utils/layout.js` owns "where does the screen sit on the canvas."** `computeDeviceWidth` and
`computeScreenBounds` are the only correct source for that math. `Screenshot.jsx` and
`OverlaysPanel.jsx` both import from it. Never re-derive this math inline — if it drifts,
zoom crops and overlay scaling silently misalign.

**Two coordinate spaces, and mixing them is the #1 bug source.** A zoom overlay's `srcRect` is
in **original image pixels** (the dropped screenshot's natural width/height). Its `x/y/w/h` are
in **canvas pixels** (export resolution). Every conversion between them goes through
`computeScreenBounds`. Mouse coordinates are in **screen pixels** and must be divided by
`displayScale` before they mean anything.

**Overlay scale is derived, never stored.** `w`/`h` are the source of truth; the scale
percentage in the inspector reads `overlay.w / naturalCanvasW` and writes back to `w`/`h`.
Adding a stored `scale` field would give corner-drag and the slider two masters.

**Adding a device = one entry in `DEVICE_SPECS`.** Every spec needs `outerBezel`, `innerBezel`,
`bodyRadius`, `midRadius`, `screenRadius`, `aspect`, plus optional island/notch/cameraHole.
Rendering and layout math both flow from it automatically. Bezels are expressed as a
**fraction of device width**, not pixels, so mockups scale to any export size.

**Device mockups use three concentric radii** (body → black inner ring → screen), rendered as
three stacked divs. This is deliberate — a single `border` on the screen div produces a
rectangular black edge, not a ring with its own corner radius. Real hardware has all three.

**Export size is global**, not per-frame — `exportSize` lives at the store root. Per-frame
device *type* exists (`screenshot.device.type`), but per-frame *canvas size* does not.

**Variant transform precedence lives in exactly one function.** `resolveTextTransform` in
`utils/variants.js` decides whether a language renders the master transform or its own
override. Never re-implement that precedence at a call site — read through the resolver. The
`variantKey(lang)` indirection is the documented seam for a future `lang@sizeProfile` key.

**Display-only chrome must render OUTSIDE the export node.** Export captures the live DOM under
`[data-export-id]`. Selection outlines, overflow warnings, the unlinked badge, and the frame
header are siblings of `.screenshot-frame`, inside the wrapper, mirroring its `scale()` so they
can still use canvas coordinates. This is structural, not a CSS `display: none` — no export
option can accidentally include them. Any new on-canvas affordance goes in the same layer.

**State can enter the store by two doors.** localStorage rehydration and project-file loading
both funnel through `migratePersistedState` / `normalizeScreenshots` (exported from `store.js`).
Adding a persisted field means adding its backfill there — one place, both doors.

---

## The model

```
exportSize      { width, height }            global
languages       ['en', 'es', …]              languages[0] is the PRIMARY / master
activeLanguage  'en'
screenshots     [ { … } ]
templates       [ { … } ]                    saved background + text style + padding
```

Per screenshot:

```
background      solid | gradient | image
text            SHARED across languages — font, colors, sizes, weights, textAreaHeight,
                align, preheaderTracking, preheaderGap, headingLineHeight
texts           { [lang]: { preheader, heading } }   ← CONTENT, per language
textTransform   { x, y, scale, rotation }   MASTER placement of the text block
textOverrides   { [lang]: { x, y, scale, rotation } }   sparse; a key's PRESENCE = unlocked
padding         { top, right, bottom, left }
image           data URL of the dropped screenshot
imageScale      zoom of the image inside the device screen
imageOffset     { x, y } pan, clamped so cover never leaves a gap
device          { type, color, showButtons, shadow }
overlays        [ … ]   shared across all languages
```

**The master/variant system covers TRANSFORM ONLY.** Every language mirrors `textTransform`
until it is explicitly unlocked, at which point it gets a `textOverrides` entry it owns.
`languages[0]` is the primary and *is* the master — it can never be unlocked from itself.
Resetting a variant deletes its override and re-mirrors. Removing a language must also delete
its override, or you leak orphans.

**Content is per-language. Style is shared. Keep it that way** — a language variant must never
be able to fork the *words*, only presentation. Anything that lets `texts[es].heading` diverge
from a translation of `texts[en].heading` by accident is a bug.

---

## Conventions

- Comments explain **why**, never what. If a line needs a "what" comment, rename something.
- New shared math goes in `utils/`, not inlined into a component, if two callers could need it.
- Inspector controls follow the existing `.row` / `.lbl` / `.text` class pattern in `styles.css`.
  Reach for the `Stepper` pattern (`[-10] [-1] [input] [+1] [+10] [↺]`) instead of a bare
  slider whenever precision matters at small on-screen zoom levels.
- Prefer styled in-app modals over `window.confirm` / `window.prompt` for anything a user hits
  routinely. This is a showpiece; native dialogs read as unfinished.
- Accessibility is a default: real labels, visible focus states, sensible contrast, keyboard
  paths for anything reachable by mouse.

---

## Known traps

- **Check that a field is actually consumed before trusting it.** `padding.top` was silently
  ignored until Session 2, and `imageScale`/`imageOffset` sat dead until Session 3. Both are
  live now, but the pattern recurs: a field in `makeScreenshot()` is not proof of a reader.
- **The Claude Code dev-preview panel can serve another project's content on localhost.** Trust
  the Vite process log, not a curl against the preview URL.
- **That same browser pane throttles `requestAnimationFrame` to zero while hidden.** Export
  awaits a frame, so `toPng` appears to hang forever and any timing measured through it is
  meaningless. Front the pane before testing or benchmarking export.
- **The dev-server file API is loopback-only on purpose.** Three independent gates (socket
  address, `Host` header, `Origin` on mutating methods) protect unauthenticated read/write/delete
  access to `projects/`. `npm run dev:lan` exposes the *app* to the LAN; the API stays local, and
  the client degrades to download/upload when it sees a 403. Don't "fix" that 403 by loosening
  the plugin.
- **Goldman Sans is git-ignored** — it is Goldman Sachs' corporate typeface, not an open licence,
  so it is not redistributed. It works locally and falls back to Inter on a fresh clone. The
  other four families are self-hosted under the OFL; do not reintroduce a Google Fonts CDN link,
  which reopens the cross-origin `cssRules` failure and breaks export offline.
- **Don't "un-transform" a frame before export.** `exportScreenshotPng` already overrides
  `transform: scale(1)`; the display scale is not baked into the capture.
- **Batch export mutates `activeLanguage`** as it iterates, waiting two animation frames per
  language for React to re-render. Anything that reads language during export must tolerate that.

---

## Work log

`WORK_STATUS.md` in the project root is the running session log — read it at the start of a
session and add an entry at the end. It carries the reasoning behind decisions, not just the
diff. New sessions go at the top.
