# Screenshot Maker — Work Status

## 2026-07-23 · Session 7 — iPad device, tighter composition, dark scrollbars, re-shoot

Design feedback pass on the GitHub screenshots, plus the code changes behind it.

**Code changes**
- **New `ipad` device type** (`DeviceFrame.jsx` `SPECS`, `store.js` `DEVICE_TYPES`). Modern
  iPad (no home button): uniform thin bezels (`outerBezel` 0.016 / `innerBezel` 0.034, vs a
  phone's ~0.04 combined), gentle corners (`bodyRadius` 0.052 vs iPhone 0.115), a single
  top-centre camera dot, slim right-side volume keys. Body aspect 1.40 → screen aspect ~1.44
  once the uniform bezel is inset, which lands near an iPad 11"/Air panel. Flows through the
  existing two-bezel renderer and `computeScreenBounds` for free — this was exactly the
  "adding a device is one `DEVICE_SPECS` entry" claim paying off.
- **Default `textAreaHeight` 600 → 470** (`store.js` `defaultText`). Hunter's note: the headline
  band left too much dead space above the phone. Because text is top-anchored, that height *is*
  the headline-to-device gap, so a smaller value sits the (now larger) device closer to the text.
  New frames only; existing saved frames keep their stored value.
- **Dark scrollbars — Firefox coverage added** (`styles.css`). The WebKit scrollbar was already
  dark (`::-webkit-scrollbar` rule); added `::-webkit-scrollbar-corner` and a Firefox
  `scrollbar-color` / `scrollbar-width` on `html`. See the finding below — the "light scrollbars
  in the screenshots" were NOT an app bug.

**The scrollbar finding (don't re-fix this)**
- The editor's scrollbars are **already dark in the running app** — Chrome honours the global
  `::-webkit-scrollbar` rule. The light scrollbars Hunter saw were a **`html-to-image` capture
  artifact**: its foreignObject render paints default OS scrollbars and ignores
  `::-webkit-scrollbar` styling. Fix for the images was to suppress scrollbar geometry during
  capture (`scrollbar-width: none` + `::-webkit-scrollbar{display:none}` injected as a temporary
  `<style>`, removed after). If future captures show light scrollbars again, it's the capture,
  not the CSS.

**Screenshots re-shot** (all in `docs/`, via the same html-to-image + local writer flow as
Session 6; the rAF-throttle workaround still applies — kick off un-awaited, front the pane to let
it run, poll `window.__cap`)
- Replaced `workspace.png` + `frame-home/route/stats.png` with tighter-composition versions
  (demo Area H set to 390, padding top/bottom 44/26) and scrollbars suppressed.
- Added iPad images: `frame-ipad.png` + `frame-ipad-streak.png` (1668×2388 exports),
  `workspace-ipad.png` (iPad editor view). Drawn iPad app screens are a tablet dashboard (left
  nav rail, hero card, 2×2 stat grid, recent list) at ~1.44 aspect to match the new device.
- `README.md` updated: iPad example under "What it makes", iPad added to the device list and the
  how-to.

**Note for next session**
- The **phone demo ("Ark — Store Screenshots") is restored** in localStorage (the iPad demo was
  temporary, backed up to `sm-backup` during capture and rolled back). To see the iPad mockup in
  the app: switch a frame's device to **iPad** in the Device panel and change the export size to
  an iPad preset (the demo used iPad 11", 1668×2388).

---

## 2026-07-23 · Session 6 — GitHub screenshots + README rewrite

Produced the public-facing README content and a fresh set of docs images. No app code changed.

**What changed**
- **`docs/` images** — replaced the two stale, pre-font-work images (`app.png`,
  `example-frame.png`, deleted) with five current ones: `workspace.png` and `font-picker.png`
  (full UI, 3360×2000 / retina 2×) and `frame-home.png` / `frame-route.png` / `frame-stats.png`
  (authentic full-res 1284×2778 exports).
- **`README.md`** — rewritten in Hunter's first-person voice ("I kept hitting the same chore…
  so I made this for my own projects"). Added a numbered **How to use it** section. Kept the
  technical sections (render trick, fonts, loopback security, roadmap) but trimmed and re-voiced.
  Updated all image references to the new files.

**How the images were made (repeatable)**
- Injected a demo project into `localStorage` (`screenshot-maker-v1`, version 3) via the browser
  console: 3 frames, 3 device types (iphone-pro / iphone-notch / android), 3 languages
  (en/es/de), an "Ark" hiking-app theme. The three in-device app screens are drawn with a canvas
  script (no real app needed) — earthy palette matching the terracotta accent.
- Captured at full res with the app's own `html-to-image` (reached via the Vite optimized-deps
  path `/node_modules/.vite/deps/html-to-image.js`), POSTed the dataURLs to a throwaway local
  python writer on :8899 that wrote them into `docs/`. Server since stopped, script deleted.
- **The rAF trap (CLAUDE.md) bit here too:** the Claude Code browser pane throttles
  requestAnimationFrame to zero while hidden, so `toPng` hangs. Worked around it by kicking the
  capture off un-awaited, storing progress on `window.__cap`, then fronting the pane with a
  screenshot to let each capture complete, polling between. Frame exports came out 1.0–1.8 MB.

**Note for next session**
- **The demo "Ark — Store Screenshots" project is still loaded in localStorage.** Left
  deliberately so Hunter can take his own screenshots of the same polished scene (he said he'd
  grab some too). To get back to the blank default: project menu → New project, or clear the
  `screenshot-maker-v1` localStorage key.

---

## 2026-07-22 · Session 5 — drop-in custom fonts folder

Hunter asked for the simplest possible font workflow: drop files into a folder, launch, they're
there — like macOS's own Font Book but scoped to this app. He chose (over a unified folder or a
repo-root folder) a **separate drop folder**, kept distinct from the app-managed `installed/`
fonts. One agent, whole tree to itself.

**The gap it closed:** the Session-4 installer only recognized a font folder if it had a
generated `meta.json` — hand-made folders were deliberately skipped. So a raw `.ttf` you dropped
in was invisible. This session added the opposite kind of scan: trust the bytes, not metadata.

**What changed**

- **`public/fonts/custom/` — a launch-time drop folder** (`vite-plugin-fonts.js`)
  - New `discoverCustomFamilies()` runs in the same `configureServer` startup hook as
    `rebuildAggregate`, so it fires on every launch. For each file it sniffs the 4 magic bytes
    (`sniffFont`, not the extension) and infers weight/style from the filename (`guessStyle`).
  - Two drop styles: **a subfolder per family** (`custom/Acme Grotesk/*.ttf` → family "Acme
    Grotesk" — the reliable path) and **loose files** whose family is parsed from the filename by
    stripping weight/style tokens (heuristic; documented as less predictable). Both work.
  - Generates `public/fonts/custom/custom.css` (atomic write) — the third companion to the
    hand-maintained `webfonts.css` and the generated `installed.css`, neither of which it touches.
    `index.html` links all three. Non-font files (`.DS_Store`, a stray `notes.txt`) are skipped
    silently; an empty folder yields a valid header-only stylesheet, not an error.
  - ttf/otf served as-is — no server-side woff2 conversion. Same-origin static files, so they
    render and export like any bundled font.
  - New `GET /api/fonts/custom` (behind the same `checkAccess` gate) plus a
    `POST /api/fonts/custom/rescan` so a dropped file can be picked up without a full restart.
- **App wiring** (`fontServer.js`, `fontRegistry.js`, `FontPicker.jsx`)
  - `listCustom()` / `rescanCustom()` mirror `listInstalled()`'s `ApiUnavailable` degradation.
  - Registry gains a fifth source, `custom`. Dedup priority: **bundled > installed > custom >
    system > stack** — app-managed families win over a drop; a drop wins over an OS font because
    it's a same-origin file that travels with the project and needs no permission prompt.
  - Picker shows a "Your fonts (dropped in)" group with the folder path and a Rescan button.
- **Docs + git** — `public/fonts/custom/README.md` (designer-facing how-to), `.gitkeep`, a
  `.gitignore` block ignoring `custom/*` except those two (same licensing/provenance reasoning as
  `installed/`; `custom.css` is generated so it's ignored too), and a root README update.

**Why**

- **Separate folder, not unified.** Hunter's mental model is "my fonts" vs "the app's fonts."
  Keeping drops in `custom/` and installs in `installed/` means the app never writes next to a
  file he dropped, uninstall never touches his folder, and the two groups read clearly apart in
  the picker. He picked this explicitly over one shared folder.
- **Under `public/`, not repo root.** A top-level `Custom Fonts/` would be more Finder-visible
  but sits outside Vite's served `public/` dir and would need extra middleware to serve. Not
  worth the moving parts; `public/fonts/custom/` is still a plain Finder folder.
- **Trust bytes over extension** — a magic-byte sniff is why renaming a PDF to `.ttf` can't
  poison the scan, and why a real font with a weird extension still works.

**Connections**

- Three stylesheets now, by design: `webfonts.css` (hand-maintained, bundled four), generated
  `installed.css` (app installs/uploads), generated `custom.css` (drops). Separation is what
  keeps any one from corrupting another. All three linked from `index.html`.
- `fontRegistry.js` is still the single list the app reads; `custom` is just another source
  feeding it, degrading to `[]` when the dev server (and thus the API) isn't there.

**Gotchas**

- **`portable` vs availability.** A custom font is flagged `portable: true` (same-origin, exports
  correctly), but the files are git-ignored, so on another clone they're simply absent — caught
  at runtime by the existing availability probe firing the missing-font warning, not by the
  static flag. That's the right division: `portable` is about export fidelity, the probe is about
  presence.
- **Empty-folder discoverability** (known, left as-is): the "Your fonts (dropped in)" group only
  appears once at least one custom font exists, so a first-timer with an empty folder gets no
  in-picker pointer to it. The two READMEs cover it. An always-visible custom-group footer would
  close it but complicates the picker's keyboard nav — deferred deliberately. **Easy follow-up if
  Hunter wants the hint always shown.**
- Build-time caveat: discovery runs on dev-server start (`apply: 'serve'`). Drop files, then
  `npm run dev` regenerates `custom.css`. If you drop files and go straight to `npm run build`
  without launching dev first, the last-generated `custom.css` is what ships — relaunch dev once
  after dropping.

**Verified (measured, not reasoned)** — build passes; `/api/fonts/custom` found a subfolder
family and a loose-file family and skipped a `notes.txt` decoy live via rescan; empty folder →
valid empty stylesheet, no error. **Export:** through the real `exportScreenshotPng`, a dropped
"Acme Grotesk" heading came out **741px ink width** (DOM advance 749px) vs **801px** for the
monospace fallback in its stack — the PNG used the dropped face, not a substitute. Drop folder
reset to empty (`.gitkeep` + `README.md` + empty `custom.css`) so Hunter starts clean.

**Open** — the empty-folder hint above; loose-file parsing stays heuristic (subfolder is
reliable); everything from Sessions 3–4's open lists still stands.

---

## 2026-07-22 · Session 4 — font system: local/system fonts + Google installer

Hunter wanted the font picker (a 9-item `<select>`) to reach his real font library. Answered in
two directions at once: use fonts already installed on his machine, AND install Google families
locally. Explicitly did NOT reintroduce a CDN `<link>` — that's the thing Session 3 removed.
Work split across three subagents (local/system half, Google-installer half, then a popover-fix
pass at the seam). Merged picture below.

**The load-bearing finding (settled empirically before building)**

System/local fonts referenced only by name **DO survive PNG export** — measured, not assumed.
Method: export a PNG, measure rendered-glyph ink width against the live DOM and against a
deliberately-wrong fallback. Menlo/Georgia/Helvetica plus two non-web-safe installed families
(Morganite, Ostrich Sans) all matched the DOM within ~1%; an invented family collapsed to the
`sans-serif` baseline. End-to-end at native 1284×2778: heading ink width Menlo 1071px vs
Morganite 380px vs fallback 977px — the export genuinely used the local face. This is why fonts
are referenced by name (cheap, no capture bloat, no `export.js` change) rather than
byte-embedded. Byte-embedding exists only as an opt-in for portability.

Second finding: **`document.fonts.check()` is unusable for missing-font detection** — returns
true for invented names, false for a bundled working font. Replaced with `document.fonts.load()`
(forces the face to actually resolve or 404) plus a canvas metric probe against two generics.

**What changed**

- **Local/system fonts** (`src/utils/localFonts.js` NEW)
  - Wraps the Local Font Access API (`queryLocalFonts`). Chrome/Edge + secure context only;
    Safari/Firefox degrade to the bundled list with a note. Permission granted/denied/never-asked
    are handled distinctly and cached for the session. Flat face list is grouped into families.
- **Unified font registry** (`src/utils/fontRegistry.js` NEW)
  - One list merging four sources — bundled (self-hosted), installed (via the Google installer),
    system (when permission granted), and generic stacks. Each entry: `id, label, family, value,
    source, weights, hasItalic, exportSafe, portable`. Deduped by family with priority
    bundled > installed > system > stack. `portable: false` only for `system` — that flag drives
    the missing-font warning. Reaches the optional server/browser modules via `import.meta.glob`
    so the build passes whether or not they exist.
- **New font picker** (`src/components/FontPicker.jsx` NEW, replaces the `<select>` in TextPanel)
  - Searchable, grouped by source, each family previewed in its own typeface. "Use my installed
    fonts" affordance explains itself before triggering the permission prompt. Full keyboard nav
    with correct `aria-activedescendant` (careful: option ids contain spaces like
    `system:Helvetica Neue` — that broke the keyboard model once and is now handled).
- **Google Fonts installer — server side** (`vite-plugin-fonts.js` NEW, `vite.config.js`)
  - Endpoints for catalog / installed / install / upload / remove, mounted like the project-files
    plugin. Downloads woff2 into `public/fonts/installed/<slug>/` with `@font-face` rules, a
    `meta.json`, and the real OFL `LICENSE.txt`. Generates `public/fonts/installed/installed.css`
    (linked from index.html alongside the hand-maintained webfonts.css, which is never rewritten)
    and re-links it live — no Vite restart. Rebuilt from disk on every dev-server start, so it
    self-heals.
  - Catalog from `fonts.google.com/metadata/fonts` (no API key), disk-cached 7 days, with a
    bundled 220-family fallback so it never hard-fails.
  - **Subsetting is the anti-bloat lever.** Default = Latin + latin-ext + whatever the project's
    `languages` list implies (ru→cyrillic, vi→vietnamese, …), weights 400/700, italic on
    (because `*asterisk*` markup renders italic). Overridable per family. A dry run HEADs the real
    files and returns exact byte/file counts before downloading.
  - **Drop-your-own fonts** via the upload endpoint — ttf/otf/woff/woff2 validated by magic bytes,
    not extension. Covers licensed families that will never be on Google. Registered identically.
- **Client transport + catalog browser** (`src/utils/fontServer.js` NEW,
  `src/components/GoogleFontBrowser.jsx` NEW)
  - `fontServer.js` mirrors projectFile.js's `ApiUnavailable` pattern (incl. 403-means-unavailable
    for the LAN case). `GoogleFontBrowser` is the search/preview/install/upload UI.
- **Popover clipping fix** (`FontPicker.jsx`, `GoogleFontBrowser.jsx`, styles.css)
  - The catalog browser moved OUT of the 280px inspector popover into a portaled modal (reuses
    `.modal-backdrop` so canvas shortcuts stand down; `useDialogFocus` for the trap). The
    everyday "pick a family I already have" path stays a fast popover, now viewport-clamped
    (flips above / shifts left, min-width 340) so it can't render off-screen at any inspector
    width. Reached via an "Add a font…" button in the popover footer.

**Why (decisions & reasoning)**

- **Both directions, not one.** Local Font Access is the right primary path for a tool you run
  yourself — it reaches Adobe Fonts and licensed families Google will never have. The Google
  installer is the way to make a font *travel with the repo*. They share one registry.
- **Reference by name, don't embed.** The Task-0 measurement made this safe. Embedding would
  reintroduce the per-capture bloat Session 3 fought (Inter = ~1.4 MB/capture with all subsets)
  and raises a redistribution question — embedding a licensed font's bytes into a shared project
  file or PNG is often a licence violation. Embedding stays opt-in, per-family, session-only.
- **Install-locally over CDN link.** A `<link>` would put a cross-origin stylesheet back in the
  page, and html-to-image can't read cross-origin `cssRules` — the exact failure Session 3
  removed. Same-origin installed files just work, offline included.
- **Server does the network, never the client, and never a caller-supplied URL.** The install
  endpoint takes a family *name*, builds every URL server-side against a fixed Google host
  allowlist, and uses `redirect: 'error'` — closing the SSRF hole a "download this URL" API would
  open. Same three loopback/Host/Origin gates as the project-files plugin.

**Connections**

- `fontRegistry.js` is the single list the whole app reads; `localFonts.js` and `fontServer.js`
  are its two dynamic sources, both optional and both degrading to sentinels when absent.
- Installer writes to `public/fonts/installed/`, generates `installed.css`, links it from
  index.html next to `webfonts.css`. `webfonts.css` (the four bundled families) is hand-
  maintained and never touched by the generator; installing a name it already declares → 409.
- The missing-font path keys off registry `portable` + a `document.fonts.load()` probe; its
  warning chrome renders outside `[data-export-id]` like every other display-only affordance.

**Gotchas & surprises**

- **`.gitignore` had a real latent bug** (fixed): `Fonts/` was unanchored and macOS sets
  `core.ignorecase=true`, so it also matched `public/fonts/` and silently excluded every
  self-hosted family — the whole point of not using a CDN — from the repo. Now `/Fonts/`.
- **CJK families emit ~120 UNLABELLED `@font-face` blocks.** A comment-required parser would have
  installed only their Latin faces and looked successful. Unlabelled blocks are now attributed to
  the family's CJK subset (Noto Sans JP → 121 files, verified). These are also ~5 MB and every
  face embeds into each export — the dry run shows the cost and the UI warns past 40 files.
- Two Vite footguns the installer agent hit and fixed: `server.watch.ignored` on the install dir
  broke serving entirely (newly written woff2 404'd into the SPA fallback as text/html →
  permanently-failed font faces); and there's a ~100-200ms window post-install before Vite sees
  the new dir, so `refreshStylesheet()` now polls one real file before re-linking.
- The Google metadata endpoint is undocumented and unversioned. Browsing has a fallback; the
  install-time css2 *parser* does not — it's the thin spot if Google changes response format.
- Cleaned up two test-installed families (Bricolage Grotesque, Lato) and a stray harness
  `.claude/launch.json` at session end. The demo document's font may still point at Bricolage in
  localStorage — that just exercises the missing-font indicator on reload; reselect any family.

**Could not verify (environmental)**

- **The real granted `queryLocalFonts()` path.** The Claude Code browser pane reports
  `local-fonts` permission `denied`, so the actual API call and `.blob()` were never exercised —
  grouping/dedupe/UI were validated against a synthetic face list. **Hunter should click "Use my
  installed fonts" once in a normal Chrome window to confirm the live path.**
- Offline export of an *installed Google* family WAS verified (network monkey-patched to reject
  non-same-origin; zero blocked requests, headline rendered in the installed face). Export timing
  through the pane remains unreliable per the rAF-throttle trap.

**Open questions / next steps**

- Export weight for CJK / many-subset families is the remaining lever if PNG size matters.
- The css2 install parser has no fallback — a monitoring note, not a fix.
- Everything from Session 3's open list still stands (undo/redo, per-frame export size, opening a
  project as source-of-truth vs the localStorage snapshot).
- Build clean (`npm run build`, 609ms). Nothing half-done.

---

## 2026-07-22 · Session 3 — variant overrides, project files, launcher, GitHub readiness

Hunter is publishing this as a public portfolio project. This session added the per-language
text override system he asked for, real project files, a double-click launcher, and a polish
pass — then closed a security hole and an export-fidelity bug found along the way. Work was
split across five subagents on disjoint file sets (no git here, so file ownership was the only
collision guard); this entry is the merged picture.

Added `CLAUDE.md` — the project had none. It holds the architecture, the load-bearing
invariants, and the traps. Read it before touching anything.

**What changed**

- **Per-language text transform overrides** (`src/utils/variants.js` NEW, `store.js`,
  `Screenshot.jsx`, `inspector/TextPanel.jsx`, `ConfirmDialog.jsx` NEW)
  - The text block can now be moved, scaled and rotated. `screenshot.textTransform` is the
    master; `screenshot.textOverrides[lang]` is a sparse map where a key's *presence* means
    that language is unlocked. `languages[0]` is the primary and IS the master.
  - `resolveTextTransform()` is the only place precedence is decided. `variantKey(lang)` is a
    deliberate seam — it becomes `lang@sizeProfile` when per-frame export sizes land.
  - Dragging text on a mirrored non-primary language opens a dialog instead of moving anything;
    unlocking is always explicit. Reset deletes the override and re-mirrors.
  - Defaults are identity, so pre-existing projects render pixel-identically (verified: an
    identity transform emits no `transform` property at all).
  - `.text-area` went from `overflow: hidden` to `visible` so a moved or scaled block isn't
    clipped. **Behaviour change:** headings that previously overflowed `textAreaHeight` were
    silently clipped and will now show.
- **Text content is never forked.** Only transform is overridable; `texts[lang]` stays the
  single per-language content store. There is a comment in `store.js` saying so.
- **Project files** (`vite-plugin-project-files.js` NEW, `src/utils/projectFile.js` NEW,
  `ProjectMenu.jsx` NEW, `vite.config.js`)
  - Dev-server REST API backing `projects/*.smproj.json`. New / Open / Save / Save As / Import /
    Export, a dirty indicator, and Cmd+S.
  - Format: `{ app, schemaVersion, name, savedAt, state }`. `state` is spread through wholesale
    so fields added later round-trip without `projectFile.js` naming them.
  - Degrades to browser download/upload whenever the API isn't reachable.
- **Launcher** — `Launch Screenshot Maker.command` (macOS, double-clickable) and `launch.sh`.
  Installs deps if missing, starts Vite, polls the port, opens the browser. Windows: `npm run dev`.
- **Security: the file API was reachable from the whole network.** `host: true` plus an
  unauthenticated read/write/delete API over `projects/`. Now: loopback bind by default
  (`SM_HOST=lan` opts in), plus three independent middleware gates — socket address, `Host`
  header (DNS rebinding), and `Origin` on mutating methods (CSRF). Verified by curl from a real
  LAN address against a deliberately LAN-bound server.
- **Export fidelity: fonts.** Every export threw a cross-origin `cssRules` error on the Google
  Fonts stylesheet. Investigation showed glyphs were actually *correct* — html-to-image silently
  recovers by refetching — but at the cost of ~130 remote fetches per session, a 6.2 MB capture
  SVG for Playfair, and total failure offline. Fixed by self-hosting all four families as woff2
  (0.91 MB, full subset parity) and precomputing `fontEmbedCSS` once per batch. Console is now
  clean and exports work with no network.
- **Polish pass**
  - Text overflow warning: measures each language, flags the frame with an amber outline and a
    "overflows by Npx" badge, shows real numbers in the Text panel, and a per-language pill row
    so you can see which translations bust the box without clicking through each one.
  - `imageScale` / `imageOffset` are live — pan and zoom the screenshot inside the device, with
    clamping derived from the exact slack `object-fit: cover` leaves.
  - Frame rename (click the label) and reorder (◀ ▶ buttons, keyboard-native).
  - `preheaderTracking`, `preheaderGap`, `headingLineHeight` promoted from hardcoded values to
    editable fields.
  - Keyboard shortcuts (arrow nudge, Cmd+D, Escape, `?` help overlay), all guarded against
    firing while typing.
  - Every `alert` / `confirm` / `prompt` replaced with `ConfirmDialog` / `PromptDialog`, which
    share focus-trap and ARIA wiring via `dialogFocus.js`.
  - `Stepper` extracted to its own component (it had been duplicated in two panels).
- **`README.md`, `LICENSE` (MIT), `.gitignore`, `docs/` with two real captured images.**

**Why (decisions & reasoning)**

- **Master + sparse override map, not a per-language copy of everything.** Storing a full
  transform per language would make "mirrored" a thing you maintain rather than a thing you get
  for free, and drift would be invisible. A missing key meaning "mirrored" makes the default
  self-enforcing, and reset is a delete rather than a re-sync.
- **The unlock prompt fires on drag, but the inspector steppers are disabled instead.** A modal
  on every keystroke and every `+1` click would be maddening and ambiguous about which control
  triggered it. A drag is one discrete gesture where an interruption reads naturally. The
  outcome is identical — nothing edits the master by accident.
- **`useStore.getState()` for project files rather than store actions.** Kept the save/load work
  fully decoupled from the concurrent store rewrite, and has the happy side effect that project
  files automatically carry fields nobody thought to enumerate.
- **Loopback-only rather than adding auth.** A token on a local dev tool is theatre; restricting
  the surface is the actual fix. LAN preview of the *app* is still available because previewing
  on a real phone is a legitimate need — the API just doesn't follow it out there.
- **Self-hosting fonts over the one-line `crossorigin` fix.** `crossorigin` would have silenced
  the error, but the tool would still break offline and still pull ~130 files per session. A
  local-first tool shouldn't need the network to render its own output correctly.
- **Goldman Sans is git-ignored, not deleted.** It's Goldman Sachs' corporate typeface under
  their own terms, not an open licence. Publishing it from a public repo is Hunter's call to
  make deliberately. Files stay on disk and work locally; a fresh clone falls back to Inter.

**Connections**

- `utils/variants.js` is the single authority on transform precedence, the way `utils/layout.js`
  is for screen bounds. Both are import-don't-reimplement.
- State now enters the store by two doors — localStorage rehydration and project-file load — and
  both funnel through `migratePersistedState` / `normalizeScreenshots`, exported from `store.js`.
  A new persisted field needs its backfill there or old files break on one path only.
- Display-only canvas chrome renders as a *sibling* of `.screenshot-frame` (the `data-export-id`
  node), mirroring its `scale()`. That's why warnings and badges can't leak into exports. Any new
  on-canvas affordance belongs in that layer.
- Persist version is now 3.

**Gotchas & surprises**

- **`.screenshot-card { overflow: hidden }` had been hiding the frame label and Dup/Del buttons
  entirely** — they sat at `top: -22px` and were clipped away. So "there's no way to rename a
  frame" was literally true: the whole header row was invisible. The clip moved to
  `.screenshot-frame-wrapper`.
- **zustand 4.5 only calls `migrate` when the stored blob has a numeric `version` key.** Real
  saves always do, but a hand-written or externally-produced blob skips migration silently. A
  `merge` that normalizes on every rehydration now covers both.
- **The Claude Code browser pane throttles `requestAnimationFrame` to zero while hidden**, and
  export awaits a frame — so `toPng` looks like it hangs forever and any timing from that path is
  meaningless. Front the pane before testing export. (Added to CLAUDE.md alongside the existing
  preview-panel warning.)
- Inter embeds ~1.4 MB of font CSS per capture because all 14 subset faces match the family.
  Harmless locally, trimmable if export weight ever matters more than script coverage.

**Open questions / next steps**

- **Per-frame export size / mirrored child rows** is still the big deferred item, and it is now
  the thing standing between this and the iPad-and-small-phone workflow. `variantKey()` was built
  as its seam. Genuinely a session on its own.
- Overlays are shared across all languages with no override path. That matches what was asked
  for, but the same `textOverrides` mechanism would extend to them if per-language callout
  placement is ever needed.
- Opening a project doesn't become the source of truth — the localStorage snapshot still wins on
  reload. The content is right; only the relationship to the file on disk is fuzzy. Worth
  deciding deliberately.
- Toolbar's export toast and ProjectMenu's notice share positioning, so simultaneous messages
  would overlap. Rare; a toast stack would fix it.
- Build is clean (`npm run build`, 515 ms). Nothing half-done.

---

## 2026-07-22 · Session 2 — layout fixes, two-layer iPhone bezel, overlay UX

Hunter came back to test the v1 build. Fixed three real layout bugs, restyled the iPhone mockup to match a real-world reference (two-layer bezel), fixed a subtle click-selection bug that made the overlay inspector disappear on mouseup, and rebuilt the overlay controls around a scale slider + button steppers instead of raw W/H sliders.

**What changed**

- **Layout** (`src/components/Screenshot.jsx`, `src/styles.css`)
  - `.text-area` in CSS: was `display: flex; flex-direction: column; align-items: center; justify-content: flex-end; padding: 0 60px 30px; text-align: center` — now just `position: absolute; overflow: hidden`. The old rules were silently forcing every text alignment to center and pinning text to the bottom of the region.
  - Text area positioning in `Screenshot.jsx` now uses `left: padding.left, right: padding.right, top: padding.top, height: textAreaHeight`. Padding.top now actually pushes the text (and image) down.
  - Image area top changed from `top: textBottom` → `top: padding.top + textBottom`. Same padding.top wiring.
  - `availableHeight` for device-width fitting and `computeScreenBounds` both updated to subtract `padding.top`.
- **iPhone / Android mockups** (`src/components/DeviceFrame.jsx`)
  - Swapped single-bezel spec (`bezel: N`) for a two-layer spec: `outerBezel` (colored metal rim) + `innerBezel` (thin black ring around screen). New `midRadius` for the inner black-ring corner. `bodyRadius` and `screenRadius` unchanged.
  - Render order: outer colored div (with subtle inset highlights so the metal doesn't look flat) → inner black div → screen div (clips content, holds Dynamic Island / notch / camera hole).
  - Dynamic Island tuned: was 28% × 4.5% at 1.8% top offset → now 29.5% × 5.5% at 3% top offset. Notch bezel bumped a bit thicker for older iPhone type.
- **Selection bug + crop editing for zoom overlays**
  - `src/store.js`: `selectScreenshot` no longer clears `selectedOverlayId` when the same screenshot is re-selected. Added `cropEditingId` state + `setCropEditing` action.
  - `src/components/Overlay.jsx`: added `onClick={e => e.stopPropagation()}` so clicks don't bubble to the frame's `onClick`.
  - `src/components/Screenshot.jsx`: `onFrameMouseDown` now branches — if `cropEditingId` matches an overlay on this screenshot, the drag *updates* that overlay's `srcRect` instead of creating a new zoom. New `updateCrop` helper does the source-image-pixel conversion (mirror of `createZoomOverlay`).
  - Blue rectangle overlay drawn on the canvas showing the current source region whenever a zoom overlay is selected — visual confirmation of what's cropped.
  - `src/components/Workspace.jsx`: terracotta banner while `cropEditingId` is active (mirrors the blue zoom-mode banner).
  - `src/components/inspector/OverlaysPanel.jsx`: added `CropControls` sub-component with "✂ Re-select crop region" toggle + numeric Src X/Y/W/H inputs.
- **Layout util extraction** (`src/utils/layout.js` — NEW)
  - Moved `computeDeviceWidth` and `computeScreenBounds` out of `Screenshot.jsx` so `OverlaysPanel` can use them too. Added `cropNaturalCanvasSize(overlay, screenBounds, imgNatural)` — returns the canvas-pixel size the cropped region would occupy at 1× scale on the underlying screen.
  - `Screenshot.jsx` now imports these instead of inlining the math.
- **Image natural size hook** (`src/utils/useImageNatural.js` — NEW)
  - Small hook that loads an `<img>` and returns `{src, naturalWidth, naturalHeight}`. Used by both `Screenshot.jsx` (via inline effect, unchanged) and `OverlaysPanel` (new — needed for scale math).
- **Rotation stepper + Zoom scale control** (`src/components/inspector/OverlaysPanel.jsx`)
  - Replaced rotation slider with a `Stepper` component: `[-10] [-1] [text input] [+1] [+10] [↺]`. Text input accepts any value, ↺ resets to 0°.
  - Added `ZoomScale` component (only shown for zoom overlays): a 10–300% slider centered at 100% + a stepper row for exact typing. 100% = same size as the cropped region would appear on the underlying screen (computed from `cropNaturalCanvasSize`). Resizing preserves overlay center so it doesn't visually jump.
- Two dev server restarts (`npm run dev` in the background). No config changes.

**Why (decisions & reasoning)**

- **Top-anchoring the text instead of adding a "text-to-image gap" input.** Hunter's complaint was that AreaH grew the region but kept text pinned to the bottom, so it stayed too close to the phone. Two ways to fix: (a) new "gap after text" knob, or (b) anchor text to the top so AreaH itself becomes that gap. Went with (b) because it's one fewer control, and top-anchored text matches every reference frame Hunter shared. AreaH is now a direct-manipulation knob for the gap.
- **Two-layer bezel with a separate black inner ring, not a border on the screen.** Could have done a single `border: N solid #000` on the screen div, but that gives you a rectangular black border, not a *ring with its own corner radius that differs from both the metal frame and the screen*. Real iPhones have three concentric radii (device / black bezel / screen). Rendering three stacked divs with their own radii is the only way to get that look.
- **Selection bug fix in two places (store + Overlay).** The store fix (don't clear overlay on same-screenshot reselect) is the load-bearing one — even if `stopPropagation` on `onClick` somehow missed an edge case, the store now protects the invariant. Added stopPropagation anyway as belt-and-braces.
- **Scale as a computed multiplier, not a stored field.** Considered storing `scale` on the zoom overlay and deriving `w`/`h` on render. Rejected because dragging the corner handle would need to translate the delta back into a scale change, and the existing corner-drag code operates on `w`/`h` directly. Kept `w`/`h` as the source of truth; the scale slider reads `overlay.w / naturalCanvasW` as "current" and writes back to `w`/`h` on change. Corner drag and scale slider both work; scale simply reflects current state instead of storing a redundant field.
- **Extract layout utils rather than pass computed values as props.** `OverlaysPanel` needs the same screen-bounds math for the scale calc. Could have passed `screenBounds` from `Screenshot` up through `Inspector` — but the inspector is a sibling, not a child. Extracting to `src/utils/layout.js` and letting each caller compute from the same primitives is cleaner and stays consistent if either place changes.

**Connections**

- `src/utils/layout.js` is now the single source of truth for "where does the screen sit on the canvas". `Screenshot.jsx`, `OverlaysPanel.jsx`, and any future exporter/overlay code should import from here rather than re-derive.
- `DEVICE_SPECS` is exported from `DeviceFrame.jsx` and consumed by `layout.js`. Adding a new device type = add an entry in `DEVICE_SPECS` (with `outerBezel`, `innerBezel`, `bodyRadius`, `midRadius`, `screenRadius`, aspect, island/notch/cameraHole optionals) and it flows through both rendering and screen-bounds math automatically.
- `cropEditingId` lives at the store root, not per-screenshot. Only one crop can be edited at a time across the whole app.
- The zoom overlay's `srcRect` is in **original image pixels** (screenshot's natural W/H), while `x/y/w/h` are in **canvas pixels**. The blue crop-outline overlay in `Screenshot.jsx` and the scale calc in `OverlaysPanel.jsx` both do the srcRect → canvas conversion via screen bounds — worth remembering when touching either.

**New components / patterns**

- `Stepper` (in `OverlaysPanel.jsx`) — reusable `[-N] [-1] [input] [+1] [+N] [↺]` control. Currently used for rotation only; would slot in cleanly anywhere a slider was too fiddly at small canvas display sizes.
- `ZoomScale` — the pattern for "slider + stepper + percent input" that reads a derived value from state and writes back to base fields. Same pattern could work for a text-size-relative-to-canvas knob if we ever want that.
- Two-layer bezel spec (`outerBezel`/`innerBezel`/`midRadius`) — the pattern to reach for when adding future device types (iPad, foldable, etc.). Every future SPEC should follow this shape.

**Gotchas & surprises**

- The dev preview panel that appears in the Claude Code UI intercepts localhost requests and can return content from *other* projects (saw it return the "Mutual Connect" project's index.html). The actual Vite server binds and serves correctly (`ready in ~200ms` in logs). If curl-testing the dev server ever looks wrong, trust the Vite process log and check the browser manually.
- html-to-image captures the DOM at its native pixel size regardless of the CSS `transform: scale(displayScale)` on the wrapper — that's why exports come out at 1284×2778 (or whatever the export size is) even though the on-screen preview is scaled down. Don't add code that "un-transforms" the frame before export; it's already handled by the `style: { transform: 'scale(1)' }` override in `exportScreenshotPng`.
- `padding.top` used to be a dead field — silently ignored by the layout. Anyone who tuned padding.top before Session 2 saw no effect. Not something the code guards against, but worth knowing if we see confusion in older saved states.

**Open questions / next steps**

- Still deferred from Session 1: **mirrored child rows** (parent row + smaller-size child rows that inherit content). Architecture supports it (add `parentId` + `overrides` to the screenshot model, filter the workspace render, add a per-row override UI in Inspector). Genuine project, ~a session on its own.
- The `ZoomScale` component recomputes `screenBounds` on every render. Fine for now (cheap math). If we ever add per-frame heavy computations it could be memoized on `[screenshot, exportSize, imgNatural]`.
- Goldman Sans TTFs are wired up now (`public/fonts/goldman/*.ttf`, referenced from `styles.css`). Session 1 shipped an unwired placeholder; Session 2 pointed it at the actual files Hunter had dropped in `Fonts/` and copied them into `public/`.
- Nothing broken or half-done. Build is clean, dev server is running at `http://localhost:5173`.

---

## 2026-05-04 · Session 1 (initial build)

Built v1 of a React-based screenshot maker tool. Single-page app, runs locally with Vite, persists to localStorage.

### What it does

- Single-row workspace of screenshot canvases at any export size (defaults to 1284×2778). Each canvas shows a fixed-height text area on top + a configurable device mockup containing the dropped phone screenshot.
- Right-side inspector lets you edit Background, Text, Padding, Device, Overlays per selected screenshot.
- Templates panel saves/loads visual style across screenshots.
- Top toolbar handles export size, language variants, add, export-one, and batch export.

### Features implemented

**Core (from initial ask)**
- Drop-zone for phone screenshot per frame (drag-drop or click-to-upload).
- Configurable padding via 4 input boxes (top / bottom / left / right). Defaults: 30 / 30 / 20 / 20.
- Background: solid color, two-color gradient with angle dial, or uploaded image with cover/contain/stretch.
- Text overlay above the screenshot: separate **Pre-header** (small, all-caps, tracked) and **Heading** (large) per language.
- Italic-accent parsing: any text wrapped in `*asterisks*` renders italic and uses the accent color (terracotta default `#c66a4d`). Newlines render as line breaks.
- Fixed text-area height so multi-line variants stay aligned across frames.
- Font picker: Goldman Sans (local), Bebas Neue, Space Grotesk, Inter, Playfair Display, system serif/sans/mono.
- Per-frame primary + accent color, preheader/heading size + weight, alignment.
- Per-frame export to PNG at native resolution.

**Device mockups (added after pivot)**
- iPhone Pro (Dynamic Island), iPhone (Notch), Android Pixel-style — all rendered procedurally as styled HTML/CSS so they scale cleanly to any export size.
- Per-frame mockup color with quick-color swatch row including orange. Toggles for side buttons and drop shadow.

**Overlays**
- Paste images from clipboard (Cmd+V) — works for PNG copied from Figma, screenshots, etc. First paste with no main image becomes the main image; subsequent pastes drop in as floating overlays.
- Pop-out zoom: click "⊕ Pop-out zoom" then drag a region on the screen — creates a zoomed copy of that source-image region positioned next to the original. Resizable, rotatable, with shadow / border / radius controls.
- Per-overlay X/Y/W/H, rotation, corner radius, drop shadow (Y / blur / opacity), border (width / color / opacity). Drag to move, corner handle to resize. Backspace deletes when selected.

**Multi-screenshot**
- "+ Add Screenshot" duplicates the previous frame's style with empty texts.
- Each frame can be duplicated or deleted from buttons above its label.
- Horizontal scrolling row, fits-to-height auto-zoom plus a manual zoom slider.

**Language variants**
- Toolbar shows language pills. Click to switch, "+ Lang" to add, right-click a pill to remove.
- Each frame's text content is per-language while layout/style is shared.
- Batch export emits N screenshots × M languages as a zip, named `FrameName_EN.png`.

**Templates**
- Save the selected frame's BG + text style + padding + image radius as a named template.
- Apply to current selection or "All" frames at once.

**Export**
- Per-frame PNG export at the configured size.
- Batch export → zip of all frames × all languages, dimensioned to the configured export size.
- Common iOS + Android sizes preset, plus custom width/height.

**Surprises**
1. **Match Background** — extracts a 2-color palette from the dropped screenshot and applies as the gradient. One click.
2. **Language variants** — supports the EN/ES/etc. workflow your "Ark Frame 17-4 EN" naming implies.
3. **Auto-save** — entire state (including images as data URLs) persists to localStorage.

### What's deferred (called out in the original ask)

- **Mirrored child rows** (smaller phones inheriting from a parent row, with per-row tweaks). The architecture supports it via the existing `screenshots` array, but the UI for parent/child relationships and per-child overrides is its own project. Add `parentId` + `overrides` fields to the screenshot model when we tackle this.
- **iOS/Android designation per row** — currently each frame has its own `device.type`, which covers the case for now. Mirrored rows would extend this.

### Tech / structure

- Vite + React 18 + Zustand (with `persist` middleware for localStorage).
- `html-to-image` for PNG export, `jszip` + `file-saver` for batch.
- All canvas rendering is vanilla DOM/CSS so the export captures crisply at any resolution.
- Files:
  - `src/store.js` — zustand store, defaults, languages, templates, device list
  - `src/App.jsx` — three-panel shell
  - `src/components/Toolbar.jsx` — top bar
  - `src/components/Workspace.jsx` — scrollable row + zoom slider
  - `src/components/Screenshot.jsx` — single canvas (BG, text area, device frame, overlays, drop/paste/zoom logic)
  - `src/components/DeviceFrame.jsx` — procedural iPhone/Android mockup
  - `src/components/Overlay.jsx` — image and zoom overlay rendering + drag/resize
  - `src/components/TextRender.jsx` — italic/secondary-color parser renderer
  - `src/components/Inspector.jsx` — right-side panel container
  - `src/components/inspector/*` — Background, Text, Padding, Device, Overlays, Templates panels
  - `src/utils/text.js` — `*asterisk*` parser
  - `src/utils/palette.js` — 2-color palette extraction
  - `src/utils/export.js` — html-to-image + jszip batch
  - `src/utils/fonts.js` — font list
  - `src/styles.css` — all styling
  - `public/fonts/goldman/README.md` — drop Goldman Sans woff2 files in this folder
- `index.html` loads Inter, Space Grotesk, Bebas Neue, Playfair Display from Google Fonts.

### How to run

```
npm install
npm run dev
```

Open the printed localhost URL.

### Open questions / things I'd flag in the morning

1. The default heading is positioned just above the device, with a 600 px text area (about 22 % of a 2778-tall canvas). Tune via the Inspector → Text → "Area H" if you want it tighter.
2. The Match Background button extracts colors directly from the **screenshot pixels** (not the device chrome). Works best with a colorful screen.
3. Goldman Sans isn't loaded yet — drop your files into `public/fonts/goldman/` per the README and refresh.
4. The paste-image-from-clipboard handler grabs whatever's on the clipboard as an image. SVG-from-Figma usually arrives as a PNG render via clipboard — that works. If you specifically want vector preservation, we'd need a separate "paste SVG markup" path.
5. Mirrored child rows + iOS/Android per-row are the biggest deferred items. Holler if you want me to take that on next.

### Commands Reference

```
npm install              # First-time install
npm run dev              # Start dev server (localhost:5173)
npm run build            # Production build → dist/
npm run preview          # Preview production build
```
