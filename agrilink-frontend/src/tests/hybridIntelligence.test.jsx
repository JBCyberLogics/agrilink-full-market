import { beforeEach, describe, expect, it, vi } from 'vitest'

const deps = vi.hoisted(() => ({
  marketListings: vi.fn(),
  fetchMarketObservations: vi.fn(),
  requestAI: vi.fn(),
  loadMatchingWeights: vi.fn(),
}))

vi.mock('../features/marketplace/services/marketplaceService.js', () => ({ marketListings: deps.marketListings }))
vi.mock('../features/farmer/services/marketIntelligenceService.js', () => ({ fetchMarketObservations: deps.fetchMarketObservations }))
vi.mock('../ai/client.js', () => ({ requestAI: deps.requestAI }))
vi.mock('../services/api/client.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, api: { ...actual.api, get: deps.loadMatchingWeights } }
})

import {
  adviseFromMarketObservations,
  adviseFromVerifiedPrices,
  createPurchasePlanFromMarketplace,
  findProduceFromMarketplace,
  rankSuppliersFromMarketplace,
  recommendFromMarketplace,
} from '../features/ai/services/hybridIntelligence.js'

const listing = ({
  id = 'listing-1', produce = 'Maize', price = 25, stock = 40, unit = 'kg',
  location = 'Nakuru', quality = 'A', currency = 'KES', available = true,
  sellerId = 'farmer-1', sellerName = 'Farmer account',
} = {}) => ({
  id,
  name: produce,
  location,
  raw: {
    _id: id,
    name: produce,
    pricePerUnit: price,
    availableStock: stock,
    unit,
    currency,
    marketLocation: location,
    qualityGrade: quality,
    isAvailable: available,
    seller: { _id: sellerId, fullName: sellerName, location },
  },
})

