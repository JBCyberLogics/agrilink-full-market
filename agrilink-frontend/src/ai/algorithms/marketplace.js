import {
  DEFAULT_RECOMMENDATION_WEIGHTS,
  normalizeWeights,
  rankByWeightedCriteria,
  scoreDistanceFit,
  scoreLocationMatch,
  scorePriceFit,
  scoreQuantityCoverage,
  scoreQualityFit,
  scoreSetCoverage,
} from './scoring.js'

const clean = (value) => typeof value === 'string' ? value.trim() : ''
const keyOf = (value) => clean(String(value ?? '')).toLocaleLowerCase()
const unitKey = (value) => {
  const normalized = keyOf(value).replace(/\s+/g, ' ')
  const aliases = { kilogram: 'kg', kilograms: 'kg', gram: 'g', grams: 'g', litres: 'litre', liter: 'litre', liters: 'litre', l: 'litre', tonne: 'tonne', tonnes: 'tonne' }
  return aliases[normalized] ?? normalized
}
const produceName = (offer) => clean(offer?.produce ?? offer?.produceType ?? offer?.commodity ?? offer?.name ?? offer?.crop)

export const DEFAULT_SUPPLIER_WEIGHTS = Object.freeze({
  produceFit: 0.2,
  priceFit: 0.225,
  qualityFit: 0.18,
  distanceFit: 0.135,
  availabilityFit: 0.18,
  fulfilmentFit: 0.08,
})

function summarizeComparable(items) {
  const sorted = [...items].sort((a, b) => a.unitPrice - b.unitPrice)
  const lowest = sorted[0] ?? null
  const highest = sorted.at(-1) ?? null
  const difference = sorted.length >= 2 ? highest.unitPrice - lowest.unitPrice : null
  return {
    comparable: sorted,
    cheapest: lowest,
    lowest,
    highest,
    average: sorted.length >= 2 ? sorted.reduce((sum, item) => sum + item.unitPrice, 0) / sorted.length : null,
    difference,
    differencePercent: lowest && lowest.unitPrice > 0 && difference !== null ? (difference / lowest.unitPrice) * 100 : null,
    observationCount: sorted.length,
    comparisonCount: sorted.length,
    unit: sorted[0]?.unit ?? null,
    currency: sorted[0]?.currency ?? null,
    produce: sorted[0]?.produce ?? null,
  }
}

function parseMarketDate(value) {
  if (typeof value !== 'string') return null
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  const validFormat = dateOnly || /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)
  if (!validFormat) return null
  const dateParts = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  const [, year, month, day] = dateParts.map(Number)
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) return null
  const epoch = Date.parse(value)
  if (!Number.isFinite(epoch)) return null
  return epoch
}

/**
 * Compare only same-produce, same-canonical-unit, same-currency offers.
 * `.groups` is the complete result; legacy top-level fields describe the
 * first comparable group and never combine incompatible observations.
 */
export function comparePrices(offers = []) {
  if (!Array.isArray(offers)) throw new TypeError('Offers must be an array.')
  const valid = []
  const excluded = []
  for (const offer of offers) {
    const produce = produceName(offer)
    const unit = clean(offer?.unit ?? offer?.measurementUnit)
    const currency = clean(offer?.currency ?? offer?.priceCurrency).toUpperCase()
    const unitPrice = offer?.unitPrice ?? offer?.price
    if (!produce || !unit || !/^[A-Z]{3}$/.test(currency) || !Number.isFinite(unitPrice) || unitPrice < 0) {
      excluded.push({ offer, reason: 'A comparable observation needs produce, a non-negative numeric price, a unit, and an ISO currency.' })
      continue
    }
    valid.push({ ...offer, produce, unit, currency, unitPrice })
  }

  const grouped = new Map()
  for (const offer of valid) {
    const key = [keyOf(offer.produce), unitKey(offer.unit), offer.currency].join('|')
    const group = grouped.get(key) ?? { produce: offer.produce, unit: offer.unit, currency: offer.currency, items: [] }
    group.items.push(offer)
    grouped.set(key, group)
  }
  const groups = [...grouped.values()].map((group) => summarizeComparable(group.items))
    .sort((a, b) => keyOf(a.produce).localeCompare(keyOf(b.produce)) || unitKey(a.unit).localeCompare(unitKey(b.unit)) || a.currency.localeCompare(b.currency))
  const reference = groups[0] ?? summarizeComparable([])
  const referenceKey = reference.produce ? [keyOf(reference.produce), unitKey(reference.unit), reference.currency].join('|') : null
  for (const offer of valid) {
    const key = [keyOf(offer.produce), unitKey(offer.unit), offer.currency].join('|')
    if (key !== referenceKey) excluded.push({ offer, reason: 'Produce, unit, or currency differs; it is reported in a separate comparison group.' })
  }
  return { ...reference, groups, excluded }
}

