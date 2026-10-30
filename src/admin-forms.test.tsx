import { describe, expect, it, vi } from 'vitest'
import { agentNameFrom, agentNameProblem, createAgentForm, createTaskForm, taskTitleProblem } from './admin-forms.ts'

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
