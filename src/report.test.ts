import { describe, expect, it } from 'vitest'
import { formatReport, parseReport } from './report.ts'

describe('formatReport', () => {
  it('writes a full header followed by the body', () => {
    expect(formatReport({ vendor: 'CV Sinar Jaya', percent: 60, status: 'on-track', body: 'Revisi 2 terkirim.' })).toBe(
      '[Vendor: CV Sinar Jaya] [Progres: 60%] [Status: on-track]\nRevisi 2 terkirim.',
    )
  })

  it('omits figures the reporter did not give, rather than writing 0', () => {
    expect(formatReport({ vendor: 'Tim Internal', body: 'Catatan bebas.' })).toBe('[Vendor: Tim Internal]\nCatatan bebas.')
  })

  it('clamps and rounds a percentage instead of passing nonsense through', () => {
    expect(formatReport({ vendor: 'A', percent: 140, body: '' })).toContain('[Progres: 100%]')
    expect(formatReport({ vendor: 'A', percent: -5, body: '' })).toContain('[Progres: 0%]')
    expect(formatReport({ vendor: 'A', percent: 62.7, body: '' })).toContain('[Progres: 63%]')
  })
})

describe('parseReport', () => {
  it('round-trips what formatReport produced', () => {
    const body = formatReport({ vendor: 'CV Sinar Jaya', percent: 60, status: 'at-risk', body: 'Menunggu approval.' })
    expect(parseReport(body)).toEqual({ vendor: 'CV Sinar Jaya', percent: 60, status: 'at-risk', body: 'Menunggu approval.' })
  })

  it('round-trips a vendor-only report', () => {
    expect(parseReport(formatReport({ vendor: 'Tim Internal', body: 'Catatan.' }))).toEqual({ vendor: 'Tim Internal', body: 'Catatan.' })
  })

  it('returns undefined for an ordinary comment so it is never mislabelled', () => {
    expect(parseReport('Looks good to me')).toBeUndefined()
    expect(parseReport('')).toBeUndefined()
    expect(parseReport('[Vendor: ]\nkosong')).toBeUndefined()
  })

  it('ignores a header that is not on the first line', () => {
    expect(parseReport('intro\n[Vendor: X]\nbody')).toBeUndefined()
  })

  it('rejects an out-of-range percentage instead of showing it', () => {
    const parsed = parseReport('[Vendor: X] [Progres: 240%]\nbody')
    expect(parsed?.percent).toBeUndefined()
    expect(parsed?.vendor).toBe('X')
  })

  it('drops an unknown status rather than trusting it', () => {
    expect(parseReport('[Vendor: X] [Status: whatever]\nbody')?.status).toBeUndefined()
  })

  it('keeps a multi-line body intact', () => {
    expect(parseReport('[Vendor: X]\nline one\nline two')?.body).toBe('line one\nline two')
  })

  it('is case-insensitive on the header keys', () => {
    expect(parseReport('[vendor: X] [progres: 20%] [status: blocked]')?.vendor).toBe('X')
  })
})
