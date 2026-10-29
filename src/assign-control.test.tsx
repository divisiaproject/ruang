import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ status: {} as Record<string, unknown>, token: '' }))
vi.mock('./polling.ts', () => ({ RefreshContext: {}, usePolling: (path: string) => mock.status[path] }))
vi.mock('./write-token.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./write-token.ts')>()
  return { ...actual, readWriteToken: () => mock.token }
})

const { AssignControl } = await import('./AssignControl.tsx')

const READY = { status: 'ready' as const, refreshing: false, refresh: () => {} }

/** A profile list with one agent, and a board that already uses one vendor label. */
function wire({ profilesKnown = true, enabled = true, profiles = ['leadagent'], used = ['CV Sinar Jaya'] } = {}) {
  mock.token = 'tok'
  mock.status = {
    '/api/kanban/write-status': { ...READY, data: { enabled } },
    '/api/runtime': {
      ...READY,
      data: { profiles: profilesKnown ? { availability: 'available', data: profiles.map((name: string) => ({ name, model: 'm', gateway: 'Running' })) } : { availability: 'unavailable', data: [] }, openCode: { availability: 'unavailable', data: '' }, fetchedAt: 'x' },
    },
    '/api/tasks': { ...READY, data: { tasks: { availability: 'available', data: used.map((assignee: string) => ({ title: 't', status: 'ready', assignee })) }, fetchedAt: 'x' } },
  }
}

const render = () => renderToStaticMarkup(<AssignControl taskId="t_abc123" board="divisia-demo"/>)

describe('AssignControl', () => {
  it('renders nothing when writes are disabled on the server', () => {
    wire({ enabled: false })
    expect(render()).toBe('')
  })

  it('renders nothing without a stored token', () => {
    wire()
    mock.token = ''
    expect(render()).toBe('')
  })

  it('marks the Hermes profile as an agent and the vendor as a label', () => {
    wire()
    const markup = render()
    expect(markup).toContain('leadagent · agent')
    expect(markup).toContain('CV Sinar Jaya · label')
  })

  it('never presents a vendor label as an agent', () => {
    wire()
    expect(render()).not.toContain('CV Sinar Jaya · agent')
  })

  it('says agent names are unknown when the profile list is unavailable', () => {
    wire({ profilesKnown: false })
    const markup = render()
    expect(markup).toContain('Profile list unavailable')
    expect(markup).not.toContain('No Hermes profiles exist')
  })

  it('says plainly when no profiles exist at all', () => {
    wire({ profiles: [] })
    expect(render()).toContain('No Hermes profiles exist yet')
  })

  it('offers a free-text field, labelled as a plain label', () => {
    wire()
    const markup = render()
    expect(markup).toContain('Assign label')
    expect(markup).toContain('plain label')
  })

  it('lists only evidence-backed names, never invented ones', () => {
    wire({ profiles: ['leadagent'], used: ['CV Sinar Jaya'] })
    const markup = render()
    const count = (markup.match(/· (agent|label)/g) ?? []).length
    expect(count).toBe(2)
  })
})
