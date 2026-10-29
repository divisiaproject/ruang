import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ status: {} as Record<string, unknown>, token: '' }))
vi.mock('./polling.ts', () => ({ RefreshContext: {}, usePolling: (path: string) => mock.status[path] }))
vi.mock('./write-token.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./write-token.ts')>()
  return { ...actual, readWriteToken: () => mock.token }
})

const { TaskActions } = await import('./TaskActions.tsx')

const READY = { status: 'ready' as const, refreshing: false, refresh: () => {} }

function render(serverEnabled: boolean, token: string) {
  mock.status = { '/api/kanban/write-status': { ...READY, data: { enabled: serverEnabled } } }
  mock.token = token
  return renderToStaticMarkup(<TaskActions taskId="t_abc123" board="divisia-demo"/>)
}

describe('TaskActions visibility', () => {
  it('renders nothing when the server has writes disabled', () => {
    // No token prompt, no buttons: a read-only Ruang must look untouched.
    expect(render(false, 'some-token')).toBe('')
  })

  it('renders nothing without a task id to address', () => {
    mock.status = { '/api/kanban/write-status': { ...READY, data: { enabled: true } } }
    mock.token = 'tok'
    expect(renderToStaticMarkup(<TaskActions board="divisia-demo"/>)).toBe('')
  })

  it('renders nothing without a board, since every route is board-scoped', () => {
    mock.status = { '/api/kanban/write-status': { ...READY, data: { enabled: true } } }
    mock.token = 'tok'
    expect(renderToStaticMarkup(<TaskActions taskId="t_abc123"/>)).toBe('')
  })

  it('asks for a token when writes are on but none is stored', () => {
    const markup = render(true, '')
    expect(markup).toContain('Save token')
    expect(markup).toContain('stored in this browser only')
    expect(markup).not.toContain('>Complete<')
  })

  it('shows the verbs once a token is stored', () => {
    const markup = render(true, 'stored-token')
    for (const label of ['Claim', 'Complete', 'Block', 'Unblock', 'Promote']) expect(markup).toContain(label)
  })

  it('warns that writes need the server token too', () => {
    expect(render(true, 'stored-token')).toContain('RUANG_WRITE_TOKEN set')
  })

  it('never renders the token itself into the page', () => {
    expect(render(true, 'super-secret-value')).not.toContain('super-secret-value')
  })
})
