import { describe, expect, it, vi } from 'vitest'
import { agentNameFrom, agentNameProblem, createAgentForm, createTaskForm, defaultBoard, modelNote, taskTitleProblem } from './admin-forms.ts'

// The forms refuse to send without a stored write token; give them one without touching storage.
vi.mock('./write-token.ts', () => ({ readWriteToken: () => 'test-write-token' }))

// Never touch the network: every case stubs fetch.
const stub = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch

describe('admin form validation', () => {
  it('accepts a plain lowercase profile name and rejects anything Hermes would refuse', () => {
    expect(agentNameProblem('leadagent')).toBeUndefined()
    expect(agentNameProblem('lead-agent')).toMatch(/lowercase letters and digits/)
    expect(agentNameProblem('LeadAgent')).toMatch(/lowercase letters/)
    expect(agentNameProblem('')).toMatch(/Enter a name/)
    expect(agentNameProblem('default')).toMatch(/protected/)
    expect(agentNameProblem('x'.repeat(33))).toMatch(/up to 32/)
  })

  it('turns typed text into a valid profile name instead of sending it raw', () => {
    expect(agentNameFrom('  Lead Agent! ')).toBe('leadagent')
    expect(agentNameFrom('lead_agent-2')).toBe('leadagent2')
  })

  it('rejects a task title that is empty, too long or starts with a dash', () => {
    expect(taskTitleProblem('Kurasi 10 akun')).toBeUndefined()
    expect(taskTitleProblem('   ')).toMatch(/Enter a title/)
    expect(taskTitleProblem('-oops')).toMatch(/dash/)
    expect(taskTitleProblem('x'.repeat(301))).toMatch(/too long/)
  })
})

describe('admin form requests', () => {
  it('creates an agent and then sets its model in a second call', async () => {
    const paths: string[] = []
    const request = (async (url: string) => { paths.push(String(url)); return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }) }) as unknown as typeof fetch
    const result = await createAgentForm({ name: 'leadagent', model: 'minimax-m3.1-flash' }, request)
    expect(result).toMatchObject({ ok: true })
    expect(paths).toEqual(['/api/agents', '/api/agents/leadagent/config'])
  })

  it('reports the server message when the agent cannot be created', async () => {
    const result = await createAgentForm({ name: 'leadagent' }, stub(409, { error: 'Profile already exists.' }))
    expect(result).toMatchObject({ ok: false, message: 'Profile already exists.' })
  })

  it('creates a task on the chosen board and reports who it went to', async () => {
    let sent: Record<string, unknown> = {}
    const request = (async (url: string, init: RequestInit) => {
      sent = { url: String(url), ...JSON.parse(String(init.body)) }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch
    const result = await createTaskForm({ title: 'Kurasi 10 akun', board: 'divisia', assignee: 'vendor-a', body: 'Done means ten rows.' }, request)
    expect(result).toMatchObject({ ok: true, message: 'Task created and assigned to vendor-a.' })
    expect(sent).toMatchObject({ url: '/api/kanban/divisia/tasks', title: 'Kurasi 10 akun', assignee: 'vendor-a', body: 'Done means ten rows.' })
  })

  it('names the default profile OM in the confirmation, never the raw id', async () => {
    const request = (async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as unknown as typeof fetch
    const result = await createTaskForm({ title: 'Untuk OM', board: 'divisia', assignee: 'default' }, request)
    expect(result).toMatchObject({ ok: true, message: 'Task created and assigned to OM.' })
  })

  it('omits an empty assignee so the task is left unassigned', async () => {
    let sent: Record<string, unknown> = {}
    const request = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body))
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as unknown as typeof fetch
    await createTaskForm({ title: 'Tanpa assignee', board: 'divisia', assignee: '  ' }, request)
    expect('assignee' in sent).toBe(false)
  })

  it('never calls the server for an invalid title', async () => {
    let called = false
    const request = (async () => { called = true; return new Response('{}', { status: 200 }) }) as unknown as typeof fetch
    expect(await createTaskForm({ title: '', board: 'divisia' }, request)).toMatchObject({ ok: false })
    expect(called).toBe(false)
  })
})

describe('defaultBoard', () => {
  // The live host really looks like this: no `divisia` board, real work in `default`.
  const live = [{ slug: 'default', current: true, total: 1 }, { slug: 'divisia-demo', current: false, total: 11 }]

  it('picks the current real board, not the demo board with more tasks', () => {
    expect(defaultBoard(live)).toBe('default')
  })

  it('picks a real board with tasks when it is not the current one', () => {
    expect(defaultBoard([{ slug: 'divisia-demo', current: true, total: 11 }, { slug: 'default', current: false, total: 3 }])).toBe('default')
  })

  it('falls back to a demo board only when nothing real exists', () => {
    expect(defaultBoard([{ slug: 'divisia-demo', current: true, total: 11 }])).toBe('divisia-demo')
  })

  it('has nothing to pick from an empty list', () => {
    expect(defaultBoard([])).toBeUndefined()
  })
})

describe('modelNote', () => {
  const live = {
    available: true,
    models: [{ provider: 'Kunciai.id' }, { provider: 'Api.ezkielyna.store' }, { provider: 'Api.ezkielyna.store' }],
    emptyProviders: [{ name: 'Kiyararouter.web.id' }],
  }

  it('names every provider and admits the ones with no list', () => {
    const note = modelNote(live)
    expect(note).toContain('3 models from 2 providers')
    expect(note).toContain('Kunciai.id, Api.ezkielyna.store')
    expect(note).toContain('No list for Kiyararouter.web.id')
  })

  it('says the list could not be read rather than showing an empty picker', () => {
    expect(modelNote({ available: false, models: [], emptyProviders: [] })).toMatch(/could not be read/)
  })

  it('says so when no provider lists anything', () => {
    expect(modelNote({ available: true, models: [], emptyProviders: [{ name: 'X' }] })).toMatch(/type the name by hand/)
  })

  it('stays quiet about missing lists when every provider has one', () => {
    expect(modelNote({ available: true, models: [{ provider: 'A' }], emptyProviders: [] })).toBe('1 model from 1 provider: A.')
  })
})
