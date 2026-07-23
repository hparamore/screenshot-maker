import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

/* ==================================================================== *
 * Font installer — dev-server API
 *
 * Downloads Google Fonts once, writes them into public/fonts/installed/, and never touches
 * the network again. That is the whole point: `html-to-image` inlines every @font-face it can
 * read, a cross-origin stylesheet is unreadable, and the app has to export correctly on a
 * plane. See the header of public/fonts/webfonts.css for the full history.
 *
 * SECURITY — this plugin is strictly more dangerous than vite-plugin-project-files.js,
 * because it both writes to disk *and* makes outbound requests on command. It copies that
 * file's three access gates verbatim (socket / Host / Origin — read the comments there, it is
 * the canonical statement of the model) and adds three of its own:
 *
 *   4. The caller never supplies a URL. Ever. It supplies a family name matched against a
 *      deliberately narrow pattern, and this file builds every URL itself against a fixed
 *      host allowlist. There is no code path from request body to fetch target.
 *   5. Redirects are refused outright (`redirect: 'error'`), so a compromised or spoofed
 *      Google response cannot bounce the download to somewhere else.
 *   6. Everything is capped — per-file bytes, total bytes, file count, per-request timeout,
 *      whole-install deadline — so a hostile or broken upstream can't fill the disk or wedge
 *      the dev server.
 * ==================================================================== */

/* ---- outbound: fixed hosts, built here, never supplied by a caller ---- */
const CATALOG_URL = 'https://fonts.google.com/metadata/fonts'
const LICENCE_URL = 'https://fonts.google.com/download/list'
const CSS_URL = 'https://fonts.googleapis.com/css2'
const ALLOWED_FETCH_HOSTS = new Set(['fonts.google.com', 'fonts.googleapis.com', 'fonts.gstatic.com'])

// css2 serves woff2 only to browsers it recognises; an unknown UA gets ttf, which is 3-5x
// bigger and defeats the point of subsetting.
const WOFF2_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

/* ---- caps ---- */
const FETCH_TIMEOUT_MS = 20_000
const INSTALL_DEADLINE_MS = 180_000
// A Latin family needs a handful of files. A CJK family needs ~120, because Google splits
// Japanese, Korean and Chinese into per-range slices — so the cap has to clear that or those
// families are simply uninstallable. The dry run prices the selection first, so nobody hits
// this by surprise.
const MAX_FILES_PER_INSTALL = 200
const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_INSTALL_BYTES = 64 * 1024 * 1024
const MAX_CATALOG_BYTES = 16 * 1024 * 1024
const MAX_CSS_BYTES = 2 * 1024 * 1024
const MAX_LICENCE_BYTES = 4 * 1024 * 1024
const DOWNLOAD_CONCURRENCY = 6
// How many faces a dry run measures exactly before it starts sampling. See handleInstall.
const DRY_RUN_SAMPLE = 24

const MAX_UPLOAD_BYTES = 64 * 1024 * 1024
const MAX_UPLOAD_FILES = 32

const CATALOG_TTL_MS = 7 * 24 * 60 * 60 * 1000
// Bump when the normalized family shape changes, so a stale cache is refetched rather than
// served in a shape the UI no longer understands.
const CATALOG_SCHEMA = 1

// Every family name in the 1,942-entry Google catalog matches /^[A-Za-z0-9][A-Za-z0-9 ]*$/
// (verified against the live metadata). The extra `_.-` is for user-uploaded families only;
// it costs nothing here because the host is fixed and the value is URL-encoded regardless.
const FAMILY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.-]{0,63}$/

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/* ---- upload: magic bytes, because an extension is a claim and a header is evidence ---- */
const FONT_SIGNATURES = [
  { magic: [0x77, 0x4f, 0x46, 0x32], ext: 'woff2', format: 'woff2' }, // wOF2
  { magic: [0x77, 0x4f, 0x46, 0x46], ext: 'woff', format: 'woff' },   // wOFF
  { magic: [0x00, 0x01, 0x00, 0x00], ext: 'ttf', format: 'truetype' },
  { magic: [0x74, 0x72, 0x75, 0x65], ext: 'ttf', format: 'truetype' }, // "true"
  { magic: [0x4f, 0x54, 0x54, 0x4f], ext: 'otf', format: 'opentype' }, // OTTO
  { magic: [0x74, 0x74, 0x63, 0x66], ext: 'ttc', format: 'collection' } // ttcf
]

/* ------------------------------------------------------------------ *
 * Access control — same three gates as vite-plugin-project-files.js.
 * Duplicated rather than imported because that file exports only its plugin factory and is
 * owned elsewhere; it remains the canonical explanation of why each gate exists.
 * ------------------------------------------------------------------ */

function isLoopbackAddress(address) {
  if (typeof address !== 'string' || !address) return false
  let host = address.trim().toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  if (host.startsWith('::ffff:')) host = host.slice(7)
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

function isLoopbackHostname(hostname) {
  if (typeof hostname !== 'string' || !hostname) return false
  const host = hostname.trim().toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  return isLoopbackAddress(host)
}

function hostnameFromHostHeader(value) {
  if (typeof value !== 'string' || !value) return ''
  const host = value.trim()
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? '' : host.slice(0, end + 1)
  }
  return host.split(':')[0]
}

function checkAccess(req) {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    return { status: 403, error: 'The font API only answers requests from this machine (loopback).' }
  }
  if (!isLoopbackHostname(hostnameFromHostHeader(req.headers.host))) {
    return { status: 403, error: 'Unexpected Host header. Reach this API as localhost or 127.0.0.1.' }
  }
  const origin = req.headers.origin
  if (MUTATING_METHODS.has((req.method || 'GET').toUpperCase()) && origin) {
    let ok = false
    try {
      const url = new URL(origin)
      ok = (url.protocol === 'http:' || url.protocol === 'https:') && isLoopbackHostname(url.hostname)
    } catch {
      ok = false
    }
    if (!ok) {
      return { status: 403, error: 'Cross-origin writes are not allowed against the font API.' }
    }
  }
  return null
}

/* ------------------------------------------------------------------ *
 * HTTP plumbing
 * ------------------------------------------------------------------ */

function sendJson(res, status, payload) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(payload))
}

function sendJsonAndClose(req, res, status, payload) {
  res.setHeader('Connection', 'close')
  res.on('finish', () => { req.socket?.destroy() })
  sendJson(res, status, payload)
}

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false

    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > maxBytes) {
      reject(httpError(413, `Request body is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`))
      return
    }

    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      if (size > maxBytes) {
        settled = true
        reject(httpError(413, `Request body is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`))
        req.pause()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (settled) return
      settled = true
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', (err) => {
      if (settled) return
      settled = true
      reject(err)
    })
  })
}

/* ------------------------------------------------------------------ *
 * Outbound fetch — the only place this process talks to the network
 * ------------------------------------------------------------------ */

/**
 * Every outbound request in this file goes through here, and here is the only place a URL is
 * turned into a request. `redirect: 'error'` matters: without it a 302 from a spoofed or
 * compromised Google response would carry the download to an arbitrary host, which is exactly
 * the SSRF hole the fixed-host allowlist exists to close.
 */
async function safeFetch(url, { maxBytes, accept, signal } = {}) {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' || !ALLOWED_FETCH_HOSTS.has(parsed.hostname)) {
    throw httpError(500, `Refusing to fetch from ${parsed.hostname} — not a Google font host.`)
  }

  const timeout = AbortSignal.timeout(FETCH_TIMEOUT_MS)
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout

  let res
  try {
    res = await fetch(parsed, {
      redirect: 'error',
      signal: combined,
      headers: {
        'User-Agent': WOFF2_UA,
        Accept: accept || '*/*'
      }
    })
  } catch (err) {
    if (err?.name === 'TimeoutError') throw httpError(504, `Timed out fetching ${parsed.hostname}`)
    throw httpError(502, `Could not reach ${parsed.hostname}. Are you online?`)
  }

  if (!res.ok) throw httpError(res.status === 404 ? 404 : 502, `${parsed.hostname} answered ${res.status}`)

  const declared = Number(res.headers.get('content-length'))
  const cap = maxBytes || MAX_FILE_BYTES
  if (Number.isFinite(declared) && declared > cap) {
    throw httpError(413, `Refusing a ${Math.round(declared / 1024)} KB response from ${parsed.hostname}`)
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length > cap) throw httpError(413, `Response from ${parsed.hostname} exceeded its size cap`)
  return buf
}

/** Google's JSON endpoints prefix an anti-JSON-hijacking guard. */
function parseGuardedJson(text) {
  return JSON.parse(text.replace(/^\)\]\}'\s*/, ''))
}

/* ------------------------------------------------------------------ *
 * Catalog
 * ------------------------------------------------------------------ */

