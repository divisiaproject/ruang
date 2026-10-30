import { mkdtemp } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AccessStore, Throttle, installAccess, issueToken } from './access.js'
import { installAgentWrites } from './agents-write.js'
import { installKanbanWrites } from './kanban-write.js'

// The write layers must never act on behalf of a vendor session, even with a valid write token.
const CODE = 'correct-horse-battery'
const VENDOR = 'vendor-code-abc123'
const TOKEN = 'write-token-for-tests'
let close: () => void
let base: string
let adminCookie: string
let vendorCookie: string

beforeEach(async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ruang-roles-'))
  process.env.RUANG_WRITE_TOKEN = TOKEN
  const store = new AccessStore(dir)
  const file = await store.set(CODE, VENDOR)
  const app = express()
  const roleOf = installAccess(app, store, new Throttle())
  installAgentWrites(app, roleOf)
  installKanbanWrites(app, roleOf)
  app.get('/api/secret', (_request, response) => { response.json({ ok: true }) })
  const server = app.listen(0, '127.0.0.1')
  await new Promise((resolve) => server.once('listening', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  close = () => server.close()
  adminCookie = `ruang_session=${issueToken(file, false, Date.now(), 'admin')}`
  vendorCookie = `ruang_session=${issueToken(file, false, Date.now(), 'vendor')}`
})
afterEach(() => { close(); delete process.env.RUANG_WRITE_TOKEN })

const create = (path: string, body: unknown, cookie: string, token = TOKEN) =>
  fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ruang-request': '1', cookie, authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  })

describe('write layers honour the session role', () => {
  it('lets an admin session with the write token create an agent', async () => {
    const response = await create('/api/agents', { name: 'bad name!' }, adminCookie)
    // Off the container there is no hermes binary, so a 400 validation error is the pass here:
    // the point is that the role gate did not stop it.
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 'INVALID_NAME' })
  })

  it('refuses a vendor session the agent form even with the write token', async () => {
    const response = await create('/api/agents', { name: 'leadagent' }, vendorCookie)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ adminOnly: true })
  })

  it('refuses a vendor session creating a Kanban task', async () => {
    const response = await create('/api/kanban/divisia/tasks', { title: 'vendor made this' }, vendorCookie)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ adminOnly: true })
  })

  it('still lets a vendor session read the board', async () => {
    const response = await fetch(`${base}/api/secret`, { headers: { cookie: vendorCookie } })
    expect(response.status).toBe(200)
  })

  it('requires the write token even for an admin session', async () => {
    const response = await create('/api/kanban/divisia/tasks', { title: 'no token' }, adminCookie, 'wrong-token')
    expect(response.status).toBe(401)
  })
})
