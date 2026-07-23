/*
 * The baseline font list — the families this repo ships, plus the generic OS stacks.
 *
 * `FONTS` is still the flat list it always was, and `store.js`'s default `fontFamily` is one of
 * its `value` strings, so nothing downstream had to change. `utils/fontRegistry.js` composes on
 * top of this: it merges these entries with fonts installed into public/fonts/ by the font
 * server and (with permission) the fonts installed on the machine. Anything that wants the
 * *whole* picture should read the registry, not this file.
 *
 * `family` is the name the browser actually resolves — the first entry in `value`. It's split
 * out rather than re-parsed because the availability check in fontRegistry.js needs an exact
 * family name, and re-deriving it from the stack at each call site is how the two drift.
 */

/** Self-hosted under public/fonts/. Same-origin @font-face, so export inlines them. */
export const BUNDLED_FONTS = [
  // Goldman Sans is git-ignored (Goldman Sachs' corporate typeface, not an open licence), so
  // these two are declared but may 404 on a fresh clone. The registry's availability check
  // catches that and the picker marks them missing rather than silently drawing Inter.
  { label: 'Goldman Sans', family: 'Goldman Sans', value: 'Goldman Sans, Inter, sans-serif' },
  { label: 'Goldman Sans Condensed', family: 'Goldman Sans Condensed', value: '"Goldman Sans Condensed", Inter, sans-serif' },
  { label: 'Bebas Neue', family: 'Bebas Neue', value: '"Bebas Neue", Impact, sans-serif' },
  { label: 'Space Grotesk', family: 'Space Grotesk', value: '"Space Grotesk", Inter, sans-serif' },
  { label: 'Inter', family: 'Inter', value: 'Inter, -apple-system, sans-serif' },
  { label: 'Playfair Display', family: 'Playfair Display', value: '"Playfair Display", Georgia, serif' }
]

/** Generic stacks. No specific family to be missing, so these can never fail to render. */
export const SYSTEM_STACK_FONTS = [
  { label: 'System Sans', family: '-apple-system', value: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { label: 'System Serif', family: 'Georgia', value: 'Georgia, "Times New Roman", serif' },
  { label: 'System Mono', family: 'SF Mono', value: '"SF Mono", Menlo, Consolas, monospace' }
]

export const FONTS = [...BUNDLED_FONTS, ...SYSTEM_STACK_FONTS]

/**
 * The family a CSS font stack will actually try first, unquoted.
 * `'"Space Grotesk", Inter, sans-serif'` → `Space Grotesk`.
 */
export function primaryFamily(stack) {
  const first = String(stack || '').split(',')[0].trim()
  return first.replace(/^["']|["']$/g, '')
}

/** Wrap a family name for use in a CSS font stack, quoting only when it needs it. */
export function quoteFamily(family) {
  return /^[\w-]+$/.test(family) ? family : JSON.stringify(family)
}

/** A single-family CSS stack with a sane generic tail, for a font we only know by name. */
export function familyToStack(family, generic = 'sans-serif') {
  return `${quoteFamily(family)}, ${generic}`
}