const CATEGORY_SLUGS = {
  'Sans Serif': 'sans-serif',
  Serif: 'serif',
  Display: 'display',
  Handwriting: 'handwriting',
  Monospace: 'monospace'
}

/** One normalized shape, whichever source it came from. */
function normalizeLiveFamily(entry) {
  const keys = Object.keys(entry.fonts || {})
  const wght = (entry.axes || []).find(a => a.tag === 'wght')
  const staticWeights = [...new Set(keys.filter(k => !k.endsWith('i')).map(Number))]
    .filter(Number.isFinite)
    .sort((a, b) => a - b)
  return {
    family: entry.family,
    category: CATEGORY_SLUGS[entry.category] || 'sans-serif',
    variable: Boolean(wght),
    weightMin: wght ? wght.min : (staticWeights[0] ?? 400),
    weightMax: wght ? wght.max : (staticWeights[staticWeights.length - 1] ?? 400),
    weights: wght ? [] : (staticWeights.length ? staticWeights : [400]),
    italic: keys.some(k => k.endsWith('i')),
    subsets: (entry.subsets || []).filter(s => s !== 'menu'),
    // Google's own popularity rank (1 = most used). The default sort in the browser, because
    // alphabetical puts ABeeZee above Inter and nobody is looking for ABeeZee.
    popularity: Number.isFinite(entry.popularity) ? entry.popularity : 99999
  }
}

/**
 * The bundled fallback is a curated ~220 most-popular families, encoded one per line as
 * `family|category|weights|subsets|flags`. It exists because /metadata/fonts is undocumented
 * and could change or vanish, and because a clone of this repo should not hard-fail offline.
 */
function parseFallbackFamily(line, index) {
  const [family, category, weights, subsets, flags] = line.split('|')
  const variable = weights.includes('..')
  const list = variable ? [] : weights.split(',').map(Number).filter(Number.isFinite)
  const [min, max] = variable ? weights.split('..').map(Number) : [list[0] ?? 400, list[list.length - 1] ?? 400]
  return {
    family,
    category,
    variable,
    weightMin: min,
    weightMax: max,
    weights: list,
    italic: (flags || '').includes('i'),
    subsets: subsets ? subsets.split(',') : ['latin'],
    // The list is already in popularity order, so its index is the rank.
    popularity: index + 1
  }
}

// Parsed on first use, not at import: the encoded list lives at the bottom of this file so it
// doesn't sit between the reader and the logic.
let fallbackMemo = null
function fallbackFamilies() {
  if (!fallbackMemo) fallbackMemo = FALLBACK_CATALOG.map(parseFallbackFamily)
  return fallbackMemo
}

/**
 * Disk-cached under node_modules/.cache so it is already git-ignored and never served to the
 * browser — the raw metadata payload is ~2.7 MB and there is no reason for it to sit in public/.
 */
class Catalog {
  constructor(cacheFile) {
    this.cacheFile = cacheFile
    this.memo = null
  }

  async read() {
    if (this.memo && Date.now() - this.memo.fetchedAt < CATALOG_TTL_MS) return this.memo

    if (!this.memo) {
      try {
        const cached = JSON.parse(await fs.readFile(this.cacheFile, 'utf8'))
        // A cache written by an older normalizer is missing fields the UI now reads. Refetch
        // rather than serve a shape that half-works.
        if (cached?.schema === CATALOG_SCHEMA && Array.isArray(cached?.families) && cached.families.length) {
          this.memo = { families: cached.families, fetchedAt: cached.fetchedAt || 0, source: 'cache' }
        }
      } catch {
        // No cache yet, or a corrupt one. Either way: refetch.
      }
    }
    if (this.memo && Date.now() - this.memo.fetchedAt < CATALOG_TTL_MS) return this.memo

    try {
      const buf = await safeFetch(CATALOG_URL, { maxBytes: MAX_CATALOG_BYTES, accept: 'application/json' })
      const data = parseGuardedJson(buf.toString('utf8'))
      const families = (data.familyMetadataList || [])
        .filter(f => f?.family && f.isOpenSource)
        .map(normalizeLiveFamily)
      if (!families.length) throw new Error('empty catalog')
      this.memo = { families, fetchedAt: Date.now(), source: 'live' }
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true })
      await writeFileAtomic(this.cacheFile, JSON.stringify({ schema: CATALOG_SCHEMA, fetchedAt: this.memo.fetchedAt, families }))
      return this.memo
    } catch {
      // Stale cache beats no catalog; the bundled list beats both being unavailable.
      if (this.memo) return { ...this.memo, source: 'stale-cache' }
      return { families: fallbackFamilies(), fetchedAt: 0, source: 'fallback' }
    }
  }

  async find(family) {
    const { families } = await this.read()
    const wanted = family.toLowerCase()
    return families.find(f => f.family.toLowerCase() === wanted) || null
  }
}

/* ------------------------------------------------------------------ *
 * Paths — resolve, then prove containment, before any fs call
 * ------------------------------------------------------------------ */

