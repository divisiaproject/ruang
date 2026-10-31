import { displayAgentName } from './identity.ts'
import { readWriteToken } from './write-token.ts'

/** The name a task message should show: OM, not the internal profile id. */
function displayLabel(name: string): string {
  return displayAgentName(name).label
}

/**
 * The two admin forms: creating an agent and creating a Kanban task.
 *
 * Both go through the existing token-gated write layers. The server also checks the
 * session role, so a vendor session is refused with 403 even if it somehow holds the token.
 */

export type FormResult = { ok: true; message: string } | { ok: false; message: string }

async function post(path: string, body: Record<string, unknown>, request: typeof fetch = fetch): Promise<FormResult> {
  const token = readWriteToken()
  if (!token) return { ok: false, message: 'No write token stored yet. Add one below first.' }
  let response: Response
  try {
    response = await request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ruang-request': '1', authorization: 'Bearer ' + token },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, message: 'The browser could not complete the request. Check the connection, then reload this page.' }
  }
  const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined
  if (!response.ok) {
    const detail = typeof payload?.error === 'string' ? payload.error : 'The server answered HTTP ' + response.status + '.'
    return { ok: false, message: detail }
  }
  return { ok: true, message: 'ok' }
}

/** Hermes profile names are lowercase letters and digits only, up to 32 characters. */
export function agentNameProblem(name: string): string | undefined {
  const trimmed = name.trim()
  if (!trimmed) return 'Enter a name for the agent.'
  if (!/^[a-z0-9]{1,32}$/.test(trimmed)) return 'Use lowercase letters and digits only, up to 32 characters.'
  if (trimmed === 'default') return 'The default profile already exists and is protected.'
  return undefined
}

export function agentNameFrom(input: string): string {
  return input.trim().toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32)
}

export async function createAgentForm(input: { name: string; model?: string }, request: typeof fetch = fetch): Promise<FormResult> {
  const problem = agentNameProblem(input.name)
  if (problem) return { ok: false, message: problem }
  const created = await post('/api/agents', { name: input.name.trim() }, request)
  if (!created.ok) return created
  const model = input.model?.trim()
  if (model) {
    const configured = await post('/api/agents/' + encodeURIComponent(input.name.trim()) + '/config', { key: 'model.default', value: model }, request)
    if (!configured.ok) return { ok: true, message: 'Agent created, but the model could not be set: ' + configured.message }
    return { ok: true, message: 'Agent ' + input.name.trim() + ' created with model ' + model + '.' }
  }
  return { ok: true, message: 'Agent ' + input.name.trim() + ' created.' }
}

/** Which board the form should preselect. A demo board is sampled data, so it always loses. */
export function defaultBoard(boards: { slug: string; current?: boolean; total?: number }[]): string | undefined {
  const real = boards.filter((board) => !/demo/.test(board.slug))
  const pick = real.find((board) => board.current)
    ?? real.find((board) => (board.total ?? 0) > 0)
    ?? boards.find((board) => board.current)
    ?? boards[0]
  return pick?.slug
}

/**
 * What the Model field should say about where its suggestions came from. Written so a provider
 * that lists nothing is named as unknown rather than quietly left out.
 */
export function modelNote(input: { available: boolean; models: { provider: string }[]; emptyProviders: { name: string }[] }): string {
  if (!input.available) return 'The model list could not be read, so any model name must be typed by hand.'
  if (input.models.length === 0) return 'No provider lists any model, so type the name by hand.'
  const providers = [...new Set(input.models.map((item) => item.provider))]
  const count = input.models.length
  const base = count + (count === 1 ? ' model from ' : ' models from ') + providers.length + (providers.length === 1 ? ' provider: ' : ' providers: ') + providers.join(', ') + '.'
  return input.emptyProviders.length > 0 ? base + ' No list for ' + input.emptyProviders.map((item) => item.name).join(', ') + '.' : base
}

export function taskTitleProblem(title: string): string | undefined {
  const trimmed = title.trim()
  if (!trimmed) return 'Enter a title for the task.'
  if (trimmed.length > 300) return 'The title is too long (max 300 characters).'
  if (trimmed.startsWith('-')) return 'The title cannot start with a dash.'
  return undefined
}

export async function createTaskForm(input: { title: string; board: string; assignee?: string; body?: string }, request: typeof fetch = fetch): Promise<FormResult> {
  const problem = taskTitleProblem(input.title)
  if (problem) return { ok: false, message: problem }
  const body: Record<string, unknown> = { title: input.title.trim() }
  if (input.assignee?.trim()) body.assignee = input.assignee.trim()
  if (input.body?.trim()) body.body = input.body.trim()
  const created = await post('/api/kanban/' + encodeURIComponent(input.board) + '/tasks', body, request)
  if (!created.ok) return created
  const assigned = input.assignee?.trim()
  return { ok: true, message: 'Task created' + (assigned ? ' and assigned to ' + displayLabel(assigned) + '.' : '.') }
}
