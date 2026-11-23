/**
 * Host half for @local/dsh-redmark.
 *
 * The bookmark UI lives entirely in the browser half. This half only exposes a
 * tiny same-origin JSON endpoint so bookmarks survive a restart or a change of
 * the web-server port (browser localStorage is scoped to scheme+host+port).
 *
 * The endpoint is strictly best-effort: if it cannot be mounted, or the browser
 * cannot reach it, the client half keeps working from localStorage alone.
 *
 * Note: a `{ kind, path, resource }` route only answers GET/HEAD (POST is
 * rejected by the carrier with 405), so this registers a raw `handler` route
 * instead, which owns the full response lifecycle and accepts POST.
 */
import { readFile, writeFile, rename, mkdir, appendFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const FILE = join(HOME, 'dsh-redmark.json')
/* Legacy file from the Session Bookmarks era: read on first load so upgrading the
 * bundle never makes existing bookmarks appear to vanish. Writes only ever go to
 * the new FILE. */
const LEGACY_FILE = join(HOME, 'session-bookmarks.json')
/* Jump/find diagnostics: the browser half posts a compact trace that is
 * appended here, so one manual test leaves a readable record on disk. Delete
 * this, the consts below and `traceHandler` to retire the channel. */
const TRACE = join(HOME, 'dsh-redmark-trace.log')
const TRACE_MAX_BYTES = 1024 * 1024
const ROUTE = '/dsh-redmark'
/* A legal list is MAX_LIST * (id + note + anchor fields) which is far above the
 * old 256 KiB: a big session was answered with 413, the mirror backed off and
 * the browser copy silently became the only copy. */
const MAX_BODY = 4 * 1024 * 1024
const MAX_LIST = 500
const MAX_NOTE = 2000
/* Refuse to let a forged session id grow the file without bound. */
const MAX_DB_BYTES = 16 * 1024 * 1024
const SESSION_ID = /^[A-Za-z0-9_.:@-]{1,160}$/

/** Per-session bookmark lists, keyed by session id (null prototype: a
 *  `__proto__` session id must never touch the prototype chain). */
let cache = Object.create(null)
let loaded = false
/* Set when the file exists but could not be read or parsed. Persisting on top
 * of that state would replace real bookmarks with a single-session snapshot. */
let readFailed = false

function plainDb(parsed) {
  const db = Object.create(null)
  if (!parsed || typeof parsed !== 'object') return db
  for (const key of Object.keys(parsed)) {
    if (!SESSION_ID.test(key)) continue
    const list = sanitize(parsed[key])
    if (list.length) db[key] = list
  }
  return db
}

/* A second concurrent request must await the first read instead of parsing the
 * file again: two interleaved loads used to race `cache` and one of them could
 * persist a half-loaded snapshot over the whole file. */
let loading = null

async function load() {
  if (loaded) return cache
  if (loading) return loading
  loading = (async () => {
    let text = null
    try {
      text = await readFile(FILE, 'utf8')
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        /* First run under the new name: adopt the legacy Session Bookmarks file
         * if one exists, so upgrading the bundle does not lose bookmarks. */
        try {
          text = await readFile(LEGACY_FILE, 'utf8')
        } catch { text = null }
      } else {
        /* EACCES, EISDIR, ENOSPC: the real file may still hold data we failed to
         * read -- starting empty and then persisting would overwrite it, so keep
         * the cache unusable and skip writes instead. Deliberately NOT marking
         * `loaded`: a transient EACCES or EISDIR (a file being replaced by a
         * directory, an antivirus lock) must be retried on the next request
         * instead of permanently poisoning this process. */
        readFailed = true
        cache = Object.create(null)
        return cache
      }
    }
    if (text === null) {
      /* No file yet (first run, or one deleted meanwhile): writing is safe. */
      readFailed = false
      cache = Object.create(null)
    } else {
      try {
        cache = plainDb(JSON.parse(text))
        /* The file parsed, so a previous transient failure is over: allow
         * persisting again instead of staying read-only for the whole run. */
        readFailed = false
      } catch {
        /* Corrupt JSON: preserve the bytes for inspection rather than letting
         * the next persist() replace them with an empty store. */
        readFailed = true
        try { await rename(FILE, FILE + '.corrupt-' + Date.now()) } catch { /* keep file */ }
        cache = Object.create(null)
      }
    }
    loaded = true
    return cache
  })()
  try {
    return await loading
  } finally {
    loading = null
  }
}

let writeChain = Promise.resolve()

