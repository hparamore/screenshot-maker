/* ------------------------------------------------------------------ *
 * Client for the dev-server font API (vite-plugin-fonts.js).
 *
 * Same contract as src/utils/projectFile.js and for the same reasons: this API only exists
 * while `npm run dev` is running, and it answers 403 to anything that isn't loopback. So every
 * call here degrades to a sentinel — `false` / `[]` / `null` — instead of throwing, and callers
 * can render an explanation rather than an error the user can't act on.
 *
 * Genuine failures (400, 404, 409, 413, 415, 500, 502, 504) still throw with the server's own
 * message. "Font server isn't here" and "that install failed" are different situations and the
 * UI has to be able to tell them apart.
 * ------------------------------------------------------------------ */

const API_BASE = '/api/fonts'

/** How the installed-font stylesheet is re-linked after a change. See refreshStylesheet(). */
const STYLESHEET_HREF = '/fonts/installed/installed.css'
const STYLESHEET_ID = 'installed-fonts'

/** The drop-folder stylesheet, re-linked the same way after a rescan. */
const CUSTOM_STYLESHEET_HREF = '/fonts/custom/custom.css'
const CUSTOM_STYLESHEET_ID = 'custom-fonts'

class ApiUnavailable extends Error {}

async function apiCall(url, options) {
  let res
  try {
    res = await fetch(url, options)
  } catch {
    throw new ApiUnavailable('no font API')
  }

  // `npm run dev:lan` serves the app to the network but the font API stays loopback-only, so a
  // phone gets a 403 on every call and there is no font server it could ever reach. Same
  // situation as no API at all. Only 403 — every other status is a real answer to a real
  // request and must keep its message.
  if (res.status === 403) throw new ApiUnavailable('remote')

  // A static host answers the SPA fallback with 200 text/html; anything non-JSON means no API.
  if (!(res.headers.get('content-type') || '').includes('application/json')) {
    throw new ApiUnavailable('no font API')
  }

  let data
  try {
    data = await res.json()
  } catch {
    throw new ApiUnavailable('no font API')
  }

  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data
}

/**
 * Vite caches directory listings and invalidates them from its file watcher, so for roughly
 * 100-200 ms after an install the brand-new family folder still 404s — and a 404 for a .woff2
 * comes back as the SPA fallback's HTML, which the browser records as a permanently failed
 * font face. Re-linking the stylesheet inside that window installs a font that renders as a
 * fallback until the next reload, which is the kind of bug you chase for an hour.
 *
 * So: poll one real file from the new family until the dev server serves it as a font, then
 * re-link. Bounded, because if it never becomes servable the stylesheet should still update.
 */
async function waitUntilServable(probeUrl, timeoutMs = 3000) {
  if (!probeUrl) return
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(probeUrl, { method: 'HEAD', cache: 'no-store' })
      if (res.ok && !(res.headers.get('content-type') || '').includes('text/html')) return
    } catch {
      // Still settling, or offline. Either way the retry below is the answer.
    }
    await new Promise(r => setTimeout(r, 60))
  }
}

/**
 * Point the <link> at the regenerated stylesheet with a fresh query string.
 *
 * This is what makes a brand-new install usable without restarting Vite: the file on disk has
 * already changed, but the browser holds the parsed sheet, and a same-href reload is a no-op.
 * Swapping the href forces a re-parse. Awaiting `document.fonts.ready` afterwards means a
 * caller that immediately re-renders — or exports — sees real glyphs rather than a fallback.
 */
async function refreshStylesheet(probeUrl, href = STYLESHEET_HREF, id = STYLESHEET_ID) {
  if (typeof document === 'undefined') return
  await waitUntilServable(probeUrl)
  let link = document.getElementById(id)
  if (!link) {
    link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    document.head.appendChild(link)
  }
  const loaded = new Promise(resolve => {
    link.addEventListener('load', resolve, { once: true })
    link.addEventListener('error', resolve, { once: true })
  })
  link.href = `${href}?v=${Date.now()}`
  await loaded
  await document.fonts?.ready
}

/* ------------------------------------------------------------------ *
 * The client contract — every call degrades to a sentinel when the API is absent
 * ------------------------------------------------------------------ */

/** @returns true when the dev-server font API is reachable from here. Never throws. */
export async function isFontServerAvailable() {
  try {
    await apiCall(`${API_BASE}/installed`)
    return true
  } catch {
    return false
  }
}

/**
 * The browsable Google Fonts catalog.
 * @returns `{ families, source, fetchedAt }`, or null when there is no font API.
 *          `source` is 'live' | 'cache' | 'stale-cache' | 'fallback' — worth surfacing, since
 *          a fallback catalog is a curated subset rather than the whole library.
 */
export async function listCatalog() {
  try {
    const data = await apiCall(`${API_BASE}/catalog`)
    return {
      families: Array.isArray(data?.families) ? data.families : [],
      source: data?.source || 'fallback',
      fetchedAt: data?.fetchedAt || 0
    }
  } catch (err) {
    if (err instanceof ApiUnavailable) return null
    throw err
  }
}

