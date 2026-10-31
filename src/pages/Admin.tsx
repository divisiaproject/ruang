import { useState } from 'react'
import { agentNameFrom, agentNameProblem, createAgentForm, createTaskForm, defaultBoard, modelNote, taskTitleProblem, type FormResult } from '../admin-forms.ts'
import { displayAgentName } from '../identity.ts'
import { usePolling } from '../polling.ts'
import { readWriteToken, writeWriteToken } from '../write-token.ts'
import { assigneeCaveat, assigneeOptions } from '../assignees.ts'
import type { ModelsSnapshot, RuntimeSnapshot, TaskBoardSnapshot } from '../types.ts'
import { PageTitle } from '../ui.tsx'

function Result({ result }: { result?: FormResult }) {
  if (!result) return null
  return <p className={result.ok ? 'form-success' : 'file-notice'} role="status">{result.message}</p>
}

/** The write token lives in this browser only; the server decides whether it means anything. */
function TokenCard() {
  const [token, setToken] = useState(readWriteToken())
  const [saved, setSaved] = useState(false)
  return <section className="card settings-card">
    <p className="eyebrow">WRITE TOKEN</p>
    <h2>This browser only</h2>
    <p className="muted">Both forms need it. It is stored in this browser, never sent anywhere else, and the server refuses every write without it.</p>
    <div className="task-action-row">
      <input className="task-action-input" type="password" value={token} placeholder="Paste the RUANG_WRITE_TOKEN from the server" onChange={(event) => { setToken(event.target.value); setSaved(false) }} aria-label="Write token"/>
      <button type="button" className="refresh-button" onClick={() => { writeWriteToken(token); setSaved(true) }}>SAVE</button>
    </div>
    {saved && <p className="form-success" role="status">{token.trim() ? 'Token stored in this browser.' : 'Token removed from this browser.'}</p>}
  </section>
}

function AgentForm() {
  const [name, setName] = useState('')
  const [model, setModel] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<FormResult>()
  const models = usePolling<ModelsSnapshot>('/api/models', 60_000)
  const available = models.status === 'ready' && models.data.availability === 'available'
  const options = available ? models.data.data : []
    const emptyProviders = available ? models.data.emptyProviders : []
  // Say exactly what was read: a provider with no models block is named, never filled in.
  const note = modelNote({ available, models: options, emptyProviders })
  const problem = name.trim() ? agentNameProblem(name) : undefined
  const submit = async () => {
    setBusy(true)
    setResult(await createAgentForm({ name: agentNameFrom(name), ...(model ? { model } : {}) }))
    setBusy(false)
  }
  return <section className="card settings-card" aria-labelledby="new-agent-title">
    <p className="eyebrow">MENU 1</p>
    <h2 id="new-agent-title">Add an agent</h2>
    <p className="muted">Creates a real Hermes profile on this machine. It appears in the office, the task board and every other page as soon as it exists.</p>
    <label className="field-label" htmlFor="agent-name">Profile name</label>
    <input id="agent-name" className="task-action-input" value={name} placeholder="leadagent" onChange={(event) => setName(event.target.value)} aria-describedby="agent-name-help"/>
    <small id="agent-name-help" className="small-note">Lowercase letters and digits only, no hyphens. The name identifies the profile everywhere, so it cannot be renamed here later.</small>
    {problem && <p className="file-notice">{problem}</p>}
    <label className="field-label" htmlFor="agent-model">Model</label>
    <input id="agent-model" className="task-action-input" list="agent-models" value={model} placeholder="Leave empty to inherit the default" onChange={(event) => setModel(event.target.value)} aria-describedby="agent-model-help"/>
    <datalist id="agent-models">{options.map((item) => <option key={item.provider + '/' + item.id} value={item.id} label={item.provider}/>)}</datalist>
    <small id="agent-model-help" className="small-note">{note}</small>
    <div className="task-action-row">
      <button type="button" className="primary-button" onClick={() => void submit()} disabled={busy || Boolean(problem) || !name.trim()}>{busy ? 'Creating…' : 'Create agent'}</button>
    </div>
    <Result result={result}/>
  </section>
}

