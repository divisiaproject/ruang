import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import express, { type NextFunction, type Request, type Response, type Express } from 'express'
import { BOARD_SLUG, TASK_ID } from './mission-control.js'

// ---------------------------------------------------------------------------
// Kanban write module.
//
// Same contract as the agent write module (agents-write.ts): Ruang's read path
// stays read-only, and this is a separate, opt-in layer that shells out to
// `hermes kanban ...`.
//
// Safety contract:
//   * Entirely disabled unless RUANG_WRITE_TOKEN is set AND presented.
//   * argv arrays only, never a shell string, never interpolated input.
//   * `--board` is a GLOBAL flag and must precede the subcommand. Hermes'
//     argparser rejects it after (verified on v0.19.0), so the order here is
//     load-bearing and covered by a test.
//   * Board slugs and task ids validated against the same regexes the read
//     layer uses, so a write can only touch what the UI can already see.
//   * `block` always sends `--kind needs_input`. Without a kind a block risks
//     being treated as a dependency, which parks the task in `todo` instead of
//     `blocked` and would silently defeat stuck detection.
//   * Every write is appended to a separate audit log.

const execFile = promisify(execFileCallback)

const HERMES = process.env.RUANG_HERMES_BIN || 'hermes'
const TIMEOUT_MS = 60_000

/** Matches Hermes' own `--kind` choices for `block`. */
const BLOCK_KINDS = ['needs_input', 'capability', 'dependency', 'transient'] as const
type BlockKind = typeof BLOCK_KINDS[number]

export type KanbanAction = 'create' | 'claim' | 'complete' | 'block' | 'unblock' | 'comment' | 'assign' | 'promote' | 'schedule'

type AuditEntry = {
  at: string
  action: KanbanAction
  board: string
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
  mkdir(auditDir(), { recursive: true })
    .then(() => appendFile(join(auditDir(), 'kanban-audit.jsonl'), line))
    .catch(() => { /* best-effort; never block a write on the audit log */ })
}

export class KanbanWriteError extends Error {
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
    if (detail.code === 'ENOENT') throw new KanbanWriteError('hermes is not installed or not on PATH.', 503, 'UNAVAILABLE')
    const stderr = typeof detail.stderr === 'string' ? detail.stderr.trim() : ''
    const stdout = typeof detail.stdout === 'string' ? detail.stdout.trim() : ''
    const message = stderr || stdout || String(detail.message ?? 'kanban command failed')
    throw new KanbanWriteError(message.slice(0, 600), 422, 'COMMAND_FAILED')
  }
}

function param(value: string | string[] | undefined): unknown {
  return Array.isArray(value) ? value[0] : value
}

function requireSlug(value: unknown): string {
  const slug = typeof value === 'string' ? value.trim() : ''
  if (!slug) throw new KanbanWriteError('board is required.', 400, 'INVALID_BOARD')
  if (!BOARD_SLUG.test(slug)) throw new KanbanWriteError('Invalid board slug.', 400, 'INVALID_BOARD')
  return slug
}

function requireTaskId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!id) throw new KanbanWriteError('task id is required.', 400, 'INVALID_TASK')
  if (!TASK_ID.test(id)) throw new KanbanWriteError('Invalid task id.', 400, 'INVALID_TASK')
  return id
}

function requireTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title) throw new KanbanWriteError('title is required.', 400, 'INVALID_TITLE')
  if (title.length > 300) throw new KanbanWriteError('title is too long (max 300).', 400, 'INVALID_TITLE')
  // A title starting with a dash would be read as a flag by the argparser.
  if (title.startsWith('-')) throw new KanbanWriteError('title cannot start with a dash.', 400, 'INVALID_TITLE')
  return title
}

function optionalText(value: unknown, field: string, max: number): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw new KanbanWriteError(`${field} must be text.`, 400, 'INVALID_INPUT')
  const text = value.trim()
  if (!text) return undefined
  if (text.length > max) throw new KanbanWriteError(`${field} is too long (max ${max}).`, 400, 'INVALID_INPUT')
  if (text.startsWith('-')) throw new KanbanWriteError(`${field} cannot start with a dash.`, 400, 'INVALID_INPUT')
  return text
}

function requireKind(value: unknown): BlockKind {
  if (typeof value === 'string' && (BLOCK_KINDS as readonly string[]).includes(value)) return value as BlockKind
  // Never fall back to an implicit kind: `dependency` would park the task in todo.
  return 'needs_input'
}