/**
 * Summarize only explicitly verified observations. Stale points stay available
 * for historical statistics but cannot supply a current/live observation.
 * A trend is withheld unless three distinct dated points span at least seven
 * days for the same commodity, market, unit, and currency.
 */
export function analyzeVerifiedMarketObservations(observations = [], { produce, market, unit, currency, now = Date.now(), periodDays } = {}) {
  if (!Array.isArray(observations)) throw new TypeError('Market observations must be an array.')
  if (periodDays !== undefined && (!Number.isFinite(periodDays) || periodDays <= 0)) throw new RangeError('Period must be a positive number of days.')
  const rejected = []
  const seen = new Set()
  const accepted = []
  const targetProduce = keyOf(produce)
  const targetMarket = keyOf(market)
  const targetUnit = unit ? unitKey(unit) : null
  const targetCurrency = currency ? clean(currency).toUpperCase() : null
  for (const observation of observations) {
    const commodity = produceName(observation)
    const location = clean(observation?.market ?? observation?.location)
    const price = observation?.price ?? observation?.unitPrice
    const observationUnit = clean(observation?.unit ?? observation?.measurementUnit)
    const observationCurrency = clean(observation?.currency).toUpperCase()
    const observedAtText = observation?.observedAt ?? observation?.observed_at
    const observedAt = parseMarketDate(observedAtText)
    const sourceName = clean(observation?.sourceName ?? observation?.source?.name)
    const verified = observation?.verificationStatus?.toLowerCase?.() === 'verified'
      || observation?.verified === true || observation?.isVerified === true
    const reportedFreshness = observation?.freshness
    const freshness = reportedFreshness === 'stale' || !Number.isFinite(observedAt) || now - observedAt > 24 * 60 * 60 * 1000
      ? 'stale'
      : 'fresh'
    if (!commodity || !location || !Number.isFinite(price) || price <= 0 || !observationUnit
      || !/^[A-Z]{3}$/.test(observationCurrency) || !Number.isFinite(observedAt) || !sourceName || !verified
      || (reportedFreshness !== undefined && !['fresh', 'stale'].includes(reportedFreshness))) {
      rejected.push({ observation, reason: 'Observation is incomplete, invalid, or lacks explicit source verification.' })
      continue
    }
    if (observedAt > now + 5 * 60 * 1000) { rejected.push({ observation, reason: 'Observation timestamp is in the future.' }); continue }
    if (targetProduce && keyOf(commodity) !== targetProduce) continue
    if (targetMarket && keyOf(location) !== targetMarket) continue
    if (targetUnit && unitKey(observationUnit) !== targetUnit) continue
    if (targetCurrency && observationCurrency !== targetCurrency) continue
    if (periodDays && now - observedAt > periodDays * 86_400_000) continue
    const identity = `${keyOf(commodity)}|${keyOf(location)}|${observedAt}|${unitKey(observationUnit)}|${observationCurrency}`
    if (seen.has(identity)) { rejected.push({ observation, reason: 'Duplicate observation.' }); continue }
    seen.add(identity)
    accepted.push({ ...observation, produce: commodity, market: location, price, unit: observationUnit, currency: observationCurrency, epoch: observedAt, freshness })
  }

  const groups = new Map()
  accepted.forEach((observation) => {
    const key = [keyOf(observation.produce), keyOf(observation.market), unitKey(observation.unit), observation.currency].join('|')
    const group = groups.get(key) ?? { produce: observation.produce, market: observation.market, unit: observation.unit, currency: observation.currency, observations: [] }
    group.observations.push(observation)
    groups.set(key, group)
  })
  const summaries = [...groups.values()].map((group) => {
    const sorted = [...group.observations].sort((a, b) => a.epoch - b.epoch)
    const current = sorted.filter((item) => item.freshness === 'fresh').at(-1) ?? null
    const prices = sorted.map((item) => item.price)
    const first = sorted[0]
    const last = sorted.at(-1)
    const enoughHistory = sorted.length >= 3 && last.epoch - first.epoch >= 7 * 86_400_000
    const change = enoughHistory ? last.price - first.price : null
    return {
      produce: group.produce,
      market: group.market,
      unit: group.unit,
      currency: group.currency,
      current,
      observations: sorted,
      count: sorted.length,
      freshCount: sorted.filter((item) => item.freshness === 'fresh').length,
      staleCount: sorted.filter((item) => item.freshness === 'stale').length,
      average: prices.length ? prices.reduce((sum, price) => sum + price, 0) / prices.length : null,
      lowest: prices.length ? Math.min(...prices) : null,
      highest: prices.length ? Math.max(...prices) : null,
      trend: enoughHistory ? {
        status: 'available',
        firstObservedAt: first.observedAt,
        lastObservedAt: last.observedAt,
        change,
        changePercent: first.price === 0 ? null : (change / first.price) * 100,
        sampleCount: sorted.length,
      } : { status: 'insufficient-history', requiredObservations: 3, requiredSpanDays: 7, sampleCount: sorted.length },
    }
  })
  const currentObservations = summaries.filter((summary) => summary.current)
  return {
    status: currentObservations.length ? 'available' : 'unavailable',
    summaries,
    currentObservations,
    rejected,
    reason: currentObservations.length ? null : 'No fresh, source-verified market observations match the selected filters.',
  }
}

