import { AI_CAPABILITIES } from '../../../ai/config.js'
import { requestAI } from '../../../ai/client.js'
import {
  analyzeVerifiedMarketObservations,
  comparePrices,
  filterAndRankProduce,
  optimizePurchasePlan,
  rankRecommendations,
  rankSuppliers,
  scoreLocationMatch,
  scoreSetCoverage,
} from '../../../ai/algorithms/index.js'
import { marketListings } from '../../marketplace/services/marketplaceService.js'
import { fetchMarketObservations } from '../../farmer/services/marketIntelligenceService.js'
import { api } from '../../../services/api/client.js'

const clean = (value) => typeof value === 'string' ? value.trim() : ''
const normalize = (value) => clean(value).toLocaleLowerCase()
const ACTIVE_LISTING_STATUSES = new Set(['active', 'available', 'published', 'live'])
const INACTIVE_LISTING_STATUSES = new Set(['inactive', 'unavailable', 'draft', 'pending', 'sold', 'soldout', 'archived', 'rejected'])
const asFinite = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function rawPrice(raw) {
  const value = raw?.pricePerUnit ?? raw?.price ?? raw?.discountPrice
  return asFinite(value)
}

function rawQuantity(raw) {
  const value = raw?.availableStock ?? raw?.quantityAvailable ?? raw?.stock ?? raw?.quantity ?? raw?.availableQuantity
  return asFinite(value)
}

function sellerFor(raw) {
  const seller = raw?.seller ?? raw?.sellerId ?? raw?.user ?? raw?.shop ?? {}
  return {
    id: typeof seller === 'string' ? seller : seller?._id ?? seller?.id ?? raw?.sellerRef ?? null,
    name: typeof seller === 'string' ? '' : clean(seller?.fullName ?? seller?.name ?? seller?.shopName),
    location: seller?.address ?? seller?.location ?? raw?.sellerLocation ?? null,
  }
}

function algorithmListing(listing) {
  const raw = listing?.raw ?? {}
  const stock = rawQuantity(raw)
  const price = rawPrice(raw)
  const explicitAvailability = raw.isAvailable ?? raw.available
  const status = clean(raw.status).toLocaleLowerCase()
  const statusAvailability = ACTIVE_LISTING_STATUSES.has(status) ? true : INACTIVE_LISTING_STATUSES.has(status) ? false : null
  const available = typeof explicitAvailability === 'boolean'
    ? explicitAvailability
    : statusAvailability !== null ? statusAvailability : stock === null ? null : stock > 0
  const seller = sellerFor(raw)
  const location = raw.marketLocation ?? raw.location ?? raw.address ?? seller.location ?? listing?.location
  const locationObject = typeof location === 'object' && location !== null
    ? location
    : { location: clean(location), county: clean(raw.county ?? raw.sellerCounty) }
  const produce = clean(raw.produceType ?? raw.cropName ?? raw.name ?? raw.title ?? raw.cropType?.name ?? raw.cropType ?? listing?.name)
  const unit = clean(raw.unit ?? raw.measurementUnit)
  // The marketplace's existing customer UI is KSh-denominated; retain KES only
  // as the app's documented display convention when listings omit currency.
  const currency = clean(raw.currency ?? raw.priceCurrency).toUpperCase() || 'KES'
  return {
    id: raw._id ?? raw.id ?? listing?.id ?? null,
    listingId: raw._id ?? raw.id ?? listing?.id ?? null,
    name: produce,
    produceType: produce,
    description: clean(raw.description ?? listing?.description),
    sellerId: seller.id,
    sellerName: seller.name,
    location: locationObject,
    locationLabel: typeof location === 'string' ? location : clean(location?.city ?? location?.town ?? location?.county),
    unitPrice: price,
    price,
    unit: unit || null,
    currency,
    availableQuantity: stock,
    stock,
    available,
    status: status || (available === false ? 'unavailable' : null),
    quality: raw.qualityGrade ?? raw.quality ?? null,
    qualityGrade: raw.qualityGrade ?? null,
    qualityScore: asFinite(raw.qualityScore),
    availableFrom: raw.availableFrom ?? raw.harvestDate ?? null,
    raw,
  }
}

