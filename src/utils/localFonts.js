/*
 * Local Font Access — the fonts installed on *this* machine.
 *
 * Chrome/Edge only, and only in a secure context (localhost counts). Safari and Firefox have
 * no equivalent, so every entry point here answers with a state rather than throwing, and the
 * registry simply omits the System group when it can't have one.
 *
 * Export fidelity note (measured, Session 4): a font referenced only by *name*, with no
 * @font-face behind it, renders correctly in a PNG export. html-to-image rasterises a
 * <foreignObject> SVG through an <img>, and while that document can't fetch anything, it can
 * still resolve locally-installed families. Ink widths in the exported PNG matched the live DOM
 * within ~1.5% for Georgia, Menlo, Helvetica Neue and four non-web-safe installed families
 * (Morganite, Ostrich Sans, Big Caslon, Phosphate), while a deliberately absent family fell back
 * to the generic and measured identically to it. So byte-embedding is NOT required for export —
 * see `embedLocalFamily` for the opt-in portability case it *is* useful for.
 */

/** Why the system font list isn't available. `granted` is the only state with fonts in it. */
export const LOCAL_FONTS_GRANTED = 'granted'
export const LOCAL_FONTS_DENIED = 'denied'
export const LOCAL_FONTS_PROMPT = 'prompt'        // never asked, or asked and dismissed
export const LOCAL_FONTS_UNSUPPORTED = 'unsupported'
export const LOCAL_FONTS_INSECURE = 'insecure'

/**
 * Session cache. Deliberately module-level rather than component state: the permission prompt
 * is a real interruption, and a picker that re-asked on every mount (or re-queried a
 * multi-thousand-face list on every render) would be unusable.
 */
let cachedState = null
let cachedFamilies = null
let cachedFaces = null     // postscriptName -> FontData, for the .blob() path
let inFlight = null

export function isLocalFontAccessSupported() {
  return typeof window !== 'undefined' && typeof window.queryLocalFonts === 'function'
}

function supportReason() {
  if (typeof window === 'undefined') return LOCAL_FONTS_UNSUPPORTED
  if (typeof window.queryLocalFonts !== 'function') return LOCAL_FONTS_UNSUPPORTED
  // queryLocalFonts exists but is a no-op outside a secure context; naming that separately
  // lets the UI say "serve this over https or localhost" instead of "your browser can't".
  if (!window.isSecureContext) return LOCAL_FONTS_INSECURE
  return null
}

/**
 * Read the permission WITHOUT prompting. Returns one of the LOCAL_FONTS_* constants.
 *
 * `permissions.query` is the only way to tell "denied" from "never asked" before spending the
 * user's one free gesture on a prompt they may have already refused. Chrome answers `denied`
 * for both an explicit refusal and an enterprise/embedder block — from the app's side those
 * are the same situation, so they get the same wording.
 */
export async function getLocalFontsPermission() {
  const blocked = supportReason()
  if (blocked) return blocked
  if (cachedState) return cachedState

  try {
    const status = await navigator.permissions.query({ name: 'local-fonts' })
    cachedState = status.state === 'granted' ? LOCAL_FONTS_GRANTED
      : status.state === 'denied' ? LOCAL_FONTS_DENIED
      : LOCAL_FONTS_PROMPT
  } catch {
    // Older Chrome knows queryLocalFonts but not the permission name. Assume it can be asked.
    cachedState = LOCAL_FONTS_PROMPT
  }
  return cachedState
}

/**
 * Fetch the font list. Safe to call without a user gesture ONLY when permission is already
 * granted — that's what `requireGesture: false` guards. The registry calls it that way on
 * startup so a returning user's system fonts are simply there, with no second prompt.
 *
 * @returns { state, families } — `families` is [] for every non-granted state.
 */
