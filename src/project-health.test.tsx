import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// The page polls two endpoints; stub the hook so the render is deterministic and offline.
const mockPolling = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock('./polling.ts', () => ({
  RefreshContext: {},
  usePolling: (path: string) => mockPolling.current[path],
}))

const { ProjectHealth, humanDuration } = await import('./pages/ProjectHealth.tsx')

// Shapes below are the real responses captured from the host on 2026-10-28.
const READY = { status: 'ready' as const, refreshing: false, refresh: () => {} }

function renderWith(stats: unknown, stuck: unknown) {
  mockPolling.current = {
    '/api/board-stats': { ...READY, data: stats },
    '/api/stuck': { ...READY, data: stuck },
  }
  return renderToStaticMarkup(<ProjectHealth/>)
}

const REAL_STATS = {
  availability: 'available' as const,
  data: {
    'divisia-demo': {
      byStatus: { triage: 0, todo: 0, scheduled: 0, ready: 3, running: 2, blocked: 2, done: 3 },
      total: 10,
      oldestReadySeconds: 983,
    },
    default: { byStatus: { triage: 0, todo: 0, scheduled: 0, ready: 1, running: 0, blocked: 0, done: 0 }, total: 1 },
  },
}

const REAL_STUCK = {
  availability: 'available' as const,
  data: [{ id: 't_bf59f78e', title: 'Kurasi 10 akun IG kompetitor', status: 'blocked', board: 'divisia-demo', reason: 'blocked' as const, ageHours: 14 }],
  thresholdHours: 48,
  fetchedAt: '2026-10-29T04:54:06.565Z',
}

describe('ProjectHealth render', () => {
  it('renders both boards with real counts and the oldest ready age', () => {
    const markup = renderWith(REAL_STATS, REAL_STUCK)
    expect(markup).toContain('divisia-demo')
    expect(markup).toContain('default')
    expect(markup).toContain('10 task')
    expect(markup).toContain('16m') // 983s, readable instead of raw seconds
    expect(markup).toContain('health-bar')
    expect(markup).toContain('1 needs attention')
  })

  it('lists the stuck task with its board and reason', () => {
    const markup = renderWith(REAL_STATS, REAL_STUCK)
    expect(markup).toContain('Kurasi 10 akun IG kompetitor')
    expect(markup).toContain('blocked')
    expect(markup).toContain('14h old')
  })

  it('does not invent an age for a board that reported none', () => {
    // `default` has no oldestReadySeconds. Render it alone: the row must be absent entirely
    // rather than showing 0s. divisia-demo does have one, so mixing both would hide a bug.
    const onlyDefault = { availability: 'available' as const, data: { default: REAL_STATS.data.default } }
    const markup = renderWith(onlyDefault, { ...REAL_STUCK, data: [] })
    expect(markup).toContain('1 task')
    expect(markup).not.toContain('Oldest waiting in ready')
  })

  it('shows the empty state when Hermes reports no boards', () => {
    const markup = renderWith({ availability: 'available', data: {} }, { availability: 'available', data: [], thresholdHours: 48, fetchedAt: 'x' })
    expect(markup).toContain('No boards reported')
  })

  it('shows Unavailable rather than zeros when the source is down', () => {
    const markup = renderWith({ availability: 'unavailable', data: {}, error: { code: 'COMMAND_FAILED', message: 'Command not installed or not on PATH.' } }, REAL_STUCK)
    expect(markup).not.toContain('No tasks on this board yet')
    expect(markup).not.toContain('No boards reported')
  })

  it('says nothing is stuck when the list is empty', () => {
    const markup = renderWith(REAL_STATS, { ...REAL_STUCK, data: [] })
    expect(markup).toContain('Nothing is blocked or waiting too long')
  })
})

describe('humanDuration', () => {
  it.each([[0, '0s'], [4, '4s'], [59, '59s'], [60, '1m'], [983, '16m'], [3600, '1h'], [86_400, '1d'], [172_800, '2d']])('%i seconds -> %s', (seconds, expected) => {
    expect(humanDuration(seconds)).toBe(expected)
  })

  it('returns undefined when the board reported no age', () => {
    expect(humanDuration(undefined)).toBeUndefined()
    expect(humanDuration(Number.NaN)).toBeUndefined()
    expect(humanDuration(-5)).toBeUndefined()
  })
})