function familySlug(family) {
  return family
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Two gates, same reasoning as resolveProjectPath in vite-plugin-project-files.js: the pattern
 * alone would still admit ".."-ish names if it were ever loosened, and the resolved-path
 * containment check is what actually makes traversal impossible.
 */
function resolveFamilyDir(installedDir, family) {
  if (typeof family !== 'string') return null
  const name = family.trim()
  if (!FAMILY_PATTERN.test(name)) return null
  const slug = familySlug(name)
  if (!slug || slug === '.' || slug === '..') return null
  const dir = path.resolve(installedDir, slug)
  if (path.dirname(dir) !== path.resolve(installedDir)) return null
  return { dir, slug, family: name }
}

async function writeFileAtomic(file, contents) {
  const tmp = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`
  try {
    await fs.writeFile(tmp, contents)
    await fs.rename(tmp, file)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/**
 * Build the family in a sibling temp directory and swap it in, so a download interrupted
 * half way through can never leave a family folder whose font.css points at files that
 * aren't there. Same reasoning as writeAtomic, one level up.
 */
async function swapDirectory(tmpDir, finalDir) {
  const doomed = `${finalDir}.old-${crypto.randomBytes(4).toString('hex')}`
  let hadPrevious = false
  try {
    await fs.rename(finalDir, doomed)
    hadPrevious = true
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  try {
    await fs.rename(tmpDir, finalDir)
  } catch (err) {
    if (hadPrevious) await fs.rename(doomed, finalDir).catch(() => {})
    throw err
  }
  if (hadPrevious) await fs.rm(doomed, { recursive: true, force: true }).catch(() => {})
}

/* ------------------------------------------------------------------ *
 * css2 parsing
 * ------------------------------------------------------------------ */

/**
 * The css2 response is a flat list of `@font-face` blocks, each usually preceded by a
 * `/* subset *\/` comment. Reading the subset off that comment is how a caller-chosen subset
 * list is honoured — css2 has no documented per-subset parameter on this endpoint, and
 * filtering here is one fewer undocumented behaviour to depend on.
 *
 * CJK families are the exception and the reason the comment is optional here: Google splits
 * Japanese, Korean and Chinese into ~120 unlabelled range slices with no comment at all. A
 * parser that required the comment would quietly install a Japanese family's Latin faces and
 * nothing else — the worst possible outcome, because it looks like it worked. Those blocks
 * come back with `subset: null` and get attributed by the caller, which knows which CJK
 * script the family actually covers.
 */
function parseGoogleCss(css) {
  const faces = []
  const re = /(?:\/\*\s*([^*]*?)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/gi
  let match
  while ((match = re.exec(css)) !== null) {
    const label = match[1]
    const body = match[2]
    const url = /src:\s*url\(([^)]+)\)/i.exec(body)?.[1]?.replace(/['"]/g, '')
    if (!url) continue
    faces.push({
      subset: label && /^[a-z0-9-]+$/i.test(label) ? label.toLowerCase() : null,
      style: /font-style:\s*italic/i.test(body) ? 'italic' : 'normal',
      weight: (/font-weight:\s*([^;]+);/i.exec(body)?.[1] || '400').trim(),
      unicodeRange: (/unicode-range:\s*([^;]+);/i.exec(body)?.[1] || '').trim(),
      url
    })
  }
  return faces
}

const CJK_SUBSETS = new Set([
  'japanese', 'korean', 'chinese-simplified', 'chinese-traditional', 'chinese-hongkong'
])

function buildCssUrl(family, { weights, variable, weightMin, weightMax, italic }) {
  const url = new URL(CSS_URL)
  let spec
  if (variable) {
    const range = weightMin === weightMax ? String(weightMin) : `${weightMin}..${weightMax}`
    spec = italic ? `ital,wght@0,${range};1,${range}` : `wght@${range}`
  } else {
    const list = weights.join(';')
    spec = italic
      ? `ital,wght@${weights.map(w => `0,${w}`).join(';')};${weights.map(w => `1,${w}`).join(';')}`
      : `wght@${list}`
  }
  // `family` is pattern-validated above and encoded here; the host is a constant.
  url.searchParams.set('family', `${family}:${spec}`)
  url.searchParams.set('display', 'swap')
  return url.toString()
}

/**
 * Names are assigned in one pass before anything downloads, because a CJK subset produces a
 * hundred faces that agree on family, weight, style *and* subset — only their unicode-range
 * differs. Deduplicating during a concurrent download would be a race; doing it up front is
 * deterministic and the stylesheet is generated from the same records.
 */
function assignFilenames(slug, faces) {
  const taken = new Set()
  for (const face of faces) {
    const weight = face.weight.replace(/\s+/g, '-')
    const style = face.style === 'italic' ? 'italic' : 'roman'
    const base = `${slug}-${style}-${weight}-${face.subset}`
    let name = `${base}.woff2`
    let n = 1
    while (taken.has(name)) name = `${base}-${++n}.woff2`
    taken.add(name)
    face.filename = name
  }
  return faces
}

function renderFontFace(family, face, href) {
  return [
    '@font-face {',
    `  font-family: "${family}";`,
    `  font-style: ${face.style};`,
    `  font-weight: ${face.weight};`,
    '  font-display: swap;',
    `  src: url("${href}") format("${face.format || 'woff2'}");`,
    face.unicodeRange ? `  unicode-range: ${face.unicodeRange};` : null,
    '}'
  ].filter(Boolean).join('\n')
}

/* ------------------------------------------------------------------ *
 * Installed-family store
 * ------------------------------------------------------------------ */

const META_FILE = 'meta.json'
const FAMILY_CSS = 'font.css'
const AGGREGATE_CSS = 'installed.css'

const AGGREGATE_HEADER = `/*
 * GENERATED — do not edit. Rewritten by vite-plugin-fonts.js on every install, upload and
 * removal, and rebuilt from what is actually on disk each time the dev server starts.
 *
 * This is the companion to the hand-maintained webfonts.css: that file declares the four
 * families bundled with the repo, this one declares whatever you have installed locally.
 * Keeping them separate is why an install can never corrupt the bundled declarations.
 *
 * index.html links both. Fonts here are downloaded once and then served from disk — the app
 * makes no font requests to any remote host at runtime, which is what keeps PNG export
 * working offline.
 */
`

async function listInstalledFamilies(installedDir) {
  let entries = []
  try {
    entries = await fs.readdir(installedDir, { withFileTypes: true })
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return []
  }

  const out = []
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    try {
      const meta = JSON.parse(await fs.readFile(path.join(installedDir, entry.name, META_FILE), 'utf8'))
      if (meta?.family) out.push(meta)
    } catch {
      // A directory without readable metadata is a half-finished or hand-made folder. Skip it
      // rather than guess — the aggregate stylesheet is rebuilt from this same list, so an
      // unreadable family simply doesn't get declared.
    }
  }
  out.sort((a, b) => a.family.localeCompare(b.family))
  return out
}

async function rebuildAggregate(installedDir) {
  const families = await listInstalledFamilies(installedDir)
  const blocks = []
  for (const meta of families) {
    try {
      const css = await fs.readFile(path.join(installedDir, meta.slug, FAMILY_CSS), 'utf8')
      blocks.push(`/* ---- ${meta.family} — ${meta.licence || 'see LICENSE.txt'} ---- */\n${css.trim()}`)
    } catch {
      // Same tolerance as above: a family with no stylesheet just isn't declared.
    }
  }
  await fs.mkdir(installedDir, { recursive: true })
  await writeFileAtomic(path.join(installedDir, AGGREGATE_CSS), `${AGGREGATE_HEADER}\n${blocks.join('\n\n')}\n`)
  return families
}

/**
 * Family names already declared by the hand-maintained webfonts.css. Installing over one of
 * them would produce two competing sets of @font-face rules for the same name, and which one
 * won would depend on stylesheet order — a silent, confusing failure. Parsed from the file
 * rather than hardcoded so the list can never drift from reality.
 */
async function readBundledFamilies(publicFontsDir) {
  try {
    const css = await fs.readFile(path.join(publicFontsDir, 'webfonts.css'), 'utf8')
    const names = new Set()
    const re = /font-family:\s*["']([^"']+)["']/g
    let m
    while ((m = re.exec(css)) !== null) names.add(m[1].toLowerCase())
    return names
  } catch {
    return new Set()
  }
}

/* ------------------------------------------------------------------ *
 * Install
 * ------------------------------------------------------------------ */

const DEFAULT_SUBSETS = ['latin', 'latin-ext']
const DEFAULT_WEIGHTS = [400, 700]

/**
 * Resolve what will actually be fetched. Kept separate from the download so the dry run and
 * the real install can never disagree about what an install costs.
 */
function planInstall(entry, body) {
  const requestedSubsets = Array.isArray(body.subsets) && body.subsets.length ? body.subsets : DEFAULT_SUBSETS
  const subsets = requestedSubsets
    .filter(s => typeof s === 'string' && /^[a-z0-9-]{1,32}$/.test(s))
    .filter(s => entry.subsets.includes(s))
  if (!subsets.length) {
    // Every family has latin; falling back to it beats failing on a stale subset list.
    subsets.push(entry.subsets.includes('latin') ? 'latin' : entry.subsets[0])
  }

  const asked = Array.isArray(body.weights) && body.weights.length ? body.weights : DEFAULT_WEIGHTS
  const clean = [...new Set(asked.map(Number).filter(w => Number.isFinite(w) && w >= 1 && w <= 1000))]
    .sort((a, b) => a - b)
  let weights = clean.length ? clean : DEFAULT_WEIGHTS

  if (entry.variable) {
    weights = weights.map(w => Math.min(entry.weightMax, Math.max(entry.weightMin, w)))
  } else {
    const available = entry.weights.length ? entry.weights : [400]
    const matched = weights.filter(w => available.includes(w))
    weights = matched.length ? matched : [available.includes(400) ? 400 : available[0]]
  }

  // Italic is load-bearing in this app — *asterisk* markup renders italic — so it defaults on
  // whenever the family has it, rather than being an advanced option nobody finds.
  const italic = entry.italic && body.italic !== false

  return {
    subsets,
    weights,
    italic,
    variable: entry.variable,
    weightMin: Math.min(...weights),
    weightMax: Math.max(...weights)
  }
}

async function fetchFaces(entry, plan, signal) {
  const family = entry.family
  const css = await safeFetch(buildCssUrl(family, plan), {
    maxBytes: MAX_CSS_BYTES,
    accept: 'text/css',
    signal
  })
  const all = parseGoogleCss(css.toString('utf8'))
  if (!all.length) throw httpError(404, `Google Fonts returned no faces for "${family}".`)

  // A family covers at most one CJK script, so unlabelled blocks can only belong to that one.
  const cjk = entry.subsets.filter(s => CJK_SUBSETS.has(s))
  const orphanSubset = cjk.length === 1 ? cjk[0] : null
  for (const face of all) {
    if (!face.subset) face.subset = orphanSubset
  }

  const wanted = new Set(plan.subsets)
  const faces = assignFilenames(familySlug(family), all.filter(f => f.subset && wanted.has(f.subset)))
  if (!faces.length) {
    throw httpError(400, `"${family}" has no faces for the selected script coverage.`)
  }
  if (faces.length > MAX_FILES_PER_INSTALL) {
    throw httpError(413, `That selection needs ${faces.length} font files; the cap is ${MAX_FILES_PER_INSTALL}. Pick fewer weights or scripts.`)
  }
  for (const face of faces) {
    const host = new URL(face.url).hostname
    if (host !== 'fonts.gstatic.com') {
      throw httpError(502, `Google Fonts pointed a face at ${host}, which is not a font host. Refusing.`)
    }
  }
  return faces
}

/** Exact bytes without downloading — one HEAD per face, so the UI can price an install. */
async function measureFaces(faces, signal) {
  const sized = []
  await runPool(faces, DOWNLOAD_CONCURRENCY, async (face) => {
    let bytes = 0
    try {
      const res = await fetch(new URL(face.url), {
        method: 'HEAD',
        redirect: 'error',
        signal: signal ? AbortSignal.any([AbortSignal.timeout(FETCH_TIMEOUT_MS), signal]) : AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': WOFF2_UA }
      })
      bytes = Number(res.headers.get('content-length')) || 0
    } catch {
      bytes = 0
    }
    sized.push({ subset: face.subset, style: face.style, weight: face.weight, bytes })
  })
  return sized
}

/**
 * Bounded-concurrency map. The `stop` flag matters: without it, one failed download would
 * reject the pool while its siblings kept writing into a temp directory the caller has
 * already started deleting.
 */
async function runPool(items, limit, worker) {
  let cursor = 0
  let stop = false
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length && !stop) {
      const index = cursor++
      try {
        await worker(items[index], index)
      } catch (err) {
        stop = true
        throw err
      }
    }
  })
  // allSettled, not all: the caller deletes the temp directory on failure, and that must not
  // race a sibling download still writing into it.
  const settled = await Promise.allSettled(runners)
  const failure = settled.find(r => r.status === 'rejected')
  if (failure) throw failure.reason
}

