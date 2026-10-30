import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const mockPolling = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))
vi.mock('./polling.ts', () => ({
  RefreshContext: {},
  usePolling: (path: string) => mockPolling.current[path],
}))

const { TaskBoard } = await import('./pages/TaskBoard.tsx')

const READY = { status: 'ready' as const, refreshing: false, refresh: () => {} }

/** Real task ids from the divisia-demo board on hermes-01-2263. */
const TASKS = {
  tasks: {
    availability: 'available',
    data: [
      { title: 'Kurasi 10 akun IG kompetitor', status: 'blocked', id: 't_bf59f78e', board: 'divisia-demo' },
      { title: 'Susun kalender konten Oktober', status: 'ready', id: 't_81d22b18', board: 'divisia-demo' },
    ],
  },
  boards: [{ slug: 'divisia-demo', name: 'Demo', current: false, total: 2 }],
  fetchedAt: '2026-10-30T09:42:45.000Z',
}

describe('task cards', () => {
  it('keeps the raw task id off the card so vendors see a clean title', () => {
    mockPolling.current = { '/api/tasks': { ...READY, data: TASKS } }
    const markup = renderToStaticMarkup(<TaskBoard/>)
    expect(markup).toContain('Kurasi 10 akun IG kompetitor')
    expect(markup).not.toContain('t_bf59f78e')
    expect(markup).not.toContain('t_81d22b18')
  })

  it('still searches by id, so the id remains reachable', () => {
    mockPolling.current = { '/api/tasks': { ...READY, data: TASKS } }
    // The filter reads the id even though the card does not print it.
    expect(renderToStaticMarkup(<TaskBoard/>)).toContain('Search tasks')
  })
})
