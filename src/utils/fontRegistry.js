/*
 * The font registry — one list, four sources, read by the whole app.
 *
 *   bundled    self-hosted under public/fonts/ and declared in webfonts.css / styles.css
 *   installed  written into public/fonts/ by the font server (Google Fonts, uploads)
 *   custom     raw font files a user dropped into public/fonts/custom/ themselves
 *   system     installed on this machine, via the Local Font Access API (permission required)
 *   stack      the generic -apple-system / Georgia / monospace fallback stacks
 *
 * `utils/fonts.js` still owns the bundled baseline; this composes on top of it rather than
 * replacing it, so anything that only needs the shipped list can keep importing FONTS.
 *
 * ── Export safety (measured, Session 4) ──────────────────────────────────────────────────
 * Referencing a font by name with no @font-face behind it DOES survive PNG export. Measured by
 * exporting a strip of 60px strings and comparing ink width in the PNG against the live DOM:
 * every installed family matched within ~1.5% (Georgia 572.4→567, Menlo 686.3→678, Morganite
 * 210.4→213, Ostrich Sans 361.6→359), while an absent family fell back to the generic and
 * measured identically to it. So `exportSafe` is true for every source here.
 *
 * What system fonts are NOT is *portable*: the PNG is right on this machine and wrong on one
 * without the font. That's the `portable` flag, and it's what the missing-font warning exists
 * to catch. `embedLocalFamily()` in utils/localFonts.js is the opt-in fix, with the licence
 * caveat documented there.
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  BUNDLED_FONTS,
  SYSTEM_STACK_FONTS,
  primaryFamily,
  quoteFamily,
  familyToStack
} from './fonts'
import {
  loadLocalFonts,
  LOCAL_FONTS_GRANTED,
  LOCAL_FONTS_UNSUPPORTED
} from './localFonts'

export const SOURCE_BUNDLED = 'bundled'
export const SOURCE_INSTALLED = 'installed'
export const SOURCE_CUSTOM = 'custom'
export const SOURCE_SYSTEM = 'system'
export const SOURCE_STACK = 'stack'

export const SOURCE_LABELS = {
  [SOURCE_BUNDLED]: 'Bundled with the app',
  [SOURCE_INSTALLED]: 'Installed in this project',
  [SOURCE_CUSTOM]: 'Your fonts (dropped in)',
  [SOURCE_SYSTEM]: 'Installed on this Mac',
  [SOURCE_STACK]: 'System stacks'
}

// Higher wins when the same family arrives from two sources.
//   bundled/installed beat custom — both are app-managed with generated @font-face rules and a
//   licence file recorded next to them, so if a family exists in both places the managed copy is
//   the more predictable one to render.
//   custom beats system — a dropped file is a same-origin static asset that renders and exports
//   with no permission prompt and lives inside the project, whereas a system font is only on this
//   one machine. So when a family is both dropped-in and OS-installed, render the project's copy.
const SOURCE_RANK = {
  [SOURCE_BUNDLED]: 4,
  [SOURCE_INSTALLED]: 3,
  [SOURCE_CUSTOM]: 2,
  [SOURCE_SYSTEM]: 1,
  [SOURCE_STACK]: 0
}

// Display order of the groups in the picker.
export const SOURCE_ORDER = [SOURCE_BUNDLED, SOURCE_INSTALLED, SOURCE_CUSTOM, SOURCE_SYSTEM, SOURCE_STACK]

/* ------------------------------------------------------------------ *
 * The font server (owned by the installer half) — optional at build time
 *
 * `import.meta.glob` with a literal path resolves to `{}` when the file doesn't exist and to a
 * real lazy loader when it does. A plain dynamic import would fail the build on a checkout
 * where the installer half isn't present; a plain static import would fail it harder.
 * ------------------------------------------------------------------ */

const fontServerModules = import.meta.glob('./fontServer.js')

async function getFontServer() {
  const load = fontServerModules['./fontServer.js']
  if (!load) return null
  try {
    return await load()
  } catch {
    return null
  }
}

/**
 * Ask the font server what it has installed. Contract: `listInstalled()` degrades to `[]` when
 * the dev-server API isn't there, so an empty list and no list are the same thing here.
 *
 * The item shape is normalised defensively — a bare family string, or an object with any of
 * `family` / `name` / `label` / `value` — so a reasonable shape on the other side works without
 * the two halves having to agree on field names first.
 */