function dateScore(requiredDate, availableDate) {
  if (!requiredDate && !availableDate) return null
  const required = parseMarketDate(requiredDate)
  const available = parseMarketDate(availableDate)
  if (!Number.isFinite(required) || !Number.isFinite(available)) return null
  return available <= required ? 100 : 0
}

export function rankProduce(produce = [], preferences = {}, weights = DEFAULT_RECOMMENDATION_WEIGHTS) {
  if (!Array.isArray(produce)) throw new TypeError('Produce records must be an array.')
  return rankByWeightedCriteria(produce, {
    weights,
    getCriteria: (item) => ({
      produceFit: scoreSetCoverage(preferences.produceTypes ?? [preferences.produceType].filter(Boolean), item.produceTypes ?? [item.produceType ?? item.name].filter(Boolean)),
      quantityFit: scoreQuantityCoverage(preferences.quantity ?? preferences.requiredQuantity, item.availableQuantity ?? item.stock),
      locationFit: scoreLocationMatch(preferences.location ?? preferences, item.location ?? item),
      priceFit: scorePriceFit(preferences.maxUnitPrice, item.unitPrice ?? item.price),
      availabilityFit: dateScore(preferences.requiredDate ?? preferences.requiredAvailabilityDate, item.availableFrom),
    }),
  })
}

