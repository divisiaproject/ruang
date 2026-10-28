import { describe, expect, it } from 'vitest'
import { parseTasks, stuckTasks, STUCK_READY_HOURS } from './mission-control.js'

// Verbatim `hermes kanban list --json` payload from Hermes v0.19.0 (2026-10-28).
const REAL_LIST = JSON.stringify([
  {
    id: 't_764ca198',
    title: 'cek bentuk data',
    body: null,
    assignee: null,
    status: 'ready',
    priority: 0,
    tenant: null,
    workspace_kind: 'scratch',
    workspace_path: null,
    branch_name: null,
    project_id: null,
    created_by: 'user',
    created_at: 1793198807,
    started_at: null,
    completed_at: null,
    result: null,
    skills: [],
    max_retries: null,
    session_id: null,
    workflow_template_id: null,
    current_step_key: null,
  },
])

const NOW = 1793198807 * 1000 // exactly the task's creation moment
const HOUR = 3_600_000

describe('parseTasks createdAt', () => {
  it('reads created_at epoch seconds as ISO, matching the real payload', () => {
    const [task] = parseTasks(REAL_LIST)
    expect(task.id).toBe('t_764ca198')
    expect(task.status).toBe('ready')
    expect(task.createdAt).toBe('2026-10-28T14:46:47.000Z')
    expect(task.priority).toBe(0)
  })

  it('leaves createdAt undefined when the field is missing', () => {
    const [task] = parseTasks(JSON.stringify([{ id: 't_1', title: 'x', status: 'ready' }]))
    expect(task.createdAt).toBeUndefined()
  })
})

describe('stuckTasks', () => {
  const ready = (id: string, createdAt: string) => ({ id, title: id, status: 'ready', createdAt })
  const blocked = (id: string, createdAt?: string) => ({ id, title: id, status: 'blocked', ...(createdAt ? { createdAt } : {}) })

  it('surfaces every blocked task regardless of age', () => {
    const fresh = new Date(NOW).toISOString()
    const result = stuckTasks([blocked('b1', fresh)], NOW)
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('blocked')
    expect(result[0].ageHours).toBe(0)
  })

  it('surfaces a blocked task that has no createdAt at all', () => {
    const result = stuckTasks([blocked('b1')], NOW)
    expect(result).toHaveLength(1)
    expect(result[0].reason).toBe('blocked')
    expect(result[0].ageHours).toBeUndefined()
  })

  it('surfaces ready tasks only past the threshold', () => {
    const young = new Date(NOW - (STUCK_READY_HOURS - 1) * HOUR).toISOString()
    const old = new Date(NOW - (STUCK_READY_HOURS + 5) * HOUR).toISOString()
    const result = stuckTasks([ready('young', young), ready('old', old)], NOW)
    expect(result.map((t) => t.id)).toEqual(['old'])
    expect(result[0].reason).toBe('waiting')
    expect(result[0].ageHours).toBe(STUCK_READY_HOURS + 5)
  })

  it('never ages a ready task without a createdAt', () => {
    expect(stuckTasks([{ id: 'x', title: 'x', status: 'ready' }], NOW)).toEqual([])
  })

  it('ignores done, todo, triage and running', () => {
    const old = new Date(NOW - 500 * HOUR).toISOString()
    const tasks = ['done', 'todo', 'triage', 'running'].map((status) => ({ id: status, title: status, status, createdAt: old }))
    expect(stuckTasks(tasks, NOW)).toEqual([])
  })

  it('puts blocked before waiting', () => {
    const veryOld = new Date(NOW - 900 * HOUR).toISOString()
    const result = stuckTasks([ready('slow', veryOld), blocked('stuck', veryOld)], NOW)
    expect(result.map((t) => t.reason)).toEqual(['blocked', 'waiting'])
  })

  it('honours a custom threshold', () => {
    const twoHours = new Date(NOW - 2 * HOUR).toISOString()
    expect(stuckTasks([ready('r', twoHours)], NOW, 1)).toHaveLength(1)
    expect(stuckTasks([ready('r', twoHours)], NOW, 3)).toHaveLength(0)
  })

  it('handles a future-dated task without producing a negative age', () => {
    const future = new Date(NOW + 10 * HOUR).toISOString()
    const result = stuckTasks([blocked('b', future)], NOW)
    expect(result[0].ageHours).toBe(0)
  })

  it('carries assignee and board through', () => {
    const result = stuckTasks([{ id: 't', title: 't', status: 'blocked', assignee: 'leadagent', board: 'divisia' }], NOW)
    expect(result[0]).toMatchObject({ assignee: 'leadagent', board: 'divisia' })
  })
})
