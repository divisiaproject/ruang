import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { homedir } from 'node:os'
import express, { type NextFunction, type Request, type Response, type Express } from 'express'
import type { Role } from './access.js'

// ---------------------------------------------------------------------------
// Owner-only terminal: one text box in #/admin that runs read-only-ish
// `hermes ...` argv on this machine and streams the text back.
// ---------------------------------------------------------------------------
//
// Safety contract (this is Opsi A + leher whitelist C):
//   * Entirely disabled unless RUANG_WRITE_TOKEN is set AND presented.
//     Vendor session: 403 even with a valid write token.
//   * argv arrays only via execFile, never a shell string.
//   * No freeform passthrough: the client sends full CLI text ("hermes kanban show"),
//     the server re-tokenises it with a small shell-word parser on THIS side,
//     then the FIRST verb must be `hermes` and the rest must match the ALLOWED
//     list below. Anything else is rejected as 400 INVALID_COMMAND before exec.
//   * Mutating profiles is out of scope: no `profile create|rename|delete|export`.
//     Those stay on the dedicated Admin forms with their own guards.
//   * Mutating kanban tasks (claim/complete/block/...) also stays on the
//     dedicated TaskBoard/Admin forms. The terminal only runs the READ side
//     plus the read-only config/model/kanban queries below.
//   * `chat` is deliberately short: one question, one answer, timeout 120s,
//     max 2000 chars, no `--attach`, no shell pipes, no multi-turn REPL.
//   * Every run is appended to a separate audit log (exec-terminal-audit.jsonl).
//   * OPTIONS passes through (preflight), same as the other write layers:
//     a 401 preflight makes the browser drop the POST with
//     "API could not be reached" even when the server is fine.

const execFile = promisify(execFileCallback)

const HERMES = process.env.RUANG_HERMES_BIN || 'hermes'
const TIMEOUT_MS = 120_000
const MAX_CHARS = 8_000
const HISTORY_LIMIT = 30

export type ExecAction = 'exec'

type AuditEntry = {
  at: string
  action: ExecAction
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
    .then(() => appendFile(join(auditDir(), 'exec-terminal-audit.jsonl'), line))
    .catch(() => { /* best-effort; never block a run on the audit log */ })
}

export class ExecTerminalError extends Error {
  constructor(message: string, readonly status = 400, readonly code = 'EXEC_FAILED') {
    super(message)
  }
}

async function hermes(args: string[]): Promise<string> {
  try {
    const { stdout, stderr } = await execFile(HERMES, args, {
      timeout: TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, NO_COLOR: '1', TERM: 'dumb', COLUMNS: '200', PYTHONIOENCODING: 'utf-8' },
    })
    const out = typeof stdout === 'string' ? stdout : ''
    const err = typeof stderr === 'string' ? stderr.trim() : ''
    // Some hermes verbs print the payload on stdout and a one-line note on
    // stderr; keep both so the terminal shows what the CLI itself showed.
    const combined = err ? (out.trimEnd() + '\n' + err + '\n') : out
    return combined.slice(0, MAX_CHARS)
  } catch (error) {
    const detail = error as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown; killed?: boolean }
    if (detail.code === 'ENOENT') throw new ExecTerminalError('hermes is not installed or not on PATH.', 503, 'UNAVAILABLE')
    if (detail.killed) throw new ExecTerminalError('The command timed out and was stopped.', 504, 'TIMEOUT')
    const stderr = typeof detail.stderr === 'string' ? detail.stderr.trim() : ''
    const stdout = typeof detail.stdout === 'string' ? detail.stdout.trim() : ''
    const message = stderr || stdout || String(detail.message ?? 'command failed')
    throw new ExecTerminalError(message.slice(0, 600), 422, 'COMMAND_FAILED')
  }
}

/**
 * Split one command line into words the way a small shell would:
 * single/double quotes and backslash escapes honoured, no expansion,
 * no variables, no command substitution, no pipes, no redirects.
 * Anything shell-like that is not plain quoting is rejected.
 */
export function splitCommandLine(input: string): string[] {
  const words: string[] = []
  let current = ''
  let quote: "'" | '"' | undefined
  let inWord = false
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]!
    if (quote) {
      if (ch === quote) { quote = undefined; continue }
      if (quote === '"' && ch === '\\' && i + 1 < input.length) { current += input[i + 1]!; i += 1; continue }
      current += ch
      continue
    }
    if (ch === "'" || ch === '"') { quote = ch; inWord = true; continue }
    if (ch === '\\') {
      if (i + 1 >= input.length) throw new ExecTerminalError('A trailing backslash means nothing; remove it.', 400, 'INVALID_COMMAND')
      current += input[i + 1]!
      i += 1
      inWord = true
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\n') {
      if (inWord) { words.push(current); current = ''; inWord = false }
      continue
    }
    // Shell metacharacters are never allowed: this box builds argv, not a shell line.
    if ('`|&;<>()$!*?~#{}'.includes(ch)) {
      throw new ExecTerminalError(`Character "${ch}" is not allowed here; this box runs one hermes command, not a shell line.`, 400, 'INVALID_COMMAND')
    }
    current += ch
    inWord = true
  }
  if (quote) throw new ExecTerminalError('An unterminated quote; close it or remove it.', 400, 'INVALID_COMMAND')
  if (inWord) words.push(current)
  return words
}

