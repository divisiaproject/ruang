import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { appendFile, copyFile, mkdir, readdir, rename, stat, unlink } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import express, { type NextFunction, type Request, type Response, type Express } from 'express'
import type { Role } from './access.js'

// ---------------------------------------------------------------------------
// Agent write module.
//
// Ruang's read path is deliberately read-only and must stay that way: it runs
// fixed commands through systemRun() and nothing else. This module is a
// separate, opt-in layer that shells out to `hermes profile ...`.
//
// Safety contract:
//   * Entirely disabled unless RUANG_WRITE_TOKEN is set AND presented.
//   * argv arrays only, never a shell string, never interpolated input.
//   * Fixed routes; no command passthrough.
//   * Profile names validated against hermes' own rule (lowercase alphanumeric).
//   * `default` can never be renamed or deleted.
//   * Delete = export first, verify the archive exists, then delete. Any
//     failure aborts before the destructive step.
//   * Every write is appended to a separate audit log.

const execFile = promisify(execFileCallback)

const HERMES = process.env.RUANG_HERMES_BIN || 'hermes'
const TIMEOUT_MS = 120_000
const NAME_PATTERN = /^[a-z0-9]{1,32}$/
const PROTECTED = 'default'

export type WriteAction = 'create' | 'config' | 'rename' | 'export' | 'delete'

type AuditEntry = {
  at: string
  action: WriteAction
  target: string
  ok: boolean
  detail?: string
}

const auditLog: AuditEntry[] = []
const AUDIT_LIMIT = 200

function auditDir(): string {
  return process.env.RUANG_BACKUP_DIR || join(homedir(), '.local', 'share', 'ruang', 'writes')
}

function record(entry: AuditEntry): void {
  auditLog.unshift(entry)
  if (auditLog.length > AUDIT_LIMIT) auditLog.length = AUDIT_LIMIT
  const line = JSON.stringify(entry) + '\n'
  const path = join(auditDir(), 'audit.jsonl')
  mkdir(auditDir(), { recursive: true })
    .then(() => appendFile(path, line))
    .catch(() => { /* audit persistence is best-effort; never block a write on it */ })
}

export class WriteError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'WRITE_FAILED') {
    super(message)
  }
}

async function hermes(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFile(HERMES, args, {
      timeout: TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', COLUMNS: '200', PYTHONIOENCODING: 'utf-8' },
    })
    return stdout
  } catch (error) {
    const detail = error as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown }
    if (detail.code === 'ENOENT') throw new WriteError('hermes is not installed or not on PATH.', 503, 'UNAVAILABLE')
    const stderr = typeof detail.stderr === 'string' ? detail.stderr.trim() : ''
    const stdout = typeof detail.stdout === 'string' ? detail.stdout.trim() : ''
    const message = stderr || stdout || String(detail.message ?? 'write command failed')
    throw new WriteError(message.slice(0, 600), 422, 'COMMAND_FAILED')
  }
}

function param(value: string | string[] | undefined): unknown {
  return Array.isArray(value) ? value[0] : value
}

function requireName(value: unknown, field = 'name'): string {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) throw new WriteError(`${field} is required.`, 400, 'INVALID_NAME')
  if (!NAME_PATTERN.test(name)) throw new WriteError(`${field} must be lowercase letters and digits only (max 32).`, 400, 'INVALID_NAME')
  return name
}

