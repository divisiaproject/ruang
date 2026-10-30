import type { Source } from './mission-control.js'

/**
 * Host telemetry, proxied from the host agent (`host_agent.py`, port 9101).
 *
 * Why a proxy instead of calling the agent from the browser: the agent is bound to
 * 127.0.0.1 and needs a shared token. Keeping both server-side means the token never
 * reaches a vendor's browser.
 *
 * Every field is passed through as the agent reported it. Nothing is computed here, so a
 * number on screen is always something the host actually said — and a missing reading
 * stays missing instead of becoming a zero.
 */

export interface HostCpu { count?: number; physical?: number; percent?: number; load?: number[]; freq_mhz?: number }
export interface HostMemory { total?: number; available?: number; used?: number; percent?: number; swap_total?: number; swap_used?: number; swap_percent?: number }
export interface HostDisk { mount?: string; device?: string; fstype?: string; total?: number; used?: number; percent?: number }
export interface HostNetwork { bytes_sent?: number; bytes_recv?: number; interfaces?: string[] }
export interface HostProcess { pid?: number; name?: string; user?: string; cpu?: number; mem_percent?: number; rss_mb?: number; cmd?: string }
export interface HostDocker { available?: boolean; count?: number; reason?: string; containers?: { id?: string; name?: string; status?: string; image?: string }[] }
export interface HostUnit { unit: string; state: string }

export interface HostTelemetry {
  agent: { kind?: string; uptime_seconds?: number; hostname?: string; platform?: string; machine?: string; python?: string }
  time: string
  uptime_seconds?: number
  cpu: HostCpu
  memory: HostMemory
  disks: HostDisk[]
  network: HostNetwork
  temperatures: unknown[]
  docker: HostDocker
  failed_units: HostUnit[]
  processes: { total?: number; top?: HostProcess[] }
}

export interface HostSnapshot extends Omit<Source<HostTelemetry | null>, 'data'> {
  data: HostTelemetry | null
  fetchedAt: string
  /** Present when the agent answered but refused the token. */
  reason?: string
}

/** The agent's defaults; overridable so tests never touch a real port. */
export function hostAgentUrl(env: NodeJS.ProcessEnv = process.env): string {
  const port = env.MC_AGENT_PORT?.trim() || '9101'
  const host = env.MC_AGENT_HOST?.trim() || '127.0.0.1'
  return `http://${host}:${port}/api/host`
}

/**
 * Fetches telemetry. Never throws: a dead agent, a wrong token and a slow agent all come
 * back as `unavailable` with a reason, because the page must say "unknown" rather than
 * show stale or invented numbers.
 */
export async function fetchHostTelemetry(options: { url?: string; token?: string; timeoutMs?: number } = {}): Promise<HostSnapshot> {
  const url = options.url ?? hostAgentUrl()
  const token = options.token ?? process.env.MC_TOKEN ?? ''
  const timeoutMs = options.timeoutMs ?? 6_000
  const fetchedAt = new Date().toISOString()

  if (!token) return { availability: 'unavailable', data: null, fetchedAt, reason: 'MC_TOKEN is not set, so the host agent will refuse the request.' }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { headers: { 'X-MC-Token': token }, signal: controller.signal })
    if (response.status === 401) return { availability: 'unavailable', data: null, fetchedAt, reason: 'The host agent rejected the token (401).' }
    if (!response.ok) return { availability: 'unavailable', data: null, fetchedAt, reason: `The host agent answered ${response.status}.` }
    const body = (await response.json()) as HostTelemetry
    // A response without the expected sections is not telemetry; do not half-render it.
    if (!body || typeof body !== 'object' || !body.cpu || !body.memory) return { availability: 'unavailable', data: null, fetchedAt, reason: 'The host agent returned an unrecognised payload.' }
    return { availability: 'available', data: body, fetchedAt }
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? `The host agent did not answer within ${timeoutMs} ms.` : `Could not reach the host agent at ${url}.`
    return { availability: 'unavailable', data: null, fetchedAt, reason }
  } finally {
    clearTimeout(timer)
  }
}

/** Bytes as GB with one decimal; `undefined` in stays `undefined` out (no fake zero). */
export function gb(bytes: number | undefined): number | undefined {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return undefined
  return Math.round((bytes / 1024 ** 3) * 10) / 10
}

/** 89 hours -> "3d 17h". */
export function humanUptime(seconds: number | undefined): string | undefined {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return undefined
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}
