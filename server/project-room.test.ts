import { describe, expect, it } from 'vitest'
import { buildOfficeSnapshot, type RuntimeSnapshot, type TaskBoardSnapshot } from './mission-control.js'

const STAMP = '2026-10-29T00:00:00.000Z'

/** A board holding one reviewable task assigned to `coder`, and nothing else. */
function boardWithReviewTask(): TaskBoardSnapshot {
  return {
    tasks: { availability: 'available', data: [{ title: 'Review the deliverable', status: 'review', assignee: 'coder' }] },
    fetchedAt: STAMP,
  } as TaskBoardSnapshot
}

function runtime(): RuntimeSnapshot {
  return {
    profiles: { availability: 'available', data: [{ name: 'default', gateway: 'Running' }, { name: 'coder', gateway: 'Running' }] },
    openCode: { availability: 'available', data: '1.0.0' },
    fetchedAt: STAMP,
  } as RuntimeSnapshot
}

const activity = { sessions: { availability: 'available', data: [] }, fetchedAt: STAMP } as never

function station(name: string) {
  const office = buildOfficeSnapshot(runtime(), boardWithReviewTask(), activity, { now: STAMP })
  return office.stations.find((item) => item.name === name)
}

/**
 * The Project Room is chosen from agent STATE only. It must never be derived from
 * a board name or task title: a task whose title contains "Review" does not move
 * anyone, and a plain comment does not either.
 */
describe('room placement by state', () => {
  it('sends a Reviewing agent to the Project Room at the review table', () => {
    const coder = station('coder')
    expect(coder?.state).toBe('Reviewing')
    expect(coder?.room).toBe('Project Room')
    expect(coder?.roomPosition).toBe('review-table')
  })

  it('keeps an Idle agent in the Lounge, not the Project Room', () => {
    const idle = station('default')
    expect(idle?.room).toBe('Lounge')
  })

  it('leaves every other room position as upstream set it', () => {
    // Guards against the Project Room edit disturbing Working / Collaborating placement.
    for (const item of buildOfficeSnapshot(runtime(), boardWithReviewTask(), activity, { now: STAMP }).stations) {
      if (item.state === 'Working') expect(item.roomPosition).toBe('assigned-desk')
      if (item.state === 'Collaborating') expect(item.roomPosition).toBe('meeting-area')
      if (item.state === 'Idle') expect(item.room).toBe('Lounge')
    }
  })

  it('never places an Unknown agent in the Project Room', () => {
    const office = buildOfficeSnapshot(
      { profiles: { availability: 'available', data: [{ name: 'default', gateway: 'Running' }] }, openCode: { availability: 'unavailable', error: { message: 'not installed' } }, fetchedAt: STAMP } as unknown as RuntimeSnapshot,
      { tasks: { availability: 'unavailable', error: { message: 'not installed' } }, fetchedAt: STAMP } as unknown as TaskBoardSnapshot,
      { sessions: { availability: 'unavailable', error: { message: 'not installed' } }, fetchedAt: STAMP } as never,
      { now: STAMP },
    )
    for (const item of office.stations) {
      if (item.state === 'Unknown') expect(item.room).not.toBe('Project Room')
    }
  })
})
