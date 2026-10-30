/** Display names intentionally differ from Hermes profile identifiers. */
export function displayAgentName(profile: string | undefined): { label: string; title?: string } {
  if (profile === 'default') return { label: 'OM', title: 'Office Manager' }
  return { label: profile ?? 'Hermes' }
}