async function existingProfiles(): Promise<string[]> {
  // Read the profile directories directly: cheap, and avoids parsing a table.
  // The built-in profile has no directory of its own, so it is added explicitly: without it
  // every operation on `default` reported NOT_FOUND instead of the protection it really has.
  const root = join(homedir(), '.hermes', 'profiles')
  const names = existsSync(root)
    ? (await readdir(root, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    : []
  return names.includes(PROTECTED) ? names : [PROTECTED, ...names]
}

async function assertMissing(name: string): Promise<void> {
  const profiles = await existingProfiles()
  if (profiles.includes(name)) throw new WriteError(`Profile "${name}" already exists.`, 409, 'EXISTS')
}

async function assertExists(name: string): Promise<void> {
  const profiles = await existingProfiles()
  if (!profiles.includes(name)) throw new WriteError(`Profile "${name}" does not exist.`, 404, 'NOT_FOUND')
}

async function exportProfile(name: string): Promise<string> {
  const dir = auditDir()
  await mkdir(dir, { recursive: true })
  // `hermes profile export [-o OUTPUT] profile_name` — confirmed on v0.19.0.
  const target = join(dir, `${name}.tar.gz`)
  let exported = false
  try {
    await hermes(['profile', 'export', name, '--output', target])
    exported = true
  } catch {
    exported = false
  }

  if (!exported) {
    // Fallback: without --output the archive is written to the process CWD.
    const fallback = join(process.cwd(), `${name}.tar.gz`)
    await hermes(['profile', 'export', name])
    if (!existsSync(fallback)) throw new WriteError('Export produced no archive; refusing to continue.', 500, 'EXPORT_FAILED')
    await rename(fallback, target).catch(async () => {
      // Cross-device move: copy then unlink.
      await copyFile(fallback, target)
      await unlink(fallback).catch(() => {})
    })
  }

  if (!existsSync(target)) throw new WriteError('Export archive missing; refusing to continue.', 500, 'EXPORT_FAILED')
  const info = await stat(target)
  if (info.size < 32) throw new WriteError('Export archive looks empty; refusing to continue.', 500, 'EXPORT_FAILED')
  return target
}

// --- operations -------------------------------------------------------------

export async function createAgent(input: Record<string, unknown>): Promise<{ name: string }> {
  const name = requireName(input.name)
  await assertMissing(name)
  const args = ['profile', 'create', name]
  if (typeof input.description === 'string' && input.description.trim()) args.push('--description', input.description.trim().slice(0, 200))
  if (typeof input.cloneFrom === 'string' && input.cloneFrom.trim()) {
    const source = requireName(input.cloneFrom, 'cloneFrom')
    await assertExists(source)
    args.push('--clone-from', source)
  }
  if (input.noSkills === true) args.push('--no-skills')
  await hermes(args)
  const profiles = await existingProfiles()
  if (!profiles.includes(name)) throw new WriteError('hermes reported success but the profile is not on disk.', 500, 'VERIFY_FAILED')
  return { name }
}

export async function configureAgent(name: unknown, key: unknown, value: unknown): Promise<{ name: string; key: string }> {
  const profile = requireName(name)
  // The built-in profile is protected: refuse it as protected, before anything else can report
  // it as missing. This form never changes the model of the agent that runs Ruang itself.
  if (profile === PROTECTED) throw new WriteError('The default profile is protected and its model is not changed here.', 403, 'PROTECTED')
  await assertExists(profile)
  const setting = typeof key === 'string' ? key.trim() : ''
  // Only allow the documented dotted config keys; nothing shell-like.
  if (!/^[a-z0-9]+(\.[a-z0-9_]+){0,3}$/.test(setting)) throw new WriteError('Invalid config key.', 400, 'INVALID_KEY')
  const val = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
  if (!val) throw new WriteError('value is required.', 400, 'INVALID_VALUE')
  if (val.length > 200) throw new WriteError('value is too long.', 400, 'INVALID_VALUE')
  await hermes(['-p', profile, 'config', 'set', setting, val])
  return { name: profile, key: setting }
}

export async function renameAgent(name: unknown, to: unknown): Promise<{ from: string; to: string }> {
  const from = requireName(name)
  const target = requireName(to, 'to')
  if (from === PROTECTED) throw new WriteError('The default profile cannot be renamed.', 403, 'PROTECTED')
  await assertExists(from)
  await assertMissing(target)
  await hermes(['profile', 'rename', from, target])
  return { from, to: target }
}

export async function deleteAgent(name: unknown, confirm: unknown): Promise<{ name: string; backup: string }> {
  const profile = requireName(name)
  if (profile === PROTECTED) throw new WriteError('The default profile cannot be deleted.', 403, 'PROTECTED')
  await assertExists(profile)
  // Destructive step requires the caller to echo the exact profile name.
  if (confirm !== profile) throw new WriteError('Confirmation does not match the profile name.', 400, 'CONFIRM_MISMATCH')
  const backup = await exportProfile(profile)
  await hermes(['profile', 'delete', profile, '--yes'])
  const remaining = await existingProfiles()
  if (remaining.includes(profile)) throw new WriteError('Delete did not remove the profile.', 500, 'VERIFY_FAILED')
  return { name: profile, backup }
}

// --- HTTP surface -----------------------------------------------------------

function authorised(request: Request, token: string): boolean {
  const header = request.get('authorization') ?? ''
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  const provided = bearer || (typeof request.get('x-ruang-write-token') === 'string' ? request.get('x-ruang-write-token')!.trim() : '')
  // Constant-time-ish comparison; tokens are short so this is adequate here.
  if (provided.length !== token.length) return false
  let mismatch = 0
  for (let index = 0; index < token.length; index += 1) mismatch |= provided.charCodeAt(index) ^ token.charCodeAt(index)
  return mismatch === 0
}

export function installAgentWrites(app: Express, roleOf?: (request: Request) => Promise<Role | undefined>): void {
  const token = (process.env.RUANG_WRITE_TOKEN || '').trim()
  if (!token) {
    // Writes stay off. Expose only a status the UI can read.
    app.get('/api/agents/write-status', (_request: Request, response: Response) => {
      response.json({ enabled: false, reason: 'RUANG_WRITE_TOKEN is not set.' })
    })
    return
  }

  app.use('/api/agents', express.json({ limit: '16kb' }), async (request: Request, response: Response, next: NextFunction) => {
    // A browser preflight carries neither cookie nor token; letting it through is what allows the
    // real POST to be sent at all. Ruang answers no CORS headers, so this grants nothing cross-site.
    if (request.method === 'OPTIONS') return next()
    // A vendor session may read the board but must never create or change an agent.
    if (roleOf && (await roleOf(request)) === 'vendor') return response.status(403).json({ error: 'Only an admin session can manage agents.', adminOnly: true })
    if (!authorised(request, token)) {
      return response.status(401).json({ error: 'Write token required.', enabled: true })
    }
    return next()
  })

  app.get('/api/agents/write-status', (_request: Request, response: Response) => {
    response.json({ enabled: true, protected: PROTECTED, audit: auditLog.slice(0, 50) })
  })

  app.get('/api/agents/audit', (_request: Request, response: Response) => {
    response.json({ entries: auditLog.slice(0, 100), directory: auditDir() })
  })

  const run = (action: WriteAction, target: string, work: () => Promise<unknown>) =>
    async (_request: Request, response: Response) => {
      try {
        const result = await work()
        record({ at: new Date().toISOString(), action, target, ok: true })
        response.json({ ok: true, result })
      } catch (error) {
        const failure = error instanceof WriteError ? error : new WriteError(String((error as Error)?.message ?? error))
        record({ at: new Date().toISOString(), action, target, ok: false, detail: failure.message })
        response.status(failure.status).json({ ok: false, error: failure.message, code: failure.code })
      }
    }

  app.post('/api/agents', async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    await run('create', String(body.name ?? ''), () => createAgent(body))(request, response)
  })

  app.post('/api/agents/:name/config', async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    await run('config', String(param(request.params.name) ?? ''), () => configureAgent(param(request.params.name), body.key, body.value))(request, response)
  })

  app.post('/api/agents/:name/rename', async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    await run('rename', String(param(request.params.name) ?? ''), () => renameAgent(param(request.params.name), body.to))(request, response)
  })

  app.post('/api/agents/:name/export', async (request: Request, response: Response) => {
    await run('export', String(param(request.params.name) ?? ''), async () => ({ backup: await exportProfile(requireName(param(request.params.name))) }))(request, response)
  })

  app.delete('/api/agents/:name', async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    await run('delete', String(param(request.params.name) ?? ''), () => deleteAgent(param(request.params.name), body.confirm))(request, response)
  })
}