async function fetchLicence(family, signal) {
  const url = new URL(LICENCE_URL)
  url.searchParams.set('family', family)
  const buf = await safeFetch(url.toString(), {
    maxBytes: MAX_LICENCE_BYTES,
    accept: 'application/json',
    signal
  })
  const data = parseGuardedJson(buf.toString('utf8'))
  const file = (data?.manifest?.files || []).find(f => /^(OFL|LICENSE|UFL|APACHE)/i.test(f?.filename || ''))
  if (!file?.contents) throw new Error('no licence in manifest')
  return { name: file.filename, text: String(file.contents), id: /^ofl/i.test(file.filename) ? 'SIL Open Font License 1.1' : file.filename.replace(/\.txt$/i, '') }
}

/* ------------------------------------------------------------------ *
 * Upload
 * ------------------------------------------------------------------ */

function sniffFont(buffer) {
  for (const sig of FONT_SIGNATURES) {
    if (sig.magic.every((byte, i) => buffer[i] === byte)) return sig
  }
  return null
}

/** Filenames are the only signal a dropped font file carries about its own weight and style. */
function guessStyle(filename) {
  const name = filename.toLowerCase()
  const italic = /italic|oblique|-it\b|_it\b/.test(name)
  const weight =
    /thin|hairline/.test(name) ? 100 :
    /extralight|ultralight/.test(name) ? 200 :
    /light/.test(name) ? 300 :
    /medium/.test(name) ? 500 :
    /semibold|demibold/.test(name) ? 600 :
    /extrabold|ultrabold/.test(name) ? 800 :
    /black|heavy/.test(name) ? 900 :
    /bold/.test(name) ? 700 :
    400
  return { style: italic ? 'italic' : 'normal', weight }
}

/* ------------------------------------------------------------------ *
 * Custom drop folder — public/fonts/custom/
 *
 * The mirror image of the installed/ scan. installed/ only trusts a folder that carries a
 * meta.json this plugin wrote; custom/ trusts nothing but the bytes. A designer drops a raw
 * .ttf in and it appears — no UI, no metadata, no generated sidecars they have to keep. That is
 * the whole ask: "I put fonts in a folder and they're there."
 *
 * Two things keep the two folders from stepping on each other: custom/ is scanned by this code
 * and never written to except for its own generated custom.css, and installed/ is app-managed
 * and never scanned by this code. Both are declared into the page by separate stylesheets, so
 * neither can corrupt the other or the hand-maintained webfonts.css.
 *
 * ttf/otf are served as-is. They work in @font-face and survive PNG export (Session 4 proved
 * name-referenced local faces export; these are same-origin static files, strictly simpler).
 * woff2 would be smaller on disk if that ever matters — but converting would mean a build step,
 * and "drop a file, it works" is worth more here than a few hundred KB.
 * ------------------------------------------------------------------ */

const CUSTOM_CSS = 'custom.css'

const CUSTOM_HEADER = `/*
 * GENERATED — do not edit. Rebuilt by vite-plugin-fonts.js from whatever font files are sitting
 * in public/fonts/custom/ each time the dev server starts, and again on POST /api/fonts/custom/rescan.
 *
 * This is the companion to installed.css (fonts installed through the in-app browser) and to
 * the hand-maintained webfonts.css (the four families bundled with the repo). This one declares
 * the fonts you dropped into public/fonts/custom/ yourself. See that folder's README.md.
 *
 * Nothing here reaches a CDN: every src points at a same-origin file under /fonts/custom/, which
 * is what keeps PNG export working offline.
 */
`

// Weight/style words a filename might carry, so they can be stripped back off to recover the
// family name of a loose file. guessStyle() reads the same vocabulary for the face's own weight.
const STYLE_TOKENS = new Set([
  'thin', 'hairline', 'extralight', 'ultralight', 'light', 'regular', 'book', 'normal',
  'medium', 'semibold', 'demibold', 'bold', 'extrabold', 'ultrabold', 'black', 'heavy',
  'italic', 'oblique', 'it', 'roman'
])

/** A URL Vite already serves from public/. Each segment is encoded so spaces and unicode in a
 *  folder or file name survive into the stylesheet intact. */
function customUrl(segments) {
  return '/fonts/custom/' + segments.map(encodeURIComponent).join('/')
}

/**
 * Sniff a file by its first four bytes rather than its extension — the same principle the upload
 * path uses, because an extension is a claim and a header is evidence. A .DS_Store, a stray PDF
 * or a README returns null and is skipped; one non-font file can never take out the scan.
 */
async function sniffFontFile(filePath) {
  let handle
  try {
    handle = await fs.open(filePath, 'r')
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(4), 0, 4, 0)
    return bytesRead >= 4 ? sniffFont(buffer) : null
  } catch {
    return null
  } finally {
    await handle?.close().catch(() => {})
  }
}

/**
 * Recover a family name from a loose filename by stripping recognised weight/style tokens.
 * "Acme-Bold.ttf" and "Acme-Italic.ttf" both resolve to "Acme". This is heuristic and the
 * documented reason a subfolder-per-family is the reliable path: a name the tokeniser can't
 * cleanly split lands in the wrong family. Casing is preserved for display.
 */
function familyFromLooseFilename(filename) {
  const base = filename.replace(/\.[^.]+$/, '')
  const words = base
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // AcmeGrotesk → Acme Grotesk
    .split(/[-_ ]+/)
    .filter(Boolean)
  const kept = words.filter(w => !STYLE_TOKENS.has(w.toLowerCase()))
  return (kept.length ? kept : words).join(' ').trim() || base
}

/**
 * Walk public/fonts/custom/ and return one record per family, from two drop styles:
 *   - a subfolder per family: custom/<Family>/*.ttf → family is the folder name, every font
 *     file inside is one of its faces. Reliable, because the family name is explicit.
 *   - loose files directly in custom/: family parsed from the filename (heuristic, above).
 *
 * Faces are deduplicated by weight+style — a family that carries the same weight/style twice
 * keeps the first and drops the rest, so a duplicated Regular doesn't emit two competing faces.
 * An empty or absent folder returns [] rather than throwing.
 */
async function discoverCustomFamilies(customDir) {
  let entries
  try {
    entries = await fs.readdir(customDir, { withFileTypes: true })
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
    return []
  }

  // Keyed by lower-cased family so a subfolder and a loose file naming the same family merge;
  // the first display name seen keeps its casing.
  const byFamily = new Map()
  const addFace = (family, face) => {
    const key = family.toLowerCase()
    let fam = byFamily.get(key)
    if (!fam) {
      fam = { family, faces: [] }
      byFamily.set(key, fam)
    }
    if (fam.faces.some(f => f.weight === face.weight && f.style === face.style)) return
    fam.faces.push(face)
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue

    if (entry.isDirectory()) {
      const family = entry.name
      const dir = path.join(customDir, entry.name)
      let files
      try {
        files = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        continue
      }
      for (const file of files) {
        if (!file.isFile() || file.name.startsWith('.')) continue
        const sig = await sniffFontFile(path.join(dir, file.name))
        if (!sig) continue
        const { style, weight } = guessStyle(file.name)
        addFace(family, { style, weight, format: sig.format, url: customUrl([entry.name, file.name]) })
      }
    } else if (entry.isFile()) {
      const sig = await sniffFontFile(path.join(customDir, entry.name))
      if (!sig) continue
      const { style, weight } = guessStyle(entry.name)
      addFace(familyFromLooseFilename(entry.name), {
        style,
        weight,
        format: sig.format,
        url: customUrl([entry.name])
      })
    }
  }

  const out = []
  for (const fam of byFamily.values()) {
    if (!fam.faces.length) continue
    fam.faces.sort((a, b) => a.weight - b.weight || a.style.localeCompare(b.style))
    out.push({
      family: fam.family,
      slug: familySlug(fam.family),
      source: 'custom',
      weights: [...new Set(fam.faces.map(f => f.weight))].sort((a, b) => a - b),
      italic: fam.faces.some(f => f.style === 'italic'),
      files: fam.faces.length,
      faces: fam.faces
    })
  }
  out.sort((a, b) => a.family.localeCompare(b.family))
  return out
}

