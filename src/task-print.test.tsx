import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TaskPrintButton } from './task-print.tsx'

/**
 * The print button is a read-only export: it prints the already-fetched
 * detail snapshot with `window.print()`. No server endpoint, no write
 * token, no dependency. The detail dialog decides *when* it shows (only
 * with `detail` loaded and the agent unlocked); this only pins *what*.
 */
describe('TaskPrintButton', () => {
  it('offers print / PDF without asking for anything', () => {
    const markup = renderToStaticMarkup(<TaskPrintButton title="Survey harga vinyl di Jakarta"/>)
    expect(markup).toContain('Cetak / PDF')
    expect(markup).toContain('Save as PDF')
    expect(markup).not.toContain('token')
  })

  it('marks itself no-print so it stays out of the PDF', () => {
    expect(renderToStaticMarkup(<TaskPrintButton/>)).toContain('no-print')
  })

  it('names the task in the accessible label for screen readers', () => {
    const markup = renderToStaticMarkup(<TaskPrintButton title="Survey harga vinyl di Jakarta"/>)
    expect(markup).toContain('Cetak laporan Survey harga vinyl di Jakarta')
  })
})
