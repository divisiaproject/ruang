/**
 * Host telemetry types and formatters shared by the Telemetry page.
 *
 * Mirrors `server/host-telemetry.ts`. The page compiles separately from the server, so the
 * shape lives here too rather than reaching across the build boundary.
 */

export interface HostCpu { count?: number; physical?: number; percent?: number; load?: number[]; freq_mhz?: number }
export interface HostMemory { total?: number; available?: number; used?: number; percent?: number; swap_total?: number; swap_used?: number; swap_percent?: number }
export interface HostDisk { mount?: string; device?: string; fstype?: string; total?: number; used?: number; percent?: number }
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
  network: { bytes_sent?: number; bytes_recv?: number; interfaces?: string[] }
  temperatures: unknown[]
  docker: HostDocker
  failed_units: HostUnit[]
  processes: { total?: number; top?: HostProcess[] }
}

/** What `/api/host` returns: the agent payload, or why it could not be read. */
export interface HostSnapshot {
  availability: 'available' | 'unavailable'
  data: HostTelemetry | null
  fetchedAt: string
  reason?: string
}

export function gb(bytes: number | undefined): number | undefined {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return undefined
  return Math.round((bytes / 1024 ** 3) * 10) / 10
}

export function humanUptime(seconds: number | undefined): string | undefined {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) return undefined
  const days = Math.floor(seconds / 86_400)
  const hours = Math.floor((seconds % 86_400) / 3_600)
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}
