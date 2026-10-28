/**
 * Host half of dsh-session-actions.
 *
 * A small local-only admin surface for the Web GUI sidebar: it can move one
 * Session (a "task" row) to another workspace, or remove it from the sidebar
 * and move its log directory into <DSH_HOME>/trash/sessions.
 *
 * The browser half calls these routes with a custom header so an arbitrary
 * web page cannot trigger them cross-origin. Everything stays on the loopback
 * listener the Web host already binds.
 *
 * @module dsh-session-actions
 */
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import zlib from 'node:zlib'

/** Stable Cordis plugin name. */
export const name = 'session-actions'

/** The Web server owns the route table this plugin contributes to. */
export const inject = ['webServer']

/** Every route this plugin serves lives under this prefix. */
const ROUTE_PREFIX = '/x-session-actions'

/** Zstandard frame magic, used to split the append-only session log. */
const ZSTD_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/** Encode one path segment the way the JSONL persistence backend does. */
function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (const ch of raw) {
    const code = ch.charCodeAt(0)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0')
  }
  return out
}

/** Build the human-navigable project directory key for one cwd. */
function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0')
      separatorRun = false
    }
  }
  return '--' + (readable.replace(/^-+/, '') || 'root').slice(0, 251) + '--'
}

/** Compare two Windows/POSIX paths for identity. */
function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const a = left.replace(/[\\/]+$/, '')
  const b = right.replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
}

/** Resolve the Harness home directory for this process. */
function resolveHome(ctx) {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return env.trim()
  try {
    const service = ctx.get('homePaths')
    const candidate = service?.home ?? service?.dshHome ?? service?.root
    if (typeof candidate === 'string' && candidate !== '') return candidate
  } catch {
    /* optional service */
  }
  return join(homedir(), '.dsh')
}

/** The workspace registry, or a clear failure. */
function registryOf(ctx) {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined || registry === null) throw new Error('工作区注册表不可用')
  return registry
}

/** Drop cached header identity so a re-read picks up the rewritten log. */
function invalidateCachedHeader(registry, sessionId) {
  for (const key of ['headers', 'sessionPaths', 'invalidSessionPaths', 'missingSessionPaths']) {
    const table = registry[key]
    if (table instanceof Map || table instanceof Set) table.delete(sessionId)
  }
}

/** Directory entries, never throwing. */
async function directories(path) {
  try {
    return await readdir(path, { withFileTypes: true })
  } catch {
    return []
  }
}

/** The log file inside one session directory. */
async function logFileOf(dir) {
  const entries = await readdir(dir)
  const hit = entries.find(
    (entry) => entry.startsWith('session.v') && (entry.endsWith('.jsonl.zstd') || entry.endsWith('.jsonl'))
  )
  if (hit === undefined) throw new Error('会话日志文件缺失')
  return join(dir, hit)
}

/** End offset of the first Zstandard frame in an append-only log. */
function firstFrameEnd(buffer) {
  let probe = buffer.indexOf(ZSTD_MAGIC, 4)
  while (probe > 0) {
    try {
      const decoded = zlib.zstdDecompressSync(buffer.subarray(0, probe))
      if (decoded.length > 0) return probe
    } catch {
      /* not a frame boundary */
    }
    probe = buffer.indexOf(ZSTD_MAGIC, probe + 1)
  }
  return buffer.length
}

/** Read the persisted session header (the first JSONL record). */
async function readHeader(dir) {
  const file = await logFileOf(dir)
  const buffer = await readFile(file)
  let text
  if (file.endsWith('.zstd')) {
    const end = firstFrameEnd(buffer)
    text = zlib.zstdDecompressSync(buffer.subarray(0, end)).toString('utf8')
  } else {
    const newline = buffer.indexOf(0x0a)
    text = buffer.subarray(0, newline < 0 ? buffer.length : newline).toString('utf8')
  }
  const line = text.split('\n')[0]
  if (line.trim() === '') throw new Error('会话日志头部为空')
  return JSON.parse(line)
}

/** Rewrite the header's cwd while preserving every later frame byte-for-byte. */
async function writeHeaderCwd(dir, cwd) {
  const file = await logFileOf(dir)
  const buffer = await readFile(file)
  if (!file.endsWith('.zstd')) {
    const text = buffer.toString('utf8')
    const newline = text.indexOf('\n')
    const line = newline < 0 ? text : text.slice(0, newline)
    const header = JSON.parse(line)
    const rest = newline < 0 ? '' : text.slice(newline)
    await writeFile(file, JSON.stringify({ ...header, cwd }) + (rest === '' ? '\n' : rest), 'utf8')
    return header
  }
  const end = firstFrameEnd(buffer)
  const decoded = zlib.zstdDecompressSync(buffer.subarray(0, end)).toString('utf8')
  const lines = decoded.split('\n').filter((line) => line.trim() !== '')
  if (lines.length !== 1) throw new Error('会话日志头部包含额外记录，无法安全改写')
  const header = JSON.parse(lines[0])
  const frame = zlib.zstdCompressSync(Buffer.from(JSON.stringify({ ...header, cwd }) + '\n', 'utf8'))
  await writeFile(file, Buffer.concat([frame, buffer.subarray(end)]))
  return header
}

