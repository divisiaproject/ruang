import { mkdtemp } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import express from 'express'
import { afterEach, describe, expect, it } from 'vitest'
import { AccessStore, installAccess } from './access.js'

// A locked Ruang still has to answer the browser's preflight, or every write form dies
// in the browser before its real request is sent. This is the bug that made a successful
// agent creation look like "The Ruang API could not be reached".
const servers: { close: () => void }[] = []

afterEach(() => { for (const server of servers.splice(0)) server.close() })

async function locked() {
  const dir = await mkdtemp(join(tmpdir(), 'ruang-preflight-'))
  const store = new AccessStore(dir)
  await store.set('admin-code-for-tests')  // a code set means Ruang starts locked
  const app = express()
  installAccess(app, store)
  app.post('/api/agents', (_request, response) => { response.json({ ok: true }) })
  app.get('/api/tasks', (_request, response) => { response.json({ ok: true }) })
  const server = app.listen(0, '127.0.0.1')
  servers.push(server)
  await new Promise((resolve) => server.once('listening', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('CORS preflight through the access gate', () => {
  it('answers OPTIONS on an API route instead of locking it out', async () => {
    const base = await locked()
    const response = await fetch(`${base}/api/agents`, { method: 'OPTIONS', headers: { origin: base, 'access-control-request-method': 'POST' } })
    expect(response.status).not.toBe(401)
  })

  it('still refuses the real POST while locked', async () => {
    const base = await locked()
    const response = await fetch(`${base}/api/agents`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ruang-request': '1' }, body: '{"name":"x"}' })
    expect(response.status).toBe(401)
  })

  it('still refuses a plain GET while locked', async () => {
    const base = await locked()
    const response = await fetch(`${base}/api/tasks`)
    expect(response.status).toBe(401)
  })
})