// --- operations -------------------------------------------------------------
// Each operation builds an argv array for exactly one Hermes verb.

export function createTaskArgs(slug: string, input: Record<string, unknown>): string[] {
  const args = ['kanban', '--board', requireSlug(slug), 'create', requireTitle(input.title)]
  const body = optionalText(input.body, 'body', 4000)
  if (body) args.push('--body', body)
  const assignee = optionalText(input.assignee, 'assignee', 64)
  if (assignee) args.push('--assignee', assignee)
  return args
}

export function claimTaskArgs(slug: string, taskId: unknown, ttl: unknown): string[] {
  const args = ['kanban', '--board', requireSlug(slug), 'claim', requireTaskId(taskId)]
  if (ttl !== undefined && ttl !== null) {
    const seconds = Number(ttl)
    if (!Number.isInteger(seconds) || seconds <= 0 || seconds > 86_400) throw new KanbanWriteError('ttl must be a whole number of seconds (1-86400).', 400, 'INVALID_INPUT')
    args.push('--ttl', String(seconds))
  }
  return args
}

export function completeTaskArgs(slug: string, taskIds: unknown, result: unknown): string[] {
  const ids = Array.isArray(taskIds) ? taskIds : [taskIds]
  if (ids.length === 0) throw new KanbanWriteError('at least one task id is required.', 400, 'INVALID_TASK')
  if (ids.length > 50) throw new KanbanWriteError('at most 50 tasks per call.', 400, 'INVALID_INPUT')
  const args = ['kanban', '--board', requireSlug(slug), 'complete', ...ids.map((id) => requireTaskId(id))]
  const summary = optionalText(result, 'result', 1000)
  if (summary) args.push('--result', summary)
  return args
}

export function blockTaskArgs(slug: string, taskId: unknown, reason: unknown, kind: unknown): string[] {
  const args = ['kanban', '--board', requireSlug(slug), 'block', '--kind', requireKind(kind), requireTaskId(taskId)]
  const text = optionalText(reason, 'reason', 1000)
  if (text) args.push(text)
  return args
}

export function unblockTaskArgs(slug: string, taskId: unknown): string[] {
  return ['kanban', '--board', requireSlug(slug), 'unblock', requireTaskId(taskId)]
}

export function commentTaskArgs(slug: string, taskId: unknown, body: unknown): string[] {
  const text = optionalText(body, 'body', 4000)
  if (!text) throw new KanbanWriteError('body is required.', 400, 'INVALID_INPUT')
  return ['kanban', '--board', requireSlug(slug), 'comment', requireTaskId(taskId), text]
}

export function assignTaskArgs(slug: string, taskId: unknown, assignee: unknown): string[] {
  const name = optionalText(assignee, 'assignee', 64)
  if (!name) throw new KanbanWriteError('assignee is required.', 400, 'INVALID_INPUT')
  // A Kanban assignee is a free-text label, not a profile id: vendors and teams are real
  // assignees. Keep it printable and non-option-like so it can never be read as a flag,
  // but allow spaces and capitals so "CV Sinar Jaya" is a valid assignee.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) throw new KanbanWriteError('assignee cannot contain control characters.', 400, 'INVALID_INPUT')
  if (name.startsWith('-')) throw new KanbanWriteError('assignee cannot start with a dash.', 400, 'INVALID_INPUT')
  return ['kanban', '--board', requireSlug(slug), 'assign', requireTaskId(taskId), name]
}

export function promoteTaskArgs(slug: string, taskId: unknown): string[] {
  return ['kanban', '--board', requireSlug(slug), 'promote', requireTaskId(taskId)]
}

export function scheduleTaskArgs(slug: string, taskId: unknown, when: unknown): string[] {
  const text = optionalText(when, 'when', 120)
  if (!text) throw new KanbanWriteError('when is required.', 400, 'INVALID_INPUT')
  return ['kanban', '--board', requireSlug(slug), 'schedule', requireTaskId(taskId), text]
}

/** Runs one prepared argv array. The caller records the audit entry. */
async function apply(args: string[]): Promise<{ output: string }> {
  const output = await hermes(args)
  return { output: output.trim().slice(0, 2000) }
}

// --- HTTP surface -----------------------------------------------------------