const SAFE_VALUE = /^[A-Za-z0-9_][A-Za-z0-9_.\-/:@+,=]*$/

function requireSafeValue(value: string, field: string): string {
  if (!value) throw new ExecTerminalError(`${field} is required.`, 400, 'INVALID_COMMAND')
  if (value.length > 200) throw new ExecTerminalError(`${field} is too long (max 200).`, 400, 'INVALID_COMMAND')
  if (!SAFE_VALUE.test(value)) throw new ExecTerminalError(`${field} has characters this box does not accept.`, 400, 'INVALID_COMMAND')
  return value
}

const BOARD_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/
const PROFILE_NAME = /^[a-z0-9]{1,32}$/

/**
 * The allowlist. Every argv the terminal may run is built here, from parsed
 * words, never from raw text. `hermes` itself is stripped before matching.
 *
 * Read-only on purpose: anything that creates, renames, deletes, claims,
 * completes, blocks, comments, assigns, exports or chat-streams stays on the
 * dedicated Admin/TaskBoard forms with their own guards and confirmations.
 */
export function buildAllowedArgv(words: string[]): string[] {
  const [head, ...tail] = words
  if (!head) throw new ExecTerminalError('Type a hermes command first.', 400, 'INVALID_COMMAND')
  if (head !== 'hermes') throw new ExecTerminalError('Only hermes commands run here; it must start with "hermes".', 400, 'INVALID_COMMAND')

  const fail = (): never => {
    throw new ExecTerminalError(
      'That verb is not on the terminal allowlist. Try: hermes config get model, hermes kanban show, hermes chat "question".',
      400,
      'INVALID_COMMAND',
    )
  }

  // hermes config get <dotted.key>  (read-only; set stays on the Model form)
  if (tail[0] === 'config' && tail[1] === 'get' && tail.length === 3) {
    const key = tail[2]!
    if (!/^[a-z0-9]+(\.[a-z0-9_]+){0,3}$/.test(key)) throw new ExecTerminalError('Invalid config key.', 400, 'INVALID_COMMAND')
    return ['config', 'get', key]
  }
  if (tail[0] === 'config' && tail[1] === 'set') {
    throw new ExecTerminalError('config set stays on the Model form (it needs the agent picker + audit). Read with config get here.', 400, 'INVALID_COMMAND')
  }
  // hermes model  (alias some installs have for listing/selecting models)
  if (tail[0] === 'model' && (tail.length === 1 || (tail.length === 2 && (tail[1] === 'list' || tail[1] === 'show')))) {
    return tail.length === 1 ? ['model'] : ['model', tail[1]!]
  }
  // hermes -p <profile> config get <key>
  if (tail[0] === '-p' && tail.length === 5 && tail[2] && PROFILE_NAME.test(tail[2]) && tail[3] === 'config' && tail[4] && tail[4] === 'get') {
    throw new ExecTerminalError('Missing the key: hermes -p <profile> config get <key>.', 400, 'INVALID_COMMAND')
  }
  if (tail[0] === '-p' && tail.length === 6 && tail[2] && PROFILE_NAME.test(tail[2]) && tail[3] === 'config' && tail[4] === 'get' && tail[5]) {
    const key = tail[5]!
    if (!/^[a-z0-9]+(\.[a-z0-9_]+){0,3}$/.test(key)) throw new ExecTerminalError('Invalid config key.', 400, 'INVALID_COMMAND')
    return ['-p', tail[2], 'config', 'get', key]
  }
  // hermes profile list | show <name>
  if (tail[0] === 'profile' && tail.length === 2 && tail[1] === 'list') return ['profile', 'list']
  if (tail[0] === 'profile' && tail.length === 3 && tail[1] === 'show' && tail[2] && PROFILE_NAME.test(tail[2])) {
    return ['profile', 'show', tail[2]]
  }
  // hermes kanban <read verbs>: show | list | boards | get <id> | view <id>
  // The global --board may precede the subcommand (mirrors kanban-write.ts).
  if (tail[0] === 'kanban' && tail.length >= 2) {
    let rest = tail.slice(1)
    let board: string | undefined
    if (rest[0] === '--board' && rest[1] && BOARD_SLUG.test(rest[1])) { board = rest[1]; rest = rest.slice(2) }
    const verb = rest[0]!
    const args = rest.slice(1)
    const withBoard = (inner: string[]): string[] => (board ? ['kanban', '--board', board, ...inner] : ['kanban', ...inner])
    // `show`/`list`/`boards` with no id = the board overview itself.
    if ((verb === 'show' || verb === 'list' || verb === 'boards') && args.length === 0) return withBoard([verb])
    // `get`/`view` take a task id; `boards` never takes one.
    if ((verb === 'get' || verb === 'view') && args.length === 1 && TASK_ID.test(args[0]!)) return withBoard([verb, args[0]!])
    return fail()
  }
  // hermes cron list | show <id>   (read-only; schedule/pause stay on Calendar)
  if (tail[0] === 'cron' && tail.length === 2 && tail[1] === 'list') return ['cron', 'list']
  if (tail[0] === 'cron' && tail.length === 3 && tail[1] === 'show') {
    return ['cron', 'show', requireSafeValue(tail[2]!, 'cron id')]
  }
  // hermes chat "one question"  (single answer, no streaming flags)
  if (tail[0] === 'chat' && tail.length >= 2) {
    const question = tail.slice(1).join(' ')
    if (!question.trim()) throw new ExecTerminalError('chat needs a question: hermes chat "halo".', 400, 'INVALID_COMMAND')
    if (question.length > 2000) throw new ExecTerminalError('That question is too long (max 2000).', 400, 'INVALID_COMMAND')
    if (tail.slice(1).some((word) => word.startsWith('-'))) {
      throw new ExecTerminalError('chat here takes only the question text; flags stay in the real CLI.', 400, 'INVALID_COMMAND')
    }
    return ['chat', question.trim()]
  }
  // Bare read helpers some installs document.
  if (tail.length === 1 && (tail[0] === '--help' || tail[0] === '--version' || tail[0] === 'help' || tail[0] === 'version')) {
    return [tail[0]!]
  }
  return fail()
}

