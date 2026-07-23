// Master / variant resolution for the text block's TRANSFORM.
//
// A translated headline is rarely the same length as the original, so a language
// sometimes needs its own nudge and scale. Everything mirrors a single master by
// default; a language only diverges once the user explicitly unlocks it.
//
// This covers PRESENTATION ONLY. Text content stays in `screenshot.texts[lang]`
// and is never forked here — see the note in store.js.

export const DEFAULT_TEXT_TRANSFORM = { x: 0, y: 0, scale: 1, rotation: 0 }

// The key an override is stored under. Today this is just the language code.
// Extension point: when per-frame export sizes land, this becomes something
// like `${lang}@${sizeProfile}` and nothing else has to change.
export function variantKey(lang) {
  return lang
}

// languages[0] is the primary / master language.
export function isPrimaryLanguage(lang, languages) {
  const list = languages || []
  if (list.length === 0) return true
  return list[0] === lang
}

// Presence of a key in textOverrides IS the unlocked flag. The primary language
// is the master, so it can never be unlocked from itself.
export function isVariantUnlocked(screenshot, lang, languages) {
  if (!screenshot) return false
  if (isPrimaryLanguage(lang, languages)) return false
  return Boolean(screenshot.textOverrides && screenshot.textOverrides[variantKey(lang)])
}

// The one place the master/override precedence lives. Every consumer goes through
// this — scattering the rules would let the canvas and the inspector disagree.
export function resolveTextTransform(screenshot, lang, languages) {
  const master = { ...DEFAULT_TEXT_TRANSFORM, ...(screenshot?.textTransform || {}) }
  if (isPrimaryLanguage(lang, languages)) return master
  const override = screenshot?.textOverrides?.[variantKey(lang)]
  if (override) return { ...DEFAULT_TEXT_TRANSFORM, ...override }
  return master
}

// Identity transforms are emitted as *no* CSS transform at all, so existing
// projects rasterize through exactly the same paint path they always did.
export function isIdentityTextTransform(t) {
  const v = { ...DEFAULT_TEXT_TRANSFORM, ...(t || {}) }
  return v.x === 0 && v.y === 0 && v.scale === 1 && v.rotation === 0
}

// Scaling should grow the block away from its visual anchor, not drift sideways.
export function textTransformOrigin(textAlign) {
  if (textAlign === 'left') return 'top left'
  if (textAlign === 'right') return 'top right'
  return 'top center'
}