// The installer records a Google category ('serif', 'display', 'handwriting'…). Using it for the
// stack's tail means a machine without the family lands somewhere adjacent rather than on the
// platform sans regardless of what was chosen.
function genericFor(category) {
  switch (String(category || '').toLowerCase()) {
    case 'serif': return 'serif'
    case 'monospace': return 'monospace'
    case 'handwriting': return 'cursive'
    case 'display': return 'fantasy'
    default: return 'sans-serif'
  }
}

async function readInstalled() {
  const mod = await getFontServer()
  if (!mod || typeof mod.listInstalled !== 'function') return []
  let raw
  try {
    raw = await mod.listInstalled()
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  const out = []
  for (const item of raw) {
    if (typeof item === 'string') {
      if (item.trim()) out.push({ family: item.trim(), value: familyToStack(item.trim()) })
      continue
    }
    if (!item || typeof item !== 'object') continue
    const family = String(item.family || item.name || item.label || '').trim()
    if (!family) continue
    out.push({
      family,
      label: String(item.label || family),
      value: typeof item.value === 'string' && item.value
        ? item.value
        : familyToStack(family, genericFor(item.category)),
      weights: Array.isArray(item.weights) ? item.weights : undefined,
      hasItalic: !!item.italic
    })
  }
  return out
}

/**
 * Ask the font server what has been dropped into public/fonts/custom/. Same contract as
 * readInstalled: `listCustom()` degrades to `[]` when the dev-server API isn't there. The
 * generic tail is plain sans-serif — a dropped font carries no category, and a machine without
 * the file falling to the platform sans is the least alarming outcome.
 */
async function readCustom() {
  const mod = await getFontServer()
  if (!mod || typeof mod.listCustom !== 'function') return []
  let raw
  try {
    raw = await mod.listCustom()
  } catch {
    return []
  }
  if (!Array.isArray(raw)) return []

  const out = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const family = String(item.family || item.name || '').trim()
    if (!family) continue
    out.push({
      family,
      value: familyToStack(family),
      weights: Array.isArray(item.weights) ? item.weights : undefined,
      hasItalic: !!item.italic,
      files: Number.isFinite(item.files) ? item.files : (Array.isArray(item.faces) ? item.faces.length : undefined)
    })
  }
  return out
}

/* ------------------------------------------------------------------ *
 * Entries
 * ------------------------------------------------------------------ */

function makeEntry({ id, label, family, value, source, detail, weights, hasItalic }) {
  return {
    id,
    label,
    family,
    value,
    source,
    detail: detail || '',
    weights: weights || null,
    hasItalic: !!hasItalic,
    // Every source renders correctly in an export on this machine — see the header note.
    exportSafe: true,
    // Only `system` is machine-bound. A custom drop is a same-origin file, so it is portable in
    // the sense the "this Mac only" chip means (it exports right and needs no OS install). It is
    // git-ignored by default, so on a fresh clone the files are simply absent — but that case is
    // caught at runtime by the availability probe (checkFamilyAvailable), which fires the
    // missing-font warning, rather than by this static flag.
    portable: source !== SOURCE_SYSTEM
  }
}

function bundledEntries() {
  return BUNDLED_FONTS.map(f => makeEntry({
    id: `bundled:${f.family}`,
    label: f.label,
    family: f.family,
    value: f.value,
    source: SOURCE_BUNDLED
  }))
}

function stackEntries() {
  return SYSTEM_STACK_FONTS.map(f => makeEntry({
    id: `stack:${f.label}`,
    label: f.label,
    family: f.family,
    value: f.value,
    source: SOURCE_STACK,
    detail: 'Whatever this OS uses'
  }))
}

function installedEntries(list) {
  return list.map(f => makeEntry({
    id: `installed:${f.family}`,
    label: f.label || f.family,
    family: f.family,
    value: f.value,
    source: SOURCE_INSTALLED,
    weights: f.weights,
    hasItalic: f.hasItalic,
    detail: f.weights?.length ? `${f.weights.length} weight${f.weights.length === 1 ? '' : 's'}` : ''
  }))
}

function customEntries(list) {
  return list.map(f => makeEntry({
    id: `custom:${f.family}`,
    label: f.family,
    family: f.family,
    value: f.value,
    source: SOURCE_CUSTOM,
    weights: f.weights,
    hasItalic: f.hasItalic,
    detail: f.files ? `${f.files} file${f.files === 1 ? '' : 's'}` : ''
  }))
}