/**
 * Regenerate custom.css from whatever is on disk. Atomic like every other generated file here,
 * and an empty folder produces a valid (header-only) stylesheet rather than an error. The
 * font-family string is the exact family name, so it matches what the registry emits for the
 * same drop (familyToStack quotes the same name).
 */
async function rebuildCustomAggregate(customDir) {
  const families = await discoverCustomFamilies(customDir)
  const blocks = families.map(fam => {
    const faces = fam.faces
      .map(face => renderFontFace(fam.family, { style: face.style, weight: face.weight, format: face.format }, face.url))
      .join('\n')
    return `/* ---- ${fam.family} — dropped in, ${fam.files} file${fam.files === 1 ? '' : 's'} ---- */\n${faces}`
  })
  await fs.mkdir(customDir, { recursive: true })
  await writeFileAtomic(path.join(customDir, CUSTOM_CSS), `${CUSTOM_HEADER}\n${blocks.join('\n\n')}\n`)
  return families
}

/* ------------------------------------------------------------------ *
 * Plugin
 * ------------------------------------------------------------------ */

export default function fontsPlugin() {
  let installedDir = ''
  let customDir = ''
  let publicFontsDir = ''
  let catalog = null
  let logger = console

  async function handleCatalog(res) {
    const { families, fetchedAt, source } = await catalog.read()
    return sendJson(res, 200, { families, fetchedAt, source, fallbackSize: fallbackFamilies().length })
  }

  async function handleInstalled(res) {
    return sendJson(res, 200, { families: await listInstalledFamilies(installedDir) })
  }

  async function handleInstall(req, res) {
    const body = JSON.parse(await readBody(req, 64 * 1024))
    const resolved = resolveFamilyDir(installedDir, body?.family)
    if (!resolved) {
      return sendJson(res, 400, {
        error: 'Invalid family name. Letters, numbers, spaces, dots, dashes and underscores only (max 64).'
      })
    }

    const bundled = await readBundledFamilies(publicFontsDir)
    if (bundled.has(resolved.family.toLowerCase())) {
      return sendJson(res, 409, {
        error: `"${resolved.family}" already ships with this app (see public/fonts/webfonts.css). Installing it again would produce two competing sets of @font-face rules.`
      })
    }

    const entry = await catalog.find(resolved.family)
    if (!entry) {
      return sendJson(res, 404, {
        error: `"${resolved.family}" isn't in the Google Fonts catalog. Check the spelling, or upload the files directly if it's a licensed family.`
      })
    }

    const plan = planInstall(entry, body || {})
    const deadline = AbortSignal.timeout(INSTALL_DEADLINE_MS)
    const faces = await fetchFaces(entry, plan, deadline)

    if (body?.dryRun) {
      // A CJK family is 120 faces, and 120 HEAD requests on every checkbox click is not a
      // price worth paying for exactness nobody needs at that scale. Small selections are
      // measured exactly; large ones sample and extrapolate, and say so.
      const sample = faces.length > DRY_RUN_SAMPLE
        ? faces.filter((_, i) => i % Math.ceil(faces.length / DRY_RUN_SAMPLE) === 0)
        : faces
      const sized = await measureFaces(sample, deadline)
      const measured = sized.reduce((n, f) => n + f.bytes, 0)
      const approx = sample.length < faces.length
      return sendJson(res, 200, {
        dryRun: true,
        approx,
        family: entry.family,
        files: faces.length,
        bytes: approx ? Math.round((measured / sample.length) * faces.length) : measured,
        faces: sized,
        plan
      })
    }

    const tmpDir = path.join(installedDir, `.tmp-${familySlug(entry.family)}-${crypto.randomBytes(4).toString('hex')}`)
    await fs.mkdir(tmpDir, { recursive: true })

    try {
      let total = 0
      const written = []
      await runPool(faces, DOWNLOAD_CONCURRENCY, async (face) => {
        const buf = await safeFetch(face.url, { maxBytes: MAX_FILE_BYTES, accept: 'font/woff2', signal: deadline })
        total += buf.length
        if (total > MAX_INSTALL_BYTES) {
          throw httpError(413, `That selection is over the ${Math.round(MAX_INSTALL_BYTES / 1024 / 1024)} MB per-install cap.`)
        }
        await fs.writeFile(path.join(tmpDir, face.filename), buf)
        written.push({ ...face, bytes: buf.length })
      })

      let licence = null
      try {
        licence = await fetchLicence(entry.family, deadline)
      } catch {
        // A missing licence file must not block an install, but it must be visible.
        logger.warn?.(`[fonts] no licence file found for ${entry.family}; writing a pointer instead`)
      }
      await fs.writeFile(
        path.join(tmpDir, 'LICENSE.txt'),
        licence
          ? licence.text
          : `${entry.family} — downloaded from Google Fonts (https://fonts.google.com/specimen/${encodeURIComponent(entry.family).replace(/%20/g, '+')}).\n` +
            'The licence text could not be fetched automatically. Google Fonts families are\n' +
            'overwhelmingly SIL Open Font License 1.1; confirm on the specimen page before\n' +
            'redistributing this family.\n'
      )

      written.sort((a, b) => a.filename.localeCompare(b.filename))
      const css = written
        .map(face => renderFontFace(entry.family, face, `/fonts/installed/${resolved.slug}/${face.filename}`))
        .join('\n')
      await fs.writeFile(path.join(tmpDir, FAMILY_CSS), `${css}\n`)

      const meta = {
        family: entry.family,
        slug: resolved.slug,
        source: 'google',
        category: entry.category,
        installedAt: new Date().toISOString(),
        subsets: plan.subsets,
        weights: plan.weights,
        variable: plan.variable,
        italic: plan.italic,
        licence: licence?.id || 'unconfirmed — see LICENSE.txt',
        files: written.map(f => ({ file: f.filename, subset: f.subset, style: f.style, weight: f.weight, bytes: f.bytes })),
        bytes: total
      }
      await fs.writeFile(path.join(tmpDir, META_FILE), `${JSON.stringify(meta, null, 2)}\n`)

      await swapDirectory(tmpDir, resolved.dir)
      await rebuildAggregate(installedDir)
      logger.info?.(`[fonts] installed ${entry.family} — ${written.length} files, ${Math.round(total / 1024)} KB`)
      return sendJson(res, 200, { ok: true, family: meta })
    } catch (err) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
  }

  async function handleUpload(req, res) {
    const body = JSON.parse(await readBody(req, MAX_UPLOAD_BYTES))
    const resolved = resolveFamilyDir(installedDir, body?.family)
    if (!resolved) {
      return sendJson(res, 400, {
        error: 'Invalid family name. Letters, numbers, spaces, dots, dashes and underscores only (max 64).'
      })
    }

    const bundled = await readBundledFamilies(publicFontsDir)
    if (bundled.has(resolved.family.toLowerCase())) {
      return sendJson(res, 409, { error: `"${resolved.family}" already ships with this app.` })
    }

    const incoming = Array.isArray(body?.files) ? body.files : []
    if (!incoming.length) return sendJson(res, 400, { error: 'No font files in the request.' })
    if (incoming.length > MAX_UPLOAD_FILES) {
      return sendJson(res, 413, { error: `Too many files — the cap is ${MAX_UPLOAD_FILES}.` })
    }

    const tmpDir = path.join(installedDir, `.tmp-${resolved.slug}-${crypto.randomBytes(4).toString('hex')}`)
    await fs.mkdir(tmpDir, { recursive: true })

    try {
      const written = []
      let total = 0
      for (const [index, file] of incoming.entries()) {
        const label = typeof file?.name === 'string' ? file.name : `font-${index + 1}`
        let buf
        try {
          buf = Buffer.from(String(file?.data || ''), 'base64')
        } catch {
          throw httpError(400, `"${label}" wasn't valid base64.`)
        }
        // An extension is a claim; the header is evidence. Sniff before anything is written.
        const sig = sniffFont(buf)
        if (!sig) {
          throw httpError(415, `"${label}" isn't a font file — its header doesn't match woff2, woff, ttf, otf or ttc.`)
        }
        total += buf.length
        if (total > MAX_UPLOAD_BYTES) throw httpError(413, 'Those files are over the upload size cap.')

        const guess = guessStyle(label)
        const style = file?.style === 'italic' || file?.style === 'normal' ? file.style : guess.style
        const weight = Number.isFinite(Number(file?.weight)) && Number(file.weight) >= 1 && Number(file.weight) <= 1000
          ? String(Math.round(Number(file.weight)))
          : String(guess.weight)
        // The uploaded name never reaches the filesystem — the name is rebuilt from values
        // this file controls, so a hostile filename has nowhere to go.
        const filename = `${resolved.slug}-${style === 'italic' ? 'italic' : 'roman'}-${weight}-${index + 1}.${sig.ext}`
        await fs.writeFile(path.join(tmpDir, filename), buf)
        written.push({ filename, style, weight, format: sig.format, bytes: buf.length, originalName: label })
      }

      const css = written
        .map(face => renderFontFace(resolved.family, face, `/fonts/installed/${resolved.slug}/${face.filename}`))
        .join('\n')
      await fs.writeFile(path.join(tmpDir, FAMILY_CSS), `${css}\n`)
      await fs.writeFile(
        path.join(tmpDir, 'LICENSE.txt'),
        `${resolved.family} was supplied by the user, not downloaded from Google Fonts.\n` +
        'Its licence is whatever you licensed it under. Check before committing these files\n' +
        'to a public repository — see the Goldman Sans note in .gitignore for the precedent.\n'
      )

      const meta = {
        family: resolved.family,
        slug: resolved.slug,
        source: 'upload',
        category: 'uploaded',
        installedAt: new Date().toISOString(),
        subsets: [],
        weights: [...new Set(written.map(f => Number(f.weight)))].sort((a, b) => a - b),
        variable: false,
        italic: written.some(f => f.style === 'italic'),
        licence: 'user-supplied — see LICENSE.txt',
        files: written.map(f => ({ file: f.filename, style: f.style, weight: f.weight, bytes: f.bytes })),
        bytes: total
      }
      await fs.writeFile(path.join(tmpDir, META_FILE), `${JSON.stringify(meta, null, 2)}\n`)

      await swapDirectory(tmpDir, resolved.dir)
      await rebuildAggregate(installedDir)
      logger.info?.(`[fonts] uploaded ${resolved.family} — ${written.length} files`)
      return sendJson(res, 200, { ok: true, family: meta })
    } catch (err) {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      throw err
    }
  }

  async function handleRemove(res, rawFamily) {
    const resolved = resolveFamilyDir(installedDir, rawFamily)
    if (!resolved) return sendJson(res, 400, { error: 'Invalid family name.' })

    let stat
    try {
      stat = await fs.stat(resolved.dir)
    } catch (err) {
      if (err.code === 'ENOENT') return sendJson(res, 404, { error: `"${resolved.family}" isn't installed.` })
      throw err
    }
    if (!stat.isDirectory()) return sendJson(res, 404, { error: `"${resolved.family}" isn't installed.` })

    await fs.rm(resolved.dir, { recursive: true, force: true })
    await rebuildAggregate(installedDir)
    logger.info?.(`[fonts] removed ${resolved.family}`)
    return sendJson(res, 200, { ok: true })
  }

  return {
    name: 'screenshot-maker:fonts',
    // Dev only, exactly like the project-file API. A built app has no server to host this;
    // the fonts it downloaded are plain files under public/ and keep working without it.
    apply: 'serve',

    configResolved(config) {
      publicFontsDir = path.resolve(config.root, 'public/fonts')
      installedDir = path.join(publicFontsDir, 'installed')
      customDir = path.join(publicFontsDir, 'custom')
      catalog = new Catalog(path.resolve(config.root, 'node_modules/.cache/screenshot-maker/google-fonts.json'))
      logger = config.logger || console
    },

    async configureServer(server) {
      // Rebuilt from disk at every start, so a hand-deleted family folder or an interrupted
      // install can never leave the aggregate stylesheet pointing at files that aren't there.
      await rebuildAggregate(installedDir).catch(err => {
        server.config.logger.error(`[fonts] could not build installed.css: ${err?.message || err}`)
      })

      // The drop folder is scanned on the same startup hook, so a font dropped in while the
      // server was down is picked up on the next launch — "put a file in the folder and it's
      // there." A broken scan must not take the dev server down with it.
      await rebuildCustomAggregate(customDir).catch(err => {
        server.config.logger.error(`[fonts] could not build custom.css: ${err?.message || err}`)
      })

      server.middlewares.use('/api/fonts', async (req, res, next) => {
        try {
          const denied = checkAccess(req)
          if (denied) return sendJsonAndClose(req, res, denied.status, { error: denied.error })

          const [rawPath] = (req.url || '/').split('?')
          const method = (req.method || 'GET').toUpperCase()

          let segments
          try {
            segments = rawPath.split('/').filter(Boolean).map(decodeURIComponent)
          } catch {
            return sendJson(res, 400, { error: 'Malformed request path' })
          }

          if (method === 'GET' && segments[0] === 'catalog' && segments.length === 1) {
            return await handleCatalog(res)
          }
          if (method === 'GET' && segments[0] === 'installed' && segments.length === 1) {
            return await handleInstalled(res)
          }
          // The drop folder, scanned fresh from disk each call — same shape as /installed, plus
          // a `source: 'custom'` the registry keys off. Read-only; custom.css is rebuilt at
          // startup and on /custom/rescan, not here.
          if (method === 'GET' && segments[0] === 'custom' && segments.length === 1) {
            return sendJson(res, 200, { families: await discoverCustomFamilies(customDir) })
          }
          // Re-scan and regenerate custom.css without a restart, so a just-dropped file can be
          // picked up with a click. Behind the same access gate as every mutating route above.
          if (method === 'POST' && segments[0] === 'custom' && segments[1] === 'rescan' && segments.length === 2) {
            return sendJson(res, 200, { ok: true, families: await rebuildCustomAggregate(customDir) })
          }
          if (method === 'DELETE' && segments[0] === 'installed' && segments.length === 2) {
            return await handleRemove(res, segments[1])
          }
          if (method === 'POST' && segments[0] === 'install' && segments.length === 1) {
            return await handleInstall(req, res)
          }
          if (method === 'POST' && segments[0] === 'upload' && segments.length === 1) {
            return await handleUpload(req, res)
          }

          return sendJson(res, 404, { error: `No font API route for ${method} /api/fonts${rawPath}` })
        } catch (err) {
          if (err?.status) {
            if (err.status === 413) return sendJsonAndClose(req, res, 413, { error: err.message })
            return sendJson(res, err.status, { error: err.message })
          }
          if (err instanceof SyntaxError) {
            return sendJson(res, 400, { error: 'Request body was not valid JSON' })
          }
          server.config.logger.error(`[fonts] ${err?.stack || err}`)
          if (res.headersSent) return next(err)
          return sendJson(res, 500, { error: err?.message || 'Internal error' })
        }
      })
    }
  }
}

