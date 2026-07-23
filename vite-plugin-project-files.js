import fs from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const EXT = '.smproj.json'

// Deliberately narrow: letters, digits, space, underscore, dot, hyphen. No slashes, no
// backslashes, no NUL. This is the first of two gates — see resolveProjectPath.
const NAME_PATTERN = /^[A-Za-z0-9 _.-]{1,64}$/

// Projects embed dropped screenshots as data URLs, so a real one can be tens of megabytes.
const MAX_BODY_BYTES = 64 * 1024 * 1024

// Methods that change something on disk. Everything here needs the extra Origin gate below.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(body)
}

/* ------------------------------------------------------------------ *
 * Access control
 *
 * This API has no authentication and it reads, overwrites and deletes files. Three
 * independent gates keep that honest, because each one covers a hole the others don't:
 *
 *   1. Socket address — the only real gate. Nothing off this machine gets in, no matter
 *      what vite.config.js sets `server.host` to. Everything else is browser-layer.
 *   2. Host header — blocks DNS rebinding. An attacker's domain can be made to resolve to
 *      127.0.0.1, at which point the socket looks local; the Host header still says
 *      evil.example, and browsers won't let a page forge it.
 *   3. Origin header on writes — blocks plain CSRF from any page the user has open.
 * ------------------------------------------------------------------ */

/** 127.0.0.0/8 (all of it, not just .1), ::1, and the v4-mapped-in-v6 spelling of both. */
function isLoopbackAddress(address) {
  if (typeof address !== 'string' || !address) return false
  let host = address.trim().toLowerCase()
  if (host.startsWith('[') && host.endsWith(']')) host = host.slice(1, -1)
  // Node reports v4 peers on a dual-stack listener as "::ffff:127.0.0.1".
  if (host.startsWith('::ffff:')) host = host.slice(7)
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
}

/** "localhost", "*.localhost" (RFC 6761 — always resolves locally), or a loopback literal. */
function isLoopbackHostname(hostname) {
  if (typeof hostname !== 'string' || !hostname) return false
  const host = hostname.trim().toLowerCase()
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  return isLoopbackAddress(host)
}

/** Strips the port from a Host header value, minding the [::1]:5173 bracket form. */
function hostnameFromHostHeader(value) {
  if (typeof value !== 'string' || !value) return ''
  const host = value.trim()
  if (host.startsWith('[')) {
    const end = host.indexOf(']')
    return end === -1 ? '' : host.slice(0, end + 1)
  }
  return host.split(':')[0]
}

/**
 * @returns null when the request may proceed, or `{ status, error }` to reject it with.
 */
function checkAccess(req) {
  if (!isLoopbackAddress(req.socket?.remoteAddress)) {
    return {
      status: 403,
      error: 'The project file API only answers requests from this machine (loopback).'
    }
  }

  if (!isLoopbackHostname(hostnameFromHostHeader(req.headers.host))) {
    return {
      status: 403,
      error: 'Unexpected Host header. Reach this API as localhost or 127.0.0.1.'
    }
  }

  // Absent Origin is normal for curl and for same-origin navigations; browsers always
  // attach one to a cross-origin fetch or form post, which is the case we care about.
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
      return {
        status: 403,
        error: 'Cross-origin writes are not allowed against the project file API.'
      }
    }
  }

  return null
}

/**
 * Two independent gates, because either one alone is a footgun: the pattern still admits
 * "." and "..", and a pattern-only check would silently break if the pattern is ever
 * loosened. The resolved-path containment check is what actually makes traversal impossible.
 */
function resolveProjectPath(projectsDir, rawName) {
  if (typeof rawName !== 'string') return null
  const name = rawName.trim()
  if (!NAME_PATTERN.test(name)) return null
  if (name === '.' || name === '..') return null

  const file = path.resolve(projectsDir, name + EXT)
  // The file must live directly in projectsDir — not in a subdirectory, not above it.
  if (path.dirname(file) !== path.resolve(projectsDir)) return null
  return file
}

/**
 * Send a response and then hang up. Used for oversized uploads: the client is still
 * streaming a body nobody is reading, so the socket has to go — but only *after* the
 * status line has flushed, otherwise the client sees a reset instead of the 413.
 */
function sendJsonAndClose(req, res, status, payload) {
  res.setHeader('Connection', 'close')
  res.on('finish', () => { req.socket?.destroy() })
  sendJson(res, status, payload)
}

