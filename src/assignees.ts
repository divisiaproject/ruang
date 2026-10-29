/**
 * Assignee options for a Kanban board.
 *
 * A Kanban `assignee` is a plain string, not a foreign key. Some values name a real
 * Hermes profile (an agent that can actually be dispatched work); others are just labels
 * for a human vendor or team. The UI must not blur that line, so every option carries
 * which kind it is and where the evidence came from.
 */

export type AssigneeKind = 'agent' | 'label'

export interface AssigneeOption {
  /** The exact string stored in `assignee`. */
  value: string
  kind: AssigneeKind
  /** Why this option exists: `profile` = named in `hermes profile list`; `board` = already used on a task. */
  source: 'profile' | 'board'
}

export interface AssigneeInput {
  /** Profile names from `hermes profile list`; undefined when that source was unavailable. */
  profiles?: string[]
  /** Assignee values already present on tasks, in any board. */
  used: (string | undefined)[]
  /** Profile availability, so an empty list can be reported as unknown rather than empty. */
  profilesKnown: boolean
}

/**
 * Builds the option list, agents first. A profile becomes an Agent option even with no
 * tasks yet (you must be able to assign the first one). A used name that is NOT a profile
 * stays a plain label and is never relabelled as an agent.
 */
export function assigneeOptions(input: AssigneeInput): AssigneeOption[] {
  const profiles = (input.profiles ?? []).filter((name) => name.trim() !== '')
  const profileSet = new Set(profiles.map((name) => name.toLowerCase()))
  const agentOptions: AssigneeOption[] = profiles.map((name) => ({ value: name, kind: 'agent', source: 'profile' }))

  const seen = new Set(agentOptions.map((option) => option.value.toLowerCase()))
  const labelOptions: AssigneeOption[] = []
  for (const raw of input.used) {
    const name = (raw ?? '').trim()
    if (!name) continue
    const key = name.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    // Matched case-insensitively against profiles, but reported with the board's own spelling.
    labelOptions.push({ value: name, kind: profileSet.has(key) ? 'agent' : 'label', source: 'board' })
  }

  labelOptions.sort((a, b) => a.value.localeCompare(b.value))
  return [...agentOptions, ...labelOptions]
}

/** True when the board has assignees but no profile list, so "no agents" must not be claimed. */
export function assigneeCaveat(input: AssigneeInput): string | undefined {
  if (!input.profilesKnown) return 'Profile list unavailable, so agent names are unknown. Only names already used on this board are listed.'
  if ((input.profiles ?? []).length === 0) return 'No Hermes profiles exist yet, so only plain labels are available.'
  return undefined
}
