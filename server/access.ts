import { createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import express, { type Express, type NextFunction, type Request, type Response } from 'express'

// Optional access code. Off by default; when it is set, every /api route except the health
// check and the access routes themselves needs a session cookie, which the server hands out
// after the code is entered. Only a scrypt hash of the code is stored, in Ruang's own config
// (never in Hermes), with a random secret that signs sessions: changing or removing the code
// replaces the secret, which ends every session. Forgotten code: `ruang access-code off`.

export const MIN_CODE_LENGTH = 12
export const MAX_CODE_LENGTH = 128
export const SESSION_MS = 12 * 60 * 60 * 1000
export const REMEMBER_MS = 7 * 24 * 60 * 60 * 1000
const COOKIE = 'ruang_session'
const FREE_ATTEMPTS = 5
const MAX_WAIT_MS = 5 * 60 * 1000

export class AccessError extends Error {
  constructor(message: string, readonly status: number, readonly retryAfterMs?: number) { super(message) }
}

/** `admin` may use the write forms; `vendor` may only read and file reports. */
export type Role = 'admin' | 'vendor'

interface AccessFile { version: 1; salt: string; hash: string; secret: string; createdAt: string; vendorSalt?: string; vendorHash?: string }
/** `broken` means the file exists but cannot be read: Ruang stays locked (fail closed). */
type AccessState = { enabled: false } | { enabled: true; file?: AccessFile; broken?: true }

export function accessConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.RUANG_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'ruang')
}

/** A random code like ruang-7KQ4-M2XD-9PWT-H6RA (80 bits; no 0/O/1/I to misread). */
export function generateCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  const groups = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join(''))
  return `ruang-${groups.join('-')}`
}

/** The code as stored and compared: surrounding whitespace removed, length and characters checked. */
export function normalizeCode(code: unknown): string {
  if (typeof code !== 'string') throw new AccessError('Enter an access code.', 400)
  const trimmed = code.trim()
  if (trimmed.length < MIN_CODE_LENGTH) throw new AccessError(`The access code needs at least ${MIN_CODE_LENGTH} characters.`, 400)
  if (trimmed.length > MAX_CODE_LENGTH) throw new AccessError(`The access code can have at most ${MAX_CODE_LENGTH} characters.`, 400)
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw new AccessError('The access code cannot contain control characters.', 400)
  return trimmed
}

export function derive(code: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(code, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => (error ? reject(error) : resolve(key))))
}

function isAccessFile(value: unknown): value is AccessFile {
  const record = value as Record<string, unknown> | null
  if (!record || record.version !== 1) return false
  if (!['salt', 'hash', 'secret', 'createdAt'].every((key) => typeof record![key] === 'string' && (record![key] as string).length > 0)) return false
  // A vendor code is all-or-nothing: half a pair would silently drop the role gate.
  const vendor = [record!.vendorSalt, record!.vendorHash].filter((item) => typeof item === 'string' && item.length > 0)
  return vendor.length === 0 || vendor.length === 2
}

export class AccessStore {
  private cache?: { key: string; state: AccessState }
  constructor(readonly dir: string = accessConfigDir()) {}

  get path(): string { return join(this.dir, 'access.json') }

