import { useState } from 'react'
import { usePolling } from './polling.ts'
import { REPORT_STATUSES, formatReport, type ReportStatus } from './report.ts'
import { readWriteToken, sendWrite } from './write-token.ts'

/**
 * Progress report form for a task.
 *
 * `hermes kanban comment` has no author flag, so the reporter's identity is
 * carried inside the comment body as a `[Vendor: …]` header. Ruang parses it
 * back for display; it never claims Hermes recorded the author.
 *
 * Renders nothing unless writes are enabled and a token is stored.
 */
export function ReportForm({ taskId, board, onDone }: { taskId?: string; board?: string; onDone?: () => void }) {
  const status = usePolling<{ enabled: boolean }>('/api/kanban/write-status', 30_000)
  const [vendor, setVendor] = useState('')
  const [percent, setPercent] = useState('')
  const [state, setState] = useState<ReportStatus | ''>('')
  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)

  const enabled = status.status === 'ready' && status.data.enabled
  if (!enabled || !taskId || !board || !readWriteToken()) return null

  const parsedPercent = percent.trim() === '' ? undefined : Number(percent)
  const invalidPercent = parsedPercent !== undefined && (!Number.isFinite(parsedPercent) || parsedPercent < 0 || parsedPercent > 100)

  const submit = async () => {
    setPending(true)
    setMessage(null)
    const text = formatReport({
      vendor,
      ...(parsedPercent !== undefined ? { percent: parsedPercent } : {}),
      ...(state ? { status: state } : {}),
      body,
    })
    const result = await sendWrite(board, `/tasks/${encodeURIComponent(taskId)}/comment`, { body: text })
    setPending(false)
    if (result.ok) {
      setMessage({ tone: 'ok', text: 'Report added to the task.' })
      setBody('')
      onDone?.()
    } else {
      setMessage({ tone: 'bad', text: result.error })
    }
  }

  return <section className="task-section task-report">
    <p className="eyebrow">PROGRESS REPORT</p>
    <p className="muted small-note">
      Recorded as a task comment. Hermes does not attribute comment authors, so the reporter is written
      into the comment text as a header — Ruang reads it back and never invents an author.
    </p>
    {message && <p className={message.tone === 'ok' ? 'task-action-ok' : 'file-notice'}>{message.text}</p>}
    <div className="task-action-row">
      <input className="task-action-input" value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="Vendor / team name (required)" aria-label="Vendor or team name"/>
      <input className="task-action-input" value={percent} onChange={(event) => setPercent(event.target.value)} placeholder="Progress %" aria-label="Progress percent" inputMode="numeric" style={{ flex: '0 1 120px' }}/>
      <select className="task-action-input" value={state} onChange={(event) => setState(event.target.value as ReportStatus | '')} aria-label="Report status" style={{ flex: '0 1 150px' }}>
        <option value="">Status…</option>
        {REPORT_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
      </select>
    </div>
    <textarea className="task-action-input task-report-body" value={body} onChange={(event) => setBody(event.target.value)} placeholder="What moved, what is stuck, what you need next…" aria-label="Report body" rows={3}/>
    {invalidPercent && <p className="file-notice">Progress must be a number from 0 to 100.</p>}
    <div className="task-action-row">
      <button type="button" className="refresh-button" onClick={() => void submit()} disabled={pending || !vendor.trim() || invalidPercent}>
        {pending ? 'Adding…' : 'Add report'}
      </button>
    </div>
  </section>
}