/** Filter real listing records first, then rank the surviving candidates. */
export function filterAndRankProduce(produce = [], preferences = {}, { weights = DEFAULT_RECOMMENDATION_WEIGHTS, strictLocation = false } = {}) {
  if (!Array.isArray(produce)) throw new TypeError('Produce records must be an array.')
  const excluded = []
  const candidates = []
  const wanted = keyOf(preferences.produceType)
  const wantedQuality = clean(preferences.qualityRequirements ?? preferences.quality)
  const budget = preferences.maxUnitPrice ?? preferences.budgetPerUnit
  const minPrice = preferences.minUnitPrice
  const requiredQty = preferences.requiredQuantity ?? preferences.quantity
  const requiredUnit = preferences.unit ? unitKey(preferences.unit) : null
  const requiredDate = preferences.requiredAvailabilityDate ?? preferences.requiredDate
  if (requiredDate && !Number.isFinite(parseMarketDate(requiredDate))) throw new RangeError('Required availability date is invalid.')
  const desiredLocation = preferences.location?.location ?? preferences.location?.town ?? preferences.location
  const normalizedDesiredLocation = clean(String(desiredLocation ?? '')).toLocaleLowerCase()
  for (const item of produce) {
    const name = keyOf(item?.produceType ?? item?.name ?? item?.cropType)
    const stock = item?.availableQuantity ?? item?.stock ?? item?.quantityAvailable
    const price = item?.unitPrice ?? item?.price
    if (!item || item.available === false || item.isAvailable === false || item.status === 'unavailable') {
      excluded.push({ item, reason: 'Listing is marked unavailable.' }); continue
    }
    if (wanted && !name) { excluded.push({ item, reason: 'Produce identity is missing; this listing cannot be safely matched.' }); continue }
    if (wanted && scoreSetCoverage([wanted], [name]) === 0 && !keyOf(item?.description).includes(wanted)) { excluded.push({ item, reason: 'Produce does not match the requested type.' }); continue }
    if (strictLocation && normalizedDesiredLocation) {
      const rawLocation = item?.location?.location ?? item?.location?.town ?? item?.location?.county ?? item?.location
      const normalizedListingLocation = clean(String(rawLocation ?? '')).toLocaleLowerCase()
      if (!normalizedListingLocation || (!normalizedListingLocation.includes(normalizedDesiredLocation) && !normalizedDesiredLocation.includes(normalizedListingLocation))) {
        excluded.push({ item, reason: normalizedListingLocation ? 'Listing location does not match the requested area.' : 'Listing location is not reported.' }); continue
      }
    }
    if (requiredUnit && !item?.unit) { excluded.push({ item, reason: 'Listing measurement unit is missing.' }); continue }
    if (requiredUnit && unitKey(item.unit) !== requiredUnit) { excluded.push({ item, reason: 'Listing measurement unit differs from the requested unit.' }); continue }
    if (Number.isFinite(requiredQty)) {
      if (!Number.isFinite(stock)) { excluded.push({ item, reason: 'Available quantity is not reported.' }); continue }
      if (stock < requiredQty) { excluded.push({ item, reason: 'Available quantity is below the requested amount.' }); continue }
    }
    if (Number.isFinite(budget) || Number.isFinite(minPrice)) {
      if (!Number.isFinite(price) || price < 0) { excluded.push({ item, reason: 'A valid price is required for the selected price filter.' }); continue }
      if (Number.isFinite(budget) && price > budget) { excluded.push({ item, reason: 'Price exceeds the maximum budget.' }); continue }
      if (Number.isFinite(minPrice) && price < minPrice) { excluded.push({ item, reason: 'Price is below the requested minimum.' }); continue }
    }
    if (wantedQuality) {
      const quality = item.qualityGrade ?? item.quality
      const fit = scoreQualityFit(wantedQuality, quality)
      if (fit === null) { excluded.push({ item, reason: 'Quality information is missing or cannot be compared.' }); continue }
      if (fit <= 0) { excluded.push({ item, reason: 'Quality does not satisfy the requested grade.' }); continue }
    }
    if (requiredDate) {
      const available = parseMarketDate(item.availableFrom ?? item.availableAt ?? item.harvestDate)
      const needed = parseMarketDate(requiredDate)
      if (!Number.isFinite(available)) { excluded.push({ item, reason: 'Availability date is not reported or invalid.' }); continue }
      if (available > needed) { excluded.push({ item, reason: 'Listing is available after the requested date.' }); continue }
    }
    candidates.push(item)
  }

  const ranked = rankProduce(candidates, preferences, weights).map((entry, index) => ({ ...entry, rank: index + 1, reasons: explainScore(entry.item, entry.score, entry.coverage) }))
  return { results: ranked, excluded, totalCandidates: produce.length }
}

export function rankRecommendations(items = [], weights = DEFAULT_RECOMMENDATION_WEIGHTS, getCriteria = (item) => item?.scores ?? {}) {
  if (!Array.isArray(items)) throw new TypeError('Recommendation items must be an array.')
  const seen = new Set()
  const unique = items.filter((item) => {
    const stableId = item?.id ?? item?._id ?? item?.key
    const identity = keyOf(stableId ?? item?.title ?? item?.name ?? item?.produceType)
    if (!identity || seen.has(identity)) return false
    seen.add(identity)
    return true
  })
  return rankByWeightedCriteria(unique, { weights, getCriteria }).map((entry, index) => ({
    ...entry,
    rank: index + 1,
    breakdown: getCriteria(entry.item) ?? {},
    reasons: entry.item?.reasons?.filter(Boolean) ?? explainScore(entry.item, entry.score, entry.coverage),
  }))
}