  /** Re-read whenever the file changes, so `ruang access-code` takes effect without a restart. */
  async state(): Promise<AccessState> {
    let key: string
    try {
      const info = await stat(this.path)
      key = `${info.ino}:${info.size}:${info.mtimeMs}`
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { enabled: false }
      return { enabled: true, broken: true }
    }
    if (this.cache?.key === key) return this.cache.state
    let state: AccessState
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      state = isAccessFile(parsed) ? { enabled: true, file: parsed } : { enabled: true, broken: true }
    } catch {
      state = { enabled: true, broken: true }
    }
    this.cache = { key, state }
    return state
  }

  async set(code: string, vendorCode?: string): Promise<AccessFile> {
    const salt = randomBytes(16)
    const file: AccessFile = { version: 1, salt: salt.toString('base64'), hash: (await derive(normalizeCode(code), salt)).toString('base64'), secret: randomBytes(32).toString('base64'), createdAt: new Date().toISOString() }
    if (vendorCode !== undefined && vendorCode !== '') {
      const vendorSalt = randomBytes(16)
      file.vendorSalt = vendorSalt.toString('base64')
      file.vendorHash = (await derive(normalizeCode(vendorCode), vendorSalt)).toString('base64')
    }
    await mkdir(this.dir, { recursive: true, mode: 0o700 })
    const temporary = `${this.path}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
    await rename(temporary, this.path)
    this.cache = undefined
    return file
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true })
    this.cache = undefined
  }

  async verify(code: unknown): Promise<boolean> {
    return (await this.roleOf(code)) !== undefined
  }

  /**
   * Which role a code unlocks, or undefined when it matches neither. The admin code is
   * checked first; the vendor code, when set, only ever unlocks the vendor role.
   */
  async roleOf(code: unknown): Promise<Role | undefined> {
    const state = await this.state()
    if (!state.enabled || !state.file || typeof code !== 'string') return undefined
    const file = state.file
    const matches = async (hash: string, salt: string): Promise<boolean> => {
      const expected = Buffer.from(hash, 'base64')
      const actual = await derive(code.trim(), Buffer.from(salt, 'base64'))
      return expected.length === actual.length && timingSafeEqual(expected, actual)
    }
    if (await matches(file.hash, file.salt)) return 'admin'
    if (file.vendorHash && file.vendorSalt && await matches(file.vendorHash, file.vendorSalt)) return 'vendor'
    return undefined
  }
}

function signature(secret: string, payload: string): string {
  return createHmac('sha256', Buffer.from(secret, 'base64')).update(payload).digest('base64url')
}

export function issueToken(file: AccessFile, remember: boolean, now = Date.now(), role: Role = 'admin'): string {
  const payload = `v1.${now + (remember ? REMEMBER_MS : SESSION_MS)}.${remember ? 1 : 0}.${role}`
  return `${payload}.${signature(file.secret, payload)}`
}

/** The role a session token carries, or undefined when the token is absent, expired or forged. */
export function tokenRole(file: AccessFile, token: string | undefined, now = Date.now()): Role | undefined {
  const match = token?.match(/^(v1\.(\d{1,15})\.[01]\.(admin|vendor))\.([A-Za-z0-9_-]{43})$/)
  if (!match || Number(match[2]) <= now) return undefined
  const expected = Buffer.from(signature(file.secret, match[1]))
  const actual = Buffer.from(match[4])
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return undefined
  return match[3] as Role
}

export function tokenValid(file: AccessFile, token: string | undefined, now = Date.now()): boolean {
  return tokenRole(file, token, now) !== undefined
}

export interface ThrottleOptions { free?: number; maxWaitMs?: number; hardLimit?: number; hardWaitMs?: number }

/**
 * Growing waits after repeated wrong codes, per client address: after `free` misses each try
 * waits 1 s, doubling up to `maxWaitMs`; from `hardLimit` misses on, `hardWaitMs` each.
 */
export class Throttle {
  private entries = new Map<string, { failures: number; until: number }>()
  constructor(private readonly options: ThrottleOptions = {}) {}
  waitMs(key: string, now = Date.now()): number { return Math.max(0, (this.entries.get(key)?.until ?? 0) - now) }
  fail(key: string, now = Date.now()): void {
    if (this.entries.size > 5_000) this.entries.clear()
    const { free = FREE_ATTEMPTS, maxWaitMs = MAX_WAIT_MS, hardLimit, hardWaitMs = 0 } = this.options
    const failures = (this.entries.get(key)?.failures ?? 0) + 1
    const wait = hardLimit !== undefined && failures >= hardLimit ? hardWaitMs : failures >= free ? Math.min(maxWaitMs, 1000 * 2 ** (failures - free)) : 0
    this.entries.set(key, { failures, until: wait > 0 ? now + wait : 0 })
  }
  succeed(key: string): void { this.entries.delete(key) }
}

export function cookieValue(request: Request, name: string): string | undefined {
  for (const part of (request.headers.cookie ?? '').split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return undefined
}

function setSession(request: Request, response: Response, token: string | undefined, remember = false): void {
  const attributes = ['Path=/', 'HttpOnly', 'SameSite=Strict', ...(request.secure ? ['Secure'] : [])]
  response.append('Set-Cookie', token ? `${COOKIE}=${token}; ${[...attributes, ...(remember ? [`Max-Age=${REMEMBER_MS / 1000}`] : [])].join('; ')}` : `${COOKIE}=; ${[...attributes, 'Max-Age=0'].join('; ')}`)
}

export interface AccessStatus { enabled: boolean; unlocked: boolean; role?: Role; vendorCodeSet?: boolean; since?: string; minLength: number; rememberDays: number }

/** Adds the access routes and the lock in front of every other /api route. Call before them. */
export function installAccess(app: Express, store = new AccessStore(), throttle = new Throttle()): (request: Request) => Promise<Role | undefined> {
  /** The role of the caller's session, or undefined when Ruang is locked for them. */
  const roleOf = async (request: Request): Promise<Role | undefined> => {
    const state = await store.state()
    if (!state.enabled) return 'admin'
    return state.file ? tokenRole(state.file, cookieValue(request, COOKIE)) : undefined
  }
  const unlocked = async (request: Request): Promise<boolean> => (await roleOf(request)) !== undefined
  const client = (request: Request) => request.socket.remoteAddress ?? 'unknown'
  /** Checks a code against the stored one, counting wrong codes towards the wait. */
  const checkCode = async (request: Request, code: unknown): Promise<Role> => {
    const wait = throttle.waitMs(client(request))
    if (wait > 0) throw new AccessError(`Too many wrong codes. Try again in ${Math.ceil(wait / 1000)} s.`, 429, wait)
    const role = await store.roleOf(code)
    if (!role) { throttle.fail(client(request)); throw new AccessError('Wrong access code.', 401) }
    throttle.succeed(client(request))
    return role
  }
  const route = (handler: (request: Request, response: Response) => Promise<unknown>) => async (request: Request, response: Response) => {
    try {
      response.json(await handler(request, response))
    } catch (error) {
      if (!(error instanceof AccessError)) throw error
      if (error.retryAfterMs) response.set('Retry-After', String(Math.ceil(error.retryAfterMs / 1000)))
      response.status(error.status).json({ error: error.message })
    }
  }
  const status = async (request: Request): Promise<AccessStatus> => {
    const state = await store.state()
    const role = await roleOf(request)
    const open = role !== undefined
    return { enabled: state.enabled, unlocked: open, ...(open && state.enabled && role ? { role } : {}), ...(state.enabled && state.file ? { vendorCodeSet: Boolean(state.file.vendorHash) } : {}), ...(open && state.enabled && state.file ? { since: state.file.createdAt } : {}), minLength: MIN_CODE_LENGTH, rememberDays: REMEMBER_MS / 86_400_000 }
  }
  const body = (request: Request) => (request.body && typeof request.body === 'object' ? request.body as Record<string, unknown> : {})

  // Changes must come from this page: a custom header cannot be sent cross-site without a CORS
  // preflight, which Ruang never answers, and the JSON parser ignores form posts.
  app.use('/api/access', express.json({ limit: '4kb' }), (request: Request, response: Response, next: NextFunction) => {
    if (request.method === 'POST' && request.get('x-ruang-request') !== '1') { response.status(403).json({ error: 'Forbidden.' }); return }
    next()
  })
  app.get('/api/access', route(status))
  app.post('/api/access/unlock', route(async (request, response) => {
    const state = await store.state()
    if (state.enabled) {
      const role = await checkCode(request, body(request).code)
      const current = await store.state()
      if (current.enabled && current.file) setSession(request, response, issueToken(current.file, body(request).remember === true, Date.now(), role), body(request).remember === true)
      // The new cookie is not on this request yet, so report the role we just issued.
      return { ...(await status(request)), unlocked: true, role }
    }
    return { ...(await status(request)), unlocked: true }
  }))
  app.post('/api/access/lock', route(async (request, response) => {
    setSession(request, response, undefined)
    return { ...(await status(request)), unlocked: !(await store.state()).enabled }
  }))
  /** Turns the code on, or replaces it (the current code is required then). */
  app.post('/api/access/code', route(async (request, response) => {
    const { code, currentCode, remember, vendorCode } = body(request)
    const next = normalizeCode(code)
    const vendor = typeof vendorCode === 'string' && vendorCode.trim() !== '' ? normalizeCode(vendorCode) : undefined
    if (vendor !== undefined && vendor === next) throw new AccessError('The vendor code must differ from the admin code.', 400)
    if ((await store.state()).enabled) {
      if (!(await unlocked(request))) throw new AccessError('Ruang is locked. Enter the access code.', 401)
      if ((await checkCode(request, currentCode)) !== 'admin') throw new AccessError('The admin code is required to change codes.', 403)
    }
    const file = await store.set(next, vendor)
    setSession(request, response, issueToken(file, remember === true), remember === true)
    return { enabled: true, unlocked: true, role: 'admin', vendorCodeSet: Boolean(file.vendorHash), since: file.createdAt, minLength: MIN_CODE_LENGTH, rememberDays: REMEMBER_MS / 86_400_000 }
  }))
  app.post('/api/access/disable', route(async (request, response) => {
    if (!(await store.state()).enabled) return status(request)
    if (!(await unlocked(request))) throw new AccessError('Ruang is locked. Enter the access code.', 401)
    if ((await checkCode(request, body(request).currentCode)) !== 'admin') throw new AccessError('The admin code is required to turn the lock off.', 403)
    await store.clear()
    setSession(request, response, undefined)
    return status(request)
  }))
  app.use('/api', async (request: Request, response: Response, next: NextFunction) => {
    // A CORS preflight carries no cookie, so answering it 401 would stop every write form before
    // its real request is ever sent. Ruang answers no CORS headers, so a cross-site page gains
    // nothing by passing this: the browser still blocks the response.
    if (request.method === 'OPTIONS') { next(); return }
    if (request.path === '/health' || request.path === '/access' || request.path.startsWith('/access/')) { next(); return }
    if (await unlocked(request)) { next(); return }
    response.status(401).json({ error: 'Ruang is locked. Enter the access code.', locked: true })
  })
  return roleOf
}
