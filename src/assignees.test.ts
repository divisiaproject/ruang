import { describe, expect, it } from 'vitest'
import { assigneeCaveat, assigneeOptions } from './assignees.ts'

describe('assigneeOptions', () => {
  it('lists profiles as agents even when no task uses them yet', () => {
    const options = assigneeOptions({ profiles: ['leadagent'], used: [], profilesKnown: true })
    expect(options).toEqual([{ value: 'leadagent', kind: 'agent', source: 'profile' }])
  })

  it('keeps a vendor name as a label and never calls it an agent', () => {
    const options = assigneeOptions({ profiles: ['leadagent'], used: ['CV Sinar Jaya'], profilesKnown: true })
    expect(options).toContainEqual({ value: 'CV Sinar Jaya', kind: 'label', source: 'board' })
  })

  it('puts agents before labels', () => {
    const options = assigneeOptions({ profiles: ['leadagent'], used: ['Aaa Vendor'], profilesKnown: true })
    expect(options.map((option) => option.kind)).toEqual(['agent', 'label'])
  })

  it('does not duplicate a profile that is also used as an assignee', () => {
    const options = assigneeOptions({ profiles: ['leadagent'], used: ['leadagent'], profilesKnown: true })
    expect(options).toHaveLength(1)
    expect(options[0].kind).toBe('agent')
  })

  it('matches a profile case-insensitively and reports it as an agent', () => {
    const options = assigneeOptions({ profiles: ['leadagent'], used: ['LeadAgent'], profilesKnown: true })
    expect(options).toHaveLength(1)
    expect(options[0].kind).toBe('agent')
  })

  it('ignores blank and undefined assignees', () => {
    const options = assigneeOptions({ profiles: [], used: [undefined, '', '   '], profilesKnown: true })
    expect(options).toEqual([])
  })

  it('sorts labels so the dropdown is stable across polls', () => {
    const options = assigneeOptions({ profiles: [], used: ['Zeta', 'Alpha', 'Mid'], profilesKnown: true })
    expect(options.map((option) => option.value)).toEqual(['Alpha', 'Mid', 'Zeta'])
  })

  it('returns only what it can see when the profile list is unavailable', () => {
    const options = assigneeOptions({ used: ['CV Sinar Jaya'], profilesKnown: false })
    expect(options).toEqual([{ value: 'CV Sinar Jaya', kind: 'label', source: 'board' }])
  })
})

describe('assigneeCaveat', () => {
  it('warns that agent names are unknown rather than implying none exist', () => {
    expect(assigneeCaveat({ used: [], profilesKnown: false })).toContain('unavailable')
  })

  it('says plainly when no profiles exist at all', () => {
    expect(assigneeCaveat({ profiles: [], used: [], profilesKnown: true })).toContain('No Hermes profiles')
  })

  it('stays quiet when profiles exist', () => {
    expect(assigneeCaveat({ profiles: ['leadagent'], used: [], profilesKnown: true })).toBeUndefined()
  })
})
