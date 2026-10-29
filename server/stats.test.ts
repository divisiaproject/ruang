import { describe, expect, it } from 'vitest'
import { parseAge, parseStats } from './mission-control.js'

// Verbatim `hermes kanban stats` from Hermes v0.19.0 on the host, board `divisia-demo`
// after seeding 10 tasks (2026-10-28). Note the irregular spacing on `scheduled  0`.
const REAL_NONEMPTY = `By status:
  triage    0
  todo      0
  scheduled  0
  ready     10
  running   0
  blocked   0
  done      0

Oldest ready task age: 4s`

// Verbatim output from the empty `default` board — no "Oldest ready task age" line.
const REAL_EMPTY = `By status:
  triage    0
  todo      0
  scheduled  0
  ready     0
  running   0
  blocked   0
  done      0`

describe('parseStats', () => {
  it('parses the non-empty board verbatim, including oldest ready age', () => {
    const stats = parseStats(REAL_NONEMPTY)
    expect(stats.byStatus).toEqual({ triage: 0, todo: 0, scheduled: 0, ready: 10, running: 0, blocked: 0, done: 0 })
    expect(stats.total).toBe(10)
    expect(stats.oldestReadySeconds).toBe(4)
  })

  it('omits oldestReadySeconds on an empty board rather than inventing 0', () => {
    const stats = parseStats(REAL_EMPTY)
    expect(stats.total).toBe(0)
    expect('oldestReadySeconds' in stats).toBe(false)
  })

  it('still rejects output with no By status section', () => {
    expect(() => parseStats('nonsense')).toThrow(/By status/)
  })
})

describe('parseAge', () => {
  it.each([
    ['4s', 4],
    ['12m', 720],
    ['3h', 10_800],
    ['2d', 172_800],
    ['1w', 604_800],
    ['2d 4h', 187_200],
    ['1w2d', 777_600],
    ['1h 30m 10s', 5_410],
  ])('%s -> %i seconds', (input, expected) => {
    expect(parseAge(input)).toBe(expected)
  })

  it('returns undefined when there is no duration', () => {
    expect(parseAge('—')).toBeUndefined()
    expect(parseAge('')).toBeUndefined()
  })
})