/** Locate one session's directory by scanning the project buckets. */
async function findSession(home, sessionId) {
  if (typeof sessionId !== 'string' || sessionId.trim() === '') throw new Error('缺少任务 ID')
  const root = join(home, 'sessions')
  const segment = encodeSegment(sessionId)
  for (const entry of await directories(root)) {
    if (!entry.isDirectory()) continue
    const dir = join(root, entry.name, segment)
    try {
      if ((await stat(dir)).isDirectory()) {
        const header = await readHeader(dir)
        return { dir, cwd: typeof header.cwd === 'string' ? header.cwd : '' }
      }
    } catch {
      /* not this bucket */
    }
  }
  throw new Error('找不到这个任务的会话文件（可能已被删除）')
}

/** Move a directory, falling back to copy+remove across volumes. */
async function moveDir(from, to) {
  try {
    await rename(from, to)
  } catch (error) {
    if (error?.code !== 'EXDEV') throw error
    await cp(from, to, { recursive: true, force: false, errorOnExist: true })
    await rm(from, { recursive: true, force: true })
  }
}

/** Turn a Windows file-lock failure into a readable sentence. */
function explain(error, verb) {
  const code = error?.code
  if (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES') {
    return '无法' + verb + '：该任务可能正在打开或运行，请先切换到其他任务再重试'
  }
  return error instanceof Error ? error.message : String(error)
}

/** Remove one session from the durable search index, best effort. */
async function cleanupSearchIndex(home, sessionId) {
  const file = join(home, 'storages', 'session-query.sqlite')
  if (!existsSync(file)) return
  try {
    const { DatabaseSync } = await import('node:sqlite')
    const database = new DatabaseSync(file)
    try {
      database.exec('PRAGMA busy_timeout = 2000')
      database.prepare('DELETE FROM persisted_docs WHERE session_id = ?').run(sessionId)
      database.prepare('DELETE FROM persisted_sessions WHERE id = ?').run(sessionId)
    } finally {
      database.close()
    }
  } catch (error) {
    console.warn('session-actions: search index cleanup skipped:', error?.message ?? error)
  }
}

/** Read one JSON request body. */
async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 65536) throw new Error('请求内容过大')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  return JSON.parse(text)
}

/** Write one JSON response. */
function send(res, status, value) {
  if (res.headersSent) return
  const body = Buffer.from(JSON.stringify(value), 'utf8')
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store'
  })
  res.end(body)
}

/** List registered workspaces plus the caller's current one. */
async function listWorkspaces(ctx, home, sessionId) {
  const registry = registryOf(ctx)
  const workspaces = registry.list().map((workspace) => ({
    id: workspace.id,
    title: workspace.title,
    path: workspace.path
  }))
  let currentId = null
  if (typeof sessionId === 'string' && sessionId !== '') {
    try {
      const session = await findSession(home, sessionId)
      const match = registry.list().find((workspace) => samePath(workspace.path, session.cwd))
      currentId = match?.id ?? null
    } catch {
      currentId = null
    }
  }
  return { workspaces, currentId }
}

/** Move one session into another workspace. */
async function moveSession(ctx, home, sessionId, targetWorkspaceId) {
  const registry = registryOf(ctx)
  const target = registry.get(targetWorkspaceId)
  if (target === undefined) throw new Error('目标空间不存在')
  const session = await findSession(home, sessionId)
  if (samePath(session.cwd, target.path)) throw new Error('这个任务已经位于该空间')
  const destination = join(join(home, 'sessions', projectKey(target.path)), encodeSegment(sessionId))

  await writeHeaderCwd(session.dir, target.path)
  try {
    await mkdir(dirname(destination), { recursive: true })
    await moveDir(session.dir, destination)
  } catch (error) {
    await writeHeaderCwd(session.dir, session.cwd).catch(() => {})
    throw new Error(explain(error, '移动'))
  }

  try {
    const source = registry.list().find((workspace) => workspace.sessionIds.includes(sessionId))
    if (source !== undefined && source.id !== target.id) await source.detachSession(sessionId)
    invalidateCachedHeader(registry, sessionId)
    if (registry.headers instanceof Map) {
      registry.headers.set(sessionId, { ...(await readHeader(destination)), cwd: target.path })
    }
    if (registry.sessionPaths instanceof Map) registry.sessionPaths.set(sessionId, target.path)
    await target.attachSession(sessionId)
  } catch (error) {
    await moveDir(destination, session.dir).catch(() => {})
    await writeHeaderCwd(session.dir, session.cwd).catch(() => {})
    throw new Error('移动到空间失败：' + explain(error, '移动'))
  }

  return { workspace: { id: target.id, title: target.title }, path: target.path }
}