function systemEntries(families) {
  return families.map(f => makeEntry({
    id: `system:${f.family}`,
    label: f.family,
    family: f.family,
    // A single-family stack with a generic tail: if this project is opened somewhere the font
    // isn't installed, falling to the platform sans is far less alarming than falling to
    // whatever the app's body font happens to be.
    value: familyToStack(f.family),
    source: SOURCE_SYSTEM,
    weights: f.weights,
    hasItalic: f.hasItalic,
    detail: `${f.faces.length} ${f.faces.length === 1 ? 'style' : 'styles'}`
  }))
}

function dedupe(entries) {
  const byFamily = new Map()
  for (const entry of entries) {
    const key = entry.family.toLowerCase()
    const existing = byFamily.get(key)
    if (!existing || SOURCE_RANK[entry.source] > SOURCE_RANK[existing.source]) {
      byFamily.set(key, entry)
    }
  }
  // Stable, source-grouped, alphabetical within a source.
  return [...byFamily.values()].sort((a, b) =>
    (SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source)) ||
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' })
  )
}

/* ------------------------------------------------------------------ *
 * The store
 * ------------------------------------------------------------------ */

const listeners = new Set()

let snapshot = {
  entries: dedupe([...bundledEntries(), ...stackEntries()]),
  systemState: null,       // null until we've looked; then a LOCAL_FONTS_* constant
  installedCount: 0,
  customCount: 0,
  loading: false
}

function publish(next) {
  snapshot = { ...snapshot, ...next }
  for (const fn of listeners) fn()
}

export function getFontRegistry() {
  return snapshot
}