/** @returns array of installed-family records, or `[]` when there is no font API. */
export async function listInstalled() {
  try {
    const data = await apiCall(`${API_BASE}/installed`)
    return Array.isArray(data?.families) ? data.families : []
  } catch (err) {
    if (err instanceof ApiUnavailable) return []
    throw err
  }
}

/**
 * The fonts a user dropped into public/fonts/custom/ themselves — discovered from the raw files,
 * with no metadata required. Degrades to `[]` when there is no font API, exactly like
 * listInstalled(): an empty list and no list are the same thing to the caller.
 * @returns array of custom-family records ({ family, slug, weights, italic, files, faces, source }).
 */
export async function listCustom() {
  try {
    const data = await apiCall(`${API_BASE}/custom`)
    return Array.isArray(data?.families) ? data.families : []
  } catch (err) {
    if (err instanceof ApiUnavailable) return []
    throw err
  }
}

/**
 * Re-scan the drop folder and regenerate custom.css without restarting the dev server, so a
 * file dropped in seconds ago becomes usable with a click. Re-links the custom stylesheet on the
 * way out. Returns `[]` (and re-links nothing) when there is no font API.
 * @returns the discovered custom-family records.
 */
export async function rescanCustom() {
  try {
    const data = await apiCall(`${API_BASE}/custom/rescan`, { method: 'POST' })
    const families = Array.isArray(data?.families) ? data.families : []
    await refreshStylesheet(firstCustomFileUrl(families), CUSTOM_STYLESHEET_HREF, CUSTOM_STYLESHEET_ID)
    return families
  } catch (err) {
    if (err instanceof ApiUnavailable) return []
    throw err
  }
}

/**
 * Download a family and write it into public/fonts/installed/.
 *
 * @param family  a Google Fonts family name — never a URL. The server builds every URL it
 *                fetches itself; there is no path from here to an arbitrary host.
 * @param opts    `{ weights: [400, 700], subsets: ['latin'], italic: true, dryRun: false }`
 *                `dryRun` prices the install (exact bytes, file count) without downloading.
 * @returns the family record, the dry-run estimate, or null when there is no font API.
 */
export async function installFont(family, opts = {}) {
  try {
    const data = await apiCall(`${API_BASE}/install`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        family,
        weights: opts.weights,
        subsets: opts.subsets,
        italic: opts.italic,
        dryRun: Boolean(opts.dryRun)
      })
    })
    if (data?.dryRun) return data
    await refreshStylesheet(firstFileUrl(data?.family))
    return data?.family || null
  } catch (err) {
    if (err instanceof ApiUnavailable) return null
    throw err
  }
}

/**
 * Register user-supplied font files — the licensed families that will never be on Google.
 *
 * @param files  a FileList or array of File objects. The family name is taken from
 *               `files.family` when present, otherwise inferred from the first filename.
 * @returns the family record, or null when there is no font API.
 */
export async function uploadFontFiles(files, family) {
  const list = Array.from(files || [])
  if (!list.length) return null

  const payload = await Promise.all(list.map(async file => ({
    name: file.name,
    data: await fileToBase64(file)
  })))

  try {
    const data = await apiCall(`${API_BASE}/upload`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ family: family || familyFromFilename(list[0].name), files: payload })
    })
    await refreshStylesheet(firstFileUrl(data?.family))
    return data?.family || null
  } catch (err) {
    if (err instanceof ApiUnavailable) return null
    throw err
  }
}

/** @returns true on success, false when there is no font API. Throws on a real server error. */
export async function removeInstalled(family) {
  try {
    await apiCall(`${API_BASE}/installed/${encodeURIComponent(family)}`, { method: 'DELETE' })
    await refreshStylesheet()
    return true
  } catch (err) {
    if (err instanceof ApiUnavailable) return false
    throw err
  }
}

/* ------------------------------------------------------------------ *
 * Internals
 * ------------------------------------------------------------------ */

/** One real file from a freshly written family — the probe waitUntilServable polls. */
function firstFileUrl(record) {
  const file = record?.files?.[0]?.file
  return file ? `/fonts/installed/${record.slug}/${file}` : null
}

/** A custom face already carries its own served URL, so the probe just borrows the first one. */
function firstCustomFileUrl(families) {
  return families?.[0]?.faces?.[0]?.url || null
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error(`"${file.name}" couldn't be read.`))
    // readAsDataURL gives "data:font/woff2;base64,AAAA…" — the payload starts after the comma.
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.readAsDataURL(file)
  })
}

/** "GoldmanSans-Bold.ttf" → "GoldmanSans". A starting point the user can correct, not a guess
 *  the server trusts — it re-validates the name against its own pattern regardless. */
function familyFromFilename(name) {
  return String(name || 'Custom Font')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_](thin|extralight|ultralight|light|regular|book|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique)+/gi, '')
    .replace(/[^A-Za-z0-9 _.-]/g, ' ')
    .trim() || 'Custom Font'
}
