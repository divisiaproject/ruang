import { useState } from 'react'
import { dayKey, monthEntries, type CalendarEntry } from '../cron-calendar.ts'
import { displayAgentName } from '../identity.ts'
import { formatDateTime, statusTone } from '../format.ts'
import { usePolling } from '../polling.ts'
import type { CalendarSnapshot, ScheduledJob } from '../types.ts'
import { EmptyState, LoadingState, PageTitle, SourceStatus, Unavailable } from '../ui.tsx'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const KIND_LABEL: Record<CalendarEntry['kind'], string> = { run: 'Scheduled run', interval: 'Repeats through the day', overdue: 'Overdue', 'last-ok': 'Last run · ok', 'last-failed': 'Last run · failed' }

function todayKey(): string {
  const now = new Date()
  return dayKey(now.getFullYear(), now.getMonth(), now.getDate())
}

/** A month grid of cron runs: upcoming runs from today, plus overdue and last-run markers. */
export function MonthView({ jobs: allJobs }: { jobs: ScheduledJob[] }) {
  const today = todayKey()
  const agents = [...new Set(allJobs.map((job) => job.agent).filter((agent): agent is string => Boolean(agent)))]
  const [agent, setAgent] = useState('')
  const jobs = agent ? allJobs.filter((job) => job.agent === agent) : allJobs
  const [cursor, setCursor] = useState(() => { const now = new Date(); return { year: now.getFullYear(), month: now.getMonth() } })
  const [selected, setSelected] = useState(today)
  const entries = monthEntries(jobs, cursor.year, cursor.month, today)
  const first = new Date(cursor.year, cursor.month, 1)
  const lead = (first.getDay() + 6) % 7
  const days = new Date(cursor.year, cursor.month + 1, 0).getDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, index) => index + 1)]
  const move = (delta: number) => setCursor(({ year, month }) => { const next = new Date(year, month + delta, 1); return { year: next.getFullYear(), month: next.getMonth() } })
  const selectedEntries = entries.get(selected) ?? []
  return <section className="month-view" aria-label="Cron calendar">
    <header className="month-head">
      <button type="button" className="icon-button" onClick={() => move(-1)} aria-label="Previous month">‹</button>
      <h2>{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2>
      <button type="button" className="icon-button" onClick={() => move(1)} aria-label="Next month">›</button>
      <button type="button" className="refresh-button" onClick={() => { const now = new Date(); setCursor({ year: now.getFullYear(), month: now.getMonth() }); setSelected(today) }}>Today</button>
      {agents.length > 1 && <label className="month-filter"><span>Agent</span><select value={agent} onChange={(event) => setAgent(event.target.value)}><option value="">All agents ({allJobs.length})</option>{agents.map((item) => <option key={item} value={item} title={displayAgentName(item).title}>{displayAgentName(item).label} ({allJobs.filter((job) => job.agent === item).length})</option>)}</select></label>}
      <span className="month-legend"><i className="kind-run"/>run <i className="kind-interval"/>repeating <i className="kind-last-ok"/>last ok <i className="kind-last-failed"/>failed / overdue</span>
    </header>
    <div className="month-grid" role="grid">
      {WEEKDAYS.map((day) => <div key={day} className="month-weekday" role="columnheader">{day}</div>)}
      {cells.map((day, index) => {
        if (day === null) return <div key={`lead-${index}`} className="month-cell empty" aria-hidden="true"/>
        const key = dayKey(cursor.year, cursor.month, day)
        const list = entries.get(key) ?? []
        return <button type="button" role="gridcell" key={key} className={`month-cell${key === today ? ' today' : ''}${key === selected ? ' selected' : ''}${key < today ? ' past' : ''}`} onClick={() => setSelected(key)} aria-label={`${key}: ${list.length} item${list.length === 1 ? '' : 's'}`} aria-selected={key === selected}>
          <span className="month-day">{day}</span>
          {list.slice(0, 3).map((entry, entryIndex) => <span key={entryIndex} className={`month-entry kind-${entry.kind}`} title={`${entry.job}${entry.agent ? ` (${displayAgentName(entry.agent).label})` : ''} · ${KIND_LABEL[entry.kind]} ${entry.label}`}><b>{entry.label}</b> {entry.job}</span>)}
          {list.length > 3 && <span className="month-more">+{list.length - 3} more</span>}
          {list.length > 0 && <span className="month-dots" aria-hidden="true">{list.slice(0, 4).map((entry, entryIndex) => <i key={entryIndex} className={`kind-${entry.kind}`}/>)}</span>}
        </button>
      })}
    </div>
    <div className="month-day-detail">
      <p className="eyebrow">{new Date(`${selected}T00:00:00`).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      {selectedEntries.length === 0 ? <p className="muted">Nothing scheduled on this day.</p> : <ul>{selectedEntries.map((entry, index) => <li key={index}><span className={`badge kind-${entry.kind}`}>{KIND_LABEL[entry.kind]}</span> <strong>{entry.job}</strong> <span className="muted">{entry.label}</span>{entry.agent && <span className="chip" title={displayAgentName(entry.agent).title}>{displayAgentName(entry.agent).label}</span>}</li>)}</ul>}
      <small className="muted">Times are the Hermes host's local time. Paused jobs only show their last run.</small>
    </div>
  </section>
}

function FailedProfiles({ profiles }: { profiles: string[] }) {
  return <p className="file-notice" role="status">Cron jobs of {profiles.map((profile) => displayAgentName(profile).label).join(', ')} could not be read, so they are missing here.</p>
}

/** The cron month view with its own data, for the Office overlay. */
export function CalendarOverlayView() {
  const snapshot = usePolling<CalendarSnapshot>('/api/calendar', 30_000)
  const jobs = snapshot.status === 'ready' ? snapshot.data.jobs : undefined
  const failed = snapshot.status === 'ready' ? snapshot.data.failedProfiles : undefined
  if (snapshot.status === 'pending') return <LoadingState message="Reading cron jobs..."/>
  return <>
    <Unavailable source={jobs} request={snapshot}/>
    {failed && <FailedProfiles profiles={failed}/>}
    {jobs?.availability === 'available' && <MonthView jobs={jobs.data}/>}
  </>
}

export function Calendar() {
  const snapshot = usePolling<CalendarSnapshot>('/api/calendar', 30_000)
  const data = snapshot.status === 'ready' ? snapshot.data : undefined
  const jobs = data?.jobs
  const sorted = [...(jobs?.data ?? [])].sort((a, b) => (a.nextRun ?? '~').localeCompare(b.nextRun ?? '~'))
  return <><PageTitle eyebrow="HERMES CRON" title="Calendar">Scheduled Hermes cron jobs of every agent (Hermes keeps cron per profile), including paused and completed ones. General calendar events are not inferred or displayed.</PageTitle>
    <SourceStatus source={jobs} fetchedAt={data?.fetchedAt} request={snapshot}/><Unavailable source={jobs} request={snapshot}/>
    {data?.failedProfiles && <FailedProfiles profiles={data.failedProfiles}/>}
    {jobs?.availability === 'available' && sorted.length > 0 && <MonthView jobs={jobs.data}/>}
    {jobs?.availability === 'available' && (sorted.length === 0 ? <EmptyState title="No scheduled jobs">Hermes did not report any cron jobs. Create one with <code>hermes cron create</code>.</EmptyState> : <section className="data-list">{sorted.map((job) => <article key={`${job.agent ?? ''}:${job.id ?? `${job.name}-${job.schedule}`}`}>
      <div><h2>{job.name}{job.agent && <span className="chip job-agent" title={displayAgentName(job.agent).title}>{displayAgentName(job.agent).label}</span>}</h2><p><code>{job.schedule}</code>{job.repeat && <> · repeat {job.repeat}</>}</p></div>
      <dl>
        {job.status && <div><dt>Status</dt><dd><span className={`badge ${statusTone(job.status)}`}>{job.status}</span></dd></div>}
        <div><dt>{job.overdue ? 'Overdue since' : 'Next run'}</dt><dd className={job.overdue ? 'text-bad' : ''}>{formatDateTime(job.nextRun)}</dd></div>
        {job.lastRun && <div><dt>Last run</dt><dd>{formatDateTime(job.lastRun)} <span className={`badge ${job.lastRunOk ? 'good' : 'bad'}`}>{job.lastRunOk ? 'ok' : 'failed'}</span></dd></div>}
      </dl>
    </article>)}</section>)}
  </>
}
