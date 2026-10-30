import { useState } from 'react'
import { usePolling } from './polling.ts'
import { assigneeCaveat, assigneeOptions, type AssigneeInput } from './assignees.ts'
import { displayAgentName } from './identity.ts'
import { readWriteToken, sendWrite } from './write-token.ts'
import type { RuntimeSnapshot, TaskBoardSnapshot } from './types.ts'

/**
 * Reassign a task.
 *
 * The list is built from real evidence only: Hermes profiles (agents) and names already
 * used on the board (labels). A free-text field exists for a new vendor name, because a
 * Kanban assignee is a plain string — but it is marked as a label, never as an agent.
 */
export function AssignControl({ taskId, board, current, onDone }: { taskId?: string; board?: string; current?: string; onDone?: () => void }) {
  const status = usePolling<{ enabled: boolean }>('/api/kanban/write-status', 30_000)
  const runtime = usePolling<RuntimeSnapshot>('/api/runtime', 30_000)
  const tasks = usePolling<TaskBoardSnapshot>('/api/tasks', 10_000)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [draft, setDraft] = useState('')

  const enabled = status.status === 'ready' && status.data.enabled
  if (!enabled || !taskId || !board || !readWriteToken()) return null

  const profilesKnown = runtime.status === 'ready' && runtime.data.profiles.availability === 'available'
  const input: AssigneeInput = {
    ...(profilesKnown ? { profiles: runtime.data.profiles.data.map((profile) => profile.name) } : {}),
    used: (tasks.status === 'ready' ? tasks.data.tasks.data ?? [] : []).map((task) => task.assignee),
    profilesKnown,
  }
  const options = assigneeOptions(input)
  const caveat = assigneeCaveat(input)

  const assign = async (value: string) => {
    if (!value.trim()) return
    setPending(true)
    setMessage(null)
    const result = await sendWrite(board, `/tasks/${encodeURIComponent(taskId)}/assign`, { assignee: value.trim() })
    setPending(false)
    if (result.ok) {
      setMessage({ tone: 'ok', text: `Assigned to ${value.trim()}.` })
      setDraft('')
      onDone?.()
    } else {
      setMessage({ tone: 'bad', text: result.error })
    }
  }

  return <section className="task-section task-assign">
    <p className="eyebrow">ASSIGN</p>
    <p className="muted small-note">
      A Kanban assignee is a plain name, not a link. <b>agent</b> means a Hermes profile that can be
      dispatched work; <b>label</b> is a vendor or team name and starts nothing.
    </p>
    {caveat && <p className="file-notice">{caveat}</p>}
    {message && <p className={message.tone === 'ok' ? 'task-action-ok' : 'file-notice'}>{message.text}</p>}

    <div className="task-action-row">
      <select className="task-action-input" value={current ?? ''} onChange={(event) => void assign(event.target.value)} disabled={pending} aria-label="Assignee">
        <option value="">{current ? `Current: ${current}` : 'Unassigned'}</option>
        {options.filter((option) => option.value !== current).map((option) => <option key={`${option.kind}-${option.value}`} value={option.value} title={option.kind === 'agent' ? displayAgentName(option.value).title : undefined}>
          {option.kind === 'agent' ? displayAgentName(option.value).label : option.value} · {option.kind}
        </option>)}
      </select>
    </div>

    <div className="task-action-row">
      <input className="task-action-input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="New vendor / team name (plain label)" aria-label="New assignee label"/>
      <button type="button" className="refresh-button" onClick={() => void assign(draft)} disabled={pending || !draft.trim()}>
        {pending ? 'Assigning…' : 'Assign label'}
      </button>
    </div>
  </section>
}