describe('hybrid intelligence service adapters', () => {
  beforeEach(() => {
    deps.marketListings.mockReset()
    deps.fetchMarketObservations.mockReset()
    deps.requestAI.mockReset().mockResolvedValue({ ok: false, code: 'AI_PROXY_NOT_CONFIGURED' })
    deps.loadMatchingWeights.mockReset().mockResolvedValue({ weights: { price: 0.35, quality: 0.25, distance: 0.2, availability: 0.2 }, version: 1 })
    deps.marketListings.mockResolvedValue({ listings: [listing()], meta: { total: 1 } })
  })

  it('ranks only actual API listing responses and returns deterministic recommendation explanations', async () => {
    const response = await recommendFromMarketplace({ role: 'buyer', produceType: 'Maize', location: 'Nakuru' })
    expect(response).toMatchObject({ ok: true, data: { source: 'authenticated marketplace API', fetchedCount: 1 } })
    expect(response.data.items[0]).toMatchObject({ id: 'listing-1', listing: { unitPrice: 25, currency: 'KES' }, score: 100 })
    expect(response.data.items[0].factors.join(' ')).toMatch(/Fit score/)
    expect(deps.marketListings).toHaveBeenCalledWith({ limit: 100 })
  })

  it('filters buyer produce search on actual unit, stock, quality, location, and budget values', async () => {
    deps.marketListings.mockResolvedValue({ listings: [
      listing(),
      listing({ id: 'bad-unit', unit: 'crate' }),
      listing({ id: 'bad-stock', stock: 10 }),
      listing({ id: 'bad-place', location: 'Meru' }),
    ] })
    const response = await findProduceFromMarketplace({
      produceType: 'Maize', requiredQuantity: 20, unit: 'kg', location: 'Nakuru',
      qualityRequirements: 'A', budgetRange: '500-1000',
    })
    expect(response.data.matches.map((match) => match.listingId)).toEqual(['listing-1'])
    expect(response.data.matches[0]).toMatchObject({ price: 25, currency: 'KES', unit: 'kg', quantity: 40 })
    expect(response.data.excludedCount).toBe(3)
  })

  it('ranks supplier accounts from real listings and omits unverified fulfillment claims', async () => {
    deps.marketListings.mockResolvedValue({ listings: [
      listing({ id: 'maize-1', sellerId: 'seller-a', sellerName: 'Seller A', stock: 20 }),
      listing({ id: 'maize-2', sellerId: 'seller-a', sellerName: 'Seller A', stock: 30, price: 20 }),
      listing({ id: 'other', sellerId: 'seller-b', produce: 'Beans' }),
    ] })
    const response = await rankSuppliersFromMarketplace({ produceType: 'Maize', quantity: 10, unit: 'kg', location: 'Nakuru' })
    expect(response.data.suppliers).toHaveLength(1)
    expect(response.data.suppliers[0]).toMatchObject({ supplierId: 'seller-a', verifiedHistory: null })
    expect(response.data.suppliers[0].reasons.join(' ')).not.toMatch(/fulfilled orders/i)
    expect(response.data.matchingWeights).toEqual({ price: 0.35, quality: 0.25, distance: 0.2, availability: 0.2 })
    expect(deps.loadMatchingWeights).toHaveBeenCalledWith('/algorithms/matching')
  })

  it('applies the administrator configured four factor weights to live supplier ranking', async () => {
    deps.marketListings.mockResolvedValue({ listings: [
      listing({ id: 'cheap-lower-quality', sellerId: 'seller-a', sellerName: 'Seller A', price: 10, stock: 10, quality: 'Grade B' }),
      listing({ id: 'higher-quality', sellerId: 'seller-b', sellerName: 'Seller B', price: 20, stock: 10, quality: 'Grade A' }),
    ] })
    const requirements = { produceType: 'Maize', quantity: 10, unit: 'kg', location: 'Nakuru', quality: 'Grade A', maxUnitPrice: 10 }
    const priceWeighted = await rankSuppliersFromMarketplace(requirements)
    expect(priceWeighted.data.suppliers.map((row) => row.supplierId)).toEqual(['seller-a', 'seller-b'])

    deps.loadMatchingWeights.mockResolvedValue({ weights: { price: 0.1, quality: 0.7, distance: 0.1, availability: 0.1 }, version: 2 })
    const qualityWeighted = await rankSuppliersFromMarketplace(requirements)
    expect(qualityWeighted.data.suppliers.map((row) => row.supplierId)).toEqual(['seller-b', 'seller-a'])
    expect(qualityWeighted.data.matchingAlgorithmVersion).toBe(2)
  })

  it('creates a budget-aware plan from current listing values without placing an order', async () => {
    deps.marketListings.mockResolvedValue({ listings: [
      listing({ id: 'low', price: 10, stock: 3 }),
      listing({ id: 'high', price: 20, stock: 10 }),
    ] })
    const response = await createPurchasePlanFromMarketplace({
      produceRequirements: 'Maize', requiredQuantities: 5, unit: 'kg', budget: 100, deliveryArea: 'Nakuru',
    })
    expect(response.data.plan).toMatchObject({ totalCost: 70, complete: true, withinBudget: true })
    expect(response.data.shortlist.map((line) => line.quantity)).toEqual([3, 2])
    expect(response.data.source).toBe('authenticated marketplace API')
  })

  it('reports live market data unavailable instead of generating a result', async () => {
    deps.fetchMarketObservations.mockResolvedValue({ observations: [] })
    const response = await adviseFromMarketObservations({ produce: 'Maize', location: 'Nakuru', quantity: 10, timePeriod: 'month' })
    expect(response).toMatchObject({ ok: false, code: 'VERIFIED_MARKET_DATA_UNAVAILABLE' })
    expect(deps.requestAI).not.toHaveBeenCalled()
  })

  it('uses verified observations for observed ranges and keeps the AI explanation separate', async () => {
    const now = new Date().toISOString()
    deps.fetchMarketObservations.mockResolvedValue({ observations: [
      { id: 'p1', commodity: 'Maize', market: 'Nakuru', price: 20, currency: 'KES', unit: 'kg', observedAt: now, sourceName: 'Authorized market feed', freshness: 'fresh', verified: true },
      { id: 'p2', commodity: 'Maize', market: 'Nakuru', price: 28, currency: 'KES', unit: 'kg', observedAt: now, sourceName: 'Authorized market feed', freshness: 'fresh', verified: true },
    ] })
    deps.requestAI.mockResolvedValue({ ok: true, data: { suggestedMinPrice: 1, suggestedMaxPrice: 999, factors: ['Separate model commentary.'] } })
    const response = await adviseFromVerifiedPrices({ produce: 'Maize', location: 'Nakuru', unit: 'kg', quantity: 10, qualityGrade: 'A' })
    expect(response.data).toMatchObject({ suggestedMinPrice: 20, suggestedMaxPrice: 28, currency: 'KES', unit: 'kg' })
    expect(response.data.aiExplanation).toEqual(['Separate model commentary.'])
    expect(response.data.factors.join(' ')).toMatch(/observed range/i)
    expect(response.data.suggestedMaxPrice).not.toBe(999)
  })

  it('does not summarize stale or unrelated observations as current prices', async () => {
    deps.fetchMarketObservations.mockResolvedValue({ observations: [
      { id: 'old', commodity: 'Maize', market: 'Nakuru', price: 25, currency: 'KES', unit: 'kg', observedAt: '2020-01-01T00:00:00.000Z', sourceName: 'Authorized market feed', freshness: 'stale', verified: true },
    ] })
    const response = await adviseFromVerifiedPrices({ produce: 'Maize', location: 'Nakuru', unit: 'kg', quantity: 10, qualityGrade: 'A' })
    expect(response).toMatchObject({ ok: false, code: 'VERIFIED_MARKET_DATA_UNAVAILABLE' })
  })
})