function isActiveListing(item) {
  if (!item || INACTIVE_LISTING_STATUSES.has(item.status)) return false
  return item.available === true || ACTIVE_LISTING_STATUSES.has(item.status)
}

async function readMarketplaceListings() {
  const { listings, meta } = await marketListings({ limit: 100 })
  return { listings: (listings ?? []).map(algorithmListing), meta }
}

function listingReasons(listing, score, coverage) {
  const reasons = []
  if (listing.locationLabel) reasons.push(`Listed in ${listing.locationLabel}.`)
  if (Number.isFinite(listing.availableQuantity)) reasons.push(`${listing.availableQuantity} ${listing.unit || 'units'} reported available.`)
  if (Number.isFinite(listing.unitPrice)) reasons.push(`Current listing price: ${listing.currency} ${listing.unitPrice}${listing.unit ? ` / ${listing.unit}` : ''}.`)
  if (Number.isFinite(score)) reasons.push(`Fit score ${score.toFixed(1)} / 100 using ${coverage}% of configured criteria.`)
  return reasons
}

export async function recommendFromMarketplace(payload) {
  const { listings, meta } = await readMarketplaceListings()
  const active = listings.filter(isActiveListing)
  const ranking = rankRecommendations(active.map((item) => ({
    id: item.listingId,
    title: item.name,
    description: item.description,
    listing: item,
    reasons: listingReasons(item),
    scores: {
      produceFit: scoreSetCoverage([payload.produceType], [item.produceType]),
      locationFit: scoreLocationMatch({ location: payload.location }, item.location),
      availabilityFit: Number.isFinite(item.availableQuantity) ? (item.availableQuantity > 0 ? 100 : 0) : null,
    },
  })), undefined, (item) => item.scores)

  const items = ranking.map((entry) => ({
    id: entry.item.id,
    title: entry.item.title,
    description: entry.item.description || 'No additional listing description was provided.',
    factors: [...entry.reasons, ...listingReasons(entry.item.listing, entry.score, entry.coverage)],
    listing: entry.item.listing,
    score: entry.score,
    coverage: entry.coverage,
  }))
  return {
    ok: true,
    data: {
      summary: items.length
        ? `Ranked ${items.length} active marketplace listing(s) from the connected API against your produce and location preferences. This is deterministic ranking, not an NVIDIA response.`
        : 'No active marketplace listings matched these preferences. No example recommendations were substituted.',
      categories: [],
      items,
      source: 'authenticated marketplace API',
      fetchedCount: meta?.total ?? active.length,
      budgetNote: Number.isFinite(payload.budget) ? 'The entered amount is a total budget. A per-unit comparison needs a requested quantity, so budget did not affect ranking.' : null,
    },
  }
}

function parseBudgetRange(value, quantity) {
  const text = clean(value).replace(/,/g, '')
  if (!text) return { minUnitPrice: undefined, maxUnitPrice: undefined }
  const match = text.match(/^\s*(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)\s*$/i)
  const single = text.match(/^\s*(\d+(?:\.\d+)?)\s*$/)
  const low = match ? Number(match[1]) : single ? 0 : null
  const high = match ? Number(match[2]) : single ? Number(single[1]) : null
  if (low === null || high === null || low > high) throw new RangeError('Enter a total budget as one amount or a range such as 5000-10000 KSh.')
  return { minUnitPrice: low / quantity, maxUnitPrice: high / quantity }
}

