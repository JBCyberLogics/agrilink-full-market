const cleanKey = (value) => typeof value === 'string' ? value.trim().toLocaleLowerCase() : ''
const produceMatches = (demand, offer) => {
  const tokens = (value) => cleanKey(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((token) => token.length > 3 && token.endsWith('s') ? token.slice(0, -1) : token)
  const requested = tokens(demand)
  const offered = tokens(offer)
  return requested.length > 0 && requested.every((token) => offered.includes(token))
}
const unitKey = (value) => {
  const valueKey = cleanKey(value).replace(/\s+/g, ' ')
  const aliases = { kilogram: 'kg', kilograms: 'kg', gram: 'g', grams: 'g', liter: 'litre', liters: 'litre', litres: 'litre', l: 'litre', tonne: 'tonne', tonnes: 'tonne' }
  return aliases[valueKey] ?? valueKey
}
const roundAmount = (value) => Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000

/**
 * Greedy, per-demand least-cost allocation over real supplied offers. It never
 * converts units/currencies, never mutates inputs, and reports what it could
 * not allocate. A budget limits allocations only when its currency is known.
 */
export function optimizePurchasePlan(demands = [], offers = [], { budget, budgetCurrency, deliveryLocation, maxDistanceKm } = {}) {
  if (!Array.isArray(demands) || !Array.isArray(offers)) throw new TypeError('Demands and offers must be arrays.')
  if (budget !== undefined && (!Number.isFinite(budget) || budget < 0)) throw new RangeError('Budget must be a non-negative number.')
  if (maxDistanceKm !== undefined && (!Number.isFinite(maxDistanceKm) || maxDistanceKm <= 0)) throw new RangeError('Maximum delivery distance must be greater than zero.')

  const allocations = []
  const shortages = []
  const excludedOffers = []
  const costsByCurrency = {}
  const remainingByOffer = offers.map((offer) => offer?.availableQuantity ?? offer?.stock)
  if (!demands.length) {
    return { allocations, shortages, excludedOffers, costsByCurrency, totalCost: 0, currency: null, complete: false, withinBudget: null, budget: budget ?? null, status: 'empty-demand', assumptions: ['No purchase requirements were supplied.'] }
  }

  const currencies = [...new Set(demands.map((demand) => cleanKey(demand?.currency).toUpperCase()).filter(Boolean))]
  const singleCurrency = currencies.length === 1 ? currencies[0] : null
  const effectiveBudgetCurrency = cleanKey(budgetCurrency).toUpperCase() || (singleCurrency ? currencies[0] : null)
  const enforceBudget = budget !== undefined && effectiveBudgetCurrency !== null && currencies.every((currency) => currency === effectiveBudgetCurrency)
  const remainingBudget = { amount: enforceBudget ? budget : Infinity }
  const assumptions = [
    'Offers are allocated from lowest unit price upward for each demand, in the order demands were supplied.',
    'Prices are comparable only for the same produce, canonical unit, and ISO currency; no conversion is performed.',
    'Supplier fulfilment quality is not assumed unless actual history records are supplied separately.',
  ]
  if (budget !== undefined && !enforceBudget) assumptions.push('The budget could not be applied across mixed or unidentified currencies.')
  if (maxDistanceKm !== undefined) assumptions.push('Distance constrained offers require an explicit distance in kilometres; missing distance is not treated as zero.')

  for (const demand of demands) {
    const demandProduce = cleanKey(demand?.produce ?? demand?.produceType)
    const demandUnit = unitKey(demand?.unit)
    const demandCurrency = cleanKey(demand?.currency).toUpperCase()
    if (!demandProduce || !Number.isFinite(demand?.quantity) || demand.quantity <= 0 || !demandUnit || !/^[A-Z]{3}$/.test(demandCurrency)) {
      shortages.push({ demand, remaining: demand?.quantity ?? null, reason: 'Demand needs produce, positive quantity, a unit, and ISO currency.' })
      continue
    }

    const compatible = []
    offers.forEach((offer, index) => {
      const offerProduce = cleanKey(offer?.produce ?? offer?.produceType ?? offer?.commodity ?? offer?.name)
      const offerUnit = unitKey(offer?.unit ?? offer?.measurementUnit)
      const offerCurrency = cleanKey(offer?.currency ?? offer?.priceCurrency).toUpperCase()
      const stock = remainingByOffer[index]
      const unitPrice = offer?.unitPrice ?? offer?.price
      if (!offerProduce || !offerUnit || !/^[A-Z]{3}$/.test(offerCurrency) || !Number.isFinite(stock) || stock <= 0 || !Number.isFinite(unitPrice) || unitPrice < 0) {
        excludedOffers.push({ offer, reason: 'Offer is missing a valid produce, price, quantity, unit, or currency.' })
        return
      }
      if (offer.available === false || offer.isAvailable === false || offer.status === 'unavailable') {
        excludedOffers.push({ offer, reason: 'Offer is marked unavailable.' }); return
      }
      if (!produceMatches(demandProduce, offerProduce)) return
      if (offerUnit !== demandUnit) { excludedOffers.push({ offer, reason: 'Listing measurement unit is incompatible with this demand.' }); return }
      if (offerCurrency !== demandCurrency) { excludedOffers.push({ offer, reason: 'Listing currency is incompatible with this demand.' }); return }
      const requestedArea = cleanKey(demand.deliveryArea ?? deliveryLocation)
      const listedArea = cleanKey(offer.location ?? offer.marketLocation)
      if (requestedArea && (!listedArea || (!listedArea.includes(requestedArea) && !requestedArea.includes(listedArea)))) {
        excludedOffers.push({ offer, reason: listedArea ? 'Listing location does not match the requested delivery area.' : 'Listing location is not reported.' })
        return
      }
      if (maxDistanceKm !== undefined && deliveryLocation) {
        const distanceKm = offer.distanceKm
        if (!Number.isFinite(distanceKm) || distanceKm < 0) {
          excludedOffers.push({ offer, reason: 'Explicit delivery distance is unavailable.' }); return
        }
        if (distanceKm > maxDistanceKm) {
          excludedOffers.push({ offer, reason: 'Offer is beyond the configured delivery distance.' }); return
        }
      }
      if (demand.quality) {
        const requested = cleanKey(demand.quality)
        const offeredQuality = cleanKey(offer.quality ?? offer.qualityGrade)
        if (!offeredQuality) { excludedOffers.push({ offer, reason: 'Offer quality is not reported.' }); return }
        if (requested !== offeredQuality) { excludedOffers.push({ offer, reason: 'Offer quality does not match the requested quality.' }); return }
      }
      if (demand.requiredDate) {
        const requiredDate = Date.parse(demand.requiredDate)
        const availableDate = Date.parse(offer.availableFrom ?? offer.availableAt ?? '')
        if (!Number.isFinite(requiredDate) || !Number.isFinite(availableDate)) {
          excludedOffers.push({ offer, reason: 'A valid required and offer availability date is needed.' }); return
        }
        if (availableDate > requiredDate) { excludedOffers.push({ offer, reason: 'Offer is available after the required date.' }); return }
      }
      compatible.push({ offer, index, unitPrice })
    })
    compatible.sort((a, b) => a.unitPrice - b.unitPrice)

    let remaining = demand.quantity
    for (const { offer, index, unitPrice } of compatible) {
      if (remaining <= 0) break
      if (remainingBudget.amount <= 0) break
      const stock = remainingByOffer[index]
      const affordable = unitPrice === 0 ? remaining : remainingBudget.amount / unitPrice
      const quantity = Math.min(remaining, stock, affordable)
      if (quantity <= 0) continue
      const cost = roundAmount(quantity * unitPrice)
      allocations.push({
        produce: demand.produce ?? demand.produceType,
        supplierId: offer.supplierId ?? offer.sellerId ?? null,
        offerId: offer.id ?? offer._id ?? null,
        quantity: roundAmount(quantity),
        unit: demand.unit,
        unitPrice,
        currency: demandCurrency,
        cost,
        source: offer.source ?? 'supplied offer data',
        rationale: 'Lowest remaining compatible unit price for this demand.',
      })
      remaining = roundAmount(remaining - quantity)
      remainingByOffer[index] = roundAmount(stock - quantity)
      costsByCurrency[demandCurrency] = roundAmount((costsByCurrency[demandCurrency] ?? 0) + cost)
      if (enforceBudget) remainingBudget.amount = roundAmount(remainingBudget.amount - cost)
    }
    if (remaining > 0) shortages.push({
      demand,
      remaining,
      reason: enforceBudget && remainingBudget.amount <= 0
        ? 'The remaining budget is insufficient for the requested quantity.'
        : 'Available compatible offers do not cover the requested quantity.',
    })
  }

  const totalCost = singleCurrency ? (costsByCurrency[singleCurrency] ?? 0) : null
  const fulfilled = shortages.length === 0
  return {
    allocations,
    shortages,
    excludedOffers,
    totalCost,
    costsByCurrency,
    currency: singleCurrency,
    complete: fulfilled,
    withinBudget: budget === undefined ? null : enforceBudget ? Object.values(costsByCurrency).reduce((sum, cost) => sum + cost, 0) <= budget : null,
    budget: budget ?? null,
    budgetCurrency: effectiveBudgetCurrency,
    status: fulfilled ? 'complete' : allocations.length ? 'partially-fulfilled' : 'no-compatible-offers',
    assumptions,
  }
}

/** Net return based only on amounts supplied by the farmer. */
export function calculateNetProfit({ quantity, sellableQuantity, unitSalePrice, costs = [], costsComplete = false, targetProfit } = {}) {
  const saleQuantity = sellableQuantity ?? quantity
  if (!Number.isFinite(saleQuantity) || saleQuantity <= 0) throw new RangeError('Sellable quantity must be greater than zero.')
  if (!Number.isFinite(unitSalePrice) || unitSalePrice < 0) throw new RangeError('Unit sale price must be non-negative.')
  if (!Array.isArray(costs)) throw new TypeError('Costs must be an array.')
  if (targetProfit !== undefined && (!Number.isFinite(targetProfit) || targetProfit < 0)) throw new RangeError('Target profit must be a non-negative amount.')
  const cleanCosts = costs.map((cost) => {
    if (!Number.isFinite(cost?.amount) || cost.amount < 0) throw new RangeError('Each cost must be a non-negative amount.')
    return { label: typeof cost.label === 'string' && cost.label.trim() ? cost.label.trim() : 'Cost', amount: cost.amount }
  })
  const grossRevenue = saleQuantity * unitSalePrice
  const knownCosts = cleanCosts.reduce((sum, cost) => sum + cost.amount, 0)
  if (!Number.isFinite(grossRevenue) || !Number.isFinite(knownCosts)) throw new RangeError('The supplied values exceed the supported calculation range.')
  const common = {
    quantity: saleQuantity,
    sellableQuantity: saleQuantity,
    unitSalePrice,
    grossRevenue,
    revenue: grossRevenue,
    costs: cleanCosts,
    knownCosts,
    costsComplete: Boolean(costsComplete),
    requiredSellingPriceForTargetProfit: costsComplete && targetProfit !== undefined ? (knownCosts + targetProfit) / saleQuantity : null,
    targetProfit: targetProfit ?? null,
    assumptions: costsComplete ? [] : ['Net profit, margin, break-even, and target price remain unavailable until all costs are confirmed.'],
  }
  if (!costsComplete) {
    return { ...common, totalCosts: null, netProfit: null, profitMarginPercent: null, breakEvenUnitPrice: null }
  }
  const netProfit = grossRevenue - knownCosts
  return {
    ...common,
    totalCosts: knownCosts,
    netProfit,
    profitMarginPercent: grossRevenue === 0 ? null : (netProfit / grossRevenue) * 100,
    breakEvenUnitPrice: knownCosts / saleQuantity,
    assumptions: ['Calculation uses only the supplied sellable quantity, unit price, and cost entries.'],
  }
}
