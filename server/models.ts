/**
 * The models a profile may be switched to, grouped by provider.
 *
 * Source: `hermes config get custom_providers`, which prints a small YAML list. Ruang does not
 * carry a YAML parser (a whole dependency for one narrow, machine-printed shape), so this reads
 * exactly the two levels that command emits: a list of providers, each with `name`, `base_url`,
 * `model` and an optional `models` list. Anything else is ignored rather than guessed at.
 */

export interface ProviderModel { id: string; provider: string; current: boolean; default: boolean }

export interface ProviderSummary { name: string; baseUrl?: string; model?: string; models: string[] }

function unquote(value: string): string {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) return trimmed.slice(1, -1)
  return trimmed
}

/**
 * Parses the provider list. A provider without a `models:` block keeps an empty list: Hermes
 * stores no catalogue for it, and inventing one would put unverified names in front of the user.
 */
export function parseCustomProviders(output: string): ProviderSummary[] {
  const providers: ProviderSummary[] = []
  let provider: ProviderSummary | undefined
  let inModels = false
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '')
    if (!line.trim() || /^\s*#/.test(line)) continue
    // "  - name: X" starts a provider; "    - value" continues its models list.
    const start = line.match(/^\s*-\s+name:\s*(.+)$/)
    if (start) {
      provider = { name: unquote(start[1]), models: [] }
      providers.push(provider)
      inModels = false
      continue
    }
    if (!provider) continue
    const field = line.match(/^\s+(base_url|api_key|model|models):\s*(.*)$/)
    if (field) {
      const [, key, rest] = field
      if (key === 'models') {
        inModels = true
        // "models: []" is an explicitly empty list; a bare "models:" opens a block list.
        const inline = rest.trim()
        if (inline.startsWith('[')) provider.models = inline.slice(1, -1).split(',').map(unquote).filter(Boolean)
        else if (inline) provider.models = [unquote(inline)]
        continue
      }
      inModels = false
      if (key === 'base_url') provider.baseUrl = unquote(rest)
      if (key === 'model') provider.model = unquote(rest)
      continue
    }
    const item = line.match(/^\s+-\s+(.+)$/)
    if (item && inModels) { provider.models.push(unquote(item[1])); continue }
    inModels = false
  }
  return providers.filter((entry) => entry.name !== '')
}

/**
 * Flattens providers into selectable models. `currentModel` (the model the profile really uses)
 * marks one entry, so the picker can show the truth even when it is not in any catalogue.
 */
export function providerModels(providers: ProviderSummary[], currentModel?: string): ProviderModel[] {
  const rows: ProviderModel[] = []
  const seen = new Set<string>()
  for (const provider of providers) {
    for (const id of provider.models) {
      const key = `${provider.name}\u0000${id}`
      if (seen.has(key)) continue
      seen.add(key)
      rows.push({ id, provider: provider.name, current: id === currentModel, default: id === provider.model })
    }
  }
  return rows.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id))
}

/**
 * The model a profile reports using. A provider catalogue can be empty or stale, but this value
 * is what the profile truly runs, so it is always offered even when no catalogue lists it.
 */
export function currentModelRow(providers: ProviderSummary[], currentModel?: string): ProviderModel | undefined {
  if (!currentModel) return undefined
  const known = providers.find((provider) => provider.models.includes(currentModel))
  return { id: currentModel, provider: known?.name ?? 'current profile', current: true, default: true }
}
