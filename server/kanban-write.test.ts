import { describe, expect, it } from 'vitest'
import { assignTaskArgs, blockTaskArgs, claimTaskArgs, commentTaskArgs, completeTaskArgs, createTaskArgs, promoteTaskArgs, scheduleTaskArgs, unblockTaskArgs, KanbanWriteError } from './kanban-write.js'

const BOARD = 'divisia-demo'
const ID = 't_bf59f78e'

/** `--board` is a GLOBAL flag on `hermes kanban`; Hermes rejects it after the subcommand. */
function boardBeforeSubcommand(args: string[], subcommand: string): boolean {
  const board = args.indexOf('--board')
  const sub = args.indexOf(subcommand)
  return board === 1 && args[0] === 'kanban' && args[2] === BOARD && sub > board
}

function expectReject(fn: () => unknown, code: string) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(KanbanWriteError)
    expect((error as KanbanWriteError).code).toBe(code)
    return
  }
  throw new Error(`expected ${code}, but the call succeeded`)
}

describe('argv shape', () => {
  it('create puts --board before the subcommand', () => {
    const args = createTaskArgs(BOARD, { title: 'Naskah kampanye' })
    expect(args).toEqual(['kanban', '--board', BOARD, 'create', 'Naskah kampanye'])
    expect(boardBeforeSubcommand(args, 'create')).toBe(true)
  })

  it('claim, complete, block, unblock, comment, assign, promote, schedule all keep --board second', () => {
    expect(boardBeforeSubcommand(claimTaskArgs(BOARD, ID, undefined), 'claim')).toBe(true)
    expect(boardBeforeSubcommand(completeTaskArgs(BOARD, [ID], 'done'), 'complete')).toBe(true)
    expect(boardBeforeSubcommand(blockTaskArgs(BOARD, ID, 'why', undefined), 'block')).toBe(true)
    expect(boardBeforeSubcommand(unblockTaskArgs(BOARD, ID), 'unblock')).toBe(true)
    expect(boardBeforeSubcommand(commentTaskArgs(BOARD, ID, 'note'), 'comment')).toBe(true)
    expect(boardBeforeSubcommand(assignTaskArgs(BOARD, ID, 'leadagent'), 'assign')).toBe(true)
    expect(boardBeforeSubcommand(promoteTaskArgs(BOARD, ID), 'promote')).toBe(true)
    expect(boardBeforeSubcommand(scheduleTaskArgs(BOARD, ID, '2026-11-01T08:00:00'), 'schedule')).toBe(true)
  })

  it('never emits a shell string: every token is a separate argv element', () => {
    const args = createTaskArgs(BOARD, { title: 'Naskah; rm -rf / && echo pwned' })
    expect(args).toContain('Naskah; rm -rf / && echo pwned')
    expect(args.some((token) => token.includes('&&'))).toBe(true)
    expect(args.length).toBe(5) // the whole title stays ONE element
  })
})

describe('block kind', () => {
  it('defaults to needs_input, never dependency', () => {
    const args = blockTaskArgs(BOARD, ID, 'vendor belum kirim', undefined)
    expect(args).toContain('--kind')
    expect(args[args.indexOf('--kind') + 1]).toBe('needs_input')
    expect(args).not.toContain('dependency')
  })

  it('rejects an unknown kind by falling back to needs_input rather than passing it through', () => {
    const args = blockTaskArgs(BOARD, ID, 'x', 'nonsense-kind')
    expect(args[args.indexOf('--kind') + 1]).toBe('needs_input')
  })

  it('passes a valid kind through', () => {
    const args = blockTaskArgs(BOARD, ID, 'x', 'capability')
    expect(args[args.indexOf('--kind') + 1]).toBe('capability')
  })
})

