import { beforeEach, describe, expect, it, vi } from 'vitest'

const marketApi = vi.hoisted(() => ({ prices: vi.fn() }))
vi.mock('../services/api/endpoints.js', () => ({ marketIntelligence: marketApi }))

import { fetchMarketObservations } from '../features/farmer/services/marketIntelligenceService.js'

const NOW = Date.parse('2026-11-04T12:00:00.000Z')
const verifiedObservation = (overrides = {}) => ({
  id: 'obs-1', commodity: 'Maize', market: 'Nakuru', price: 42,
  currency: 'KES', unit: 'kg', observedAt: '2026-11-04T10:00:00.000Z',
  source: { name: 'Trusted Provider', verified: true, url: 'https://data.example.test/market' },
  ...overrides,
})

describe('live market observation validation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps only source-verified, supported observations and labels stale data', async () => {
    marketApi.prices.mockResolvedValue({ data: [
      verifiedObservation(),
      verifiedObservation({ id: 'duplicate' }),
      verifiedObservation({ id: 'stale', commodity: 'Beans', observedAt: '2026-11-01T10:00:00.000Z' }),
      verifiedObservation({ id: 'unverified', source: { name: 'Unverified Source' } }),
      verifiedObservation({ id: 'unsupported-unit', unit: 'basket' }),
      verifiedObservation({ id: 'bad-date', observedAt: '2026-02-31T10:00:00.000Z' }),
    ] })

    const result = await fetchMarketObservations({ now: NOW })
    expect(marketApi.prices).toHaveBeenCalledWith({ limit: 100 })
    expect(result.observations.map((row) => row.id)).toEqual(['obs-1', 'stale'])
    expect(result.observations[0]).toMatchObject({ freshness: 'fresh', sourceName: 'Trusted Provider', currency: 'KES', unit: 'kg' })
    expect(result.observations[1].freshness).toBe('stale')
    expect(result.duplicateCount).toBe(1)
    expect(result.rejectedCount).toBe(3)
    expect(result.rejectedReasons).toMatchObject({
      'Source verification was not confirmed by the API.': 1,
      'Unsupported measurement unit: basket.': 1,
      'Missing or invalid observation date and time.': 1,
    })
  })

  it('rejects unexpected response shapes instead of rendering fallback data', async () => {
    marketApi.prices.mockResolvedValue({ data: { results: [] } })
    await expect(fetchMarketObservations({ now: NOW })).rejects.toThrow(/unsupported response shape/)
  })

  it('keeps KAMIS wholesale and retail quotes distinct and preserves date precision and source provenance', async () => {
    marketApi.prices.mockResolvedValue({ data: [
      { id: 'kamis-wholesale', commodity: 'Dry Maize (White Maize)', market: 'Kibuye', price: 65, currency: 'KES', unit: 'kg', unitLabel: 'Kg', priceType: 'wholesale', observedAt: '2026-11-04', observationTimePrecision: 'date', source: 'KAMIS', sourceReference: 'https://kamis.kilimo.go.ke/site/market_search', verificationStatus: 'verified' },
      { id: 'kamis-retail', commodity: 'Dry Maize (White Maize)', market: 'Kibuye', price: 65, currency: 'KES', unit: 'kg', unitLabel: 'Kg', priceType: 'retail', observedAt: '2026-11-04', observationTimePrecision: 'date', source: 'KAMIS', sourceReference: 'https://kamis.kilimo.go.ke/site/market_search', verificationStatus: 'verified' },
    ] })
    const result = await fetchMarketObservations({ now: NOW })
    expect(result.observations).toHaveLength(2)
    expect(result.observations.map((row) => row.priceType)).toEqual(['wholesale', 'retail'])
    expect(result.observations[0]).toMatchObject({ dateOnly: true, unit: 'Kg', unitCode: 'kg', sourceUrl: 'https://kamis.kilimo.go.ke/site/market_search' })
  })

  it('propagates API failures without replacing them with sample values', async () => {
    marketApi.prices.mockRejectedValue({ status: 503, error: 'Market data source is unavailable.' })
    await expect(fetchMarketObservations({ now: NOW })).rejects.toMatchObject({ error: 'Market data source is unavailable.' })
  })
})
