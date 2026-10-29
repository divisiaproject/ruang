/**
 * Vendor progress reports.
 *
 * `hermes kanban comment` accepts only `comment <task_id> <body>` — there is no
 * author flag, so Hermes records whoever ran the command. Ruang must not invent
 * an author field. Instead the reporter's identity and figures travel INSIDE the
 * body as a compact header line, which Ruang parses back out. Nothing is faked:
 * if the header is absent the text is shown as an ordinary comment.
 */

export type ReportStatus = 'on-track' | 'at-risk' | 'blocked' | 'done'

export const REPORT_STATUSES: ReportStatus[] = ['on-track', 'at-risk', 'blocked', 'done']

export interface ProgressReport {
  vendor: string
  /** 0-100, or undefined when the reporter did not state one. */
  percent?: number
  status?: ReportStatus
  /** Everything after the header line, trimmed. */
  body: string
}

const HEADER = /^\s*\[Vendor:\s*([^\]]{1,80})\]\s*(?:\[Progres:\s*(\d{1,3})%?\])?\s*(?:\[Status:\s*([a-z-]{1,16})\])?\s*$/i

/** Emits the body `hermes kanban comment` should store for a report. */
export function formatReport(report: { vendor: string; percent?: number; status?: ReportStatus; body: string }): string {
  const parts = [`[Vendor: ${report.vendor.trim()}]`]
  if (report.percent !== undefined && Number.isFinite(report.percent)) parts.push(`[Progres: ${Math.max(0, Math.min(100, Math.round(report.percent)))}%]`)
  if (report.status) parts.push(`[Status: ${report.status}]`)
  const body = report.body.trim()
  return [parts.join(' '), body].filter(Boolean).join('\n')
}

/** Returns the parsed report, or undefined when the body has no recognisable header. */
export function parseReport(body: string): ProgressReport | undefined {
  const [first, ...rest] = body.split('\n')
  const match = HEADER.exec(first ?? '')
  if (!match) return undefined
  const vendor = match[1].trim()
  if (!vendor) return undefined
  const rawPercent = match[2] === undefined ? undefined : Number.parseInt(match[2], 10)
  const percent = rawPercent !== undefined && Number.isFinite(rawPercent) && rawPercent >= 0 && rawPercent <= 100 ? rawPercent : undefined
  const status = match[3] && (REPORT_STATUSES as string[]).includes(match[3].toLowerCase()) ? match[3].toLowerCase() as ReportStatus : undefined
  return { vendor, ...(percent !== undefined ? { percent } : {}), ...(status ? { status } : {}), body: rest.join('\n').trim() }
}