function authorised(request: Request, token: string): boolean {
  const header = request.get('authorization') ?? ''
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : ''
  const provided = bearer || (typeof request.get('x-ruang-write-token') === 'string' ? request.get('x-ruang-write-token')!.trim() : '')
  if (provided.length !== token.length) return false
  let mismatch = 0
  for (let index = 0; index < token.length; index += 1) mismatch |= provided.charCodeAt(index) ^ token.charCodeAt(index)
  return mismatch === 0
}

export function installExecTerminal(app: Express, roleOf?: (request: Request) => Promise<Role | undefined>): void {
  const token = (process.env.RUANG_WRITE_TOKEN || '').trim()
  if (!token) {
    app.get('/api/exec/write-status', (_request: Request, response: Response) => {
      response.json({ enabled: false, reason: 'RUANG_WRITE_TOKEN is not set.' })
    })
    return
  }

  // Reading whether the terminal is on (and its recent history) is not itself
  // a run, so the Admin page can check without a token — same as the other
  // write layers. Registered BEFORE the guard below.
  app.get('/api/exec/write-status', (_request: Request, response: Response) => {
    response.json({ enabled: true, history: auditLog.slice(0, HISTORY_LIMIT) })
  })

  app.get('/api/exec/history', (_request: Request, response: Response) => {
    response.json({ entries: auditLog.slice(0, 100) })
  })

  app.use('/api/exec', express.json({ limit: '16kb' }), async (request: Request, response: Response, next: NextFunction) => {
    // A browser preflight carries neither cookie nor token; letting it through
    // is what allows the real POST to be sent at all. Ruang answers no CORS
    // headers, so this grants nothing cross-site.
    if (request.method === 'OPTIONS') return next()
    // A vendor session may read the board but must never run the owner's shell.
    if (roleOf && (await roleOf(request)) === 'vendor') return response.status(403).json({ error: 'Only an admin session can run the terminal.', adminOnly: true })
    if (!authorised(request, token)) {
      return response.status(401).json({ error: 'Write token required.', enabled: true })
    }
    return next()
  })

  app.post('/api/exec', async (request: Request, response: Response) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    const command = typeof body.command === 'string' ? body.command : ''
    if (!command.trim()) { response.status(400).json({ ok: false, error: 'Type a hermes command first.', code: 'INVALID_COMMAND' }); return }
    if (command.length > 4000) { response.status(400).json({ ok: false, error: 'That line is too long (max 4000).', code: 'INVALID_COMMAND' }); return }
    let argv: string[] = []
    try {
      argv = buildAllowedArgv(splitCommandLine(command))
      const output = await hermes(argv)
      record({ at: new Date().toISOString(), action: 'exec', target: argv.join(' ').slice(0, 200), ok: true })
      response.json({ ok: true, argv, output })
    } catch (error) {
      const failure = error instanceof ExecTerminalError ? error : new ExecTerminalError(String((error as Error)?.message ?? error), 500, 'INTERNAL')
      record({ at: new Date().toISOString(), action: 'exec', target: (argv.join(' ') || command).slice(0, 200), ok: false, detail: failure.message })
      response.status(failure.status).json({ ok: false, error: failure.message, code: failure.code })
    }
  })
}