export async function findProduceFromMarketplace(payload) {
  const { listings } = await readMarketplaceListings()
  const activeListings = listings.filter(isActiveListing)
  const budget = parseBudgetRange(payload.budgetRange, payload.requiredQuantity)
  const result = filterAndRankProduce(activeListings, {
    produceType: payload.produceType,
    requiredQuantity: payload.requiredQuantity,
    unit: payload.unit,
    location: { location: payload.location },
    qualityRequirements: payload.qualityRequirements,
    requiredAvailabilityDate: payload.requiredAvailabilityDate,
    ...budget,
  }, { strictLocation: true })
  const matches = result.results.map(({ item, score, coverage, reasons, rank }) => ({
    listingId: item.listingId,
    produceName: item.name,
    farmerName: item.sellerName || 'Seller name not provided by the listing API',
    location: item.locationLabel || 'Location not reported',
    quantity: item.availableQuantity,
    unit: item.unit || 'Unit not reported',
    price: item.unitPrice,
    currency: item.currency,
    quality: item.quality ?? 'Quality not reported',
    matchScore: score,
    scoreCoverage: coverage,
    reasons,
    rank,
    item,
  }))
  return {
    ok: true,
    data: {
      matches,
      summary: matches.length ? `${matches.length} actual listing(s) matched the requested filters.` : 'No actual marketplace listing matched the filters. No sample produce was added.',
      excludedCount: result.excluded.length,
      source: 'authenticated marketplace API',
    },
  }
}

export async function rankSuppliersFromMarketplace(payload) {
  const [{ listings }, configuration] = await Promise.all([
    readMarketplaceListings(),
    api.get('/algorithms/matching'),
  ])
  const activeListings = listings.filter(isActiveListing)
  const productQuery = normalize(payload.produceType)
  const unitQuery = normalize(payload.unit)
  const candidates = activeListings.filter((item) => item.sellerId
    && item.unit
    && normalize(item.unit) === unitQuery
    && (normalize(item.produceType).includes(productQuery) || productQuery.includes(normalize(item.produceType))))
  const ranked = rankSuppliers(candidates.map((item) => ({
    id: item.sellerId,
    sellerName: item.sellerName,
    listingId: item.listingId,
    name: item.name,
    produceTypes: [item.produceType].filter(Boolean),
    availableQuantity: item.availableQuantity,
    unitPrice: item.unitPrice,
    currency: item.currency,
    unit: item.unit,
    quality: item.quality,
    location: item.location,
    listing: item,
    fulfillmentHistory: item.raw.fulfillmentHistory ?? item.raw.fulfilmentHistory ?? null,
  })), {
    produceType: payload.produceType,
    quantity: payload.quantity,
    location: payload.location && typeof payload.location === 'object' ? payload.location : { location: payload.location },
    quality: payload.quality,
    maxUnitPrice: payload.maxUnitPrice,
  }, {
    produceFit: 0,
    priceFit: configuration.weights.price,
    qualityFit: configuration.weights.quality,
    distanceFit: configuration.weights.distance,
    availabilityFit: configuration.weights.availability,
    fulfilmentFit: 0,
  })
  const seen = new Set()
  const suppliers = ranked.filter((row) => {
    const key = String(row.item.id)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  }).map((row) => ({
    supplierId: row.item.id,
    supplierName: row.item.sellerName || 'Supplier name not provided by the listing API',
    location: row.item.listing.locationLabel || 'Location not reported',
    produce: row.item.name,
    quantity: row.item.availableQuantity,
    unit: row.item.unit || 'Unit not reported',
    price: row.item.unitPrice,
    currency: row.item.currency,
    quality: row.item.quality ?? 'Quality not reported',
    matchScore: row.scorePercent,
    scoreCoverage: row.coverage,
    factorScores: row.factors,
    reasons: row.reasons,
    verifiedHistory: row.verifiedHistory,
    listingId: row.item.listingId,
  }))
  return {
    ok: true,
    data: {
      suppliers,
      summary: suppliers.length ? `Ranked ${suppliers.length} suppliers that have actual marketplace listings for ${payload.produceType}.` : 'No verifiable supplier listings matched these requirements. No suppliers were invented.',
      source: 'authenticated marketplace API',
      matchingWeights: configuration.weights,
      matchingAlgorithmVersion: configuration.version,
    },
  }
}

