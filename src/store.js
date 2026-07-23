import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { nanoid } from 'nanoid'
import {
  DEFAULT_TEXT_TRANSFORM,
  variantKey,
  isPrimaryLanguage,
  isVariantUnlocked
} from './utils/variants'
import { TEXT_METRIC_DEFAULTS } from './utils/textMetrics'

export const EXPORT_PRESETS = [
  { label: 'iPhone 6.9" (1290×2796)', width: 1290, height: 2796 },
  { label: 'iPhone 6.7" (1284×2778)', width: 1284, height: 2778 },
  { label: 'iPhone 6.5" (1242×2688)', width: 1242, height: 2688 },
  { label: 'iPhone 5.5" (1242×2208)', width: 1242, height: 2208 },
  { label: 'iPad 12.9" (2048×2732)', width: 2048, height: 2732 },
  { label: 'iPad 11" (1668×2388)', width: 1668, height: 2388 },
  { label: 'Android Phone (1080×1920)', width: 1080, height: 1920 },
  { label: 'Android Tablet 7" (1080×1920)', width: 1080, height: 1920 },
  { label: 'Android Tablet 10" (1920×1200)', width: 1920, height: 1200 },
  { label: 'Custom', width: null, height: null }
]

const defaultBackground = () => ({
  type: 'gradient', // 'solid' | 'gradient' | 'image'
  color1: '#f4ecd8',
  color2: '#7d8a5c',
  angle: 180, // degrees, 0 = up
  image: null,
  imageFit: 'cover'
})

const defaultText = () => ({
  fontFamily: 'Goldman Sans, Inter, sans-serif',
  primaryColor: '#1d2129',
  secondaryColor: '#c66a4d',
  preheaderSize: 36,
  preheaderWeight: 600,
  headingSize: 110,
  headingWeight: 700,
  // Height of the headline band above the device. Because the text is
  // top-anchored, this doubles as the gap between the headline and the phone —
  // 470 keeps the device large and close to the text rather than stranded low.
  textAreaHeight: 470,
  textAlign: 'center',
  ...TEXT_METRIC_DEFAULTS
})

const defaultPadding = () => ({ top: 30, right: 20, bottom: 30, left: 20 })

export const DEVICE_TYPES = [
  { value: 'none', label: 'No mockup (raw image)' },
  { value: 'iphone-pro', label: 'iPhone Pro (Dynamic Island)' },
  { value: 'iphone-notch', label: 'iPhone (Notch)' },
  { value: 'android', label: 'Android (Pixel-style)' },
  { value: 'ipad', label: 'iPad (no home button)' }
]

const defaultDevice = () => ({
  type: 'iphone-pro',
  color: '#1d1d1f',
  showButtons: true,
  shadow: true
})

const defaultTexts = () => ({
  preheader: 'WHY PEOPLE LOVE ARK',
  heading: 'Built to *last*'
})

// Backfill every field added after the original model on rehydrated screenshots.
// All of them are identity values, so a project saved before a feature existed
// renders exactly as it always did.
//
// Exported because localStorage is not the only way state enters the store: a
// `.smproj.json` written by an older build arrives through applyProject(), and
// skipping this step there is how frames end up missing fields the UI expects.
export function normalizeScreenshots(list) {
  return (Array.isArray(list) ? list : []).map((sc, i) => ({
    ...sc,
    name: sc?.name || (i === 0 ? 'Frame' : `Frame ${i + 1}`),
    // v3 promoted the pre-header tracking / gap and heading line-height out of
    // Screenshot.jsx; the defaults are the constants they replaced.
    text: { ...defaultText(), ...(sc?.text || {}) },
    imageScale: Number.isFinite(sc?.imageScale) ? sc.imageScale : 1,
    imageOffset: {
      x: Number(sc?.imageOffset?.x) || 0,
      y: Number(sc?.imageOffset?.y) || 0
    },
    textTransform: { ...DEFAULT_TEXT_TRANSFORM, ...(sc?.textTransform || {}) },
    textOverrides: sc?.textOverrides || {}
  }))
}

// The one upgrade path for a persisted state blob, whatever it was persisted in.
// v2 introduced the text master/variant transform; v3 the promoted text metrics
// and the live image pan/zoom. Every step so far is a field backfill, so the
// migration IS the normalizer — but callers should go through this name, so a
// future step that isn't just a backfill lands on every entry point at once.
export function migratePersistedState(persisted) {
  if (!persisted || typeof persisted !== 'object') return persisted
  return { ...persisted, screenshots: normalizeScreenshots(persisted.screenshots) }
}

