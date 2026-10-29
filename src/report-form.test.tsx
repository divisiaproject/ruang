import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { parseReport } from './report.ts'

const mock = vi.hoisted(() => ({ status: {} as Record<string, unknown> }))
vi.mock('./polling.ts', () => ({ RefreshContext: {}, usePolling: (path: string) => mock.status[path] }))

const { ReportForm } = await import('./ReportForm.tsx')

/** Exactly what the write layer stored on the host after the round-trip test. */
const STORED_BODY = '[Vendor: CV Sinar Jaya] [Progres: 60%] [Status: at-risk]\nRevisi 2 sudah dikirim, menunggu approval brand.'

const READY = { status: 'ready' as const, refreshing: false, refresh: () => {} }

function renderForm(enabled: boolean) {
  mock.status = { '/api/kanban/write-status': { ...READY, data: { enabled } } }
  return renderToStaticMarkup(<ReportForm taskId="t_bf59f78e" board="divisia-demo"/>)
}

describe('ReportForm visibility', () => {
  it('renders nothing when the server has writes disabled', () => {
    expect(renderForm(false)).toBe('')
  })

  it('renders nothing without a stored token, matching the write controls', () => {
    // No token in this jsdom localStorage: the form must not appear.
    expect(renderForm(true)).toBe('')
  })
})

describe('stored report parses back into fields', () => {
  it('recovers vendor, percent, status and body from the exact stored text', () => {
    expect(parseReport(STORED_BODY)).toEqual({
      vendor: 'CV Sinar Jaya',
      percent: 60,
      status: 'at-risk',
      body: 'Revisi 2 sudah dikirim, menunggu approval brand.',
    })
  })

  it('keeps the header out of the body so it is not shown twice', () => {
    expect(parseReport(STORED_BODY)?.body).not.toContain('Vendor:')
  })
})