function authorised(request: Request, token: string): boolean {
  const header = request.get('authorization') ?? ''
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  const provided = bearer || (typeof request.get('x-ruang-write-token') === 'string' ? request.get('x-ruang-write-token')!.trim() : '')
  if (provided.length !== token.length) return false
  let mismatch = 0
  for (let index = 0; index < token.length; index += 1) mismatch |= provided.charCodeAt(index) ^ token.charCodeAt(index)
  return mismatch === 0
}

export function installKanbanWrites(app: Express): void {
  const token = (process.env.RUANG_WRITE_TOKEN || '').trim()
  if (!token) {
    app.get('/api/kanban/write-status', (_request: Request, response: Response) => {
      response.json({ enabled: false, reason: 'RUANG_WRITE_TOKEN is not set.' })
    })
    return
  }

  const requireToken = (request: Request, response: Response, next: NextFunction) => {
    if (!authorised(request, token)) return response.status(401).json({ error: 'Write token required.', enabled: true })
    return next()
  }

  // Reading whether writes are on is not itself a write, so the UI can check without a token.
  app.get('/api/kanban/write-status', (_request: Request, response: Response) => {
    response.json({ enabled: true })
  })

  app.use('/api/kanban', express.json({ limit: '64kb' }), requireToken)

  app.get('/api/kanban/audit', (_request: Request, response: Response) => {
    response.json({ entries: auditLog.slice(0, 100) })
  })

  // Board and task id are validated INSIDE build(), so a rejected value becomes a 400
  // (invalid request) instead of escaping the handler as a 500.
  const run = (action: KanbanAction, boardOf: () => string, targetOf: () => string, build: (board: string) => string[]) =>
    async (_request: Request, response: Response) => {
      let board = ''
      let target = ''
      try {
        board = boardOf()
        target = targetOf()
        const args = build(board)
        const result = await apply(args)
        record({ at: new Date().toISOString(), action, board, target, ok: true })
        response.json({ ok: true, argv: args.slice(3), result })
      } catch (error) {
        const failure = error instanceof KanbanWriteError ? error : new KanbanWriteError(String((error as Error)?.message ?? error), 500, 'INTERNAL')
        record({ at: new Date().toISOString(), action, board, target, ok: false, detail: failure.message })
        response.status(failure.status).json({ ok: false, error: failure.message, code: failure.code })
      }
    }

  const boardOf = (request: Request) => () => requireSlug(param(request.params.board))
  const idOf = (request: Request) => () => requireTaskId(param(request.params.id))

  app.post('/api/kanban/:board/tasks', async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    await run('create', boardOf(request), () => String(body.title ?? ''), (board) => createTaskArgs(board, body))(request, response)
  })

  app.post('/api/kanban/:board/tasks/:id/claim', async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    await run('claim', boardOf(request), idOf(request), (board) => claimTaskArgs(board, param(request.params.id), body.ttl))(request, response)
  })

  app.post('/api/kanban/:board/tasks/:id/complete', async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    await run('complete', boardOf(request), idOf(request), (board) => completeTaskArgs(board, [param(request.params.id)], body.result))(request, response)
  })

  app.post('/api/kanban/:board/tasks/:id/block', async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    await run('block', boardOf(request), idOf(request), (board) => blockTaskArgs(board, param(request.params.id), body.reason, body.kind))(request, response)
  })

  app.post('/api/kanban/:board/tasks/:id/unblock', async (request: Request, response: Response) => {
    await run('unblock', boardOf(request), idOf(request), (board) => unblockTaskArgs(board, param(request.params.id)))(request, response)
  })

  app.post('/api/kanban/:board/tasks/:id/comment', async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    await run('comment', boardOf(request), idOf(request), (board) => commentTaskArgs(board, param(request.params.id), body.body))(request, response)
  })

  app.post('/api/kanban/:board/tasks/:id/assign', async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    await run('assign', boardOf(request), idOf(request), (board) => assignTaskArgs(board, param(request.params.id), body.assignee))(request, response)
  })

  app.post('/api/kanban/:board/tasks/:id/promote', async (request: Request, response: Response) => {
    await run('promote', boardOf(request), idOf(request), (board) => promoteTaskArgs(board, param(request.params.id)))(request, response)
  })

  app.post('/api/kanban/:board/tasks/:id/schedule', async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    await run('schedule', boardOf(request), idOf(request), (board) => scheduleTaskArgs(board, param(request.params.id), body.when))(request, response)
  })
}
