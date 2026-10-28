import { describe, expect, it } from 'vitest'
import { parseStats } from './mission-control.js'

// Verbatim output captured from `hermes kanban stats` on Hermes v0.19.0 (2026-10-28).
const REAL_EMPTY = `By status:
  triage    0
  todo      0
  scheduled  0
  ready     0
  running   0
  blocked   0
  done      0
`

const REAL_COUNTED = `By status:
  triage      3
  todo        8
  scheduled   2
  ready       5
  running     1
  blocked     4
  done       27
`

describe('parseStats', () => {
  it('parses the real empty-board output', () => {
    const stats = parseStats(REAL_EMPTY)
    expect(stats.byStatus).toEqual({ triage: 0, todo: 0, scheduled: 0, ready: 0, running: 0, blocked: 0, done: 0 })
    expect(stats.total).toBe(0)
  })

  it('parses counted statuses and tolerates variable column spacing', () => {
    const stats = parseStats(REAL_COUNTED)
    expect(stats.byStatus.blocked).toBe(4)
    expect(stats.byStatus.ready).toBe(5)
    expect(stats.byStatus.done).toBe(27)
    expect(stats.total).toBe(50)
  })

  it('stops at a later section instead of folding it into the status block', () => {
    const withTail = `${REAL_COUNTED}\nBy assignee:\n  leadagent   12\n`
    const stats = parseStats(withTail)
    expect(stats.byStatus.leadagent).toBeUndefined()
    expect(stats.total).toBe(50)
  })

  it('keeps unknown future statuses rather than dropping them', () => {
    const stats = parseStats('By status:\n  todo   1\n  archived   9\n')
    expect(stats.byStatus.archived).toBe(9)
    expect(stats.total).toBe(10)
  })

  it('throws when there is no status section', () => {
    expect(() => parseStats('no board here')).toThrow(/By status/)
  })

  it('throws when the status section is empty', () => {
    expect(() => parseStats('By status:\n')).toThrow(/empty/)
  })
})
