import { useStore, makeScreenshot, migratePersistedState } from '../store'

export const PROJECT_SCHEMA_VERSION = 1

const APP_ID = 'screenshot-maker'
const FILE_EXT = '.smproj.json'
const API_BASE = '/api/projects'

// Mirrors the zustand `persist` partialize list. Ephemeral UI state (selection, zoom mode,
// crop editing) is deliberately absent — a project file describes the document, not the session.
const PERSISTED_KEYS = ['exportSize', 'languages', 'activeLanguage', 'screenshots', 'templates']

/* ------------------------------------------------------------------ *
 * Shape
 * ------------------------------------------------------------------ */

export function serializeProject(name) {
  const s = useStore.getState()
  const state = {}
  for (const key of PERSISTED_KEYS) state[key] = s[key]

  return {
    app: APP_ID,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    name: (name || 'Untitled').trim() || 'Untitled',
    savedAt: new Date().toISOString(),
    state
  }
}

/**
 * Validate, then hand `state` to the store wholesale.
 *
 * The spread is intentional and load-bearing: nothing here enumerates screenshot or template
 * fields, so any field the model grows later round-trips through save/open without this file
 * needing to learn about it. Copying field-by-field would silently drop new work.
 *
 * Selection ids are cleared because they point at screenshots from the *previous* document.
 *
 * `migratePersistedState` runs first for the same reason zustand runs it on rehydration: a file
 * written before a field existed has to be brought up to the current shape, and it is the same
 * shape either way. It backfills rather than allowlists, so the wholesale spread above survives.
 */
export function applyProject(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj) || obj.app !== APP_ID) {
    throw new Error("This file isn't a Screenshot Maker project.")
  }

  const version = obj.schemaVersion
  if (typeof version !== 'number' || !Number.isFinite(version)) {
    throw new Error("This project file is missing its version number and can't be opened.")
  }
  if (version > PROJECT_SCHEMA_VERSION) {
    throw new Error('Saved by a newer version of Screenshot Maker. Update the app to open this project.')
  }

  const state = obj.state
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    throw new Error('This project file has no saved state in it.')
  }
  if (!Array.isArray(state.screenshots) || state.screenshots.length === 0) {
    throw new Error('This project file has no screenshots in it.')
  }

  const migrated = migratePersistedState(state)
  useStore.setState({ ...migrated, selectedId: null, selectedOverlayId: null })
  return obj.name || 'Untitled'
}

/** Back to a single blank frame. Destructive — callers must confirm first. */
export function resetProject() {
  useStore.setState({
    languages: ['en'],
    activeLanguage: 'en',
    screenshots: [makeScreenshot()],
    templates: [],
    selectedId: null,
    selectedOverlayId: null
  })
}

/**
 * Fire `onChange` whenever the document changes — ignoring selection, zoom mode and other
 * session-only state, so merely clicking a frame doesn't read as an unsaved edit.
 * Returns the unsubscribe function.
 */
export function watchProjectState(onChange) {
  const snapshot = (s) => PERSISTED_KEYS.map(k => s[k])
  let previous = snapshot(useStore.getState())

  return useStore.subscribe((s) => {
    const next = snapshot(s)
    // Reference equality is enough: every store mutation replaces the slices it touches.
    if (next.some((value, i) => value !== previous[i])) {
      previous = next
      onChange()
    }
  })
}

export function projectFilename(name) {
  const safe = String(name || 'Untitled').replace(/[^A-Za-z0-9 _.-]/g, '_').trim() || 'Untitled'
  return safe + FILE_EXT
}

/* ------------------------------------------------------------------ *
 * Browser fallbacks — work with no dev server at all
 * ------------------------------------------------------------------ */

export function downloadProjectFile(obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = projectFilename(obj?.name)
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoking synchronously races the download in Safari.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function readProjectFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("That file couldn't be read."))
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result)))
      } catch {
        reject(new Error("That file isn't valid JSON, so it can't be a project file."))
      }
    }
    reader.readAsText(file)
  })
}

/* ------------------------------------------------------------------ *
 * Dev-server file API
 *
 * Every call degrades instead of throwing when the API isn't there — running the built app
 * under `npm run preview` (or any static host) hits the SPA fallback and gets HTML back, not
 * JSON. That case returns a `null`/`false` sentinel so the UI can quietly offer
 * import/export instead of showing the user an error they can't act on.
 * ------------------------------------------------------------------ */

/** Why the file API isn't usable — drives the wording of the fallback note in the UI. */
export const API_ABSENT = 'absent'
export const API_REMOTE = 'remote'

class ApiUnavailable extends Error {
  constructor(reason) {
    super(reason)
    this.reason = reason
  }
}

// The wrappers below flatten ApiUnavailable into a null/false sentinel, which loses the
// reason. Recording it here lets the UI explain *which* kind of unavailable it hit without
// changing four return shapes. Read it right after a call returns its sentinel — it always
// describes the most recent attempt.
let lastUnavailableReason = API_ABSENT

export function fileApiUnavailableReason() {
  return lastUnavailableReason
}

function unavailable(reason) {
  lastUnavailableReason = reason
  return new ApiUnavailable(reason)
}

async function apiCall(url, options) {
  let res
  try {
    res = await fetch(url, options)
  } catch {
    throw unavailable(API_ABSENT)
  }

  // `npm run dev:lan` serves the app to the whole network but the file API stays loopback-only
  // (vite-plugin-project-files.js), so a phone gets a 403 on every call. From that device there
  // is no file server it can ever reach — the same situation as no API at all, and the same
  // graceful download/upload fallback. Only 403; 400/404/413/500 are real answers to a real
  // request and must keep surfacing their messages.
  if (res.status === 403) throw unavailable(API_REMOTE)

  // The SPA fallback answers 200 text/html; anything non-JSON means "no API here".
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) throw unavailable(API_ABSENT)

  let data
  try {
    data = await res.json()
  } catch {
    throw unavailable(API_ABSENT)
  }

  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`)
  return data
}

const projectUrl = (name) => `${API_BASE}/${encodeURIComponent(name)}`

/** @returns array of `{ name, savedAt, size }`, or null when there is no file API. */
export async function listServerProjects() {
  try {
    const data = await apiCall(API_BASE)
    return Array.isArray(data?.projects) ? data.projects : []
  } catch (err) {
    if (err instanceof ApiUnavailable) return null
    throw err
  }
}

/** @returns true on success, false when there is no file API. Throws on a real server error. */
export async function saveToServer(name, obj) {
  try {
    await apiCall(projectUrl(name), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(obj)
    })
    return true
  } catch (err) {
    if (err instanceof ApiUnavailable) return false
    throw err
  }
}

/** @returns the parsed project, or null when there is no file API. */
export async function loadFromServer(name) {
  try {
    return await apiCall(projectUrl(name))
  } catch (err) {
    if (err instanceof ApiUnavailable) return null
    throw err
  }
}

/** @returns true on success, false when there is no file API. */
export async function deleteFromServer(name) {
  try {
    await apiCall(projectUrl(name), { method: 'DELETE' })
    return true
  } catch (err) {
    if (err instanceof ApiUnavailable) return false
    throw err
  }
}
