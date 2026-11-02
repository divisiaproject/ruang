import { useEffect, useRef, useState } from 'react'
import { displayAgentName } from '../identity.ts'
import { formatDateTime, orderedStatuses, statusTone } from '../format.ts'
import { usePolling } from '../polling.ts'
import { loadSnapshot, type RequestState } from '../request-state.ts'
import type { Task, TaskBoardSnapshot, TaskDetailSnapshot } from '../types.ts'
import { Dialog, EmptyState, PageTitle, SearchInput, SourceStatus, Unavailable } from '../ui.tsx'
import { ProfileUnlock, RelockBar } from '../ProfileLock.tsx'
import { agentPrivacy, useProfileLock } from '../profile-lock.ts'
import { TaskActions } from '../TaskActions.tsx'
import { TaskPrintButton } from '../task-print.tsx'
import { ReportForm } from '../ReportForm.tsx'
import { AssignControl } from '../AssignControl.tsx'
import { parseReport } from '../report.ts'

const UNASSIGNED = '(unassigned)'

function Field({ label, value }: { label: string; value?: string | number }) {
  return value === undefined || value === '' ? null : <div><dt>{label}</dt><dd>{value}</dd></div>
}

export function TaskDetailDialog({ task, onClose, onOpenTask }: { task: Task; onClose: () => void; onOpenTask?: (id: string) => void }) {
  const [state, setState] = useState<RequestState<TaskDetailSnapshot>>({ status: 'pending' })
  const lock = useProfileLock()
  // A locked agent's task stays private until its PIN is entered; the server refuses it too.
  const privacy = agentPrivacy(lock, task.assignee)
  const locked = privacy === 'locked' || (task.private === true && !lock)
  useEffect(() => {
    if (!task.id || locked) return
    let active = true
    setState({ status: 'pending' })
    void loadSnapshot<TaskDetailSnapshot>(`/api/tasks/${encodeURIComponent(task.id)}${task.board ? `?board=${encodeURIComponent(task.board)}` : ''}`).then((next) => { if (active) setState(next) })
    return () => { active = false }
  }, [task.id, task.board, locked])
  const detail = state.status === 'ready' && state.data.task.availability === 'available' ? state.data.task.data : null
  const failed = !task.id || state.status === 'failed' || (state.status === 'ready' && !detail)
  const status = detail?.status ?? task.status
  const links = (label: string, ids: string[]) => ids.length > 0 && <div><dt>{label}</dt><dd className="task-links">{ids.map((id) => <button type="button" key={id} className="chip chip-button" onClick={() => onOpenTask?.(id)}>{id}</button>)}</dd></div>
  return <Dialog labelledBy="task-detail-title" onClose={onClose} closeLabel={`Close details for ${task.title}`} className="task-detail">
    <p className="eyebrow">KANBAN TASK{task.board ? ` · ${task.board.toUpperCase()} BOARD` : ''}{task.id ? ` · ${task.id}` : ''}</p>
    <h2 id="task-detail-title">{detail?.title ?? task.title}</h2>
    <div className="task-meta"><span className={`badge ${statusTone(status)}`}>{status}</span><span className={`chip ${task.assignee ? '' : 'chip-muted'}`} title={task.assignee ? displayAgentName(task.assignee).title : undefined}>{task.assignee ? displayAgentName(task.assignee).label : 'unassigned'}</span>{(detail?.priority ?? task.priority) ? <span className="chip chip-priority">P{detail?.priority ?? task.priority}</span> : null}</div>
    {locked && task.assignee ? <ProfileUnlock agent={task.assignee} minutes={lock?.unlockMinutes} compact/> : <>
    {privacy === 'unlocked' && task.assignee && <RelockBar agent={task.assignee} minutes={lock?.unlockMinutes ?? 15}/>}
    {state.status === 'pending' && task.id && <p className="muted">Loading task details…</p>}
    {failed && <p className="file-notice">{task.id ? 'Full details are not available right now (hermes kanban show could not be read). Showing the board summary.' : 'This task has no id, so only the board summary is available.'}</p>}
    {detail && <>
      <dl className="office-detail-grid task-grid">
        <Field label="Created" value={detail.createdAt ? `${formatDateTime(detail.createdAt)}${detail.createdBy ? ` by ${detail.createdBy}` : ''}` : undefined}/>
        <Field label="Started" value={detail.startedAt && formatDateTime(detail.startedAt)}/>
        <Field label="Completed" value={detail.completedAt && formatDateTime(detail.completedAt)}/>
        <Field label="Workspace" value={detail.workspace}/>
        <Field label="Branch" value={detail.branch}/>
        <Field label="Model" value={detail.model}/>
        <Field label="Tenant" value={detail.tenant}/>
        <Field label="Skills" value={detail.skills.join(', ')}/>
        {links('Depends on', detail.parents)}
        {links('Blocks', detail.children)}
      </dl>
      {detail.lastError && <section className="task-section"><p className="eyebrow">LAST FAILURE</p><pre className="task-text text-bad">{detail.lastError}</pre></section>}
      <section className="task-section"><p className="eyebrow">DESCRIPTION</p>{detail.body ? <pre className="task-text">{detail.body}</pre> : <p className="muted">No description.</p>}</section>
      {detail.result && <section className="task-section"><p className="eyebrow">RESULT / LATEST SUMMARY</p><pre className="task-text">{detail.result}</pre></section>}
      {detail.runs.length > 0 && <section className="task-section"><p className="eyebrow">RUNS ({detail.runs.length})</p><table className="log-table"><thead><tr><th>Run</th><th>Profile</th><th>Status</th><th>Started</th><th>Ended</th></tr></thead><tbody>{detail.runs.map((run) => <tr key={run.id}><td>#{run.id}</td><td title={displayAgentName(run.profile).title}>{run.profile ? displayAgentName(run.profile).label : '—'}</td><td><span className={`badge ${statusTone(run.outcome ?? run.status ?? '')}`}>{run.outcome ?? run.status ?? '—'}</span>{run.error && <div className="text-bad small-note">{run.error}</div>}{run.summary && <div className="small-note">{run.summary}</div>}</td><td>{formatDateTime(run.startedAt)}</td><td>{formatDateTime(run.endedAt)}</td></tr>)}</tbody></table></section>}
      {detail.comments.length > 0 && <section className="task-section"><p className="eyebrow">COMMENTS ({detail.comments.length})</p><ul className="task-timeline">{detail.comments.map((comment, index) => {
        // A vendor report carries its reporter in the body header; a plain comment has none.
        const report = parseReport(comment.body)
        return <li key={index}>
          <b>{report ? report.vendor : comment.author}</b>
          {report && <span className="chip">vendor report</span>}
          {report?.percent !== undefined && <span className="chip">{report.percent}%</span>}
          {report?.status && <span className={`badge ${report.status === 'blocked' || report.status === 'at-risk' ? 'bad' : report.status === 'done' ? 'muted' : 'good'}`}>{report.status}</span>}
          <small>{formatDateTime(comment.createdAt)}</small>
          {report ? (report.body ? <p>{report.body}</p> : null) : <p>{comment.body}</p>}
        </li>
      })}</ul></section>}
      {detail.events.length > 0 && <section className="task-section"><p className="eyebrow">ACTIVITY ({detail.events.length})</p><ul className="task-timeline">{[...detail.events].reverse().map((event, index) => <li key={index}><b>{event.kind}</b><small>{formatDateTime(event.createdAt)}{event.runId ? ` · run #${event.runId}` : ''}</small>{event.detail && <code>{event.detail}</code>}</li>)}</ul></section>}
    </>}
    {/* Write controls last and always outside the `detail` block: the read path can
        fail while the write path still works, and a locked agent shows no actions. */}
    {!locked && detail && <TaskPrintButton title={detail.title}/>}
    {!locked && <TaskActions taskId={task.id} board={task.board} onDone={onClose}/>}
    {!locked && <AssignControl taskId={task.id} board={task.board} current={detail?.assignee ?? task.assignee} onDone={onClose}/>}
    {!locked && <ReportForm taskId={task.id} board={task.board} onDone={onClose}/>}
    </>}
  </Dialog>
}

export function TaskBoard() {
  const snapshot = usePolling<TaskBoardSnapshot>('/api/tasks', 10_000)
  const [query, setQuery] = useState('')
  const [assignee, setAssignee] = useState('all')
  const [board, setBoard] = useState('all')
  const [openTask, setOpenTask] = useState<Task | undefined>()
  const trigger = useRef<HTMLButtonElement | null>(null)
  const boardRef = useRef<HTMLElement | null>(null)
  /** Scrolls the board sideways by about one column, or to a column. */
  const scrollBoard = (direction: number) => boardRef.current?.scrollBy({ left: direction * 250, behavior: 'smooth' })
  const showColumn = (status: string) => boardRef.current?.querySelector<HTMLElement>(`[data-status="${CSS.escape(status)}"]`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  const closeTask = () => { setOpenTask(undefined); trigger.current?.focus() }
  const data = snapshot.status === 'ready' ? snapshot.data : undefined
  const tasks = data?.tasks
  const all = tasks?.data ?? []
  const assignees = [...new Set(all.map((task) => task.assignee ?? UNASSIGNED))].sort()
  const boards = data?.boards ?? []
  const multiBoard = boards.length > 1
  const needle = query.trim().toLowerCase()
  const visible = all.filter((task) => (assignee === 'all' || (task.assignee ?? UNASSIGNED) === assignee) && (board === 'all' || task.board === board) && (!needle || `${task.title} ${task.id ?? ''} ${task.assignee ?? ''}`.toLowerCase().includes(needle)))
  const columns = orderedStatuses(all.map((task) => task.status), true)
  return <><PageTitle eyebrow="HERMES KANBAN" title="Task board">Live, read-only view of <code>hermes kanban list</code> across every Kanban board. Columns follow the Hermes board order; the board refreshes every 10 seconds.</PageTitle>
    <SourceStatus source={tasks} fetchedAt={data?.fetchedAt} request={snapshot}/><Unavailable source={tasks} request={snapshot}/>
    {data?.failedBoards && <p className="file-notice">Could not read the {data.failedBoards.join(', ')} board{data.failedBoards.length === 1 ? '' : 's'}; showing the others.</p>}
    {tasks?.availability === 'available' && (all.length === 0 ? <EmptyState title="No tasks">{multiBoard ? `None of the ${boards.length} Kanban boards has open tasks.` : 'Hermes returned an empty Kanban task list.'} Create one with <code>hermes kanban create</code>.</EmptyState> : <>
      <div className="toolbar"><SearchInput value={query} onChange={setQuery} label="Search tasks"/><label className="select-label">Assignee <select value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="all">All ({all.length})</option>{assignees.map((name) => <option key={name} value={name} title={displayAgentName(name).title}>{displayAgentName(name).label}</option>)}</select></label>{multiBoard && <label className="select-label">Board <select value={board} onChange={(event) => setBoard(event.target.value)}><option value="all">All boards</option>{boards.map((item) => <option key={item.slug} value={item.slug}>{item.name}{item.current ? ' (current)' : ''}</option>)}</select></label>}<span className="toolbar-count">{visible.length} shown</span></div>
      <nav className="board-nav" aria-label="Kanban columns">
        <button type="button" className="refresh-button" onClick={() => scrollBoard(-1)} aria-label="Scroll the board left">‹</button>
        <div className="board-nav-chips">{columns.map((status) => <button type="button" key={status} className={`chip chip-button tone-border-${statusTone(status)}`} onClick={() => showColumn(status)}>{status} <b>{visible.filter((task) => task.status === status).length}</b></button>)}</div>
        <button type="button" className="refresh-button" onClick={() => scrollBoard(1)} aria-label="Scroll the board right">›</button>
      </nav>
      <section className="board" aria-label="Kanban board" ref={boardRef}>{columns.map((status) => {
        const items = visible.filter((task) => task.status === status).sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
        return <article key={status} data-status={status} className={`column tone-border-${statusTone(status)}`} aria-label={`${status} column`}><header className="column-head"><p className="eyebrow">{status}</p><span className="column-count">{items.length}</span></header>
          {items.length === 0 ? <p className="column-empty">—</p> : items.map((task) => <button type="button" className="task task-card" key={`${task.board ?? ''}-${task.status}-${task.id ?? task.title}`} onClick={(event) => { trigger.current = event.currentTarget; setOpenTask(task) }} aria-label={`${task.title}. ${task.status}. Open task details.`}><strong>{task.title}</strong><div className="task-meta">{multiBoard && task.board && <span className="chip chip-muted">{task.board}</span>}<span className={`chip ${task.assignee ? '' : 'chip-muted'}`} title={task.assignee ? displayAgentName(task.assignee).title : undefined}>{task.assignee ? displayAgentName(task.assignee).label : 'unassigned'}</span>{task.priority ? <span className="chip chip-priority">P{task.priority}</span> : null}</div></button>)}
        </article>
      })}</section>
    </>)}
    {openTask && <TaskDetailDialog key={`${openTask.board ?? ''}-${openTask.id ?? openTask.title}`} task={openTask} onClose={closeTask} onOpenTask={(id) => setOpenTask(all.find((task) => task.id === id && task.board === openTask.board) ?? { id, title: id, status: 'unknown', ...(openTask.board ? { board: openTask.board } : {}) })}/>}
  </>
}
