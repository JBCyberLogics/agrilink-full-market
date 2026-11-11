import { AI_CAPABILITIES as C } from './config.js'
import {
  analyzeVerifiedMarketObservations, auditListingRewrite, calculateNetProfit, comparePrices, evaluateHarvestWindow, optimizePurchasePlan,
  rankCropSuitability, rankFarmerBuyerMatches, rankProduce, rankRecommendations, rankSuppliers,
} from './algorithms/index.js'

const smokeChecks = {
  [C.RECOMMENDATIONS_CENTER]: () => rankRecommendations([{ id: 'diagnostic', scores: { fit: 90 } }], { fit: 1 })[0]?.score === 90,
  [C.MARKET_ADVISOR]: () => analyzeVerifiedMarketObservations([{
    produce: 'diagnostic crop', market: 'diagnostic location', price: 10, unit: 'kg', currency: 'KES',
    observedAt: '2026-01-01T00:00:00.000Z', sourceName: 'diagnostic fixture', verified: true,
  }], { now: Date.parse('2026-01-01T01:00:00.000Z') }).status === 'available',
  [C.CROP_ADVISOR]: () => rankCropSuitability([
    { name: 'diagnostic crop', requirements: { soilPh: { min: 6, max: 7 } } },
  ], { soilPh: 6.5 })[0]?.score === 100,
  [C.PRICE_ADVISOR]: () => comparePrices([
    { produce: 'diagnostic crop', unitPrice: 12, unit: 'kg', currency: 'KES' },
    { produce: 'diagnostic crop', unitPrice: 10, unit: 'kg', currency: 'KES' },
  ]).cheapest?.unitPrice === 10,
  [C.LISTING_ASSISTANT]: () => auditListingRewrite(
    { title: 'Maize', description: 'Fresh harvest' },
    { title: 'Fresh maize', description: 'Fresh harvest' },
  ).safe,
  [C.MATCHING_ASSISTANT]: () => rankFarmerBuyerMatches([
    { produceTypes: ['diagnostic crop'], availableQuantity: 10, location: { county: 'Kiambu' }, unitPrice: 5 },
  ], { produceTypes: ['diagnostic crop'], quantity: 10, location: { county: 'Kiambu' }, maxUnitPrice: 5 }).matches[0]?.score > 0,
  [C.HARVEST_ADVISOR]: () => evaluateHarvestWindow({
    expectedHarvestDate: '2026-01-10', preferredWindowStart: '2026-01-01', preferredWindowEnd: '2026-01-20',
  }).status === 'within-window',
  [C.NET_PROFIT_ADVISOR]: () => calculateNetProfit({
    quantity: 2, unitSalePrice: 10, costs: [{ amount: 5 }], costsComplete: true,
  }).netProfit === 15,
  [C.PRODUCE_FINDER]: () => rankProduce([
    { produceType: 'diagnostic crop', availableQuantity: 10, location: { county: 'Kiambu' }, unitPrice: 5 },
  ], { produceTypes: ['diagnostic crop'], quantity: 10, location: { county: 'Kiambu' }, maxUnitPrice: 5 })[0]?.score > 0,
  [C.SUPPLIER_ADVISOR]: () => rankSuppliers([
    { produceTypes: ['diagnostic crop'], availableQuantity: 10, location: { county: 'Kiambu' }, unitPrice: 5 },
  ], { produceTypes: ['diagnostic crop'], quantity: 10, location: { county: 'Kiambu' }, maxUnitPrice: 5 })[0]?.score > 0,
  [C.PURCHASE_ASSISTANT]: () => optimizePurchasePlan(
    [{ produce: 'diagnostic crop', quantity: 2, unit: 'kg', currency: 'KES' }],
    [{ produce: 'diagnostic crop', availableQuantity: 2, unit: 'kg', unitPrice: 5, currency: 'KES' }],
  ).complete,
}

const NO_LOCAL_ALGORITHM = new Set([
  C.AGRICULTURAL_ASSISTANT,
])

/** Smoke checks use synthetic values inside the DEV-only diagnostics tool. */
export function runAlgorithmSmokeTest(capability) {
  if (NO_LOCAL_ALGORITHM.has(capability)) {
    return { status: 'NOT_APPLICABLE', label: 'No local deterministic algorithm is wired to this capability.' }
  }
  const check = smokeChecks[capability]
  if (!check) return { status: 'NOT_TESTED', label: 'No algorithm check is registered.' }
  try {
    if (!check()) return { status: 'FAIL', label: 'The algorithm returned an unexpected result.' }
    return { status: 'PASS', label: 'Local synthetic smoke check returned the expected result.' }
  } catch (error) {
    return { status: 'FAIL', label: error?.message || 'The algorithm check threw an error.' }
  }
}
