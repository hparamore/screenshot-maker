import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import {
  isFontServerAvailable,
  listCatalog,
  listInstalled,
  installFont,
  uploadFontFiles,
  removeInstalled
} from '../utils/fontServer'

/**
 * Browse Google Fonts, download a family into public/fonts/, and drop in your own files.
 *
 * Rendered inside the font picker. `onInstalled(family)` fires after anything that changes
 * what is on disk — install, upload, remove — so the picker can refresh its list.
 *
 * The download is a one-time cost, deliberately: everything here writes to disk and nothing
 * loads at runtime from a CDN. That is what keeps PNG export working with no network, which
 * is the whole reason the app self-hosts fonts in the first place.
 */
export default function GoogleFontBrowser({ onInstalled }) {
  const languages = useStore(s => s.languages)

  const [ready, setReady] = useState(null) // null = still checking
  const [catalog, setCatalog] = useState(null)
  const [installed, setInstalled] = useState([])
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [openFamily, setOpenFamily] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const [notice, setNotice] = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const available = await isFontServerAvailable()
      if (cancelled) return
      setReady(available)
      if (!available) return
      try {
        const [cat, inst] = await Promise.all([listCatalog(), listInstalled()])
        if (cancelled) return
        setCatalog(cat)
        setInstalled(inst)
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
    })()
    return () => { cancelled = true }
  }, [])

  const installedByName = useMemo(
    () => new Map(installed.map(f => [f.family.toLowerCase(), f])),
    [installed]
  )

  const results = useMemo(() => {
    const families = catalog?.families || []
    const needle = query.trim().toLowerCase()
    return families
      .filter(f => category === 'all' || f.category === category)
      .filter(f => !needle || f.family.toLowerCase().includes(needle))
      .sort((a, b) => (a.popularity || 99999) - (b.popularity || 99999))
      .slice(0, 120)
  }, [catalog, query, category])

  async function refresh(family) {
    setInstalled(await listInstalled())
    if (family) onInstalled?.(family)
  }

  async function handleInstall(family, opts) {
    setError(null)
    setNotice(null)
    setBusy({ family: family.family, label: 'Downloading…' })
    try {
      const record = await installFont(family.family, opts)
      if (!record) {
        setError('The font server went away mid-install. Is the dev server still running?')
        return
      }
      setNotice(`${record.family} installed — ${formatBytes(record.bytes)} on disk, no network needed from here.`)
      setOpenFamily(null)
      await refresh(record.family)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function handleRemove(family) {
    setError(null)
    setNotice(null)
    setBusy({ family, label: 'Removing…' })
    try {
      await removeInstalled(family)
      setNotice(`${family} removed.`)
      await refresh(family)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  async function handleUpload(files, name) {
    setError(null)
    setNotice(null)
    setBusy({ family: 'upload', label: 'Reading files…' })
    try {
      const record = await uploadFontFiles(files, name)
      if (!record) {
        setError('The font server went away. Is the dev server still running?')
        return
      }
      setNotice(`${record.family} added from your own files.`)
      await refresh(record.family)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(null)
    }
  }

  if (ready === null) {
    return <p className="panel-hint" role="status">Checking for the font server…</p>
  }

  if (ready === false) {
    return (
      <div className="font-browser">
        <p className="panel-hint">
          <strong>Font installing needs the dev server.</strong> It downloads families to
          <code> public/fonts/</code>, which a static build has no way to do. Run
          <code> npm run dev</code> on this machine and the browser appears here.
        </p>
        <p className="panel-hint">
          Fonts already installed still work — they are plain files, served like any other
          asset, with no network involved.
        </p>
      </div>
    )
  }

  return (
    <div className="font-browser">
      {installed.length > 0 && (
        <InstalledList
          installed={installed}
          busy={busy}
          onRemove={handleRemove}
        />
      )}

      {/* Search and the category filter sit side by side once there is room for both, which
          there now is — this used to be a 280px popover where they had to stack. */}
      <div className="font-browser-controls">
        <div className="row">
          <label className="lbl" htmlFor="font-search">Search</label>
          <input
            id="font-search"
            className="text"
            type="search"
            placeholder="Family name…"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>

        {/* A filter, not a tablist — these buttons control the list below rather than swapping
            panels, so they announce as pressed toggles instead of claiming tab semantics. */}
        <div className="tabs" role="group" aria-label="Filter by category">
          {CATEGORIES.map(cat => (
            <button
              key={cat.value}
              type="button"
              aria-pressed={category === cat.value}
              className={`tab${category === cat.value ? ' active' : ''}`}
              onClick={() => setCategory(cat.value)}
            >
              {cat.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="font-browser-msg is-error" role="alert">{error}</p>}
      {notice && <p className="font-browser-msg is-ok" role="status">{notice}</p>}

      <ul className="font-result-list">
        {results.map(family => {
          const record = installedByName.get(family.family.toLowerCase())
          const isOpen = openFamily === family.family
          return (
            <li key={family.family} className={`font-result${isOpen ? ' is-open' : ''}`}>
              <button
                type="button"
                className="font-result-head"
                aria-expanded={isOpen}
                onClick={() => setOpenFamily(isOpen ? null : family.family)}
              >
                <span className="font-result-name">{family.family}</span>
                <span className="font-result-meta">
                  {record ? 'installed' : family.category.replace('-', ' ')}
                </span>
              </button>
              {isOpen && (
                <InstallForm
                  family={family}
                  languages={languages}
                  record={record}
                  busy={busy}
                  onInstall={handleInstall}
                  onRemove={handleRemove}
                />
              )}
            </li>
          )
        })}
        {!results.length && <li className="empty-state">No family matches “{query}”.</li>}
      </ul>

      <CatalogNote catalog={catalog} shown={results.length} />
      <UploadRow busy={busy} onUpload={handleUpload} />
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Install form — weights, script coverage, and what it will cost
 * ------------------------------------------------------------------ */

function InstallForm({ family, languages, record, busy, onInstall, onRemove }) {
  const suggested = useMemo(() => subsetsForLanguages(languages, family.subsets), [languages, family.subsets])
  const [weights, setWeights] = useState(() => defaultWeights(family))
  const [subsets, setSubsets] = useState(suggested)
  const [italic, setItalic] = useState(family.italic)
  const [estimate, setEstimate] = useState(null)
  const [estimating, setEstimating] = useState(false)
  const requestId = useRef(0)

  // Price the exact selection against Google's real content lengths, debounced so dragging
  // through checkboxes doesn't fire a request per click. A 14-subset family is a genuinely
  // different download from a 2-subset one and the user should see that before waiting on it.
  useEffect(() => {
    if (!weights.length || !subsets.length) {
      setEstimate(null)
      return
    }
    const id = ++requestId.current
    setEstimating(true)
    const timer = setTimeout(async () => {
      try {
        const result = await installFont(family.family, { weights, subsets, italic, dryRun: true })
        if (requestId.current === id) setEstimate(result && result.dryRun ? result : null)
      } catch {
        if (requestId.current === id) setEstimate(null)
      } finally {
        if (requestId.current === id) setEstimating(false)
      }
    }, 350)
    return () => clearTimeout(timer)
  }, [family.family, weights, subsets, italic])

  const weightChoices = family.variable ? VARIABLE_WEIGHT_STOPS.filter(
    w => w >= family.weightMin && w <= family.weightMax
  ) : family.weights

  const busyHere = busy?.family === family.family

  return (
    <div className="font-install">
      <p className="font-preview" style={{ fontFamily: `"${family.family}", sans-serif` }} aria-hidden="true">
        Ship it beautifully
      </p>
      {!record && (
        <p className="panel-hint">
          Preview shows the real face only once it is installed — nothing is fetched from a CDN
          to render this list.
        </p>
      )}

      <fieldset className="font-fieldset">
        <legend>Weights</legend>
        <div className="font-chips">
          {weightChoices.map(w => (
            <Chip
              key={w}
              label={String(w)}
              checked={weights.includes(w)}
              onChange={() => setWeights(toggle(weights, w))}
            />
          ))}
        </div>
        {family.variable && (
          <p className="panel-hint">
            Variable family — the lightest and heaviest you pick become one file covering
            everything between them.
          </p>
        )}
      </fieldset>

      <fieldset className="font-fieldset">
        <legend>Script coverage</legend>
        <div className="font-chips">
          {orderedSubsets(family.subsets, suggested).map(s => (
            <Chip
              key={s}
              label={s}
              checked={subsets.includes(s)}
              onChange={() => setSubsets(toggle(subsets, s))}
            />
          ))}
        </div>
        <p className="panel-hint">
          Preselected from this project’s languages ({languages.join(', ')}). Every extra script
          is another file per weight — this is why Inter used to embed 1.4 MB into each capture.
        </p>
      </fieldset>

      {family.italic && (
        <div className="row">
          <Chip label="Include italics" checked={italic} onChange={() => setItalic(!italic)} />
        </div>
      )}

      <p className="font-cost" role="status">
        {estimating && 'Measuring…'}
        {!estimating && estimate && (
          <>
            <strong>{estimate.approx ? '~' : ''}{formatBytes(estimate.bytes)}</strong> ·{' '}
            {estimate.files} file{estimate.files === 1 ? '' : 's'} · {estimateSeconds(estimate.bytes)}
            {estimate.files > 40 && (
              <> — a script this size is split into one file per character range, and every one
              of them gets embedded into each PNG you export.</>
            )}
          </>
        )}
        {!estimating && !estimate && (weights.length && subsets.length
          ? 'Size unavailable — the download will still work.'
          : 'Pick at least one weight and one script.')}
      </p>

      <div className="row">
        <button
          type="button"
          className="btn primary"
          disabled={Boolean(busy) || !weights.length || !subsets.length}
          onClick={() => onInstall(family, { weights, subsets, italic })}
        >
          {busyHere ? busy.label : record ? 'Reinstall with these options' : 'Install'}
        </button>
        {record && (
          <button
            type="button"
            className="btn danger small"
            disabled={Boolean(busy)}
            onClick={() => onRemove(record.family)}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ *
 * Pieces
 * ------------------------------------------------------------------ */

function InstalledList({ installed, busy, onRemove }) {
  return (
    <div className="font-installed">
      <p className="lbl-strong">Installed locally</p>
      <ul className="font-installed-list">
        {installed.map(f => (
          <li key={f.slug} className="font-installed-row">
            <span className="font-installed-name" style={{ fontFamily: `"${f.family}", sans-serif` }}>
              {f.family}
            </span>
            <span className="font-installed-meta">
              {formatBytes(f.bytes)}
              {f.source === 'upload' ? ' · yours' : ''}
            </span>
            <button
              type="button"
              className="btn ghost small"
              disabled={Boolean(busy)}
              onClick={() => onRemove(f.family)}
              aria-label={`Remove ${f.family}`}
            >
              {busy?.family === f.family ? busy.label : 'Remove'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function UploadRow({ busy, onUpload }) {
  const inputRef = useRef(null)
  const [name, setName] = useState('')

  return (
    <div className="font-upload">
      <p className="panel-hint">
        Got a licensed family that will never be on Google? Add the files directly — woff2,
        woff, ttf or otf. They are checked by their file header, not their extension, and land
        in the same place as everything else. Select every weight you want in one go: a second
        upload of the same family replaces the first.
      </p>
      <div className="row">
        <label className="lbl" htmlFor="font-upload-name">Family</label>
        <input
          id="font-upload-name"
          className="text"
          type="text"
          placeholder="Taken from the filename"
          value={name}
          onChange={e => setName(e.target.value)}
        />
      </div>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        multiple
        aria-label="Font files to add"
        accept=".woff2,.woff,.ttf,.otf,.ttc,font/woff2,font/woff,font/ttf,font/otf"
        onChange={e => {
          const files = e.target.files
          if (files?.length) onUpload(files, name.trim() || undefined)
          e.target.value = ''
        }}
      />
      <button
        type="button"
        className="btn"
        disabled={Boolean(busy)}
        onClick={() => inputRef.current?.click()}
      >
        {busy?.family === 'upload' ? busy.label : 'Choose font files…'}
      </button>
    </div>
  )
}

function CatalogNote({ catalog, shown }) {
  if (!catalog) return null
  const total = catalog.families.length
  if (catalog.source === 'fallback') {
    return (
      <p className="panel-hint">
        Showing the {total} bundled families — the live Google catalog wasn’t reachable, so this
        is the curated list that ships with the app. Everything here still installs normally.
      </p>
    )
  }
  return (
    <p className="panel-hint">
      {shown} of {total} families{shown < total ? ' — keep typing to narrow it down' : ''}.
      {catalog.source === 'stale-cache' ? ' Catalog is cached; Google wasn’t reachable to refresh it.' : ''}
    </p>
  )
}

function Chip({ label, checked, onChange }) {
  return (
    <label className={`font-chip${checked ? ' is-on' : ''}`}>
      <input type="checkbox" checked={checked} onChange={onChange} />
      <span>{label}</span>
    </label>
  )
}

/* ------------------------------------------------------------------ *
 * Defaults
 * ------------------------------------------------------------------ */

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'sans-serif', label: 'Sans' },
  { value: 'serif', label: 'Serif' },
  { value: 'display', label: 'Display' },
  { value: 'handwriting', label: 'Script' },
  { value: 'monospace', label: 'Mono' }
]

// Variable families accept any value in their range; offering every integer would be absurd,
// and these are the stops a type picker actually uses.
const VARIABLE_WEIGHT_STOPS = [100, 200, 300, 400, 500, 600, 700, 800, 900]

/**
 * Language code → Google Fonts subset. Deliberately partial: a code with no entry contributes
 * nothing, so an unrecognised locale falls back to latin rather than downloading everything.
 * Regional suffixes are stripped first, so `pt-BR` and `zh-Hant` both resolve.
 */
const LANGUAGE_SUBSETS = {
  ru: 'cyrillic', uk: 'cyrillic', bg: 'cyrillic', sr: 'cyrillic', mk: 'cyrillic', be: 'cyrillic', kk: 'cyrillic',
  el: 'greek',
  vi: 'vietnamese',
  ja: 'japanese', ko: 'korean',
  zh: 'chinese-simplified',
  ar: 'arabic', fa: 'arabic', ur: 'arabic',
  he: 'hebrew',
  hi: 'devanagari', mr: 'devanagari', ne: 'devanagari',
  th: 'thai', km: 'khmer', lo: 'lao', my: 'myanmar',
  bn: 'bengali', ta: 'tamil', te: 'telugu', kn: 'kannada', ml: 'malayalam',
  gu: 'gujarati', pa: 'gurmukhi', or: 'oriya', si: 'sinhala',
  am: 'ethiopic', hy: 'armenian', ka: 'georgian',
  // Latin scripts that need the extended block for their diacritics.
  pl: 'latin-ext', cs: 'latin-ext', sk: 'latin-ext', hu: 'latin-ext', ro: 'latin-ext',
  tr: 'latin-ext', hr: 'latin-ext', sl: 'latin-ext', lt: 'latin-ext', lv: 'latin-ext', et: 'latin-ext'
}

/**
 * The good part: a project with Russian variants gets Cyrillic, and one without doesn't pay
 * for it. Latin is always included — the UI, the fallbacks and most product names live there.
 */
function subsetsForLanguages(languages, available) {
  const wanted = new Set(['latin'])
  if (available.includes('latin-ext')) wanted.add('latin-ext')
  for (const lang of languages || []) {
    const base = String(lang).toLowerCase().split(/[-_]/)[0]
    const subset = LANGUAGE_SUBSETS[base]
    if (subset && available.includes(subset)) wanted.add(subset)
  }
  const picked = [...wanted].filter(s => available.includes(s))
  return picked.length ? picked : [available[0]]
}

/**
 * Google lists subsets in its own order, which buries `latin` behind four Cyrillic variants on
 * a family like Roboto. The ones this project actually needs come first; the rest stay
 * available in a stable alphabetical order behind them.
 */
function orderedSubsets(available, suggested) {
  const lead = suggested.filter(s => available.includes(s))
  const rest = available.filter(s => !lead.includes(s)).sort()
  return [...lead, ...rest]
}

/** Regular plus a bold, because a headline and a preheader is the shape of every frame here. */
function defaultWeights(family) {
  if (family.variable) {
    const stops = VARIABLE_WEIGHT_STOPS.filter(w => w >= family.weightMin && w <= family.weightMax)
    return [stops.includes(400) ? 400 : stops[0], stops.includes(700) ? 700 : stops[stops.length - 1]]
      .filter((w, i, a) => a.indexOf(w) === i)
  }
  const has = family.weights
  const picked = [has.includes(400) ? 400 : has[0], has.includes(700) ? 700 : null].filter(Boolean)
  return [...new Set(picked)]
}

function toggle(list, value) {
  return list.includes(value) ? list.filter(v => v !== value) : [...list, value].sort((a, b) => (a > b ? 1 : -1))
}

function formatBytes(bytes) {
  if (!bytes) return '0 KB'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * A stated assumption beats fake precision. The size is exact — measured against Google's
 * real content lengths — but the time depends on a connection nobody here can see, so the
 * figure it is derived from is named rather than hidden.
 */
function estimateSeconds(bytes) {
  const seconds = bytes / (2 * 1024 * 1024)
  if (seconds < 1.5) return 'about a second on a 16 Mbps line'
  return `about ${Math.ceil(seconds)}s on a 16 Mbps line`
}