function tooLargeError() {
  const err = new Error(`Project is larger than ${Math.round(MAX_BODY_BYTES / 1024 / 1024)} MB`)
  err.status = 413
  return err
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let settled = false

    // Cheapest rejection: a declared Content-Length over the cap needs no bytes read at all.
    const declared = Number(req.headers['content-length'])
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      reject(tooLargeError())
      return
    }

    req.on('data', (chunk) => {
      if (settled) return
      size += chunk.length
      // Backstop for chunked uploads and for a Content-Length that lied.
      if (size > MAX_BODY_BYTES) {
        settled = true
        reject(tooLargeError())
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

/**
 * Write to a sibling temp file and rename over the target. rename(2) is atomic within a
 * filesystem, so a save interrupted halfway can never leave a half-written project behind.
 */
async function writeAtomic(file, contents) {
  const tmp = `${file}.${process.pid}-${crypto.randomBytes(4).toString('hex')}.tmp`
  try {
    await fs.writeFile(tmp, contents, 'utf8')
    await fs.rename(tmp, file)
  } catch (err) {
    await fs.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

export default function projectFilesPlugin(options = {}) {
  let projectsDir = ''

  return {
    name: 'screenshot-maker:project-files',
    // Dev only. The production build has no server to host this, and the client degrades
    // to download/upload when the API answers with anything that isn't our JSON.
    apply: 'serve',

    configResolved(config) {
      projectsDir = path.resolve(config.root, options.dir || 'projects')
    },

    configureServer(server) {
      // Mounted with a path prefix, so req.url arrives here already stripped of it:
      // "/api/projects" -> "/", "/api/projects/My App" -> "/My App".
      server.middlewares.use('/api/projects', async (req, res, next) => {
        try {
          // Before anything else — including reading a body we may be about to refuse.
          const denied = checkAccess(req)
          if (denied) {
            return sendJsonAndClose(req, res, denied.status, { error: denied.error })
          }

          const [rawPath] = (req.url || '/').split('?')
          let name = null
          try {
            name = decodeURIComponent(rawPath.replace(/^\//, ''))
          } catch {
            return sendJson(res, 400, { error: 'Malformed project name' })
          }

          const method = (req.method || 'GET').toUpperCase()

          // ---- collection: GET /api/projects
          if (!name) {
            if (method !== 'GET') {
              res.setHeader('Allow', 'GET')
              return sendJson(res, 405, { error: `${method} not allowed here` })
            }
            let entries = []
            try {
              entries = await fs.readdir(projectsDir)
            } catch (err) {
              // No projects/ yet is a normal empty state, not an error.
              if (err.code !== 'ENOENT') throw err
            }
            const projects = []
            for (const entry of entries) {
              if (!entry.endsWith(EXT)) continue
              const full = path.join(projectsDir, entry)
              let stat
              try {
                stat = await fs.stat(full)
              } catch {
                continue
              }
              if (!stat.isFile()) continue
              projects.push({
                name: entry.slice(0, -EXT.length),
                // mtime rather than the savedAt inside the file: listing must not parse
                // every project, and projects are large enough that it would show.
                savedAt: stat.mtime.toISOString(),
                size: stat.size
              })
            }
            projects.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
            return sendJson(res, 200, { projects })
          }

          // ---- item: GET / POST / DELETE /api/projects/:name
          const file = resolveProjectPath(projectsDir, name)
          if (!file) {
            return sendJson(res, 400, {
              error: 'Invalid project name. Use letters, numbers, spaces, dots, dashes or underscores (max 64).'
            })
          }

          if (method === 'GET') {
            let text
            try {
              text = await fs.readFile(file, 'utf8')
            } catch (err) {
              if (err.code === 'ENOENT') return sendJson(res, 404, { error: 'Project not found' })
              throw err
            }
            let parsed
            try {
              parsed = JSON.parse(text)
            } catch {
              return sendJson(res, 422, { error: 'That project file is not valid JSON' })
            }
            return sendJson(res, 200, parsed)
          }

          if (method === 'POST' || method === 'PUT') {
            let raw
            try {
              raw = await readBody(req)
            } catch (err) {
              return sendJsonAndClose(req, res, err.status || 400, {
                error: err.message || 'Could not read request body'
              })
            }
            let parsed
            try {
              parsed = JSON.parse(raw)
            } catch {
              return sendJson(res, 400, { error: 'Request body was not valid JSON' })
            }
            await fs.mkdir(projectsDir, { recursive: true })
            await writeAtomic(file, JSON.stringify(parsed, null, 2))
            const stat = await fs.stat(file)
            return sendJson(res, 200, {
              ok: true,
              name: path.basename(file, EXT),
              savedAt: stat.mtime.toISOString(),
              size: stat.size
            })
          }

          if (method === 'DELETE') {
            try {
              await fs.unlink(file)
            } catch (err) {
              if (err.code === 'ENOENT') return sendJson(res, 404, { error: 'Project not found' })
              throw err
            }
            return sendJson(res, 200, { ok: true })
          }

          res.setHeader('Allow', 'GET, POST, DELETE')
          return sendJson(res, 405, { error: `${method} not allowed here` })
        } catch (err) {
          // A bad request must never take the dev server down with it.
          server.config.logger.error(`[project-files] ${err?.stack || err}`)
          if (res.headersSent) return next(err)
          return sendJson(res, 500, { error: err?.message || 'Internal error' })
        }
      })
    }
  }
}