export async function createPurchasePlanFromMarketplace(payload) {
  const { listings } = await readMarketplaceListings()
  const activeListings = listings.filter(isActiveListing)
  const produce = clean(payload.produceRequirements)
  if (!produce || /[,;\n]/.test(produce)) {
    return { ok: false, code: 'SINGLE_PRODUCE_REQUIRED', error: 'Enter one produce name per plan. Multi-item purchases require separate quantity and unit details for each item.' }
  }
  const demand = [{
    produce,
    quantity: Number(payload.requiredQuantities),
    unit: payload.unit,
    currency: 'KES',
    deliveryArea: payload.deliveryArea,
    quality: payload.quality || undefined,
    requiredDate: payload.purchaseDeadline || undefined,
  }]
  const offers = activeListings.map((item) => ({
    id: item.listingId,
    supplierId: item.sellerId,
    produce: item.produceType,
    availableQuantity: item.availableQuantity,
    unit: item.unit,
    unitPrice: item.unitPrice,
    currency: item.currency,
    quality: item.quality,
    availableFrom: item.availableFrom,
    location: item.locationLabel,
    available: item.available,
  }))
  const plan = optimizePurchasePlan(demand, offers, {
    budget: payload.budget === '' || payload.budget === undefined ? undefined : Number(payload.budget),
    budgetCurrency: 'KES',
  })
  const shortlist = plan.allocations.map((line) => {
    const listing = listings.find((item) => String(item.listingId) === String(line.offerId))
    return {
      item: line.produce,
      quantity: line.quantity,
      unit: line.unit,
      price: line.unitPrice,
      total: line.cost,
      currency: line.currency,
      quality: listing?.quality ?? null,
      supplier: listing?.sellerName || null,
      listingId: line.offerId,
    }
  })
  const summary = plan.complete
    ? `All ${Number(payload.requiredQuantities)} ${payload.unit} requested were allocated across ${shortlist.length} compatible real listing(s). Estimated listing cost: KES ${plan.totalCost}.`
    : plan.allocations.length
      ? `The available real listings cover ${Number(payload.requiredQuantities) - plan.shortages[0].remaining} of ${Number(payload.requiredQuantities)} ${payload.unit}; ${plan.shortages[0].remaining} remain unfilled.`
      : 'No compatible real listing is available for this purchase requirement.'
  return {
    ok: true,
    data: {
      summary,
      checklist: [...plan.assumptions, ...plan.shortages.map((shortage) => shortage.reason)],
      shortlist,
      costBreakdown: plan.totalCost === null ? 'Costs are grouped by currency; no mixed-currency total was calculated.' : `KES ${plan.totalCost} from ${shortlist.length} listing allocation(s).`,
      plan,
      source: 'authenticated marketplace API',
    },
  }
}

function periodDays(period) {
  return period === 'week' ? 7 : period === 'quarter' ? 90 : 30
}

