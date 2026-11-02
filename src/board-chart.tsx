import { orderedStatuses, statusTone } from './format.ts'
import type { KanbanStatusCounts } from './types.ts'

export type BoardChartMode = 'bar-h' | 'bar-v' | 'pie'

export const BOARD_CHART_MODES: { value: BoardChartMode; label: string }[] = [
  { value: 'bar-h', label: 'Bar horizontal' },
  { value: 'bar-v', label: 'Bar vertikal' },
  { value: 'pie', label: 'Pie' },
]

/**
 * Status breakdown in three shapes, all read-only and dependency-free.
 *
 * The pie is a plain SVG circle with stroke-dasharray slices and the bars are
 * plain divs, so no chart library is needed. Colours reuse the existing
 * `tone-*` scale via `statusTone()`, and every shape carries the same
 * `role="img"` label with the raw counts so screen readers get identical data.
 */
export function BoardChart({ counts, mode }: { counts: KanbanStatusCounts; mode: BoardChartMode }) {
  const statuses = orderedStatuses(Object.keys(counts.byStatus))
  const total = counts.total || 0
  const label = statuses.map((status) => `${counts.byStatus[status] ?? 0} ${status}`).join(', ')
  const nonzero = statuses.filter((status) => (counts.byStatus[status] ?? 0) > 0)

  if (mode === 'pie') {
    // A full circle is 100 units of dash; each slice takes count/total of it.
    let offset = 25 // start at 12 o'clock
    return (
      <div className="health-chart-wrap">
        <svg className="health-pie" viewBox="0 0 42 42" role="img" aria-label={`${total} tasks: ${label}`}>
          <circle cx="21" cy="21" r="15.915" className="health-pie-track" />
          {nonzero.map((status) => {
            const count = counts.byStatus[status] ?? 0
            const share = total === 0 ? 0 : (count / total) * 100
            const dash = `${share} ${100 - share}`
            const rotation = `rotate(${(offset / 100) * 360} 21 21)`
            offset += share
            return (
              <circle
                key={status}
                cx="21" cy="21" r="15.915"
                fill="none" strokeWidth="6"
                className={`health-pie-slice tone-${statusTone(status)}`}
                strokeDasharray={dash}
                transform={rotation}
              >
                <title>{`${count} ${status}`}</title>
              </circle>
            )
          })}
        </svg>
        <ul className="health-legend">
          {statuses.map((status) => (
            <li key={status}><span className={`badge ${statusTone(status)}`}>{status}</span> {counts.byStatus[status] ?? 0}</li>
          ))}
        </ul>
      </div>
    )
  }

  if (mode === 'bar-v') {
    const max = Math.max(1, ...statuses.map((status) => counts.byStatus[status] ?? 0))
    return (
      <div className="health-chart-wrap">
        <div className="health-vbar" role="img" aria-label={`${total} tasks: ${label}`}>
          {statuses.map((status) => {
            const count = counts.byStatus[status] ?? 0
            return (
              <div key={status} className="health-vbar-col" title={`${count} ${status}`}>
                <span className="health-vbar-value">{count}</span>
                <span className={`health-vbar-fill tone-${statusTone(status)}`} style={{ height: `${(count / max) * 100}%` }} />
                <span className="health-vbar-label" title={status}>{status}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="health-bar-wrap">
      <div className="health-bar" role="img" aria-label={`${total} tasks: ${label}`}>
        {statuses.map((status) => {
          const count = counts.byStatus[status] ?? 0
          return count === 0 ? null : <span key={status} className={`health-seg tone-${statusTone(status)}`} style={{ flexGrow: count }} title={`${count} ${status}`} />
        })}
      </div>
      <ul className="health-legend">
        {statuses.map((status) => (
          <li key={status}><span className={`badge ${statusTone(status)}`}>{status}</span> {counts.byStatus[status] ?? 0}</li>
        ))}
      </ul>
    </div>
  )
}
