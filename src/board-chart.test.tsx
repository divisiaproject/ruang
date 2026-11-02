import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BOARD_CHART_MODES, BoardChart } from './board-chart.tsx'
import type { KanbanStatusCounts } from './types.ts'

/**
 * The three chart shapes render the same counts with the same tone scale.
 * No library, no endpoint: plain SVG for the pie, plain divs for the bars.
 */
const COUNTS: KanbanStatusCounts = {
  byStatus: { triage: 0, todo: 0, scheduled: 0, ready: 3, running: 2, blocked: 2, done: 3 },
  total: 10,
  oldestReadySeconds: 983,
}

describe('BoardChart', () => {
  it('offers exactly the three agreed shapes, defaulting to bar horizontal', () => {
    expect(BOARD_CHART_MODES.map((option) => option.value)).toEqual(['bar-h', 'bar-v', 'pie'])
  })

  it('renders the horizontal bar with proportional segments', () => {
    const markup = renderToStaticMarkup(<BoardChart counts={COUNTS} mode="bar-h"/>)
    expect(markup).toContain('health-bar')
    expect(markup).toContain('flex-grow:3') // ready: 3 tasks
    expect(markup).toContain('10 tasks: 0 triage')
  })

  it('renders the vertical bar with one column per status and the raw numbers', () => {
    const markup = renderToStaticMarkup(<BoardChart counts={COUNTS} mode="bar-v"/>)
    expect(markup).toContain('health-vbar')
    expect(markup).toContain('health-vbar-label')
    expect(markup).toContain('10 tasks: 0 triage')
  })

  it('renders the pie as SVG slices with the same tone scale', () => {
    const markup = renderToStaticMarkup(<BoardChart counts={COUNTS} mode="pie"/>)
    expect(markup).toContain('<svg')
    expect(markup).toContain('health-pie-slice tone-info') // ready maps to info
    expect(markup).toContain('health-pie-slice tone-bad') // blocked maps to bad
    expect(markup).toContain('stroke-dasharray')
    expect(markup).toContain('10 tasks: 0 triage')
  })

  it('gives every shape an identical accessible label', () => {
    const label = '10 tasks: 0 triage'
    for (const mode of ['bar-h', 'bar-v', 'pie'] as const) {
      expect(renderToStaticMarkup(<BoardChart counts={COUNTS} mode={mode}/>)).toContain(label)
    }
  })
})
