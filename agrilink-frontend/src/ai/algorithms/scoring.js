/**
 * Deterministic scoring primitives. Generic recommendation scores use 0–100;
 * the buyer/seller match contract below uses normalized 0–1 factors.
 */
export const DEFAULT_RECOMMENDATION_WEIGHTS = Object.freeze({
  produceFit: 0.35,
  quantityFit: 0.25,
  locationFit: 0.2,
  priceFit: 0.12,
  availabilityFit: 0.08,
})

export const DEFAULT_MATCH_WEIGHTS = Object.freeze({
  priceFit: 0.35,
  qualityFit: 0.25,
  distanceFit: 0.2,
  availabilityFit: 0.2,
})

export const DEFAULT_DISTANCE_SCALE_KM = 250

function checkedWeights(weights = DEFAULT_RECOMMENDATION_WEIGHTS) {
  const entries = Object.entries(weights ?? {})
  if (!entries.length) throw new TypeError('At least one scoring weight is required.')
  for (const [key, weight] of entries) {
    if (!Number.isFinite(weight) || weight < 0) throw new RangeError(`Weight "${key}" must be a non-negative number.`)
  }
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0)
  if (total <= 0) throw new RangeError('The sum of scoring weights must be greater than zero.')
  return { entries, total }
}

export function normalizeWeights(weights = DEFAULT_RECOMMENDATION_WEIGHTS) {
  const { entries, total } = checkedWeights(weights)
  return Object.fromEntries(entries.map(([key, weight]) => [key, weight / total]))
}

/** Score 0–100 criteria. Missing criteria are omitted and reduce coverage. */
export function weightedScore(criteria = {}, weights = DEFAULT_RECOMMENDATION_WEIGHTS) {
  const { entries, total } = checkedWeights(weights)
  const available = entries.filter(([key, weight]) =>
    weight > 0 && Number.isFinite(criteria[key]) && criteria[key] >= 0 && criteria[key] <= 100,
  )
  const appliedWeight = available.reduce((sum, [, weight]) => sum + weight, 0)
  if (!appliedWeight) return { score: null, coverage: 0, availableCriteria: [], missingCriteria: entries.map(([key]) => key) }

  const weightedTotal = available.reduce((sum, [key, weight]) => sum + criteria[key] * weight, 0)
  return {
    score: Math.round((weightedTotal / appliedWeight) * 100) / 100,
    coverage: Math.round((appliedWeight / total) * 100),
    availableCriteria: available.map(([key]) => key),
    missingCriteria: entries.filter(([key]) => !available.some(([availableKey]) => availableKey === key)).map(([key]) => key),
  }
}