// The project name lived in its own localStorage key before it became store
// state. Read it once so an in-flight session keeps its title, then retire it.
const LEGACY_NAME_KEY = 'screenshot-maker-project-name'
function adoptLegacyProjectName() {
  try {
    const name = localStorage.getItem(LEGACY_NAME_KEY)
    if (name) localStorage.removeItem(LEGACY_NAME_KEY)
    return name || ''
  } catch {
    return ''
  }
}

// Measured text heights are derived from the DOM, so they are compared by value
// rather than identity — otherwise every measurement pass would look like a
// change and re-trigger itself.
function sameTextMetrics(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  const keys = Object.keys(b)
  if (Object.keys(a).length !== keys.length) return false
  return keys.every(k =>
    a[k] &&
    a[k].contentHeight === b[k].contentHeight &&
    a[k].areaHeight === b[k].areaHeight
  )
}

export function makeScreenshot() {
  return {
    id: nanoid(8),
    name: 'Frame',
    background: defaultBackground(),
    text: defaultText(),
    padding: defaultPadding(),
    image: null,
    imageScale: 1,
    imageOffset: { x: 0, y: 0 },
    imageRadius: 48,
    device: defaultDevice(),
    // CONTENT is per-language and lives here and nowhere else. The override
    // system below deliberately covers transform only — never fork `texts`,
    // or a translation can silently drift from what it was translating.
    texts: { en: defaultTexts() },
    // Master transform for the text block. All languages mirror this unless
    // they have an entry in textOverrides.
    textTransform: { ...DEFAULT_TEXT_TRANSFORM },
    // Sparse map. A key's PRESENCE means that variant is unlocked from the master.
    textOverrides: {},
    overlays: []
  }
}