export function explainScore(item, score, coverage) {
  const reasons = []
  if (item?.produceType ?? item?.name) reasons.push(`Produce: ${item.produceType ?? item.name}`)
  if (item?.location?.county ?? item?.location) reasons.push(`Location data: ${item.location?.county ?? item.location}`)
  if (Number.isFinite(item?.availableQuantity ?? item?.stock)) reasons.push(`Reported available quantity: ${item.availableQuantity ?? item.stock}`)
  if (Number.isFinite(item?.unitPrice ?? item?.price)) reasons.push(`Reported unit price: ${item.unitPrice ?? item.price}`)
  if (Number.isFinite(score)) reasons.push(`Fit score ${score}/100 from supplied listing fields (${coverage}% scoring coverage).`)
  return reasons
}

export function rankSuppliers(suppliers = [], requirements = {}, weights = DEFAULT_SUPPLIER_WEIGHTS) {
  if (!Array.isArray(suppliers)) throw new TypeError('Supplier records must be an array.')
  const normalizedWeights = normalizeWeights(weights)
  return suppliers.map((supplier, index) => {
    const requestedProduce = requirements.produceTypes ?? [requirements.produceType].filter(Boolean)
    const offeredProduce = supplier.produceTypes ?? supplier.crops ?? [supplier.produceType ?? supplier.name].filter(Boolean)
    const price = scorePriceFit(requirements.maxUnitPrice, supplier.unitPrice ?? supplier.price)
    const quantity = scoreQuantityCoverage(requirements.quantity, supplier.availableQuantity ?? supplier.stock)
    const quality = scoreQualityFit(requirements.quality ?? requirements.qualityGrade, supplier.quality ?? supplier.qualityGrade ?? supplier.qualityScore)
    const distance = scoreDistanceFit(requirements.location ?? requirements, supplier.location ?? supplier, { maxDistanceKm: requirements.maxDistanceKm ?? 250 })
    const produce = scoreSetCoverage(requestedProduce, offeredProduce)
    const history = supplier.fulfillmentHistory ?? supplier.fulfilmentHistory
    const fulfilment = history?.verified === true && Number.isFinite(history.fulfilledOrders) && Number.isFinite(history.onTimeOrders)
      && history.fulfilledOrders > 0 && history.onTimeOrders >= 0 && history.onTimeOrders <= history.fulfilledOrders
      ? history.onTimeOrders / history.fulfilledOrders
      : null
    const factors = { produceFit: produce === null ? null : produce / 100, priceFit: price === null ? null : price / 100, qualityFit: quality, distanceFit: distance, availabilityFit: quantity === null ? null : quantity / 100, fulfilmentFit: fulfilment }
    const applicableWeights = Object.entries(normalizedWeights).filter(([key, weight]) => weight > 0 && Number.isFinite(factors[key]))
    const coverage = applicableWeights.reduce((sum, [, weight]) => sum + weight, 0)
    const score = coverage ? applicableWeights.reduce((sum, [key, weight]) => sum + factors[key] * weight, 0) / coverage : null
    const missingCriteria = Object.keys(normalizedWeights).filter((key) => !Number.isFinite(factors[key]))
    const verifiedHistory = fulfilment === null ? null : { fulfilledOrders: history.fulfilledOrders, onTimeOrders: history.onTimeOrders, onTimeRate: fulfilment }
    const reasons = []
    if (produce !== null) reasons.push(produce === 100 ? 'Matches all requested produce types.' : `Matches ${produce.toFixed(0)}% of requested produce types.`)
    if (price !== null) reasons.push(`Price fit ${price.toFixed(0)}% against the supplied maximum.`)
    if (quality !== null) reasons.push(`Quality fit ${(quality * 100).toFixed(0)}% based on supplied quality data.`)
    if (distance !== null) reasons.push(`Distance fit ${(distance * 100).toFixed(0)}% from supplied coordinates/distance.`)
    if (quantity !== null) reasons.push(`Quantity fit ${quantity.toFixed(0)}% against the requested quantity.`)
    if (verifiedHistory) reasons.push(`${verifiedHistory.onTimeOrders}/${verifiedHistory.fulfilledOrders} verified fulfilled orders were on time.`)
    return { item: supplier, index, score, scorePercent: score === null ? null : score * 100, coverage: coverage * 100, factors, missingCriteria, produceFit: produce, verifiedHistory, reasons }
  }).filter((entry) => entry.score !== null && (entry.produceFit === null || entry.produceFit > 0))
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.index - b.index)
    .map(({ index, ...entry }, rank) => ({ ...entry, rank: rank + 1 }))
}