export async function adviseFromMarketObservations(payload) {
  const feed = await fetchMarketObservations()
  const evidence = analyzeVerifiedMarketObservations(feed.observations, {
    produce: payload.produce,
    market: payload.location,
    periodDays: periodDays(payload.timePeriod),
  })
  const summaries = evidence.summaries.filter((summary) => summary.current)
  if (!summaries.length) {
    return { ok: false, code: 'VERIFIED_MARKET_DATA_UNAVAILABLE', error: 'No fresh, verified market observations match this produce and location. No AI market claims were generated.' }
  }
  const facts = summaries.map((summary) => {
    const points = summary.observations.filter((row) => row.freshness === 'fresh')
    const min = Math.min(...points.map((row) => row.price))
    const max = Math.max(...points.map((row) => row.price))
    return `${summary.market}: ${summary.currency} ${min}–${max} per ${summary.unit}, from ${points.length} fresh verified observation(s).`
  })
  const trends = summaries.map((summary) => summary.trend.status === 'available'
    ? `${summary.market}: observed historical change ${summary.trend.changePercent === null ? 'not calculable' : `${summary.trend.changePercent.toFixed(1)}%`} across ${summary.trend.sampleCount} dated observations.`
    : `${summary.market}: trend withheld; historical sample is insufficient.`)
  const aiResponse = await requestAI(AI_CAPABILITIES.MARKET_ADVISOR, { ...payload, verifiedObservations: summaries })
  const aiProvider = clean(aiResponse.meta?.provider) || null
  return {
    ok: true,
    data: {
      summary: `${facts.join(' ')} No forecast is calculated by this screen.`,
      factors: [...facts, ...trends],
      recommendedActions: [],
      aiInterpretation: aiResponse.ok ? aiResponse.data.summary : null,
      aiStatus: aiResponse.ok ? (aiProvider?.toLowerCase() === 'nvidia' ? 'connected' : 'provider-unverified') : aiResponse.code,
      aiProvider,
      evidence: summaries,
      source: 'verified AgriLink market-data API',
    },
  }
}

export async function adviseFromVerifiedPrices(payload) {
  const feed = await fetchMarketObservations()
  const marketName = normalize(payload.location)
  const unit = normalize(payload.unit)
  const observations = feed.observations.filter((row) => row.freshness === 'fresh'
    && normalize(row.commodity) === normalize(payload.produce)
    && normalize(row.market) === marketName
    && normalize(row.unit) === unit
    && row.currency === 'KES')
  if (!observations.length) {
    return { ok: false, code: 'VERIFIED_MARKET_DATA_UNAVAILABLE', error: 'No fresh verified price observations match this produce, market, unit, and currency. AgriLink will not create a price range without source data.' }
  }
  const comparison = comparePrices(observations.map((row) => ({
    id: row.id, produce: row.commodity, market: row.market, unit: row.unit, currency: row.currency,
    unitPrice: row.price, observedAt: row.observedAt, sourceName: row.sourceName, sourceUrl: row.sourceUrl,
  })))
  const group = comparison.groups.find((item) => normalize(item.produce) === normalize(payload.produce)
    && normalize(item.unit) === unit && item.currency === 'KES')
  if (!group || !group.observationCount) {
    return { ok: false, code: 'VERIFIED_MARKET_DATA_UNAVAILABLE', error: 'No comparable observations remained after unit and currency validation.' }
  }
  const aiResponse = await requestAI(AI_CAPABILITIES.PRICE_ADVISOR, {
    ...payload,
    verifiedObservations: observations.map(({ commodity, market, price, currency, unit: observedUnit, observedAt, sourceName }) => ({ commodity, market, price, currency, unit: observedUnit, observedAt, sourceName })),
  })
  const aiProvider = clean(aiResponse.meta?.provider) || null
  return {
    ok: true,
    data: {
      suggestedMinPrice: group.lowest.unitPrice,
      suggestedMaxPrice: group.highest.unitPrice,
      factors: [
        `Observed range from ${group.observationCount} verified record(s) at ${group.produce}, ${group.market}.`,
        `Source observations: ${[...new Set(observations.map((row) => row.sourceName))].join(', ')}.`,
        `Latest observation: ${observations.map((row) => row.observedAt).sort().at(-1)}.`,
        'This is an observed range, not an AI forecast or a guarantee of your achievable price.',
      ],
      aiExplanation: aiResponse.ok ? aiResponse.data.factors ?? [] : [],
      aiStatus: aiResponse.ok ? (aiProvider?.toLowerCase() === 'nvidia' ? 'connected' : 'provider-unverified') : aiResponse.code,
      aiProvider,
      evidence: group.comparable,
      currency: group.currency,
      unit: group.unit,
      source: 'verified AgriLink market-data API',
    },
  }
}