export const useStore = create(
  persist(
    (set, get) => ({
      exportSize: { width: 1284, height: 2778 },
      languages: ['en'],
      activeLanguage: 'en',
      screenshots: [makeScreenshot()],
      selectedId: null,
      selectedOverlayId: null,
      zoomMode: false,
      templates: [],
      projectName: '',

      // Session-only. Screenshot.jsx measures the rendered text block per
      // language and reports here so the inspector — a sibling, not a child —
      // can show the same numbers without re-measuring.
      // Shape: { [screenshotId]: { [lang]: { contentHeight, areaHeight, scale } } }
      textMetrics: {},

      setExportSize: (width, height) => set({ exportSize: { width, height } }),

      setProjectName: (name) => set({ projectName: name || '' }),

      setTextMetrics: (id, metrics) => set((s) => {
        if (sameTextMetrics(s.textMetrics[id], metrics)) return {}
        return { textMetrics: { ...s.textMetrics, [id]: metrics } }
      }),

      addLanguage: (code) => set((s) => {
        if (s.languages.includes(code)) return {}
        return {
          languages: [...s.languages, code],
          screenshots: s.screenshots.map(sc => ({
            ...sc,
            texts: { ...sc.texts, [code]: sc.texts[s.activeLanguage] || defaultTexts() }
          }))
        }
      }),
      removeLanguage: (code) => set((s) => {
        if (s.languages.length <= 1) return {}
        const langs = s.languages.filter(l => l !== code)
        // An override may only exist for a surviving NON-primary language. Removing
        // the old primary promotes langs[0], whose override would otherwise linger
        // as dead state that resolveTextTransform silently ignores.
        const validKeys = new Set(langs.slice(1).map(variantKey))
        return {
          languages: langs,
          activeLanguage: s.activeLanguage === code ? langs[0] : s.activeLanguage,
          screenshots: s.screenshots.map(sc => {
            const { [code]: _, ...rest } = sc.texts
            const overrides = Object.fromEntries(
              Object.entries(sc.textOverrides || {}).filter(([k]) => validKeys.has(k))
            )
            return { ...sc, texts: rest, textOverrides: overrides }
          })
        }
      }),
      setActiveLanguage: (code) => set({ activeLanguage: code }),

      addScreenshot: () => set((s) => {
        const last = s.screenshots[s.screenshots.length - 1]
        const fresh = makeScreenshot()
        // inherit visual style from last screenshot
        if (last) {
          fresh.background = JSON.parse(JSON.stringify(last.background))
          fresh.text = { ...last.text }
          fresh.padding = { ...last.padding }
          fresh.imageRadius = last.imageRadius
          fresh.device = { ...last.device }
          // A new frame inherits the master transform but starts fully mirrored —
          // per-language exceptions are a property of the frame they were tuned for.
          fresh.textTransform = { ...DEFAULT_TEXT_TRANSFORM, ...(last.textTransform || {}) }
          fresh.textOverrides = {}
          // each language gets blank texts
          fresh.texts = Object.fromEntries(
            s.languages.map(l => [l, { preheader: '', heading: '' }])
          )
        }
        fresh.name = `Frame ${s.screenshots.length + 1}`
        return {
          screenshots: [...s.screenshots, fresh],
          selectedId: fresh.id
        }
      }),

      duplicateScreenshot: (id) => set((s) => {
        const idx = s.screenshots.findIndex(sc => sc.id === id)
        if (idx < 0) return {}
        const copy = JSON.parse(JSON.stringify(s.screenshots[idx]))
        copy.id = nanoid(8)
        copy.name = copy.name + ' copy'
        const next = [...s.screenshots]
        next.splice(idx + 1, 0, copy)
        return { screenshots: next, selectedId: copy.id }
      }),

      removeScreenshot: (id) => set((s) => {
        const { [id]: _dropped, ...textMetrics } = s.textMetrics
        return {
          screenshots: s.screenshots.filter(sc => sc.id !== id),
          selectedId: s.selectedId === id ? null : s.selectedId,
          textMetrics
        }
      }),

      // Frame order drives both the workspace row and the batch-export order, so
      // reordering is a document edit, not a view preference.
      reorderScreenshot: (id, newIndex) => set((s) => {
        const from = s.screenshots.findIndex(sc => sc.id === id)
        if (from < 0) return {}
        const to = Math.max(0, Math.min(s.screenshots.length - 1, newIndex))
        if (to === from) return {}
        const next = [...s.screenshots]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        return { screenshots: next }
      }),

      selectScreenshot: (id) => set((s) => ({
        selectedId: id,
        selectedOverlayId: s.selectedId === id ? s.selectedOverlayId : null
      })),

      cropEditingId: null,
      setCropEditing: (id) => set({ cropEditingId: id }),

      updateScreenshot: (id, partial) => set((s) => ({
        screenshots: s.screenshots.map(sc => sc.id === id ? { ...sc, ...partial } : sc)
      })),

      patchScreenshot: (id, path, value) => set((s) => ({
        screenshots: s.screenshots.map(sc => {
          if (sc.id !== id) return sc
          const next = { ...sc }
          let cursor = next
          for (let i = 0; i < path.length - 1; i++) {
            cursor[path[i]] = { ...cursor[path[i]] }
            cursor = cursor[path[i]]
          }
          cursor[path[path.length - 1]] = value
          return next
        })
      })),

      setScreenshotText: (id, lang, field, value) => set((s) => ({
        screenshots: s.screenshots.map(sc => {
          if (sc.id !== id) return sc
          return {
            ...sc,
            texts: {
              ...sc.texts,
              [lang]: { ...(sc.texts[lang] || {}), [field]: value }
            }
          }
        })
      })),

      // Writes to whichever target the active language currently resolves against:
      // the master when mirrored (so every mirrored language moves together), or
      // just this language's override once it has been unlocked.
      setTextTransform: (screenshotId, lang, languages, partial) => set((s) => {
        const langs = languages || s.languages
        return {
          screenshots: s.screenshots.map(sc => {
            if (sc.id !== screenshotId) return sc
            const key = variantKey(lang)
            if (isVariantUnlocked(sc, lang, langs)) {
              const current = { ...DEFAULT_TEXT_TRANSFORM, ...(sc.textOverrides?.[key] || {}) }
              return {
                ...sc,
                textOverrides: { ...(sc.textOverrides || {}), [key]: { ...current, ...partial } }
              }
            }
            const master = { ...DEFAULT_TEXT_TRANSFORM, ...(sc.textTransform || {}) }
            return { ...sc, textTransform: { ...master, ...partial } }
          })
        }
      }),

      unlockTextVariant: (screenshotId, lang) => set((s) => {
        // The primary language IS the master; there is nothing to unlock it from.
        if (isPrimaryLanguage(lang, s.languages)) return {}
        const key = variantKey(lang)
        return {
          screenshots: s.screenshots.map(sc => {
            if (sc.id !== screenshotId) return sc
            if (sc.textOverrides?.[key]) return sc
            return {
              ...sc,
              textOverrides: {
                ...(sc.textOverrides || {}),
                [key]: { ...DEFAULT_TEXT_TRANSFORM, ...(sc.textTransform || {}) }
              }
            }
          })
        }
      }),

      resetTextVariant: (screenshotId, lang) => set((s) => {
        const key = variantKey(lang)
        return {
          screenshots: s.screenshots.map(sc => {
            if (sc.id !== screenshotId) return sc
            if (!sc.textOverrides || !(key in sc.textOverrides)) return sc
            const { [key]: _, ...rest } = sc.textOverrides
            return { ...sc, textOverrides: rest }
          })
        }
      }),

      addOverlay: (id, overlay) => set((s) => ({
        screenshots: s.screenshots.map(sc => sc.id === id
          ? { ...sc, overlays: [...sc.overlays, { id: nanoid(6), ...overlay }] }
          : sc),
        selectedOverlayId: null
      })),

      updateOverlay: (screenshotId, overlayId, partial) => set((s) => ({
        screenshots: s.screenshots.map(sc => sc.id === screenshotId
          ? {
              ...sc,
              overlays: sc.overlays.map(o => o.id === overlayId ? { ...o, ...partial } : o)
            }
          : sc)
      })),

      removeOverlay: (screenshotId, overlayId) => set((s) => ({
        screenshots: s.screenshots.map(sc => sc.id === screenshotId
          ? { ...sc, overlays: sc.overlays.filter(o => o.id !== overlayId) }
          : sc),
        selectedOverlayId: s.selectedOverlayId === overlayId ? null : s.selectedOverlayId
      })),

      selectOverlay: (id) => set({ selectedOverlayId: id }),
      setZoomMode: (on) => set({ zoomMode: on }),

      saveTemplate: (name) => set((s) => {
        const sc = s.screenshots.find(x => x.id === s.selectedId) || s.screenshots[0]
        if (!sc) return {}
        const tpl = {
          id: nanoid(6),
          name,
          background: sc.background,
          text: sc.text,
          padding: sc.padding,
          imageRadius: sc.imageRadius
        }
        return { templates: [...s.templates, tpl] }
      }),

      applyTemplate: (templateId) => set((s) => {
        const t = s.templates.find(x => x.id === templateId)
        if (!t) return {}
        const targetId = s.selectedId
        return {
          screenshots: s.screenshots.map(sc => sc.id === targetId
            ? {
                ...sc,
                background: JSON.parse(JSON.stringify(t.background)),
                text: { ...t.text },
                padding: { ...t.padding },
                imageRadius: t.imageRadius
              }
            : sc)
        }
      }),

      applyTemplateAll: (templateId) => set((s) => {
        const t = s.templates.find(x => x.id === templateId)
        if (!t) return {}
        return {
          screenshots: s.screenshots.map(sc => ({
            ...sc,
            background: JSON.parse(JSON.stringify(t.background)),
            text: { ...t.text },
            padding: { ...t.padding },
            imageRadius: t.imageRadius
          }))
        }
      }),

      removeTemplate: (id) => set((s) => ({
        templates: s.templates.filter(t => t.id !== id)
      }))
    }),
    {
      name: 'screenshot-maker-v1',
      version: 3,
      migrate: migratePersistedState,
      // zustand only runs `migrate` when the stored blob carries a numeric `version`.
      // Hand-edited or externally written state has none, so normalize on merge too —
      // consumers read defensively regardless, this just keeps the store itself clean.
      merge: (persisted, current) => ({
        ...current,
        ...(persisted || {}),
        screenshots: persisted?.screenshots
          ? normalizeScreenshots(persisted.screenshots)
          : current.screenshots,
        projectName: persisted?.projectName ?? adoptLegacyProjectName()
      }),
      partialize: (s) => ({
        exportSize: s.exportSize,
        languages: s.languages,
        activeLanguage: s.activeLanguage,
        screenshots: s.screenshots,
        templates: s.templates,
        // Without this a reload restores the content but forgets whose project
        // it is, and the menu shows "Untitled" over somebody's saved work.
        projectName: s.projectName
      })
    }
  )
)
