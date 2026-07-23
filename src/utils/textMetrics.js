// Typographic knobs that used to be hardcoded in Screenshot.jsx, plus the
// text-overflow vocabulary shared by the canvas chrome and the Text inspector.
//
// The defaults ARE the old hardcoded constants, so a project that predates these
// fields renders exactly as it always did.

export const TEXT_METRIC_DEFAULTS = {
  preheaderTracking: 0.18, // em
  preheaderGap: 24,        // canvas px between pre-header and heading
  headingLineHeight: 1.05
}

// Project files are handed to the store wholesale and skip the rehydration
// normalizer, so every read of a post-v1 field goes through here instead of
// trusting the object to carry it.
export function readTextMetrics(text) {
  const t = text || {}
  const pick = (key) =>
    Number.isFinite(t[key]) ? t[key] : TEXT_METRIC_DEFAULTS[key]
  return {
    preheaderTracking: pick('preheaderTracking'),
    preheaderGap: pick('preheaderGap'),
    headingLineHeight: pick('headingLineHeight')
  }
}

// Sub-pixel differences are measurement noise, not a design problem.
export const OVERFLOW_TOLERANCE = 1

export function isOverflowing(entry) {
  if (!entry) return false
  if (!Number.isFinite(entry.contentHeight) || !Number.isFinite(entry.areaHeight)) return false
  return entry.contentHeight > entry.areaHeight + OVERFLOW_TOLERANCE
}

export function overflowAmount(entry) {
  if (!isOverflowing(entry)) return 0
  return Math.round(entry.contentHeight - entry.areaHeight)
}

// One row per language, in the app's language order, for the at-a-glance pills.
export function overflowByLanguage(metrics, languages) {
  return (languages || []).map(lang => {
    const entry = metrics?.[lang] || null
    return {
      lang,
      entry,
      measured: Boolean(entry),
      over: isOverflowing(entry),
      by: overflowAmount(entry)
    }
  })
}