/** Remove one session from the sidebar, keeping its files in the trash. */
async function deleteSession(ctx, home, sessionId) {
  const registry = registryOf(ctx)
  const session = await findSession(home, sessionId)
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const destination = join(home, 'trash', 'sessions', stamp + '-' + encodeSegment(sessionId))
  try {
    await mkdir(dirname(destination), { recursive: true })
    await moveDir(session.dir, destination)
  } catch (error) {
    throw new Error(explain(error, '删除'))
  }

  for (const workspace of registry.list()) {
    if (workspace.sessionIds.includes(sessionId)) {
      await workspace.detachSession(sessionId).catch(() => {})
    }
  }
  const archived = Array.isArray(registry.archivedSessionIds) ? registry.archivedSessionIds : []
  const pinned = Array.isArray(registry.pinnedSessionIds) ? registry.pinnedSessionIds : []
  if (archived.includes(sessionId)) {
    await registry.unarchiveSession(sessionId).catch(() => {})
  }
  if (pinned.includes(sessionId)) {
    await registry.unpinSession(sessionId).catch(() => {})
  }
  invalidateCachedHeader(registry, sessionId)

  await rm(join(home, 'storages', 'session_projcache', 'sessions', encodeSegment(sessionId) + '.json'), {
    force: true
  }).catch(() => {})
  await cleanupSearchIndex(home, sessionId)
  return { trash: destination }
}

/** Put one trashed session back where its header says it belongs. */
async function restoreSession(ctx, home, trashPath) {
  if (typeof trashPath !== 'string' || trashPath.trim() === '') throw new Error('缺少回收站路径')
  const root = join(home, 'trash', 'sessions')
  const inside = relative(root, trashPath)
  if (inside === '' || inside.startsWith('..') || inside.includes(':')) throw new Error('无效的回收站路径')
  const header = await readHeader(trashPath)
  const sessionId = header.id
  if (typeof sessionId !== 'string' || sessionId === '') throw new Error('回收站中的会话缺少 ID')
  const cwd = typeof header.cwd === 'string' ? header.cwd : ''
  if (cwd === '') throw new Error('回收站中的会话缺少工作目录')
  const destination = join(home, 'sessions', projectKey(cwd), encodeSegment(sessionId))
  await mkdir(dirname(destination), { recursive: true })
  await moveDir(trashPath, destination)
  const registry = registryOf(ctx)
  const workspace = registry.list().find((candidate) => samePath(candidate.path, cwd))
  if (workspace !== undefined) {
    invalidateCachedHeader(registry, sessionId)
    if (registry.headers instanceof Map) registry.headers.set(sessionId, header)
    if (registry.sessionPaths instanceof Map) registry.sessionPaths.set(sessionId, cwd)
    await workspace.attachSession(sessionId).catch(() => {})
  }
  return { sessionId, path: destination }
}

/** Serve one request under the admin prefix. */
async function handle(ctx, req, res) {
  try {
    if (req.headers['x-session-actions'] !== '1') {
      send(res, 403, { ok: false, error: '缺少插件请求标记' })
      return
    }
    const origin = req.headers.origin
    if (typeof origin === 'string' && origin !== '') {
      try {
        if (new URL(origin).host !== req.headers.host) {
          send(res, 403, { ok: false, error: '请求来源不被允许' })
          return
        }
      } catch {
        send(res, 403, { ok: false, error: '请求来源不被允许' })
        return
      }
    }
    const url = new URL(req.url ?? '/', 'http://localhost')
    const path = url.pathname.slice(ROUTE_PREFIX.length) || '/'
    const home = resolveHome(ctx)
    if (req.method === 'GET' && path === '/ping') {
      send(res, 200, { ok: true, home })
      return
    }
    if (req.method === 'GET' && path === '/workspaces') {
      send(res, 200, { ok: true, ...(await listWorkspaces(ctx, home, url.searchParams.get('sessionId'))) })
      return
    }
    if (req.method === 'POST' && path === '/move') {
      const body = await readBody(req)
      const result = await moveSession(ctx, home, body.sessionId, body.targetWorkspaceId)
      send(res, 200, { ok: true, ...result })
      return
    }
    if (req.method === 'POST' && path === '/delete') {
      const body = await readBody(req)
      const result = await deleteSession(ctx, home, body.sessionId)
      send(res, 200, { ok: true, ...result })
      return
    }
    if (req.method === 'POST' && path === '/restore') {
      const body = await readBody(req)
      const result = await restoreSession(ctx, home, body.trash)
      send(res, 200, { ok: true, ...result })
      return
    }
    send(res, 404, { ok: false, error: '未知操作' })
  } catch (error) {
    send(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
  }
}

/**
 * Mount the admin routes. The Web host owns the listener; this plugin only
 * claims one prefix, and the disposer follows the fiber.
 * @param ctx - plugin context with the webServer service.
 */
export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: (req, res) => handle(ctx, req, res)
      }),
    'session-actions: admin routes'
  )
  ctx.logger?.info?.('session-actions: mounted %s', ROUTE_PREFIX)
}
