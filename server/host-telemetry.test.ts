import { afterEach, describe, expect, it } from 'vitest'
import { createServer, type Server } from 'node:http'
import { fetchHostTelemetry, gb, hostAgentUrl, humanUptime } from './host-telemetry.js'

/** Real shape, taken from hermes-01-2263 via `curl /api/host` on 2026-10-30. */
const REAL = {
  agent: { kind: 'host', uptime_seconds: 250, hostname: 'hermes-01-2263', platform: 'Linux 7.0.0-38-generic', machine: 'x86_64', python: '3.14.4' },
  time: '2026-10-30T08:19:48+00:00',
  uptime_seconds: 320_400,
  cpu: { count: 2, physical: 2, percent: 2.4, load: [0.22, 0.21, 0.09] },
  memory: { total: 8_246_248_192, available: 4_180_000_000, used: 4_066_248_192, percent: 49.3, swap_total: 4_294_967_296, swap_used: 562_036_736, swap_percent: 13.1 },
  disks: [
    { mount: '/', device: '/dev/sda1', fstype: 'ext4', total: 100_000_000_000, used: 77_200_000_000, percent: 77.2 },
    { mount: '/boot', percent: 26.6 },
    { mount: '/boot/efi', percent: 6.0 },
  ],
  network: { bytes_sent: 1234, bytes_recv: 5678, interfaces: ['eth0'] },
  temperatures: [],
  docker: { available: true, count: 5, containers: [{ id: 'dc982d03ca38', name: 'hermes-71a6a5bf', status: 'Up', image: 'nikolaik/python-nodejs' }] },
  failed_units: [{ unit: 'logrotate.service', state: 'files' }],
  processes: { total: 3, top: [{ pid: 1, name: 'systemd', user: 'root', cpu: 0.1, mem_percent: 0.2, rss_mb: 12.5, cmd: '/sbin/init' }] },
}

let server: Server | undefined
const listen = (handler: Parameters<typeof createServer>[1]) =>
  new Promise<string>((resolve) => {
    server = createServer(handler)
    server.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      resolve(`http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/host`)
    })
  })

afterEach(() => { server?.close(); server = undefined })

describe('fetchHostTelemetry', () => {
  it('passes the agent payload through unchanged', async () => {
    const url = await listen((request, response) => {
      expect(request.headers['x-mc-token']).toBe('tok')
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(REAL))
    })
    const snapshot = await fetchHostTelemetry({ url, token: 'tok' })
    expect(snapshot.availability).toBe('available')
    expect(snapshot.data?.agent.hostname).toBe('hermes-01-2263')
    expect(snapshot.data?.cpu.percent).toBe(2.4)
    expect(snapshot.data?.disks[0].percent).toBe(77.2)
    expect(snapshot.data?.docker.count).toBe(5)
  })

  it('reports a rejected token as unavailable, not as empty data', async () => {
    const url = await listen((_request, response) => { response.writeHead(401); response.end('{}') })
    const snapshot = await fetchHostTelemetry({ url, token: 'wrong' })
    expect(snapshot.availability).toBe('unavailable')
    expect(snapshot.data).toBeNull()
    expect(snapshot.reason).toContain('401')
  })

  it('refuses to call the agent at all without a token', async () => {
    const snapshot = await fetchHostTelemetry({ url: 'http://127.0.0.1:1/api/host', token: '' })
    expect(snapshot.availability).toBe('unavailable')
    expect(snapshot.reason).toContain('MC_TOKEN')
  })

  it('reports an unreachable agent without throwing', async () => {
    const snapshot = await fetchHostTelemetry({ url: 'http://127.0.0.1:1/api/host', token: 'tok', timeoutMs: 500 })
    expect(snapshot.availability).toBe('unavailable')
    expect(snapshot.reason).toContain('Could not reach')
  })

  it('rejects a payload that is not telemetry instead of half-rendering it', async () => {
    const url = await listen((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ hello: 'world' }))
    })
    const snapshot = await fetchHostTelemetry({ url, token: 'tok' })
    expect(snapshot.availability).toBe('unavailable')
    expect(snapshot.reason).toContain('unrecognised')
  })

  it('times out instead of hanging the page', async () => {
    const url = await listen(() => { /* never answers */ })
    const snapshot = await fetchHostTelemetry({ url, token: 'tok', timeoutMs: 300 })
    expect(snapshot.availability).toBe('unavailable')
    expect(snapshot.reason).toContain('300 ms')
  })
})

describe('hostAgentUrl', () => {
  it('defaults to loopback 9101', () => {
    expect(hostAgentUrl({})).toBe('http://127.0.0.1:9101/api/host')
  })
  it('honours overrides', () => {
    expect(hostAgentUrl({ MC_AGENT_HOST: '10.0.0.5', MC_AGENT_PORT: '9999' })).toBe('http://10.0.0.5:9999/api/host')
  })
})

describe('formatting helpers', () => {
  it('converts bytes to GB and refuses to invent a number', () => {
    expect(gb(8_246_248_192)).toBe(7.7)
    expect(gb(undefined)).toBeUndefined()
  })

  it('formats uptime from real values', () => {
    expect(humanUptime(320_400)).toBe('3d 17h')
    expect(humanUptime(7_200)).toBe('2h 0m')
    expect(humanUptime(120)).toBe('2m')
    expect(humanUptime(undefined)).toBeUndefined()
  })
})
