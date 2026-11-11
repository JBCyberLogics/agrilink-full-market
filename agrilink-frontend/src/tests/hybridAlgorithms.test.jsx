import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MATCH_WEIGHTS,
  DEFAULT_SUPPLIER_WEIGHTS,
  analyzeVerifiedMarketObservations,
  auditListingRewrite,
  buildHarvestPlan,
  calculateNetProfit,
  comparePrices,
  evaluateHarvestWindow,
  filterAndRankProduce,
  normalizeWeights,
  optimizePurchasePlan,
  rankFarmerBuyerMatches,
  rankRecommendations,
  rankSuppliers,
  scoreCropSuitability,
  scorePriceFit,
} from '../ai/algorithms/index.js'

const NOW = Date.parse('2026-11-04T12:00:00.000Z')
const verified = (overrides = {}) => ({
  produce: 'Maize', market: 'Nakuru', price: 30, unit: 'kg', currency: 'KES',
  observedAt: '2026-11-04T08:00:00.000Z', sourceName: 'Authorized market feed', verified: true,
  ...overrides,
})

describe('hybrid deterministic algorithms', () => {
  it('uses the requested transparent matching weights and excludes missing core identity', () => {
    expect(DEFAULT_MATCH_WEIGHTS).toEqual({ priceFit: 0.35, qualityFit: 0.25, distanceFit: 0.2, availabilityFit: 0.2 })
    const result = rankFarmerBuyerMatches([
      { id: 'good', produceType: 'Maize', unit: 'kg', currency: 'KES', unitPrice: 20, availableQuantity: 5, qualityScore: 0.8, location: { latitude: 0, longitude: 0 } },
      { id: 'unknown', unit: 'kg', currency: 'KES', unitPrice: 20, availableQuantity: 5 },
    ], {
      produceType: 'maize', quantity: 10, unit: 'kg', currency: 'KES', maxUnitPrice: 25,
      quality: 0.9, location: { latitude: 0, longitude: 0 },
    })
    expect(result.matches[0]).toMatchObject({ item: { id: 'good' }, coverage: 100 })
    expect(result.matches[0].score).toBeCloseTo(0.8722, 3)
    expect(result.matches[0].breakdown).toMatchObject({ priceFit: { value: 1, weight: 0.35 }, qualityFit: { value: expect.closeTo(0.8 / 0.9), weight: 0.25 } })
    expect(result.excluded[0].reason).toMatch(/produce information is missing/i)
    const partial = rankFarmerBuyerMatches([
      { id: 'partial', produceType: 'Maize', unit: 'kg', currency: 'KES', unitPrice: 20, availableQuantity: 10 },
    ], { produceType: 'Maize', quantity: 10, unit: 'kg', currency: 'KES', maxUnitPrice: 25 })
    expect(partial.matches[0].coverage).toBe(55)
    expect(partial.matches[0].missingCriteria).toEqual(['qualityFit', 'distanceFit'])
    expect(rankFarmerBuyerMatches([], { produceType: 'Maize', quantity: 0 }).errors).toHaveLength(1)
    expect(rankFarmerBuyerMatches([{ produceType: 'Maize', unit: 'crate', currency: 'KES' }], { produceType: 'Maize', quantity: 1, unit: 'kg', currency: 'KES' }).matches).toHaveLength(0)
  })

  it('normalizes custom weights, rejects invalid weights, and handles zero-price boundaries', () => {
    expect(normalizeWeights({ priceFit: 2, availabilityFit: 2 })).toEqual({ priceFit: 0.5, availabilityFit: 0.5 })
    expect(() => normalizeWeights({ price: -1 })).toThrow(/non-negative/)
    expect(() => normalizeWeights({ price: 0, quantity: 0 })).toThrow(/greater than zero/)
    expect(scorePriceFit(0, 0)).toBe(100)
    expect(scorePriceFit(0, 1)).toBe(0)
  })

  it('deduplicates and explains recommendations, including empty input', () => {
    const ranked = rankRecommendations([
      { id: 'a', title: 'Maize', scores: { produceFit: 80 }, reasons: ['Produce matches'] },
      { id: 'a', title: 'Duplicate', scores: { produceFit: 100 } },
      { id: 'b', title: 'Beans', scores: { produceFit: 50 } },
    ], { produceFit: 1 })
    expect(ranked.map((item) => item.item.id)).toEqual(['a', 'b'])
    expect(ranked[0].reasons).toEqual(['Produce matches'])
    expect(ranked[0].rank).toBe(1)
    expect(rankRecommendations([])).toEqual([])
  })

  it('compares price groups without combining produce, unit, or currency', () => {
    const comparison = comparePrices([
      { id: 'a', produce: 'Maize', unitPrice: 20, unit: 'kg', currency: 'KES' },
      { id: 'b', produce: 'maize', unitPrice: 30, unit: 'kilogram', currency: 'KES' },
      { id: 'c', produce: 'Maize', unitPrice: 3, unit: 'crate', currency: 'KES' },
      { id: 'd', produce: 'Beans', unitPrice: 1, unit: 'kg', currency: 'USD' },
      { id: 'invalid', unitPrice: 4, unit: 'kg', currency: 'KES' },
    ])
    const kg = comparison.groups.find((group) => group.produce.toLowerCase() === 'maize' && group.currency === 'KES' && group.unit === 'kg')
    expect(kg).toMatchObject({ lowest: { id: 'a' }, highest: { id: 'b' }, average: 25, difference: 10, differencePercent: 50, comparisonCount: 2 })
    expect(comparison.groups).toHaveLength(3)
    expect(comparison.excluded.some(({ reason }) => /needs produce/.test(reason))).toBe(true)
    expect(comparePrices([{ produce: 'Maize', unitPrice: 20, unit: 'kg', currency: 'KES' }]).average).toBeNull()
    expect(comparePrices([]).cheapest).toBeNull()
  })

  it('accepts only verified complete market observations, flags stale and duplicate rows, and gates trends', () => {
    const observations = [
      verified({ price: 20, observedAt: '2026-10-20T08:00:00.000Z' }),
      verified({ price: 25, observedAt: '2026-10-27T08:00:00.000Z' }),
      verified({ price: 30, observedAt: '2026-11-04T08:00:00.000Z' }),
      verified({ price: 31, observedAt: '2026-11-04T08:00:00.000Z' }),
      verified({ price: 5, sourceName: '', observedAt: '2026-11-04T09:00:00.000Z' }),
      verified({ price: 10, observedAt: '2026-11-04T13:00:00.000Z' }),
      verified({ price: 35, observedAt: '2026-11-03T08:00:00.000Z', freshness: 'fresh' }),
    ]
    const result = analyzeVerifiedMarketObservations(observations, { now: NOW })
    expect(result.status).toBe('available')
    expect(result.currentObservations[0].current.price).toBe(30)
    expect(result.currentObservations[0].trend).toMatchObject({ status: 'available', change: 10, sampleCount: 4 })
    expect(result.rejected.some(({ reason }) => /duplicate/i.test(reason))).toBe(true)
    expect(result.rejected.some(({ reason }) => /incomplete/i.test(reason))).toBe(true)
    expect(result.currentObservations[0].staleCount).toBe(3)
    expect(analyzeVerifiedMarketObservations([verified({ observedAt: '2026-10-01T08:00:00.000Z' })], { now: NOW }).status).toBe('unavailable')
    expect(analyzeVerifiedMarketObservations([verified({ observedAt: '2026-02-31T08:00:00.000Z' })], { now: NOW }).rejected).toHaveLength(1)
  })

  it('requires verified supplier history before scoring fulfillment', () => {
    expect(Object.values(DEFAULT_SUPPLIER_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1)
    const base = { id: 'supplier', produceTypes: ['Maize'], availableQuantity: 50, unitPrice: 10, quality: 'A', location: { distanceKm: 10 } }
    const requirements = { produceType: 'Maize', quantity: 20, maxUnitPrice: 20, quality: 'A' }
    const [unverified] = rankSuppliers([{ ...base, fulfilledOrders: 10, onTimeOrders: 10 }], requirements)
    const [verifiedHistory] = rankSuppliers([{ ...base, fulfillmentHistory: { verified: true, fulfilledOrders: 10, onTimeOrders: 9 } }], requirements)
    expect(unverified.verifiedHistory).toBeNull()
    expect(unverified.factors.fulfilmentFit).toBeNull()
    expect(verifiedHistory.verifiedHistory.onTimeRate).toBe(0.9)
    expect(verifiedHistory.coverage).toBeCloseTo(100)
  })

  it('applies combined produce, unit, quantity, location, quality, price, and date filters', () => {
    const listings = [
      { id: 'fits', produceType: 'Maize', unit: 'kg', availableQuantity: 50, unitPrice: 20, quality: 'A', availableFrom: '2026-11-01', location: 'Nakuru' },
      { id: 'wrong-location', produceType: 'Maize', unit: 'kg', availableQuantity: 50, unitPrice: 20, quality: 'A', availableFrom: '2026-11-01', location: 'Meru' },
      { id: 'wrong-unit', produceType: 'Maize', unit: 'crate', availableQuantity: 50, unitPrice: 20, quality: 'A', availableFrom: '2026-11-01', location: 'Nakuru' },
      { id: 'unknown-quality', produceType: 'Maize', unit: 'kg', availableQuantity: 50, unitPrice: 20, availableFrom: '2026-11-01', location: 'Nakuru' },
    ]
    const result = filterAndRankProduce(listings, {
      produceType: 'Maize', unit: 'kg', requiredQuantity: 20, location: 'Nakuru',
      quality: 'A', maxUnitPrice: 25, requiredAvailabilityDate: '2026-11-10',
    }, { strictLocation: true })
    expect(result.results.map(({ item }) => item.id)).toEqual(['fits'])
    expect(result.excluded).toHaveLength(3)
    expect(filterAndRankProduce([], { produceType: 'Maize' }).results).toEqual([])
    expect(() => filterAndRankProduce([], { requiredAvailabilityDate: '2026-02-31' })).toThrow(/invalid/)
  })

  it('optimizes only compatible purchasing alternatives and reports budget shortages', () => {
    const demands = [{ produce: 'Maize', quantity: 10, unit: 'kg', currency: 'KES' }]
    const offers = [
      { id: 'cheap', produce: 'Maize', availableQuantity: 5, unit: 'kg', unitPrice: 10, currency: 'KES' },
      { id: 'other-unit', produce: 'Maize', availableQuantity: 20, unit: 'crate', unitPrice: 1, currency: 'KES' },
      { id: 'other-currency', produce: 'Maize', availableQuantity: 20, unit: 'kg', unitPrice: 1, currency: 'USD' },
    ]
    const plan = optimizePurchasePlan(demands, offers, { budget: 80, budgetCurrency: 'KES' })
    expect(plan.allocations).toEqual([expect.objectContaining({ offerId: 'cheap', quantity: 5, cost: 50 })])
    expect(plan.shortages[0].remaining).toBe(5)
    expect(plan.withinBudget).toBe(true)
    expect(plan.excludedOffers.length).toBeGreaterThan(0)
    expect(optimizePurchasePlan([], []).status).toBe('empty-demand')
    expect(() => optimizePurchasePlan([], [], { budget: -1 })).toThrow(/non-negative/)
  })

  it('calculates net profit, margins, break-even, and target price with validation', () => {
    const result = calculateNetProfit({
      sellableQuantity: 10, unitSalePrice: 20, costs: [{ amount: 100 }, { amount: 50 }],
      costsComplete: true, targetProfit: 50,
    })
    expect(result).toMatchObject({ grossRevenue: 200, totalCosts: 150, netProfit: 50, profitMarginPercent: 25, breakEvenUnitPrice: 15, requiredSellingPriceForTargetProfit: 20 })
    expect(calculateNetProfit({ quantity: 10, unitSalePrice: 20, costs: [{ amount: 100 }], targetProfit: 50 }).requiredSellingPriceForTargetProfit).toBeNull()
    expect(() => calculateNetProfit({ quantity: 0, unitSalePrice: 20 })).toThrow(/greater than zero/)
    expect(() => calculateNetProfit({ quantity: 1, unitSalePrice: -1 })).toThrow(/non-negative/)
    expect(() => calculateNetProfit({ quantity: 1, unitSalePrice: 1, targetProfit: -1 })).toThrow(/non-negative/)
  })

  it('scores crop suitability from caller supplied profiles and makes harvest rules explicit', () => {
    const crop = { name: 'User supplied crop profile', requirements: { rainfallMm: { min: 200, max: 400 }, soilPh: { min: 5, max: 7 } } }
    expect(scoreCropSuitability(crop, { rainfallMm: 300, soilPh: 6 })).toMatchObject({ score: 100, coverage: 55, nature: 'rule-based suitability score; not a trained prediction' })
    expect(() => scoreCropSuitability({ requirements: { soilPh: { min: 8, max: 5 } } }, { soilPh: 6 })).toThrow(/minimum cannot exceed maximum/)
    expect(evaluateHarvestWindow({ expectedHarvestDate: '2026-11-08', preferredWindowStart: '2026-11-10', preferredWindowEnd: '2026-11-20', storageDays: 3 }).feasible).toBe(true)
    expect(buildHarvestPlan({ expectedHarvestDate: '2026-11-10', expectedQuantity: 5, today: '2026-11-04' })).toMatchObject({ status: 'scheduled', daysUntilHarvest: 6, checklist: expect.any(Array) })
    expect(() => buildHarvestPlan({ expectedHarvestDate: '2026-02-31', expectedQuantity: 5 })).toThrow(/valid expected harvest date/)
  })

  it('flags unsupported listing rewrite claims without rejecting harmless wording', () => {
    const result = auditListingRewrite(
      { existingTitle: 'Green maize', description: 'Freshly harvested maize.', quantity: '50 kg' },
      { improvedTitle: 'Certified organic maize', improvedDescription: 'Pesticide-free maize, 100 kg.' },
    )
    expect(result.safe).toBe(false)
    expect(result.warnings.join(' ')).toMatch(/organic|certified|pesticide|quantity/i)
    expect(auditListingRewrite({ existingTitle: 'Maize', description: 'Harvested today' }, { improvedTitle: 'Fresh maize', improvedDescription: 'Harvested today.' }).safe).toBe(true)
  })
})
