import { useEffect, useState } from 'react'
import { usePolling } from './polling.ts'
import { readWriteToken, sendWrite, writeWriteToken } from './write-token.ts'

type Status = { enabled: boolean; reason?: string }

/** Which verbs change the task permanently enough to ask first. */
const DESTRUCTIVE = new Set(['complete', 'block'])

type Action = { verb: string; label: string; hint: string; needsText?: 'reason' | 'result' }

const ACTIONS: Action[] = [
  { verb: 'claim', label: 'Claim', hint: 'Mark this task as running, so nobody else picks it up.' },
  { verb: 'complete', label: 'Complete', hint: 'Close the task. The result is kept on the run.', needsText: 'result' },
  { verb: 'block', label: 'Block', hint: 'Park the task as blocked so it shows up in Needs attention.', needsText: 'reason' },
  { verb: 'unblock', label: 'Unblock', hint: 'Return a blocked task to the queue.' },
  { verb: 'promote', label: 'Promote', hint: 'Move the task forward in the queue.' },
]

/**
 * Write controls for one task. Renders nothing at all unless the server has
 * writes enabled AND a token is stored — never a button that cannot work.
 */
export function TaskActions({ taskId, board, onDone }: { taskId?: string; board?: string; onDone?: () => void }) {
  const status = usePolling<Status>('/api/kanban/write-status', 30_000)
  const [stored, setStored] = useState(() => readWriteToken())
  const [draft, setDraft] = useState('')
  const [pending, setPending] = useState<string | null>(null)
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  const [confirming, setConfirming] = useState<Action | null>(null)
  const [confirmText, setConfirmText] = useState('')

  useEffect(() => { setStored(readWriteToken()) }, [])
  useEffect(() => { setMessage(null); setConfirming(null); setConfirmText('') }, [taskId])

  const enabled = status.status === 'ready' && status.data.enabled
  // Nothing to offer when the server is read-only or the task has no id to address.
  if (!enabled || !taskId || !board) return null

  if (!stored) {
    return <section className="task-section task-actions">
      <p className="eyebrow">ACTIONS</p>
      <p className="muted">Writes are enabled on the server. Paste the write token to use them here. It is stored in this browser only.</p>
      <div className="task-action-row">
        <input className="task-action-input" type="password" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="RUANG_WRITE_TOKEN" aria-label="Write token" autoComplete="off"/>
        <button type="button" className="refresh-button" onClick={() => { writeWriteToken(draft); setStored(draft.trim()); setDraft('') }} disabled={!draft.trim()}>Save token</button>
      </div>
    </section>
  }

  const run = async (action: Action, text: string) => {
    setPending(action.verb)
    setMessage(null)
    const body = action.needsText === 'reason' ? { reason: text } : action.needsText === 'result' ? { result: text } : {}
    const result = await sendWrite(board, `/tasks/${encodeURIComponent(taskId)}/${action.verb}`, body)
    setPending(null)
    setConfirming(null)
    setConfirmText('')
    if (result.ok) {
      setMessage({ tone: 'ok', text: `${action.label} done.` })
      onDone?.()
    } else {
      setMessage({ tone: 'bad', text: result.error })
    }
  }

  const click = (action: Action) => {
    if (DESTRUCTIVE.has(action.verb)) { setConfirming(action); setConfirmText(''); return }
    void run(action, '')
  }

  return <section className="task-section task-actions">
    <p className="eyebrow">ACTIONS</p>
    {message && <p className={message.tone === 'ok' ? 'task-action-ok' : 'file-notice'}>{message.text}</p>}

    {confirming ? <>
      <p className="muted">{confirming.hint} This cannot be undone from here.</p>
      {confirming.needsText && <input className="task-action-input" value={confirmText} onChange={(event) => setConfirmText(event.target.value)} placeholder={confirming.needsText === 'reason' ? 'Reason (why is this blocked?)' : 'Result summary (optional)'} aria-label={confirming.needsText === 'reason' ? 'Block reason' : 'Result summary'}/>}
      <div className="task-action-row">
        <button type="button" className="refresh-button" onClick={() => void run(confirming, confirmText)} disabled={pending !== null || (confirming.needsText === 'reason' && !confirmText.trim())}>
          {pending === confirming.verb ? `${confirming.label}…` : `Yes, ${confirming.label.toLowerCase()}`}
        </button>
        <button type="button" className="refresh-button" onClick={() => { setConfirming(null); setConfirmText('') }} disabled={pending !== null}>Cancel</button>
      </div>
    </> : <div className="task-action-row">
      {ACTIONS.map((action) => <button type="button" key={action.verb} className="refresh-button" title={action.hint} onClick={() => click(action)} disabled={pending !== null}>
        {pending === action.verb ? `${action.label}…` : action.label}
      </button>)}
    </div>}

    <p className="muted small-note">Token stored in this browser. Writes are only possible while the server runs with RUANG_WRITE_TOKEN set.</p>
  </section>
}
