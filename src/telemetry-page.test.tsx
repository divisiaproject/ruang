import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ snapshot: {} as Record<string, unknown> }))
vi.mock('./polling.ts', () => ({
  RefreshContext: {},
  usePolling: (path: string) => mock.snapshot[path],
}))

const { Telemetry } = await import('./pages/Telemetry.tsx')

const READY = { status: 'ready' as const, refreshing: false, refresh: () => {} }

/** Verbatim from hermes-01-2263 via `curl :9101/api/host`, 2026-10-30. */
const REAL_HOST = {
  agent: { kind: 'host', uptime_seconds: 250, hostname: 'hermes-01-2263', platform: 'Linux 7.0.0-38-generic', machine: 'x86_64', python: '3.14.4' },
  time: '2026-10-30T08:19:48+00:00',
  uptime_seconds: 320_400,
  cpu: { count: 2, physical: 2, percent: 2.4, load: [0.22, 0.21, 0.09] },
  memory: { total: 8_246_248_192, available: 4_180_000_000, used: 4_066_248_192, percent: 49.3, swap_percent: 13.1 },
  disks: [{ mount: '/', percent: 77.2 }, { mount: '/boot', percent: 26.6 }, { mount: '/boot/efi', percent: 6.0 }],
  network: { bytes_sent: 1, bytes_recv: 2, interfaces: ['eth0'] },
  temperatures: [],
  docker: { available: true, count: 5, containers: [{ id: 'dc98', name: 'hermes-71a6a5bf', status: 'Up' }] },
  failed_units: [{ unit: 'logrotate.service', state: 'files' }],
  processes: { total: 3, top: [{ pid: 1, name: 'systemd', user: 'root', cpu: 0.1, mem_percent: 0.2 }] },
}

const wire = (data: unknown) => { mock.snapshot = { '/api/host': { ...READY, data } } }
const render = () => renderToStaticMarkup(<Telemetry/>)

describe('Telemetry page', () => {
  it('shows the real host readings', () => {
    wire({ availability: 'available', data: REAL_HOST, fetchedAt: '2026-10-30T08:19:48.000Z' })
    const markup = render()
    expect(markup).toContain('hermes-01-2263')
    expect(markup).toContain('Linux 7.0.0-38-generic')
    expect(markup).toContain('3d 17h')
    expect(markup).toContain('49.3%')
    expect(markup).toContain('77.2%')
  })

  it('marks a high disk as bad and a low one as good', () => {
    wire({ availability: 'available', data: REAL_HOST, fetchedAt: '2026-10-30T08:19:48.000Z' })
    const markup = render()
    expect(markup).toContain('tone-bad')
    expect(markup).toContain('tone-good')
  })

  it('lists a failed systemd unit instead of hiding it', () => {
    wire({ availability: 'available', data: REAL_HOST, fetchedAt: '2026-10-30T08:19:48.000Z' })
    expect(render()).toContain('logrotate.service')
  })

  it('says telemetry is unavailable and shows no numbers when the agent is down', () => {
    wire({ availability: 'unavailable', data: null, fetchedAt: '2026-10-30T08:19:48.000Z', reason: 'Could not reach the host agent at http://127.0.0.1:9101/api/host.' })
    const markup = render()
    expect(markup).toContain('unavailable')
    expect(markup).toContain('Could not reach')
    // The whole point: no fabricated zeroes.
    expect(markup).not.toContain('0.0%')
    expect(markup).not.toContain('hermes-01-2263')
  })

  it('explains that the token was rejected rather than showing an empty host', () => {
    wire({ availability: 'unavailable', data: null, fetchedAt: '2026-10-30T08:19:48.000Z', reason: 'The host agent rejected the token (401).' })
    expect(render()).toContain('rejected the token')
  })
})
