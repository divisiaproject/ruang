import { mkdtemp } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { AccessStore, Throttle, installAccess, issueToken } from './access.js'
import { installExecTerminal, buildAllowedArgv, splitCommandLine } from './exec-terminal.js'

// The owner terminal must behave like the other write layers: OPTIONS passes,
// vendor is refused with 403 even holding the token, and anything off the
// allowlist is rejected before a process is ever spawned.
const CODE = 'correct-horse-battery'
const VENDOR = 'vendor-code-abc123'
const TOKEN = 'exec-terminal-test-token'
const servers: { close: () => void }[] = []
let base = ''
let adminCookie = ''
let vendorCookie = ''

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  delete process.env.RUANG_WRITE_TOKEN
})

async function locked() {
  const dir = await mkdtemp(join(tmpdir(), 'ruang-exec-'))
  process.env.RUANG_WRITE_TOKEN = TOKEN
  const store = new AccessStore(dir)
  const file = await store.set(CODE, VENDOR)
  const app = express()
  const roleOf = installAccess(app, store, new Throttle())
  installExecTerminal(app, roleOf)
  app.post('/api/agents', (_request, response) => { response.json({ ok: true }) })
  const server = app.listen(0, '127.0.0.1')
  servers.push(server)
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  adminCookie = `ruang_session=${issueToken(file, false, Date.now(), 'admin')}`
  vendorCookie = `ruang_session=${issueToken(file, false, Date.now(), 'vendor')}`
}

const run = (command: string, cookie: string, token = TOKEN) =>
  fetch(`${base}/api/exec`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ruang-request': '1', cookie, authorization: 'Bearer ' + token },
    body: JSON.stringify({ command }),
  })

describe('exec terminal preflight and roles', () => {
  it('answers OPTIONS instead of locking it out', async () => {
    await locked()
    const response = await fetch(`${base}/api/exec`, { method: 'OPTIONS', headers: { origin: base, 'access-control-request-method': 'POST' } })
    expect(response.status).not.toBe(401)
  })

  it('refuses a vendor session even with the write token', async () => {
    await locked()
    const response = await run('hermes config get model', vendorCookie)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ adminOnly: true })
  })

  it('requires the write token even for an admin session', async () => {
    await locked()
    const response = await run('hermes config get model', adminCookie, 'wrong-token')
    expect(response.status).toBe(401)
  })

  it('rejects shell metacharacters before spawning anything', async () => {
    await locked()
    const response = await run('hermes config get model; touch /tmp/pwned-exec', adminCookie)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_COMMAND' })
  })

  it('rejects profile create: mutation stays on the Admin forms', async () => {
    await locked()
    const response = await run('hermes profile create leadagent', adminCookie)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_COMMAND' })
  })

  it('rejects kanban claim: task writes stay on the TaskBoard forms', async () => {
    await locked()
    const response = await run('hermes kanban --board default claim abc123', adminCookie)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_COMMAND' })
  })
})

describe('exec terminal allowlist', () => {
  it('builds clean argv for read verbs', () => {
    expect(buildAllowedArgv(splitCommandLine('hermes config get model'))).toEqual(['config', 'get', 'model'])
    expect(buildAllowedArgv(splitCommandLine('hermes kanban show'))).toEqual(['kanban', 'show'])
    expect(buildAllowedArgv(splitCommandLine('hermes kanban --board default boards'))).toEqual(['kanban', '--board', 'default', 'boards'])
    expect(buildAllowedArgv(splitCommandLine('hermes kanban --board default get abc123'))).toEqual(['kanban', '--board', 'default', 'get', 'abc123'])
    expect(buildAllowedArgv(splitCommandLine('hermes profile list'))).toEqual(['profile', 'list'])
    expect(buildAllowedArgv(splitCommandLine('hermes --version'))).toEqual(['--version'])
  })

  it('keeps quoted chat text as one argv element', () => {
    expect(buildAllowedArgv(splitCommandLine('hermes chat "halo apa kabar"'))).toEqual(['chat', 'halo apa kabar'])
  })

  it('refuses pipes, redirects, substitution and flags-smuggling', () => {
    for (const line of [
      'hermes config get model | cat',
      'hermes config get model > /tmp/x',
      'hermes config get $(whoami)',
      'hermes chat --attach file.txt halo',
      'rm -rf /',
      'hermes config set model.default deepseek-v4.1-flash',
      'hermes profile delete leadagent',
    ]) {
      expect(() => buildAllowedArgv(splitCommandLine(line)), line).toThrow()
    }
  })
})