describe('validation', () => {
  it('rejects a bad board slug', () => {
    expectReject(() => createTaskArgs('../etc', { title: 'x' }), 'INVALID_BOARD')
    expectReject(() => createTaskArgs('Board With Spaces', { title: 'x' }), 'INVALID_BOARD')
    expectReject(() => createTaskArgs('', { title: 'x' }), 'INVALID_BOARD')
  })

  it('rejects a bad task id', () => {
    expectReject(() => claimTaskArgs(BOARD, '--help', undefined), 'INVALID_TASK')
    expectReject(() => claimTaskArgs(BOARD, 'a b', undefined), 'INVALID_TASK')
    expectReject(() => claimTaskArgs(BOARD, '', undefined), 'INVALID_TASK')
  })

  it('rejects a title that would be read as a flag', () => {
    expectReject(() => createTaskArgs(BOARD, { title: '--board evil' }), 'INVALID_TITLE')
    expectReject(() => createTaskArgs(BOARD, { title: '' }), 'INVALID_TITLE')
    expectReject(() => createTaskArgs(BOARD, {}), 'INVALID_TITLE')
  })

  it('rejects an over-long title instead of truncating silently', () => {
    expectReject(() => createTaskArgs(BOARD, { title: 'x'.repeat(301) }), 'INVALID_TITLE')
  })

  it('caps a bulk complete', () => {
    const many = Array.from({ length: 51 }, (_, index) => `t_${index}`)
    expectReject(() => completeTaskArgs(BOARD, many, undefined), 'INVALID_INPUT')
  })

  it('rejects a nonsensical claim ttl', () => {
    expectReject(() => claimTaskArgs(BOARD, ID, 0), 'INVALID_INPUT')
    expectReject(() => claimTaskArgs(BOARD, ID, 90_000), 'INVALID_INPUT')
    expectReject(() => claimTaskArgs(BOARD, ID, 'soon'), 'INVALID_INPUT')
  })

  it('rejects an assignee that would be read as a flag', () => {
    expectReject(() => assignTaskArgs(BOARD, ID, '--yes'), 'INVALID_INPUT')
    expectReject(() => assignTaskArgs(BOARD, ID, '-x'), 'INVALID_INPUT')
  })

  it('rejects control characters in an assignee', () => {
    expectReject(() => assignTaskArgs(BOARD, ID, 'CV\nSinar'), 'INVALID_INPUT')
  })

  it('accepts a vendor name with spaces and capitals', () => {
    // A Kanban assignee is a free-text label, not a profile id. Blocking this made
    // every real vendor unassignable.
    expect(assignTaskArgs(BOARD, ID, 'CV Sinar Jaya')).toEqual(['kanban', '--board', BOARD, 'assign', ID, 'CV Sinar Jaya'])
  })

  it('keeps a vendor name as ONE argv element, never split on spaces', () => {
    const args = assignTaskArgs(BOARD, ID, 'CV Sinar Jaya')
    expect(args).toHaveLength(6)
    expect(args[5]).toBe('CV Sinar Jaya')
  })

  it('still accepts a profile-style id', () => {
    expect(assignTaskArgs(BOARD, ID, 'leadagent')).toContain('leadagent')
  })

  it('requires a comment body', () => {
    expectReject(() => commentTaskArgs(BOARD, ID, ''), 'INVALID_INPUT')
  })
})

describe('optional flags are omitted, not passed empty', () => {
  it('create without body or assignee stays minimal', () => {
    expect(createTaskArgs(BOARD, { title: 'x' })).toHaveLength(5)
  })

  it('complete without a result adds no --result', () => {
    expect(completeTaskArgs(BOARD, [ID], '')).not.toContain('--result')
  })

  it('claim without a ttl adds no --ttl', () => {
    expect(claimTaskArgs(BOARD, ID, undefined)).not.toContain('--ttl')
  })

  it('block without a reason still names the kind', () => {
    const args = blockTaskArgs(BOARD, ID, '', undefined)
    expect(args).toEqual(['kanban', '--board', BOARD, 'block', '--kind', 'needs_input', ID])
  })
})
