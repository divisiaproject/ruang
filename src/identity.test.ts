import { describe, expect, it } from 'vitest'
import { displayAgentName } from './identity.ts'

describe('displayAgentName', () => {
  it('uses OM as the visible label and Office Manager as its hover title for the default profile', () => {
    expect(displayAgentName('default')).toEqual({ label: 'OM', title: 'Office Manager' })
  })
  it('does not rename other profile identifiers', () => {
    expect(displayAgentName('leadagent')).toEqual({ label: 'leadagent' })
  })
  it('uses Hermes when no profile name is available', () => {
    expect(displayAgentName(undefined)).toEqual({ label: 'Hermes' })
  })
})