async function persist() {
  if (readFailed) {
    /* Keep the unreadable file untouched; the client's own copy still works. */
    return Promise.resolve()
  }
  const snapshot = JSON.stringify(cache, null, 2)
  if (Buffer.byteLength(snapshot) > MAX_DB_BYTES) {
    /* Refusing to write beats truncating: the browser copy is still complete. */
    return Promise.reject(new Error('store too large'))
  }
  writeChain = writeChain.catch(() => {}).then(async () => {
    try {
      await mkdir(HOME, { recursive: true })
      const tmp = FILE + '.tmp'
      await writeFile(tmp, snapshot, 'utf8')
      await rename(tmp, FILE)
    } catch {
      /* durability is best-effort: the browser half still owns the live copy */
    }
  })
  return writeChain
}

function clipNote(note) {
  if (typeof note !== 'string') return ''
  return note.length > MAX_NOTE ? note.slice(0, MAX_NOTE) : note
}

function clipText(value, max) {
  if (typeof value !== 'string' || !value) return undefined
  return value.length > max ? value.slice(0, max) : value
}

function sanitize(list) {
  if (!Array.isArray(list)) return []
  const out = []
  const seen = new Set()
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    if (!Number.isSafeInteger(raw.turn)) continue
    let id = typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 120) : 'bm-' + out.length
    /* A single `-<n>` suffix was not enough: after an earlier clash the same
     * suffixed id could already be present, so the loop below appends until the
     * id is genuinely unique (two equal ids made a delete hit the wrong row). */
    if (seen.has(id)) {
      let suffix = out.length
      do {
        id = (typeof raw.id === 'string' && raw.id ? raw.id.slice(0, 110) : 'bm') + '-' + suffix
        suffix += 1
      } while (seen.has(id))
    }
    seen.add(id)
    /* A passage bookmark carries a DOM anchor. Dropping those fields turned
     * every saved passage into a plain turn note on the next reload, so the
     * mirror keeps them exactly like the browser half does. */
    const kind = raw.kind === 'text' ? 'text' : 'turn'
    out.push({
      id,
      turn: raw.turn,
      seq: Number.isSafeInteger(raw.seq) ? raw.seq : undefined,
      note: clipNote(raw.note),
      createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString(),
      kind,
      nodeKey: kind === 'text' ? clipText(raw.nodeKey, 200) : undefined,
      quote: clipText(raw.quote, 600),
      start: Number.isSafeInteger(raw.start) ? raw.start : undefined,
      end: Number.isSafeInteger(raw.end) ? raw.end : undefined,
      prefix: clipText(raw.prefix, 40),
      suffix: clipText(raw.suffix, 40),
      sessionTitle: clipText(raw.sessionTitle, 120),
    })
    if (out.length >= MAX_LIST) break
  }
  return out
}

function send(res, status, body, extraHeaders) {
  let payload = ''
  try {
    payload = JSON.stringify(body)
  } catch {
    payload = '{}'
  }
  const headers = Object.assign(
    {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-length': String(Buffer.byteLength(payload)),
    },
    extraHeaders || {},
  )
  try {
    res.writeHead(status, headers)
    res.end(payload)
  } catch {
    try { res.end() } catch { /* socket already gone */ }
  }
}