export function subscribeFontRegistry(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

let refreshing = null

/**
 * Rebuild the list from every source.
 *
 * `askForSystemFonts` is the user-gesture flag: false (the default) means "include system fonts
 * only if permission was already granted", which is what startup and post-install refreshes
 * want. The picker passes true from a click, and only from a click.
 */
export function refreshFontRegistry({ askForSystemFonts = false } = {}) {
  if (refreshing && !askForSystemFonts) return refreshing

  publish({ loading: true })

  refreshing = (async () => {
    const [installed, custom, local] = await Promise.all([
      readInstalled(),
      readCustom(),
      loadLocalFonts({ requireGesture: askForSystemFonts })
    ])

    const entries = dedupe([
      ...bundledEntries(),
      ...installedEntries(installed),
      ...customEntries(custom),
      ...(local.state === LOCAL_FONTS_GRANTED ? systemEntries(local.families) : []),
      ...stackEntries()
    ])

    // New @font-face rules may have arrived with the installed or custom lists, so anything we
    // previously decided was missing deserves another look.
    availability.clear()

    publish({
      entries,
      systemState: local.state,
      installedCount: installed.length,
      customCount: custom.length,
      loading: false
    })
    refreshing = null
    return snapshot
  })()

  return refreshing
}

/**
 * Re-scan the drop folder (regenerating custom.css and re-linking it), then rebuild the whole
 * registry so the new families show up. The picker's "Rescan" button calls this. Safe when there
 * is no font server — rescanCustom() degrades to a no-op and the refresh still runs.
 */
export async function rescanCustomFonts() {
  const mod = await getFontServer()
  if (mod && typeof mod.rescanCustom === 'function') {
    try {
      await mod.rescanCustom()
    } catch {
      // A real server error is surfaced by the refresh below reporting no change; a click
      // shouldn't throw into the picker.
    }
  }
  return refreshFontRegistry()
}

/** Find the registry entry a stored CSS stack came from, by family. */
export function findEntryByValue(value) {
  const family = primaryFamily(value)
  const key = family.toLowerCase()
  return snapshot.entries.find(e => e.family.toLowerCase() === key) || null
}

/* ------------------------------------------------------------------ *
 * Availability — is this family actually on this machine?
 *
 * `document.fonts.check()` is NOT usable for this, which the measurements bear out: on Chrome
 * 1xx it returned `true` for "Definitely Not Installed 9Z" and `false` for Playfair Display,
 * which is bundled and works. It answers "can these glyphs be drawn (including by fallback)",
 * not "does this family exist".
 *
 * What does work is a two-step:
 *   1. `document.fonts.load()` — forces any matching @font-face to actually download, so a
 *      lazily-loaded bundled family isn't mistaken for a missing one. A family with no
 *      @font-face resolves instantly and harmlessly.
 *   2. A canvas metric probe against TWO different generics. Render a wide, metric-sensitive
 *      string as `Family, monospace` and as plain `monospace`, then the same against `serif`.
 *      A present family differs from at least one baseline; an absent one matches both exactly.
 *      Two baselines rather than one so a family that happens to be metrically identical to
 *      monospace isn't written off.
 *
 * Verified: this reports present for Georgia/Menlo/Morganite/Ostrich Sans/Big Caslon/DM Sans
 * and for all four bundled webfonts, and absent for two invented names.
 * ------------------------------------------------------------------ */

const GENERIC_FAMILIES = new Set([
  'sans-serif', 'serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
  'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded',
  '-apple-system', 'blinkmacsystemfont'
])

// Long, and deliberately mixes wide/narrow/round/flat glyphs so two different typefaces are
// very unlikely to land on the same total advance width.
const PROBE_TEXT = 'mmmmmmmmmmwwwwiiilllWWMMOO@#gjq 0123456789'
const PROBE_SIZE = '72px'

const availability = new Map()
let probeCtx = null

function measure(font) {
  if (!probeCtx) probeCtx = document.createElement('canvas').getContext('2d')
  probeCtx.font = font
  return probeCtx.measureText(PROBE_TEXT).width
}

function metricProbe(family) {
  const q = quoteFamily(family)
  const mono = measure(`${PROBE_SIZE} ${q}, monospace`)
  const monoBase = measure(`${PROBE_SIZE} monospace`)
  if (Math.abs(mono - monoBase) > 0.5) return true
  const serif = measure(`${PROBE_SIZE} ${q}, serif`)
  const serifBase = measure(`${PROBE_SIZE} serif`)
  return Math.abs(serif - serifBase) > 0.5
}

export function isGenericFamily(family) {
  return GENERIC_FAMILIES.has(String(family || '').toLowerCase())
}

/** Cached answer, or undefined if we haven't checked this family yet. */
export function getCachedAvailability(family) {
  return availability.get(String(family || '').toLowerCase())
}

/** @returns Promise<boolean> — true when this family will really render. */
export async function checkFamilyAvailable(family) {
  const name = String(family || '').trim()
  if (!name) return true
  const key = name.toLowerCase()
  if (availability.has(key)) return availability.get(key)
  if (isGenericFamily(name)) {
    availability.set(key, true)
    return true
  }

  try {
    // Rejects for a family with no matching face, and for an @font-face whose file 404s — the
    // Goldman Sans case on a fresh clone. Either way the probe below is the actual verdict.
    await document.fonts.load(`${PROBE_SIZE} ${quoteFamily(name)}`, 'Aa')
  } catch { /* fall through to the probe */ }

  const present = metricProbe(name)
  availability.set(key, present)
  return present
}

/** Forget every availability verdict — after installing a font, say. */
export function clearAvailabilityCache() {
  availability.clear()
}

/**
 * Check a whole set of stacks at once and report the families that aren't there.
 * @returns Promise<string[]> of missing family names.
 */
export async function findMissingFamilies(stacks) {
  const families = [...new Set(stacks.map(primaryFamily).filter(Boolean))]
  const results = await Promise.all(families.map(async f => [f, await checkFamilyAvailable(f)]))
  return results.filter(([, ok]) => !ok).map(([f]) => f)
}

/* ------------------------------------------------------------------ *
 * React bindings
 *
 * They live here rather than in a component so the picker, the Text panel and the frame chrome
 * all read the same subscription — three components each running their own probe would each
 * pay for a layout flush and could disagree mid-flight.
 * ------------------------------------------------------------------ */

/** The whole registry snapshot, re-rendering when it changes. */
export function useFontRegistry() {
  return useSyncExternalStore(subscribeFontRegistry, getFontRegistry, getFontRegistry)
}

/**
 * Is the family at the head of this stack actually available?
 * @returns `true` | `false` | `null` while the first check is still running.
 */
export function useFamilyAvailable(stack) {
  const family = primaryFamily(stack)
  const registry = useFontRegistry()
  const [available, setAvailable] = useState(() => {
    const cached = getCachedAvailability(family)
    return cached === undefined ? null : cached
  })

  // `registry.entries` is in the dependency list because installing a font adds an @font-face
  // and clears the cache — a family that was missing a second ago may not be any more.
  useEffect(() => {
    let alive = true
    setAvailable(() => {
      const cached = getCachedAvailability(family)
      return cached === undefined ? null : cached
    })
    checkFamilyAvailable(family).then(ok => { if (alive) setAvailable(ok) })
    return () => { alive = false }
  }, [family, registry.entries])

  return { family, available }
}

export { primaryFamily, LOCAL_FONTS_GRANTED, LOCAL_FONTS_UNSUPPORTED }