export function rankByWeightedCriteria(items = [], { weights = DEFAULT_RECOMMENDATION_WEIGHTS, getCriteria = (item) => item?.scores ?? {} } = {}) {
  if (!Array.isArray(items)) throw new TypeError('Items must be an array.')
  return items
    .map((item, index) => ({ item, index, ...weightedScore(getCriteria(item) ?? {}, weights) }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.index - b.index)
    .map(({ index, ...entry }) => entry)
}

const normalizedLabel = (value) => typeof value === 'string' ? value.trim().toLocaleLowerCase() : ''
const labelTokens = (value) => normalizedLabel(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((token) => token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token)
const labelsMatch = (required, offered) => {
  const need = labelTokens(required)
  const have = labelTokens(offered)
  return need.length > 0 && need.every((token) => have.includes(token))
}

export function scoreSetCoverage(requiredValues, offeredValues) {
  if (!Array.isArray(requiredValues) || requiredValues.length === 0 || !Array.isArray(offeredValues) || offeredValues.length === 0) return null
  const offered = new Set(offeredValues.map(normalizedLabel).filter(Boolean))
  const required = [...new Set(requiredValues.map(normalizedLabel).filter(Boolean))]
  if (!required.length) return null
  return (required.filter((value) => offered.has(value) || [...offered].some((candidate) => labelsMatch(value, candidate))).length / required.length) * 100
}

export function scoreLocationMatch(need = {}, source = {}) {
  const needTown = need.town ?? need.location
  const sourceTown = source.town ?? source.location
  if (needTown && sourceTown && normalizedLabel(String(needTown)) === normalizedLabel(String(sourceTown))) return 100
  if (need.subCounty && source.subCounty && normalizedLabel(need.subCounty) === normalizedLabel(source.subCounty)) return 90
  if (need.county && source.county) return normalizedLabel(need.county) === normalizedLabel(source.county) ? 70 : 0
  return null
}

export function scoreQuantityCoverage(requested, available) {
  if (!Number.isFinite(requested) || requested <= 0 || !Number.isFinite(available) || available < 0) return null
  return Math.min(available / requested, 1) * 100
}

export function scorePriceFit(maxUnitPrice, offeredUnitPrice) {
  if (!Number.isFinite(maxUnitPrice) || maxUnitPrice < 0 || !Number.isFinite(offeredUnitPrice) || offeredUnitPrice < 0) return null
  if (maxUnitPrice === 0) return offeredUnitPrice === 0 ? 100 : 0
  return offeredUnitPrice <= maxUnitPrice ? 100 : Math.max(0, 100 - ((offeredUnitPrice - maxUnitPrice) / maxUnitPrice) * 100)
}

function coordinates(point) {
  const latitude = point?.latitude ?? point?.lat ?? point?.coordinates?.latitude ?? point?.coordinates?.lat
  const longitude = point?.longitude ?? point?.lon ?? point?.lng ?? point?.coordinates?.longitude ?? point?.coordinates?.lng
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return null
  return { latitude, longitude }
}

/** Haversine distance, using only explicit coordinates or a supplied measured distance. */
export function distanceBetweenKm(origin, destination) {
  if (Number.isFinite(destination?.distanceKm) && destination.distanceKm >= 0) return destination.distanceKm
  const from = coordinates(origin)
  const to = coordinates(destination)
  if (!from || !to) return null
  const radians = (value) => (value * Math.PI) / 180
  const latitudeDelta = radians(to.latitude - from.latitude)
  const longitudeDelta = radians(to.longitude - from.longitude)
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2
  return 6371.0088 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
}

/** Returns null when distance is not explicitly available; no county-to-distance guess. */
export function scoreDistanceFit(origin, destination, { maxDistanceKm = DEFAULT_DISTANCE_SCALE_KM } = {}) {
  if (!Number.isFinite(maxDistanceKm) || maxDistanceKm <= 0) throw new RangeError('Maximum distance must be greater than zero.')
  const distanceKm = distanceBetweenKm(origin, destination)
  return distanceKm === null ? null : Math.max(0, 1 - distanceKm / maxDistanceKm)
}

/** Compare explicit quality scores or conservatively compare known grade labels. */
export function scoreQualityFit(required, offered) {
  const numeric = (value) => {
    if (!Number.isFinite(value)) return null
    const normalized = value > 1 ? value / 100 : value
    return normalized >= 0 && normalized <= 1 ? normalized : null
  }
  const requiredScore = numeric(required)
  const offeredScore = numeric(offered)
  if (requiredScore !== null && offeredScore !== null) return requiredScore === 0 ? 1 : Math.min(offeredScore / requiredScore, 1)
  const need = normalizedLabel(required)
  const have = normalizedLabel(offered)
  if (!need || !have) return null
  if (need === have) return 1
  const gradeRank = (value) => {
    const match = value.match(/(?:grade\s*)?([a-f])(?:\b|$)/i)
    return match ? 6 - match[1].toUpperCase().charCodeAt(0) + 65 : null
  }
  const requiredGrade = gradeRank(need)
  const offeredGrade = gradeRank(have)
  if (requiredGrade !== null && offeredGrade !== null) return offeredGrade >= requiredGrade ? 1 : 0
  return null
}

function normalizedMatchCriteria(candidate, need, { maxDistanceKm = DEFAULT_DISTANCE_SCALE_KM } = {}) {
  const requestedProduce = need.produceTypes ?? [need.produceType].filter(Boolean)
  const candidateProduce = candidate.produceTypes ?? candidate.crops ?? [candidate.produceType ?? candidate.name].filter(Boolean)
  if (!Array.isArray(requestedProduce) || !requestedProduce.some((value) => normalizedLabel(value))) {
    return { excluded: 'A produce requirement is needed before candidates can be matched.' }
  }
  if (!Array.isArray(candidateProduce) || !candidateProduce.some((value) => normalizedLabel(value))) {
    return { excluded: 'Candidate produce information is missing; it cannot be treated as a match.' }
  }
  const produceFit = scoreSetCoverage(requestedProduce, candidateProduce)
  if (need.unit && !candidate.unit) return { excluded: 'Candidate measurement unit is missing; compatibility cannot be confirmed.' }
  if (need.currency && !candidate.currency) return { excluded: 'Candidate currency is missing; compatibility cannot be confirmed.' }
  if (need.unit && normalizedLabel(need.unit) !== normalizedLabel(candidate.unit)) return { excluded: 'Measurement unit differs from the requested unit.' }
  if (need.currency && normalizedLabel(need.currency) !== normalizedLabel(candidate.currency)) return { excluded: 'Currency differs from the requested currency.' }
  if (produceFit === 0) return { excluded: 'The item does not match the requested produce.' }
  if (candidate.available === false || candidate.isAvailable === false || candidate.status === 'unavailable') {
    return { excluded: 'The item is marked unavailable.' }
  }

  const requestedQuantity = need.quantity ?? need.requiredQuantity
  const availableQuantity = candidate.availableQuantity ?? candidate.stock ?? candidate.quantityAvailable
  const coverage100 = scoreQuantityCoverage(requestedQuantity, availableQuantity)
  if (coverage100 === 0) return { excluded: 'No requested quantity is available.' }

  const maxPrice = need.maxUnitPrice ?? need.budgetPerUnit
  const unitPrice = candidate.unitPrice ?? candidate.price
  const criteria = {
    priceFit: scorePriceFit(maxPrice, unitPrice) === null ? null : scorePriceFit(maxPrice, unitPrice) / 100,
    qualityFit: scoreQualityFit(need.quality ?? need.qualityGrade, candidate.quality ?? candidate.qualityGrade ?? candidate.qualityScore),
    distanceFit: scoreDistanceFit(need.location ?? need, candidate.location ?? candidate, { maxDistanceKm }),
    availabilityFit: coverage100 === null ? null : coverage100 / 100,
  }
  const missingCriteria = Object.entries(criteria).filter(([, value]) => value === null).map(([key]) => key)
  const normalizedWeights = normalizeWeights(need.weights ?? DEFAULT_MATCH_WEIGHTS)
  const observed = Object.entries(normalizedWeights).filter(([key, weight]) => weight > 0 && Number.isFinite(criteria[key]))
  const appliedWeight = observed.reduce((sum, [, weight]) => sum + weight, 0)
  if (!appliedWeight) return { excluded: 'There is not enough verified information to score this candidate.' }
  const breakdown = Object.fromEntries(Object.entries(normalizedWeights).map(([key, weight]) => [key, {
    value: Number.isFinite(criteria[key]) ? criteria[key] : null,
    weight,
    contribution: Number.isFinite(criteria[key]) ? criteria[key] * weight : null,
  }]))
  const rawScore = observed.reduce((sum, [key, weight]) => sum + criteria[key] * weight, 0) / appliedWeight
  return {
    criteria,
    breakdown,
    score: Math.round(rawScore * 10000) / 10000,
    scorePercent: Math.round(rawScore * 10000) / 100,
    coverage: Math.round(appliedWeight * 10000) / 100,
    missingCriteria,
    distanceKm: distanceBetweenKm(need.location ?? need, candidate.location ?? candidate),
    weightCoverage: Math.round(appliedWeight * 10000) / 100,
  }
}

/**
 * Four-factor seller/buyer match. Weights are normalized to sum to one and
 * scores stay 0–1; scorePercent is supplied for a familiar 0–100 display.
 */
export function rankFarmerBuyerMatches(candidates = [], buyerNeed = {}, options = {}) {
  if (!Array.isArray(candidates)) throw new TypeError('Candidates must be an array.')
  const requestedQuantity = buyerNeed.quantity ?? buyerNeed.requiredQuantity
  const errors = []
  if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0) errors.push('Requested quantity must be greater than zero.')
  const ranked = []
  const excluded = []
  if (errors.length) return { matches: [], excluded: [], errors }
  candidates.forEach((candidate, index) => {
    const result = normalizedMatchCriteria(candidate ?? {}, buyerNeed, options)
    if (result.excluded) excluded.push({ item: candidate, reason: result.excluded })
    else ranked.push({ item: candidate, index, ...result })
  })
  ranked.sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.index - b.index)
  return { matches: ranked.map(({ index, ...match }, rank) => ({ ...match, rank: rank + 1 })), excluded, errors }
}