export async function loadLocalFonts({ requireGesture = true } = {}) {
  const blocked = supportReason()
  if (blocked) return { state: blocked, families: [] }

  if (cachedFamilies) return { state: LOCAL_FONTS_GRANTED, families: cachedFamilies }
  if (inFlight) return inFlight

  const state = await getLocalFontsPermission()
  if (requireGesture === false && state !== LOCAL_FONTS_GRANTED) {
    return { state, families: [] }
  }
  if (state === LOCAL_FONTS_DENIED) return { state, families: [] }

  inFlight = (async () => {
    try {
      const faces = await window.queryLocalFonts()
      cachedFaces = new Map()
      for (const face of faces) cachedFaces.set(face.postscriptName, face)
      cachedFamilies = groupFaces(faces)
      cachedState = LOCAL_FONTS_GRANTED
      return { state: LOCAL_FONTS_GRANTED, families: cachedFamilies }
    } catch (err) {
      // A refusal and a dismissal both land here as NotAllowedError/SecurityError. They differ
      // in what the browser remembers: refusing writes `denied`, dismissing leaves `prompt`
      // and the user can try again. Re-reading the permission is the only way to tell, and the
      // difference matters — one is worth offering a retry button for, the other isn't.
      cachedState = null
      const after = await getLocalFontsPermission()
      return { state: after === LOCAL_FONTS_GRANTED ? LOCAL_FONTS_PROMPT : after, families: [] }
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

/** Drop the session cache — for a "try again" after a dismissed prompt. */
export function resetLocalFontsCache() {
  cachedState = null
  cachedFamilies = null
  cachedFaces = null
}

/** The families loaded so far, or null if we've never successfully queried. */
export function getCachedLocalFamilies() {
  return cachedFamilies
}

/*
 * queryLocalFonts returns individual FACES — "Morganite Light", "Morganite Black Italic" — but
 * a font picker is a list of FAMILIES. Group them, and keep enough per-face detail that the
 * picker can say "9 styles" and the embedding path can find the right blob.
 *
 * `style` is a human string from the OS ("Bold Italic", "Condensed Light"), not a CSS value, so
 * weight/italic are inferred from it rather than parsed strictly. Inference is only used for
 * display and for picking a representative face; nothing load-bearing depends on it.
 */
function groupFaces(faces) {
  const byFamily = new Map()

  for (const face of faces) {
    const family = face.family
    if (!family) continue
    let entry = byFamily.get(family)
    if (!entry) {
      entry = { family, faces: [] }
      byFamily.set(family, entry)
    }
    entry.faces.push({
      postscriptName: face.postscriptName,
      fullName: face.fullName,
      style: face.style || 'Regular',
      weight: inferWeight(face.style),
      italic: /italic|oblique/i.test(face.style || '')
    })
  }

  const families = []
  for (const entry of byFamily.values()) {
    entry.faces.sort((a, b) => (a.weight - b.weight) || (a.italic - b.italic))
    const weights = [...new Set(entry.faces.map(f => f.weight))].sort((a, b) => a - b)
    families.push({
      family: entry.family,
      faces: entry.faces,
      weights,
      hasItalic: entry.faces.some(f => f.italic),
      // The face the picker previews with: upright, closest to regular.
      representative: (entry.faces.find(f => !f.italic && f.weight === 400) ||
                       entry.faces.find(f => !f.italic) ||
                       entry.faces[0]).postscriptName
    })
  }

  families.sort((a, b) => a.family.localeCompare(b.family, undefined, { sensitivity: 'base' }))
  return families
}

const WEIGHT_WORDS = [
  [/\bthin|hairline\b/i, 100],
  [/\bextra ?light|ultra ?light\b/i, 200],
  [/\blight\b/i, 300],
  [/\bmedium\b/i, 500],
  [/\bsemi ?bold|demi ?bold\b/i, 600],
  [/\bextra ?bold|ultra ?bold\b/i, 800],
  [/\bblack|heavy|ultra\b/i, 900],
  [/\bbold\b/i, 700]
]

function inferWeight(style) {
  const s = String(style || '')
  for (const [re, weight] of WEIGHT_WORDS) if (re.test(s)) return weight
  return 400
}

/* ------------------------------------------------------------------ *
 * Bytes — the opt-in embedding path
 * ------------------------------------------------------------------ */

/**
 * The raw bytes of one face. Requires the permission that produced the list in the first place.
 * @returns Blob, or null if we don't have that face (or never got permission).
 */
export async function getFaceBlob(postscriptName) {
  if (!cachedFaces) return null
  const face = cachedFaces.get(postscriptName)
  if (!face || typeof face.blob !== 'function') return null
  try {
    return await face.blob()
  } catch {
    return null
  }
}

const embeddedFamilies = new Map()

/**
 * Inject a data-URL @font-face for a locally-installed family, making it a real webfont for the
 * rest of the session.
 *
 * Export does NOT need this — see the measurement note at the top of this file. What it buys is
 * *portability*: an embedded family is inlined into the capture SVG by html-to-image, so the
 * same PNG comes out of a machine that doesn't have the font installed.
 *
 * Two costs, both real:
 *   - Weight. Every embedded face is base64'd into every capture. A 400 KB family adds ~530 KB
 *     to each of N×M exports. Only the upright regular + bold are embedded for that reason.
 *   - Licence. Font bytes are software under someone's licence. Embedding a licensed family
 *     into an artefact that leaves this machine is a redistribution decision, not a technical
 *     one, which is why this is opt-in and per-family rather than automatic.
 *
 * Session-only: nothing is persisted, so reloading the app forgets it.
 */
export async function embedLocalFamily(family) {
  if (embeddedFamilies.has(family)) return embeddedFamilies.get(family)

  const entry = (cachedFamilies || []).find(f => f.family === family)
  if (!entry) return false

  const wanted = [
    entry.faces.find(f => !f.italic && f.weight === 400) || entry.faces.find(f => !f.italic),
    entry.faces.find(f => !f.italic && f.weight === 700)
  ].filter(Boolean)

  const rules = []
  for (const face of wanted) {
    const blob = await getFaceBlob(face.postscriptName)
    if (!blob) continue
    const dataUrl = await blobToDataUrl(blob)
    rules.push(
      `@font-face{font-family:${JSON.stringify(family)};font-style:normal;` +
      `font-weight:${face.weight};font-display:swap;src:url(${dataUrl});}`
    )
  }

  if (!rules.length) {
    embeddedFamilies.set(family, false)
    return false
  }

  const style = document.createElement('style')
  style.dataset.embeddedFont = family
  style.textContent = rules.join('\n')
  document.head.appendChild(style)
  embeddedFamilies.set(family, true)
  try {
    await document.fonts.ready
  } catch { /* the rules are in the document either way */ }
  return true
}

export function isFamilyEmbedded(family) {
  return embeddedFamilies.get(family) === true
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read font bytes'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(blob)
  })
}
