import { usePolling } from '../polling.ts'
import { gb, humanUptime, type HostSnapshot } from '../host-telemetry.ts'

const pct = (value: number | undefined) => (typeof value === 'number' ? `${value.toFixed(1)}%` : 'Unknown')

/** Bar tone follows the reading; an unknown value gets no bar at all rather than a fake empty one. */
function tone(value: number | undefined) {
  if (typeof value !== 'number') return ''
  if (value >= 90) return 'tone-bad'
  if (value >= 75) return 'tone-warn'
  return 'tone-good'
}

function Meter({ label, value, detail }: { label: string; value?: number; detail?: string }) {
  return <div className="host-meter">
    <div className="host-meter-head"><span>{label}</span><b className={tone(value)}>{pct(value)}</b></div>
    {typeof value === 'number' && <div className="host-bar"><i className={tone(value)} style={{ width: `${Math.min(100, Math.max(0, value))}%` }}/></div>}
    {detail && <p className="muted small-note">{detail}</p>}
  </div>
}

/**
 * Server telemetry, read from the host agent through Ruang's proxy.
 *
 * Every number shown here came from the machine; when the agent is unreachable the page
 * says so and shows nothing rather than zeros. That is the whole point of the page.
 */
export function Telemetry() {
  const snapshot = usePolling<HostSnapshot>('/api/host', 15_000)
  const data = snapshot.status === 'ready' ? snapshot.data : undefined
  const host = data?.data ?? null
  const reason = data?.availability === 'unavailable' ? data.reason : undefined

  if (snapshot.status === 'pending') return <section className="panel"><p className="muted">Reading host telemetry…</p></section>

  return <>
    <section className="panel">
      <div className="panel-head">
        <h2>Host telemetry</h2>
        {data && <span className="chip">read {new Date(data.fetchedAt).toLocaleTimeString()}</span>}
      </div>
      {reason && <p className="file-notice">
        Host telemetry is unavailable: {reason}
        <br/><span className="muted small-note">Nothing is shown rather than a guess. Check <code>systemctl status host-agent</code> on the host.</span>
      </p>}
      {!reason && !host && <p className="file-notice">The host agent returned no data.</p>}

      {host && <>
        <dl className="office-detail-grid task-grid">
          <div><dt>Host</dt><dd>{host.agent.hostname ?? 'Unknown'}</dd></div>
          <div><dt>Platform</dt><dd>{host.agent.platform ?? 'Unknown'}</dd></div>
          <div><dt>Uptime</dt><dd>{humanUptime(host.uptime_seconds) ?? 'Unknown'}</dd></div>
          <div><dt>CPU cores</dt><dd>{host.cpu.count ?? 'Unknown'}</dd></div>
          <div><dt>Docker containers</dt><dd>{host.docker.available ? (host.docker.count ?? 0) : 'Not available'}</dd></div>
          <div><dt>Failed units</dt><dd className={host.failed_units.length ? 'tone-bad' : 'tone-good'}>{host.failed_units.length}</dd></div>
        </dl>
      </>}
    </section>

    {host && <>
      <section className="panel">
        <h2>Load</h2>
        <div className="host-meters">
          <Meter label="CPU" value={host.cpu.percent} detail={host.cpu.load ? `load ${host.cpu.load.join(' · ')}` : undefined}/>
          <Meter label="Memory" value={host.memory.percent} detail={gb(host.memory.used) !== undefined && gb(host.memory.total) !== undefined ? `${gb(host.memory.used)} GB of ${gb(host.memory.total)} GB` : undefined}/>
          <Meter label="Swap" value={host.memory.swap_percent}/>
        </div>
      </section>

      <section className="panel">
        <h2>Disks</h2>
        {host.disks.length === 0 && <p className="muted">No mounted filesystems were reported.</p>}
        <div className="host-meters">
          {host.disks.map((disk) => <Meter key={disk.mount ?? Math.random()} label={disk.mount ?? disk.device ?? 'disk'} value={disk.percent} detail={gb(disk.used) !== undefined && gb(disk.total) !== undefined ? `${gb(disk.used)} GB of ${gb(disk.total)} GB` : undefined}/>)}
        </div>
      </section>

      {(host.failed_units.length > 0 || host.docker.containers?.length) && <section className="panel">
        <h2>Needs attention</h2>
        {host.failed_units.length > 0 && <>
          <p className="eyebrow">FAILED SYSTEMD UNITS</p>
          <ul className="stuck-list">
            {host.failed_units.map((unit) => <li key={unit.unit}><b>{unit.unit}</b> <span className="chip chip-muted">{unit.state}</span></li>)}
          </ul>
        </>}
        {host.docker.containers && host.docker.containers.length > 0 && <>
          <p className="eyebrow">CONTAINERS</p>
          <ul className="stuck-list">
            {host.docker.containers.map((container) => <li key={container.id ?? container.name}>
              <b>{container.name ?? 'unnamed'}</b> <span className="chip chip-muted">{container.status ?? 'Unknown'}</span>
            </li>)}
          </ul>
        </>}
      </section>}

      {host.processes.top && host.processes.top.length > 0 && <section className="panel">
        <h2>Top processes <span className="muted small-note">by memory</span></h2>
        <table className="host-table">
          <thead><tr><th>PID</th><th>Name</th><th>User</th><th>CPU</th><th>Memory</th></tr></thead>
          <tbody>
            {host.processes.top.slice(0, 10).map((process) => <tr key={process.pid}>
              <td>{process.pid ?? '—'}</td>
              <td>{process.name ?? '—'}</td>
              <td>{process.user ?? '—'}</td>
              <td>{typeof process.cpu === 'number' ? `${process.cpu.toFixed(1)}%` : '—'}</td>
              <td>{typeof process.mem_percent === 'number' ? `${process.mem_percent.toFixed(1)}%` : '—'}</td>
            </tr>)}
          </tbody>
        </table>
      </section>}
    </>}
  </>
}