function TaskForm() {
  const runtime = usePolling<RuntimeSnapshot>('/api/runtime', 30_000)
  const tasks = usePolling<TaskBoardSnapshot>('/api/tasks', 10_000)
  const [title, setTitle] = useState('')
  const [board, setBoard] = useState('')
  const [assignee, setAssignee] = useState('')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<FormResult>()

  const profilesKnown = runtime.status === 'ready' && runtime.data.profiles.availability === 'available'
  const used = tasks.status === 'ready' ? (tasks.data.tasks.data ?? []).map((task) => task.assignee) : []
  const profiles = profilesKnown ? runtime.data.profiles.data.map((profile) => profile.name) : []
  const options = assigneeOptions({ ...(profilesKnown ? { profiles } : {}), used, profilesKnown })
  const caveat = assigneeCaveat({ ...(profilesKnown ? { profiles } : {}), used, profilesKnown })
  const boards = tasks.status === 'ready' ? (tasks.data.boards ?? []) : []
  // Prefer the board Hermes itself calls current, and never preselect a demo board when a real one exists.
  const chosenBoard = board || defaultBoard(boards) || ''
  const problem = title.trim() ? taskTitleProblem(title) : undefined

  const submit = async () => {
    setBusy(true)
    setResult(await createTaskForm({ title, board: chosenBoard, ...(assignee ? { assignee } : {}), ...(body ? { body } : {}) }))
    setBusy(false)
  }
  return <section className="card settings-card" aria-labelledby="new-task-title">
    <p className="eyebrow">MENU 2</p>
    <h2 id="new-task-title">Create a task</h2>
    <p className="muted">Writes a real Kanban task through <code>hermes kanban create</code>. Assign it to an agent (a Hermes profile that can be dispatched work) or to a vendor label (a plain name that starts nothing).</p>

    <label className="field-label" htmlFor="task-title">Title</label>
    <input id="task-title" className="task-action-input" value={title} placeholder="Kurasi 10 akun IG kompetitor" onChange={(event) => setTitle(event.target.value)} maxLength={300}/>
    {problem && <p className="file-notice">{problem}</p>}

    <label className="field-label" htmlFor="task-board">Board</label>
    {boards.length === 0 ? <p className="file-notice">No board could be read, so a task cannot be created safely.</p>
      : <select id="task-board" className="task-action-input" value={chosenBoard} onChange={(event) => setBoard(event.target.value)}>
        {boards.map((item) => <option key={item.slug} value={item.slug}>{item.name}{item.current ? ' (current)' : ''}</option>)}
      </select>}

    <label className="field-label" htmlFor="task-assignee">Assign to</label>
    <select id="task-assignee" className="task-action-input" value={assignee} onChange={(event) => setAssignee(event.target.value)}>
      <option value="">Unassigned</option>
      {options.map((option) => <option key={option.kind + '-' + option.value} value={option.value} title={option.kind === 'agent' ? displayAgentName(option.value).title : undefined}>
        {(option.kind === 'agent' ? displayAgentName(option.value).label : option.value) + ' · ' + option.kind}
      </option>)}
    </select>
    {caveat && <p className="small-note">{caveat}</p>}

    <label className="field-label" htmlFor="task-body">Description</label>
    <textarea id="task-body" className="task-action-input task-textarea" value={body} rows={4} placeholder="Optional. What done looks like." onChange={(event) => setBody(event.target.value)}/>

    <div className="task-action-row">
      <button type="button" className="primary-button" onClick={() => void submit()} disabled={busy || Boolean(problem) || !title.trim() || !chosenBoard}>{busy ? 'Creating…' : 'Create task'}</button>
    </div>
    <Result result={result}/>
  </section>
}

/** Admin-only page: the server refuses both forms for a vendor session. */
export function Admin() {
  return <>
    <PageTitle eyebrow="OWNER ONLY" title="Admin">
      Two forms the owner uses to run the team: create an agent, and create a task. Both are refused by the server
      for a vendor session, even if the vendor somehow holds the write token.
    </PageTitle>
    <div className="admin-forms">
      <TokenCard/>
      <AgentForm/>
      <TaskForm/>
    </div>
  </>
}
