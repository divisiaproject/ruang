/**
 * The browser's copy of the Ruang write token.
 *
 * Trade-off the operator accepted: the token lives in localStorage, so any
 * JavaScript on this origin can read it. Ruang binds 127.0.0.1 by default, so
 * that surface is this machine only. If Ruang is ever exposed to a network,
 * this decision has to be revisited.
 *
 * The server is the authority: with RUANG_WRITE_TOKEN unset every write route
 * returns 404, so a stale token here cannot enable anything.
 */
const KEY = 'ruang.writeToken'

export function readWriteToken(): string {
  if (typeof window === 'undefined') return ''
  try {
    return window.localStorage.getItem(KEY) ?? ''
  } catch {
    // Private mode or storage disabled: writes simply stay unavailable.
    return ''
  }
}

export function writeWriteToken(token: string): void {
  if (typeof window === 'undefined') return
  try {
    const trimmed = token.trim()
    if (trimmed) window.localStorage.setItem(KEY, trimmed)
    else window.localStorage.removeItem(KEY)
  } catch {
    /* ignore: the UI will keep showing "not stored" */
  }
}

export type WriteResult = { ok: true; argv: string[]; result: { output: string } } | { ok: false; error: string; code: string }

/** POSTs one write verb. Kept in one place so every caller sends the same headers. */
export async function sendWrite(board: string, path: string, body: Record<string, unknown>, request: typeof fetch = fetch): Promise<WriteResult> {
  const token = readWriteToken()
  if (!token) return { ok: false, error: 'No write token stored. Add one under Settings to enable writes.', code: 'NO_TOKEN' }
  let response: Response
  try {
    response = await request(`/api/kanban/${encodeURIComponent(board)}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
  } catch {
    return { ok: false, error: 'The Ruang API could not be reached.', code: 'UNREACHABLE' }
  }
  const payload = await response.json().catch(() => undefined) as Record<string, unknown> | undefined
  if (!response.ok) {
    return { ok: false, error: typeof payload?.error === 'string' ? payload.error : `HTTP ${response.status}`, code: typeof payload?.code === 'string' ? payload.code : 'WRITE_FAILED' }
  }
  return payload as WriteResult
}