/** Resolves the request body, or `null` when it exceeds MAX_BODY. */
function readBody(req) {
  return new Promise((resolve) => {
    let size = 0
    let done = false
    const chunks = []
    const finish = (value) => {
      if (done) return
      done = true
      resolve(value)
    }
    req.on('data', (chunk) => {
      if (done) return
      size += chunk.length
      if (size > MAX_BODY) {
        // Stop reading and let the handler answer 413; it drains/destroys after.
        try { req.pause() } catch { /* not a stream any more */ }
        finish(null)
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => finish(null))
    req.on('aborted', () => finish(null))
  })
}

/** Same-origin only: a third-party page must not be able to write bookmarks. */
function sameOrigin(req) {
  const site = req.headers['sec-fetch-site']
  if (site && site !== 'same-origin' && site !== 'none') return false
  const origin = req.headers.origin
  if (!origin) return true
  try {
    return new URL(origin).host === req.headers.host
  } catch {
    return false
  }
}

/* Size of TRACE as this process last left it; re-reading a 1 MB log on every
 * flush was both wasteful and racy when two flushes overlap. */
let traceSize = -1

async function appendTrace(lines) {
  const list = []
  for (const line of lines) {
    if (typeof line !== 'string' || !line) continue
    list.push(line.slice(0, 400))
    if (list.length >= 200) break
  }
  if (!list.length) return
  const stamp = new Date().toISOString()
  const text = list.map((line) => stamp + ' ' + line).join('\n') + '\n'
  try {
    await mkdir(HOME, { recursive: true })
    if (traceSize < 0) {
      try {
        const stat = await stat(TRACE)
        traceSize = stat && Number.isFinite(stat.size) ? stat.size : 0
      } catch {
        traceSize = 0
      }
    }
    if (traceSize + Buffer.byteLength(text) > TRACE_MAX_BYTES) {
      await writeFile(TRACE, text, 'utf8')
      traceSize = Buffer.byteLength(text)
      return
    }
    await appendFile(TRACE, text, 'utf8')
    traceSize += Buffer.byteLength(text)
  } catch {
    traceSize = -1
    /* diagnostics must never break the plugin */
  }
}

/** POST /dsh-redmark/trace — append one test run's diagnostic lines. */
async function traceHandler(req, res) {
  if (req.method !== 'POST') return send(res, 405, { error: 'method not allowed' }, { allow: 'POST' })
  if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden' })
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return send(res, 415, { error: 'application/json required' })
  }
  const raw = await readBody(req)
  if (raw === null) return send(res, 413, { error: 'payload too large' })
  let body = null
  try {
    body = JSON.parse(raw)
  } catch {
    body = null
  }
  if (!body || !Array.isArray(body.lines)) return send(res, 400, { error: 'lines[] is required' })
  await appendTrace(body.lines)
  return send(res, 200, { ok: true, written: Math.min(body.lines.length, 200) })
}

async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname === ROUTE + '/trace') return traceHandler(req, res)
    const sessionId = url.searchParams.get('sessionId') || ''
    if (!SESSION_ID.test(sessionId)) return send(res, 400, { error: 'invalid session id' })
    if (!sameOrigin(req)) return send(res, 403, { error: 'forbidden' })

    const db = await load()

    if (req.method === 'GET' || req.method === 'HEAD') {
      const bookmarks = Array.isArray(db[sessionId]) ? db[sessionId] : []
      if (req.method === 'HEAD') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
        return res.end()
      }
      return send(res, 200, { bookmarks })
    }

    if (req.method === 'POST') {
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
        return send(res, 415, { error: 'application/json required' })
      }
      const raw = await readBody(req)
      if (raw === null) return send(res, 413, { error: 'payload too large' })
      let body = null
      try {
        body = JSON.parse(raw)
      } catch {
        body = null
      }
      if (!body || !Array.isArray(body.bookmarks)) {
        return send(res, 400, { error: 'bookmarks[] is required' })
      }
      const list = sanitize(body.bookmarks)
      /* An empty payload replacing a non-empty list is almost always an
       * accident (a failed client read, a stale tab) rather than "I deleted
       * everything". It really did erase a whole session here. So keep the
       * previous copy aside before honouring it -- the write still succeeds,
       * but the data is no longer gone. */
      const previous = Array.isArray(db[sessionId]) ? db[sessionId] : []
      if (list.length === 0 && previous.length > 0) {
        const keep = FILE + '.erased-' + Date.now()
        try {
          await mkdir(HOME, { recursive: true })
          await writeFile(keep, JSON.stringify({ [sessionId]: previous }, null, 2), 'utf8')
        } catch { /* best effort */ }
        await appendTrace(['store: emptying ' + sessionId + ' (' + previous.length + ' -> 0), copy kept at ' + keep])
      }
      db[sessionId] = list
      /* Report whether the write reached the disk: a 200 that silently dropped
       * the write made the mirror look healthy while the file fell behind. */
      let durable = true
      try {
        await persist()
      } catch {
        durable = false
      }
      return send(res, durable ? 200 : 507, {
        bookmarks: list,
        durable,
        truncated: Array.isArray(body.bookmarks) && body.bookmarks.length > list.length,
      })
    }

    return send(res, 405, { error: 'method not allowed' }, { allow: 'GET, HEAD, POST' })
  } catch {
    return send(res, 500, { error: 'internal error' })
  }
}

/** The web runtime must be ready before the mirror endpoint can mount. */
export const inject = ['webServer']

export function apply(ctx) {
  const webServer = ctx.webServer || ctx.get('webServer')
  if (!webServer || typeof webServer.register !== 'function') {
    try {
      const logger = ctx.get('logger')
      if (logger && typeof logger.warn === 'function') {
        logger.warn('dsh-redmark: webServer unavailable, durability mirror disabled')
      }
    } catch { /* logging is optional */ }
    return
  }
  ctx.effect(() => {
    try {
      return webServer.register({ kind: 'prefix', path: ROUTE, handler })
    } catch {
      return () => {}
    }
  }, 'dsh-redmark: web endpoint')
}