/* ==================================================================== *
 * Bundled fallback catalog
 *
 * The 220 most-popular open-source Google Fonts families, snapshotted from
 * https://fonts.google.com/metadata/fonts. That endpoint needs no API key — which is why it
 * is the primary source, since requiring a key would make this feature unusable for anyone
 * who just cloned the repo — but it is undocumented, so it gets a floor underneath it.
 *
 * This list is also a better default browsing experience than the full 1,942: nobody scrolls
 * a two-thousand-row picker looking for a headline face. Noto and Google's own product fonts
 * are excluded deliberately (a thousand Noto scripts would drown the list; Google Sans is
 * Google's brand typeface).
 *
 * Encoding, one family per line:
 *   family | category | weights | subsets | flags
 *     weights  "100..900" for a variable wght axis, otherwise a comma list of static weights
 *     flags    "i" when the family has italics
 * ==================================================================== */
const FALLBACK_CATALOG = [
  'Roboto|sans-serif|100..900|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,math,symbols,vietnamese|i',
  'Open Sans|sans-serif|300..800|cyrillic,cyrillic-ext,greek,greek-ext,hebrew,latin,latin-ext,math,symbols,vietnamese|i',
  'Inter|sans-serif|100..900|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,vietnamese|i',
  'Montserrat|sans-serif|100..900|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Poppins|sans-serif|100,200,300,400,500,600,700,800,900|devanagari,latin,latin-ext|i',
  'Lato|sans-serif|100,300,400,700,900|latin,latin-ext|i',
  'Roboto Condensed|sans-serif|100..900|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,vietnamese|i',
  'Roboto Mono|monospace|100..700|cyrillic,cyrillic-ext,greek,latin,latin-ext,vietnamese|i',
  'Arimo|sans-serif|400..700|cyrillic,cyrillic-ext,greek,greek-ext,hebrew,latin,latin-ext,vietnamese|i',
  'Oswald|sans-serif|200..700|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|',
  'Raleway|sans-serif|100..900|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'DM Sans|sans-serif|100..1000|latin,latin-ext|i',
  'Nunito|sans-serif|200..1000|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Nunito Sans|sans-serif|200..1000|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Playfair Display|serif|400..900|cyrillic,latin,latin-ext,vietnamese|i',
  'Roboto Slab|serif|100..900|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,vietnamese|',
  'Rubik|sans-serif|300..900|arabic,cyrillic,cyrillic-ext,hebrew,latin,latin-ext|i',
  'Archivo Black|sans-serif|400|latin,latin-ext|',
  'Ubuntu|sans-serif|300,400,500,700|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext|i',
  'Kanit|sans-serif|100,200,300,400,500,600,700,800,900|latin,latin-ext,thai,vietnamese|i',
  'Outfit|sans-serif|100..900|latin,latin-ext|',
  'Merriweather|serif|300..900|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Manrope|sans-serif|200..800|cyrillic,cyrillic-ext,greek,latin,latin-ext,vietnamese|',
  'Work Sans|sans-serif|100..900|latin,latin-ext,vietnamese|i',
  'Black Ops One|display|400|cyrillic-ext,latin,latin-ext,vietnamese|',
  'Prompt|sans-serif|100,200,300,400,500,600,700,800,900|latin,latin-ext,thai,vietnamese|i',
  'Lora|serif|400..700|cyrillic,cyrillic-ext,latin,latin-ext,math,symbols,vietnamese|i',
  'PT Sans|sans-serif|400,700|cyrillic,cyrillic-ext,latin,latin-ext|i',
  'Bebas Neue|sans-serif|400|latin,latin-ext|',
  'Saira|sans-serif|100..900|latin,latin-ext,vietnamese|i',
  'Mulish|sans-serif|200..1000|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Figtree|sans-serif|300..900|latin,latin-ext|i',
  'Plus Jakarta Sans|sans-serif|200..800|cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Bricolage Grotesque|sans-serif|200..800|latin,latin-ext,vietnamese|',
  'Source Sans 3|sans-serif|200..900|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,vietnamese|i',
  'Share Tech|sans-serif|400|latin|',
  'Smooch Sans|sans-serif|100..900|latin,latin-ext,vietnamese|',
  'Barlow|sans-serif|100,200,300,400,500,600,700,800,900|latin,latin-ext,vietnamese|i',
  'Quicksand|sans-serif|300..700|latin,latin-ext,vietnamese|',
  'Inconsolata|monospace|200..900|latin,latin-ext,vietnamese|',
  'IBM Plex Sans|sans-serif|100..700|cyrillic,cyrillic-ext,greek,latin,latin-ext,vietnamese|i',
  'Jost|sans-serif|100..900|cyrillic,latin,latin-ext|i',
  'Karla|sans-serif|200..800|latin,latin-ext|i',
  'Archivo|sans-serif|100..900|latin,latin-ext,vietnamese|i',
  'Fira Sans|sans-serif|100,200,300,400,500,600,700,800,900|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,vietnamese|i',
  'Heebo|sans-serif|100..900|hebrew,latin,latin-ext,math,symbols|',
  'Space Grotesk|sans-serif|300..700|latin,latin-ext,vietnamese|',
  'Titillium Web|sans-serif|200,300,400,600,700,900|latin,latin-ext|i',
  'JetBrains Mono|monospace|100..800|cyrillic,cyrillic-ext,greek,latin,latin-ext,vietnamese|i',
  'PT Serif|serif|400,700|cyrillic,cyrillic-ext,latin,latin-ext|i',
  'Fjalla One|sans-serif|400|cyrillic-ext,latin,latin-ext,vietnamese|',
  'Changa One|display|400|latin|i',
  'Dancing Script|handwriting|400..700|latin,latin-ext,vietnamese|',
  'Libre Baskerville|serif|400..700|latin,latin-ext|i',
  'Lobster Two|display|400,700|latin|i',
  'Libre Franklin|sans-serif|100..900|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Cormorant Garamond|serif|300..700|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Barlow Condensed|sans-serif|100,200,300,400,500,600,700,800,900|latin,latin-ext,vietnamese|i',
  'Source Code Pro|monospace|200..900|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,vietnamese|i',
  'Public Sans|sans-serif|100..900|latin,latin-ext,vietnamese|i',
  'Josefin Sans|sans-serif|100..700|latin,latin-ext,vietnamese|i',
  'Anton|sans-serif|400|latin,latin-ext,vietnamese|',
  'EB Garamond|serif|400..800|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,vietnamese|i',
  'Nanum Gothic|sans-serif|400,700,800|korean,latin|',
  'Assistant|sans-serif|200..800|hebrew,latin,latin-ext|',
  'Alfa Slab One|display|400|latin,latin-ext,vietnamese|',
  'Sora|sans-serif|100..800|latin,latin-ext|',
  'Lexend|sans-serif|100..900|latin,latin-ext,vietnamese|',
  'Cairo|sans-serif|200..1000|arabic,latin,latin-ext|',
  'Mukta|sans-serif|200,300,400,500,600,700,800|devanagari,latin,latin-ext|',
  'Inter Tight|sans-serif|100..900|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,vietnamese|i',
  'Schibsted Grotesk|sans-serif|400..900|latin,latin-ext|i',
  'Red Hat Display|sans-serif|300..900|latin,latin-ext|i',
  'Instrument Serif|serif|400|latin,latin-ext|i',
  'Cabin|sans-serif|400..700|latin,latin-ext,vietnamese|i',
  'Bitter|serif|100..900|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Roboto Flex|sans-serif|100..1000|cyrillic,cyrillic-ext,greek,latin,latin-ext,vietnamese|',
  'Dosis|sans-serif|200..800|latin,latin-ext,vietnamese|',
  'Hind Siliguri|sans-serif|300,400,500,600,700|bengali,latin,latin-ext|',
  'Rajdhani|sans-serif|300,400,500,600,700|devanagari,latin,latin-ext|',
  'Ramabhadra|sans-serif|400|latin,telugu|',
  'IBM Plex Mono|monospace|100,200,300,400,500,600,700|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'M PLUS Rounded 1c|sans-serif|100,300,400,500,700,800,900|cyrillic,cyrillic-ext,greek,greek-ext,hebrew,japanese,latin,latin-ext,vietnamese|',
  'Anek Telugu|sans-serif|100..800|latin,latin-ext,telugu|',
  'Fraunces|serif|100..900|latin,latin-ext,vietnamese|i',
  'Exo 2|sans-serif|100..900|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Geist|sans-serif|100..900|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Oxygen|sans-serif|300,400,700|latin,latin-ext|',
  'Orbitron|sans-serif|400..900|latin|',
  'Urbanist|sans-serif|100..900|latin,latin-ext|i',
  'Caveat|handwriting|400..700|cyrillic,cyrillic-ext,latin,latin-ext|',
  'Hind|sans-serif|300,400,500,600,700|devanagari,latin,latin-ext|',
  'Lilita One|display|400|latin,latin-ext|',
  'DM Serif Display|serif|400|latin,latin-ext|i',
  'Source Serif 4|serif|200..900|cyrillic,cyrillic-ext,greek,latin,latin-ext,vietnamese|i',
  'Crimson Text|serif|400,600,700|latin,latin-ext,vietnamese|i',
  'Overpass|sans-serif|100..900|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Slabo 27px|serif|400|latin,latin-ext|',
  'Fredoka|sans-serif|300..700|hebrew,latin,latin-ext|',
  'Bungee|display|400|latin,latin-ext,vietnamese|',
  'Tajawal|sans-serif|200,300,400,500,700,800,900|arabic,latin|',
  'Pacifico|handwriting|400|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|',
  'Merriweather Sans|sans-serif|300..800|cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Cinzel|serif|400..900|latin,latin-ext|',
  'Instrument Sans|sans-serif|400..700|latin,latin-ext|i',
  'Barlow Semi Condensed|sans-serif|100,200,300,400,500,600,700,800,900|latin,latin-ext,vietnamese|i',
  'PT Sans Narrow|sans-serif|400,700|cyrillic,cyrillic-ext,latin,latin-ext|',
  'Arvo|serif|400,700|latin|i',
  'Lobster|display|400|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|',
  'Comfortaa|display|300..700|cyrillic,cyrillic-ext,greek,latin,latin-ext,vietnamese|',
  'Abel|sans-serif|400|latin|',
  'Chakra Petch|sans-serif|300,400,500,600,700|latin,latin-ext,thai,vietnamese|i',
  'Teko|sans-serif|300..700|devanagari,latin,latin-ext|',
  'Newsreader|serif|200..800|latin,latin-ext,vietnamese|i',
  'Epilogue|sans-serif|100..900|latin,latin-ext,vietnamese|i',
  'Geist Mono|monospace|100..900|cyrillic,cyrillic-ext,latin,latin-ext,symbols2,vietnamese|i',
  'M PLUS 1p|sans-serif|100,300,400,500,700,800,900|cyrillic,cyrillic-ext,greek,greek-ext,hebrew,japanese,latin,latin-ext,vietnamese|',
  'Asap|sans-serif|100..900|latin,latin-ext,vietnamese|i',
  'Bodoni Moda|serif|400..900|latin,latin-ext,math,symbols|i',
  'Hanken Grotesk|sans-serif|100..900|cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Lexend Deca|sans-serif|100..900|latin,latin-ext,vietnamese|',
  'Maven Pro|sans-serif|400..900|latin,latin-ext,vietnamese|',
  'Abril Fatface|display|400|latin,latin-ext|',
  'DM Mono|monospace|300,400,500|latin,latin-ext|i',
  'Almarai|sans-serif|300,400,700,800|arabic,latin|',
  'Questrial|sans-serif|400|latin,latin-ext,vietnamese|',
  'Zilla Slab|serif|300,400,500,600,700|latin,latin-ext|i',
  'Space Mono|monospace|400,700|latin,latin-ext,vietnamese|i',
  'Domine|serif|400..700|latin,latin-ext|',
  'Zen Kaku Gothic New|sans-serif|300,400,500,700,900|cyrillic,japanese,latin,latin-ext|',
  'Geologica|sans-serif|100..900|cyrillic,cyrillic-ext,greek,latin,latin-ext,vietnamese|',
  'Marcellus|serif|400|latin,latin-ext|',
  'ABeeZee|sans-serif|400|latin,latin-ext|i',
  'Play|sans-serif|400,700|cyrillic,cyrillic-ext,greek,latin,latin-ext,vietnamese|',
  'Shadows Into Light|handwriting|400|latin,latin-ext|',
  'Varela Round|sans-serif|400|hebrew,latin,latin-ext,vietnamese|',
  'Kalam|handwriting|300,400,700|devanagari,latin,latin-ext|',
  'Albert Sans|sans-serif|100..900|latin,latin-ext|i',
  'Satisfy|handwriting|400|latin|',
  'Alumni Sans|sans-serif|100..900|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Rethink Sans|sans-serif|400..800|latin,latin-ext|i',
  'Gravitas One|display|400|latin|',
  'Great Vibes|handwriting|400|cyrillic,cyrillic-ext,greek-ext,latin,latin-ext,vietnamese|',
  'Exo|sans-serif|100..900|latin,latin-ext,vietnamese|i',
  'IBM Plex Serif|serif|100,200,300,400,500,600,700|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Archivo Narrow|sans-serif|400..700|latin,latin-ext,vietnamese|i',
  'Be Vietnam Pro|sans-serif|100,200,300,400,500,600,700,800,900|latin,latin-ext,vietnamese|i',
  'Nanum Myeongjo|serif|400,700,800|korean,latin|',
  'Onest|sans-serif|100..900|cyrillic,cyrillic-ext,latin,latin-ext|',
  'League Spartan|sans-serif|100..900|latin,latin-ext,vietnamese|',
  'Cormorant|serif|300..700|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Unbounded|sans-serif|200..900|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|',
  'IBM Plex Sans Arabic|sans-serif|100,200,300,400,500,600,700|arabic,cyrillic-ext,latin,latin-ext|',
  'Frank Ruhl Libre|serif|300..900|hebrew,latin,latin-ext|',
  'Spectral|serif|200,300,400,500,600,700,800|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Crimson Pro|serif|200..900|latin,latin-ext,vietnamese|i',
  'Syne|sans-serif|400..800|greek,latin,latin-ext|',
  'Indie Flower|handwriting|400|latin,latin-ext|',
  'Zen Maru Gothic|sans-serif|300,400,500,700,900|cyrillic,greek,japanese,latin,latin-ext|',
  'Sarabun|sans-serif|100,200,300,400,500,600,700,800|latin,latin-ext,thai,vietnamese|i',
  'Encode Sans|sans-serif|100..900|latin,latin-ext,vietnamese|',
  'Permanent Marker|handwriting|400|latin|',
  'Saira Condensed|sans-serif|100,200,300,400,500,600,700,800,900|latin,latin-ext,vietnamese|',
  'Roboto Serif|serif|100..900|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Vollkorn|serif|400..900|cyrillic,cyrillic-ext,greek,latin,latin-ext,vietnamese|i',
  'Yanone Kaffeesatz|sans-serif|200..700|cyrillic,cyrillic-ext,latin,latin-ext,math,symbols,vietnamese|',
  'Signika|sans-serif|300..700|latin,latin-ext,vietnamese|',
  'Alegreya Sans|sans-serif|100,300,400,500,700,800,900|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,vietnamese|i',
  'Amiri|serif|400,700|arabic,latin,latin-ext|i',
  'Fira Sans Condensed|sans-serif|100,200,300,400,500,600,700,800,900|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,vietnamese|i',
  'Sofia Sans|sans-serif|1..1000|cyrillic,cyrillic-ext,greek,latin,latin-ext|i',
  'Literata|serif|200..900|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,vietnamese|i',
  'Catamaran|sans-serif|100..900|latin,latin-ext,tamil|',
  'Press Start 2P|display|400|cyrillic,cyrillic-ext,greek,latin,latin-ext|',
  'Unna|serif|400,700|latin,latin-ext|i',
  'Montserrat Alternates|sans-serif|100,200,300,400,500,600,700,800,900|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Luckiest Guy|display|400|latin,latin-ext|',
  'Fira Code|monospace|300..700|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,symbols2|',
  'News Cycle|sans-serif|400,700|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,vietnamese|',
  'Cardo|serif|400,700|gothic,greek,greek-ext,hebrew,latin,latin-ext,old-italic,runic|i',
  'Yellowtail|handwriting|400|latin,latin-ext|',
  'Bree Serif|serif|400|latin,latin-ext|',
  'Atkinson Hyperlegible|sans-serif|400,700|latin,latin-ext|i',
  'Rowdies|display|300,400,700|latin,latin-ext,vietnamese|',
  'DM Serif Text|serif|400|latin,latin-ext|i',
  'Righteous|display|400|latin,latin-ext|',
  'Baskervville|serif|400..700|latin,latin-ext|i',
  'Aleo|serif|100..900|latin,latin-ext,vietnamese|i',
  'Viga|sans-serif|400|latin,latin-ext|',
  'Baloo 2|display|400..800|devanagari,latin,latin-ext,vietnamese|',
  'Red Hat Text|sans-serif|300..700|latin,latin-ext|i',
  'Antic Slab|serif|400|latin|',
  'Tinos|serif|400,700|cyrillic,cyrillic-ext,greek,greek-ext,hebrew,latin,latin-ext,vietnamese|i',
  'Russo One|sans-serif|400|cyrillic,latin,latin-ext|',
  'Gothic A1|sans-serif|100,200,300,400,500,600,700,800,900|cyrillic,cyrillic-ext,greek,greek-ext,korean,latin,latin-ext,vietnamese|',
  'Hammersmith One|sans-serif|400|latin,latin-ext|',
  'Khand|sans-serif|300,400,500,600,700|devanagari,latin,latin-ext|',
  'Shippori Mincho|serif|400,500,600,700,800|japanese,latin,latin-ext|',
  'Prata|serif|400|cyrillic,cyrillic-ext,latin,vietnamese|',
  'LINE Seed JP|sans-serif|100,400,700,800|cyrillic,greek-ext,japanese,latin,latin-ext|',
  'Readex Pro|sans-serif|160..700|arabic,latin,latin-ext,vietnamese|',
  'Acme|sans-serif|400|latin|',
  'Titan One|display|400|latin,latin-ext|',
  'Sawarabi Mincho|serif|400|braille,japanese,latin,latin-ext|',
  'Alegreya|serif|400..900|cyrillic,cyrillic-ext,greek,greek-ext,latin,latin-ext,vietnamese|i',
  'Courier Prime|monospace|400,700|latin,latin-ext|i',
  'Playfair|serif|300..900|cyrillic,cyrillic-ext,latin,latin-ext,vietnamese|i',
  'Amatic SC|handwriting|400,700|cyrillic,hebrew,latin,latin-ext,vietnamese|',
  'Libre Barcode 39|display|400|latin|',
  'Zeyada|handwriting|400|latin,latin-ext|',
  'Share Tech Mono|monospace|400|latin|',
  'Rubik Mono One|sans-serif|400|cyrillic,latin,latin-ext|',
  'Chivo|sans-serif|100..900|latin,latin-ext,vietnamese|i',
  'Alata|sans-serif|400|latin,latin-ext,vietnamese|',
  'Tenor Sans|sans-serif|400|cyrillic,latin,latin-ext|',
  'Advent Pro|sans-serif|100..900|cyrillic,cyrillic-ext,greek,latin,latin-ext|i',
  'Crete Round|serif|400|latin,latin-ext|i',
  'Allura|handwriting|400|latin,latin-ext,vietnamese|',
  'Courgette|handwriting|400|latin,latin-ext|',
  'Bangers|display|400|latin,latin-ext,vietnamese|',
]
