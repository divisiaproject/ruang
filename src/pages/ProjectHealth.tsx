import { useMemo } from 'react'
import { displayAgentName } from '../identity.ts'
import { formatDateTime, orderedStatuses, statusTone } from '../format.ts'
import { usePolling } from '../polling.ts'
import type { BoardStatsSnapshot, KanbanStatusCounts, StuckSnapshot, StuckTask } from '../types.ts'
import { EmptyState, PageTitle, SourceStatus, Unavailable } from '../ui.tsx'

/** "983s" is unreadable on a dashboard; turn seconds into the largest useful unit. */
export function humanDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return undefined
  if (seconds < 60) return `${Math.floor(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86_400)}d`
}

/** A status breakdown as one stacked bar plus a legend, so shape is visible at a glance. */
function StatusBar({ counts }: { counts: KanbanStatusCounts }) {
  const statuses = orderedStatuses(Object.keys(counts.byStatus))
  const total = counts.total || 0
  const label = statuses.map((status) => `${counts.byStatus[status] ?? 0} ${status}`).join(', ')
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

function BoardCard({ slug, counts, stuckCount }: { slug: string; counts: KanbanStatusCounts; stuckCount: number }) {
  const oldest = humanDuration(counts.oldestReadySeconds)
  const slow = counts.oldestReadySeconds !== undefined && counts.oldestReadySeconds > 48 * 3600
  return (
    <article className="health-card">
      <header>
        <h2>{slug}</h2>
        <span className="chip">{counts.total} task{counts.total === 1 ? '' : 's'}</span>
        {stuckCount > 0 && <span className="badge bad">{stuckCount} needs attention</span>}
      </header>
      {counts.total === 0 ? <p className="muted">No tasks on this board yet.</p> : <StatusBar counts={counts} />}
      <dl className="health-facts">
        {oldest && <div><dt>Oldest waiting in ready</dt><dd className={slow ? 'text-bad' : ''}>{oldest}</dd></div>}
        <div><dt>Blocked</dt><dd className={counts.byStatus.blocked ? 'text-bad' : ''}>{counts.byStatus.blocked ?? 0}</dd></div>
        <div><dt>In progress</dt><dd>{counts.byStatus.running ?? 0}</dd></div>
        <div><dt>Done</dt><dd>{counts.byStatus.done ?? 0}</dd></div>
      </dl>
    </article>
  )
}

function StuckList({ tasks }: { tasks: StuckTask[] }) {
  if (tasks.length === 0) return <p className="muted">Nothing is blocked or waiting too long.</p>
  return (
    <ul className="data-list">
      {tasks.map((task: StuckTask, index: number) => (
        <li key={task.id ?? index}>
          <span className={`badge ${task.reason === 'blocked' ? 'bad' : 'info'}`}>{task.reason === 'blocked' ? 'blocked' : 'waiting'}</span>{' '}
          <strong>{task.title}</strong>{' '}
          {task.board && <span className="chip">{task.board}</span>}{' '}
          {task.assignee && <span className="chip" title={displayAgentName(task.assignee).title}>{displayAgentName(task.assignee).label}</span>}{' '}
          {task.ageHours !== undefined && <span className="muted">{humanDuration(task.ageHours * 3600)} old</span>}
        </li>
      ))}
    </ul>
  )
}

export function ProjectHealth() {
  const statsRequest = usePolling<BoardStatsSnapshot>('/api/board-stats')
  const stuckRequest = usePolling<StuckSnapshot>('/api/stuck')

  const stats = statsRequest.status === 'ready' ? statsRequest.data : undefined
  const stuck = stuckRequest.status === 'ready' ? stuckRequest.data : undefined
  const counts = stats?.availability === 'available' ? stats.data : undefined
  const tasks: StuckTask[] = stuck?.availability === 'available' ? stuck.data : []

  const boards: [string, KanbanStatusCounts][] = useMemo(
    () => Object.entries(counts ?? {}).sort((a, b) => a[0].localeCompare(b[0])),
    [counts],
  )
  const stuckByBoard = useMemo(() => {
    const map = new Map<string, number>()
    for (const task of tasks) map.set(task.board ?? '', (map.get(task.board ?? '') ?? 0) + 1)
    return map
  }, [tasks])

  return (
    <div className="page">
      <PageTitle eyebrow="Operations" title="Project Health">
        Every Kanban board Hermes reports, with its status shape and the tasks that need attention.
      </PageTitle>
      <SourceStatus source={stats} request={statsRequest}/>
      {stats && stats.availability !== 'available' && <Unavailable source={stats} request={statsRequest}/>}

      {statsRequest.status === 'pending' && <p className="muted">Reading boards from Hermes…</p>}

      {counts && (boards.length === 0
        ? <EmptyState title="No boards reported">Hermes did not report any Kanban boards. Create one with <code>hermes kanban boards create &lt;slug&gt;</code>.</EmptyState>
        : <>
            <section className="health-grid">
              {boards.map(([slug, boardCounts]) => (
                <BoardCard key={slug} slug={slug} counts={boardCounts} stuckCount={stuckByBoard.get(slug) ?? 0}/>
              ))}
            </section>

            <section className="health-stuck">
              <h2>Needs attention {stuck && <span className="chip">{tasks.length}</span>}</h2>
              <p className="muted">
                Blocked tasks, plus tasks waiting in <code>ready</code> longer than {stuck?.thresholdHours ?? 48} hours.
              </p>
              {stuckRequest.status === 'pending' ? <p className="muted">Reading tasks…</p> : <StuckList tasks={tasks}/>}
              {stuck?.fetchedAt && <p className="muted">Updated {formatDateTime(stuck.fetchedAt)}</p>}
            </section>
          </>)}
    </div>
  )
}
