import { describe, expect, it } from 'vitest'
import { currentModelRow, parseCustomProviders, providerModels } from './models.js'

// Verbatim shape of `hermes config get custom_providers` on the live host (api_key elided).
// Note the provider with no `models:` block and the ids that contain slashes and dots.
const OUTPUT = `- name: Kunciai.id
  base_url: https://kunciai.id/v1
  api_key: sk-x
  model: kunciai/prov3-deepseek-v4-flash
  models:
  - kunciai/claude-fable-5.1
  - kunciai/gpt-6.1-sol
  - kunciai/nano-banana-2
- name: Api.ezkielyna.store
  base_url: https://api.ezkielyna.store/v1
  api_key: sk-y
  model: deepseek-v4.1-flash-1017
  models:
  - deepseek-v4.1-flash
  - deepseek-v4.1-flash-1017
  - minimax-m3.1-flash
- name: Kiyararouter.web.id
  base_url: https://kiyararouter.web.id/v1
  api_key: sk-z
`

describe('parseCustomProviders', () => {
  it('reads every provider, in order', () => {
    expect(parseCustomProviders(OUTPUT).map((p) => p.name)).toEqual(['Kunciai.id', 'Api.ezkielyna.store', 'Kiyararouter.web.id'])
  })

  it('keeps each provider\'s own model list', () => {
    const [kunci, ezki] = parseCustomProviders(OUTPUT)
    expect(kunci.models).toEqual(['kunciai/claude-fable-5.1', 'kunciai/gpt-6.1-sol', 'kunciai/nano-banana-2'])
    expect(ezki.models).toEqual(['deepseek-v4.1-flash', 'deepseek-v4.1-flash-1017', 'minimax-m3.1-flash'])
  })

  it('leaves a provider with no models block empty instead of inventing entries', () => {
    const kiyara = parseCustomProviders(OUTPUT)[2]
    expect(kiyara.models).toEqual([])
    expect(kiyara.model).toBeUndefined()
  })

  it('reads base_url and the default model', () => {
    const ezki = parseCustomProviders(OUTPUT)[1]
    expect(ezki.baseUrl).toBe('https://api.ezkielyna.store/v1')
    expect(ezki.model).toBe('deepseek-v4.1-flash-1017')
  })

  it('returns nothing for output it does not recognise, rather than guessing', () => {
    expect(parseCustomProviders('')).toEqual([])
    expect(parseCustomProviders('not: [valid yaml here')).toEqual([])
  })
})

describe('providerModels', () => {
  it('lists every model with the provider it came from', () => {
    const rows = providerModels(parseCustomProviders(OUTPUT), 'deepseek-v4.1-flash-1017')
    expect(rows).toHaveLength(6)
    expect(rows.find((row) => row.id === 'deepseek-v4.1-flash-1017')).toEqual({ id: 'deepseek-v4.1-flash-1017', provider: 'Api.ezkielyna.store', current: true, default: true })
    expect(rows.find((row) => row.id === 'minimax-m3.1-flash')).toMatchObject({ provider: 'Api.ezkielyna.store', current: false })
  })

  it('groups by provider so two providers can offer the same id', () => {
    const providers = [
      { name: 'A', models: ['shared-model'] },
      { name: 'B', models: ['shared-model'] },
    ]
    expect(providerModels(providers).map((row) => row.provider)).toEqual(['A', 'B'])
  })

  it('marks exactly one current model', () => {
    const rows = providerModels(parseCustomProviders(OUTPUT), 'minimax-m3.1-flash')
    expect(rows.filter((row) => row.current)).toHaveLength(1)
  })

  it('has nothing to offer when no provider lists models', () => {
    expect(providerModels([{ name: 'Kiyararouter.web.id', models: [] }])).toEqual([])
  })
})

describe('currentModelRow', () => {
  it('offers the running model even when no catalogue lists it', () => {
    const row = currentModelRow(parseCustomProviders(OUTPUT), 'some-unlisted-model')
    expect(row).toEqual({ id: 'some-unlisted-model', provider: 'current profile', current: true, default: true })
  })

  it('attributes the running model to the provider that lists it', () => {
    expect(currentModelRow(parseCustomProviders(OUTPUT), 'minimax-m3.1-flash')).toMatchObject({ provider: 'Api.ezkielyna.store' })
  })

  it('has no row when the profile reports no model', () => {
    expect(currentModelRow(parseCustomProviders(OUTPUT), undefined)).toBeUndefined()
  })
})
