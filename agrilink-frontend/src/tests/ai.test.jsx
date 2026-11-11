import { describe, expect, it, vi } from 'vitest'
import { requestAI } from '../ai/client.js'
import { AI_CAPABILITIES } from '../ai/config.js'
import {
  calculateNetProfit, comparePrices, evaluateHarvestWindow, optimizePurchasePlan,
  rankByWeightedCriteria, rankCropSuitability, rankFarmerBuyerMatches,
  rankProduce, rankRecommendations, rankSuppliers, scoreCropSuitability, weightedScore,
} from '../ai/algorithms/index.js'
import { AI_REQUEST_SCHEMAS, AI_RESPONSE_SCHEMAS, validateAIRequest, validateAIResponse } from '../ai/schemas.js'
import { validateProfileDraft, normalizeProfileFields, splitFullName } from '../features/settings/profileSchema.js'
import { validateProfilePicture } from '../features/settings/components/ProfilePictureField.jsx'

describe('AgriLink AI contracts', () => {
  it('routes AI requests through the backend and surfaces missing verified market data honestly', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch')
    fetch.mockImplementation(async (input) => {
      const path = new URL(String(input), window.location.href).pathname
      if (path.endsWith('/auth/csrf')) {
        document.cookie = 'agrilink.csrf=fixture.signature; Path=/'
        return new Response(JSON.stringify({ success: true, data: { csrfToken: 'fixture.signature' } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      return new Response(JSON.stringify({ success: false, code: 'MARKET_DATA_UNAVAILABLE', message: 'No fresh verified market observation is available. No price recommendation was generated.' }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    })
    const response = await requestAI(AI_CAPABILITIES.MARKET_ADVISOR, {
      produce: 'Maize', location: 'Nakuru', quantity: 50, timePeriod: 'month',
    })
    expect(response).toMatchObject({ ok: false, code: 'MARKET_DATA_UNAVAILABLE', status: 503 })
    expect(response.error).toContain('No price recommendation was generated')
    expect(fetch.mock.calls.some(([url]) => String(url).includes('/api/v1/ai/shared/market-advisor'))).toBe(true)
    fetch.mockRestore()
    document.cookie = 'agrilink.csrf=; Max-Age=0; Path=/'
  })

  it('validates capability request and response shapes', () => {
    expect(() => validateAIRequest(AI_CAPABILITIES.MARKET_ADVISOR, { produce: 'Maize' })).toThrow(/Missing required/)
    expect(() => validateAIRequest(AI_CAPABILITIES.MARKET_ADVISOR, { produce: 'Maize', location: 'Nakuru', quantity: -1, timePeriod: 'month' })).toThrow(/Invalid AI request field/)
    expect(() => validateAIResponse(AI_CAPABILITIES.PRICE_ADVISOR, { suggestedMinPrice: 25 })).toThrow(/suggestedMaxPrice/)
    expect(validateAIResponse(AI_CAPABILITIES.MARKET_ADVISOR, { summary: 'Server response.' })).toEqual({ summary: 'Server response.' })
    expect(() => validateAIRequest(AI_CAPABILITIES.HARVEST_ADVISOR, {
      produceType: 'Maize', expectedHarvestDate: '2026-02-31', expectedQuantity: 10, location: 'Nakuru',
    })).toThrow(/Invalid AI request field/)
    expect(() => validateAIRequest(AI_CAPABILITIES.AGRICULTURAL_ASSISTANT, { message: 'a'.repeat(4001) })).toThrow(/Invalid AI request field/)
  })

  it('validates request and response shapes for all twelve capabilities', () => {
    const requests = {
      [AI_CAPABILITIES.AGRICULTURAL_ASSISTANT]: { message: 'How should I store maize?' },
      [AI_CAPABILITIES.MARKET_ADVISOR]: { produce: 'Maize', location: 'Nakuru', quantity: 10, timePeriod: 'month' },
      [AI_CAPABILITIES.RECOMMENDATIONS_CENTER]: { role: 'farmer', produceType: 'Maize', location: 'Nakuru' },
      [AI_CAPABILITIES.CROP_ADVISOR]: { produceType: 'Maize', growingStage: 'flowering', location: 'Nakuru', expectedQuantity: 10 },
      [AI_CAPABILITIES.PRICE_ADVISOR]: { produce: 'Maize', quantity: 10, qualityGrade: 'A', location: 'Nakuru', unit: 'kg' },
      [AI_CAPABILITIES.LISTING_ASSISTANT]: { existingTitle: 'Maize', description: 'Fresh maize listing' },
      [AI_CAPABILITIES.MATCHING_ASSISTANT]: { produceType: 'Maize', quantity: 10, location: 'Nakuru', quality: 'A', availability: 'soon' },
      [AI_CAPABILITIES.HARVEST_ADVISOR]: { produceType: 'Maize', expectedHarvestDate: '2026-12-01', expectedQuantity: 10, location: 'Nakuru' },
      [AI_CAPABILITIES.NET_PROFIT_ADVISOR]: { calculation: { revenue: 100, knownCosts: 20 } },
      [AI_CAPABILITIES.PRODUCE_FINDER]: { produceType: 'Maize', requiredQuantity: 10, location: 'Nakuru' },
      [AI_CAPABILITIES.SUPPLIER_ADVISOR]: { produceType: 'Maize', location: 'Nakuru' },
      [AI_CAPABILITIES.PURCHASE_ASSISTANT]: { produceRequirements: 'Maize', requiredQuantities: 10, deliveryArea: 'Nakuru' },
    }
    const responses = {
      [AI_CAPABILITIES.AGRICULTURAL_ASSISTANT]: { content: 'A validated response.' },
      [AI_CAPABILITIES.MARKET_ADVISOR]: { summary: 'A validated response.' },
      [AI_CAPABILITIES.RECOMMENDATIONS_CENTER]: { summary: 'A validated response.' },
      [AI_CAPABILITIES.CROP_ADVISOR]: { summary: 'A validated response.' },
      [AI_CAPABILITIES.PRICE_ADVISOR]: { suggestedMinPrice: 1, suggestedMaxPrice: 2 },
      [AI_CAPABILITIES.LISTING_ASSISTANT]: { improvedTitle: 'Maize', improvedDescription: 'Listing text.' },
      [AI_CAPABILITIES.MATCHING_ASSISTANT]: { matches: [] },
      [AI_CAPABILITIES.HARVEST_ADVISOR]: { timeline: 'A validated response.' },
      [AI_CAPABILITIES.NET_PROFIT_ADVISOR]: { summary: 'A validated response.' },
      [AI_CAPABILITIES.PRODUCE_FINDER]: { matches: [] },
      [AI_CAPABILITIES.SUPPLIER_ADVISOR]: { summary: 'A validated supplier explanation.', suppliers: [] },
      [AI_CAPABILITIES.PURCHASE_ASSISTANT]: { summary: 'A validated response.' },
    }

    expect(Object.keys(requests)).toHaveLength(12)
    for (const capability of Object.keys(AI_REQUEST_SCHEMAS)) {
      expect(validateAIRequest(capability, requests[capability])).toBe(requests[capability])
      expect(validateAIResponse(capability, responses[capability])).toBe(responses[capability])
    }
    expect(Object.keys(AI_RESPONSE_SCHEMAS)).toHaveLength(12)
  })
})

describe('weighted and domain algorithms', () => {
  it('scores only observed criteria and reports weight coverage', () => {
    expect(weightedScore({ price: 80, location: null }, { price: 0.6, location: 0.4 })).toEqual({
      score: 80, coverage: 60, availableCriteria: ['price'], missingCriteria: ['location'],
    })
    expect(weightedScore({}, { price: 1 })).toMatchObject({ score: null, coverage: 0 })
  })

  it('ranks known produce criteria and preserves missing-value coverage', () => {
    const ranked = rankProduce([
      { id: 'a', name: 'Maize', availableQuantity: 100, location: { county: 'Nakuru' }, unitPrice: 50, availableFrom: '2026-01-01' },
      { id: 'b', name: 'Beans' },
    ], { produceTypes: ['maize'], quantity: 80, location: { county: 'Nakuru' }, maxUnitPrice: 60, requiredDate: '2026-02-01' })
    expect(ranked[0].item.id).toBe('a')
    expect(ranked[0].coverage).toBe(100)
    expect(rankByWeightedCriteria([{ scores: {} }])).toEqual([])
    expect(rankRecommendations([{ id: 'r1', scores: { quality: 90 } }], { quality: 1 })[0].score).toBe(90)
  })

  it('ranks farmer-buyer matches and suppliers from provided needs only', () => {
    const farmers = [{ id: 'farm-1', produceTypes: ['tomato'], availableQuantity: 20, location: { county: 'Kiambu' }, unitPrice: 40 }]
    const need = { produceTypes: ['tomato'], quantity: 10, location: { county: 'Kiambu' }, maxUnitPrice: 50 }
    expect(rankFarmerBuyerMatches(farmers, need).matches[0].item.id).toBe('farm-1')
    expect(rankSuppliers(farmers, need)[0].score).toBeGreaterThan(0)
  })

  it('compares prices only for matching units and currencies', () => {
    const result = comparePrices([
      { seller: 'a', produce: 'Maize', unitPrice: 100, unit: 'kg', currency: 'KES' },
      { seller: 'b', produce: 'Maize', unitPrice: 80, unit: 'kg', currency: 'KES' },
      { seller: 'c', produce: 'Maize', unitPrice: 4, unit: 'crate', currency: 'KES' },
    ])
    expect(result.groups.find((group) => group.unit === 'kg').cheapest.seller).toBe('b')
    expect(result.excluded[0].reason).toMatch(/currency differs/i)
  })

  it('scores crop suitability using supplied requirements and observations', () => {
    const crop = { name: 'Crop A', requirements: { rainfallMm: { min: 500, max: 900 }, temperatureC: { min: 18, max: 28 }, soilPh: { min: 5.5, max: 7 }, soilTypes: ['loam'] } }
    expect(scoreCropSuitability(crop, { rainfallMm: 700, temperatureC: 22, soilPh: 6.2, soilType: 'loam' }).score).toBe(100)
    expect(rankCropSuitability([crop], { rainfallMm: 700 }).length).toBe(1)
    expect(rankCropSuitability([crop], {}).length).toBe(0)
  })

  it('applies harvest-window rules without inferring market conditions', () => {
    expect(evaluateHarvestWindow({ expectedHarvestDate: '2026-01-10', preferredWindowStart: '2026-01-05', preferredWindowEnd: '2026-01-20' }).status).toBe('within-window')
    expect(evaluateHarvestWindow({ expectedHarvestDate: '', preferredWindowStart: '', preferredWindowEnd: '' }).feasible).toBeNull()
  })

  it('optimizes compatible purchases and avoids totaling mixed currencies', () => {
    const plan = optimizePurchasePlan([{ produce: 'Maize', quantity: 12, unit: 'kg', currency: 'KES' }], [
      { produce: 'maize', availableQuantity: 5, unit: 'kg', unitPrice: 10, currency: 'KES', supplierId: 's1' },
      { produce: 'Maize', availableQuantity: 10, unit: 'kg', unitPrice: 12, currency: 'KES', supplierId: 's2' },
    ], { budget: 150 })
    expect(plan.allocations.map((line) => line.supplierId)).toEqual(['s1', 's2'])
    expect(plan.totalCost).toBe(134)
    expect(plan.withinBudget).toBe(true)
    const mixed = optimizePurchasePlan([{ produce: 'A', quantity: 1, unit: 'kg', currency: 'KES' }, { produce: 'B', quantity: 1, unit: 'kg', currency: 'USD' }], [])
    expect(mixed.totalCost).toBeNull()
    expect(mixed.withinBudget).toBeNull()
    const sharedStock = optimizePurchasePlan([
      { produce: 'Maize', quantity: 4, unit: 'kg', currency: 'KES' },
      { produce: 'Maize', quantity: 4, unit: 'kg', currency: 'KES' },
    ], [{ produce: 'Maize', availableQuantity: 5, unit: 'kg', unitPrice: 10, currency: 'KES' }])
    expect(sharedStock.allocations.reduce((sum, line) => sum + line.quantity, 0)).toBe(5)
    expect(sharedStock.shortages[0].remaining).toBe(3)
  })

  it('calculates net profit only when the user confirms cost completeness', () => {
    const incomplete = calculateNetProfit({ quantity: 10, unitSalePrice: 30, costs: [{ label: 'Transport', amount: 40 }] })
    expect(incomplete).toMatchObject({ revenue: 300, knownCosts: 40, netProfit: null })
    const complete = calculateNetProfit({ quantity: 10, unitSalePrice: 30, costs: [{ label: 'Transport', amount: 40 }], costsComplete: true })
    expect(complete).toMatchObject({ revenue: 300, totalCosts: 40, netProfit: 260, breakEvenUnitPrice: 4 })
  })
})

describe('profile schemas and image input validation', () => {
  it('normalizes buyer business fields and validates them only for business accounts', () => {
    expect(splitFullName(' Amina   Otieno Wanjiku ')).toEqual({ firstName: 'Amina', lastName: 'Otieno Wanjiku' })
    const business = normalizeProfileFields('Buyer', { buyerType: 'business' })
    expect(validateProfileDraft('Buyer', { ...business, firstName: 'Mara', lastName: 'Njoroge' })).toMatchObject({ organizationName: expect.any(String) })
    const individual = normalizeProfileFields('Buyer', { buyerType: 'individual', organizationName: 'Stale Ltd' })
    expect(individual.organizationName).toBe('')
  })

  it('accepts listed image formats and rejects unsupported or oversized files', () => {
    expect(validateProfilePicture({ name: 'avatar.webp', type: 'image/webp', size: 1024 })).toBe('')
    expect(validateProfilePicture({ name: 'avatar.gif', type: 'image/gif', size: 1024 })).toMatch(/JPG/)
    expect(validateProfilePicture({ name: 'avatar.jpg', type: 'image/jpeg', size: 6 * 1024 * 1024 })).toMatch(/5 MB/)
  })
})
