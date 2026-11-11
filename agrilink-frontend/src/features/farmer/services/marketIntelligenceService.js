import { marketIntelligence } from '../../../services/api/endpoints.js'

export const MARKET_OBSERVATION_MAX_AGE_MS = 24 * 60 * 60 * 1000
const FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1000

const UNIT_ALIASES = Object.freeze({
  kg: 'kg', kilogram: 'kg', kilograms: 'kg',
  g: 'g', gram: 'g', grams: 'g',
  tonne: 'tonne', tonnes: 'tonne', 'metric ton': 'tonne',
  litre: 'litre', litres: 'litre', l: 'litre',
  lt: 'litre',
  ml: 'ml', millilitre: 'ml', millilitres: 'ml',
  bunch: 'bunch', bunches: 'bunch',
  tray: 'tray', trays: 'tray',
  'tray-30-eggs': 'tray (30 eggs)',
  crate: 'crate', crates: 'crate',
  piece: 'piece', pieces: 'piece',
  bag: 'bag', bags: 'bag', '90kg bag': '90kg bag', '90 kg bag': '90kg bag',
  head: 'head', heads: 'head', cob: 'cob', cobs: 'cob',
  net: 'net', nets: 'net',
})

const clean = (value) => typeof value === 'string' ? value.trim() : ''

function calendarDateIsValid(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!match) return false
  const [, year, month, day] = match.map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

function normalizeTimestamp(value) {
  if (typeof value !== 'string' || !calendarDateIsValid(value)) return null
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value)
  if (!isDateOnly && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value)) return null
  const epoch = Date.parse(value)
  return Number.isFinite(epoch) ? { epoch, value, dateOnly: isDateOnly } : null
}

function sourceFields(record) {
  const source = record.source
  const sourceName = clean(typeof source === 'string' ? source : source?.name ?? source?.provider ?? record.sourceName ?? record.provider)
  const verified = record.verified === true
    || record.isVerified === true
    || record.verificationStatus?.toLowerCase?.() === 'verified'
    || source?.verified === true
    || source?.verificationStatus?.toLowerCase?.() === 'verified'
  const rawUrl = typeof source === 'object' ? source?.url ?? record.sourceUrl ?? record.sourceReference : record.sourceUrl ?? record.sourceReference
  let sourceUrl = null
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol === 'https:') sourceUrl = parsed.href
  } catch { /* Source attribution remains text when no safe HTTPS URL exists. */ }
  return { sourceName, verified, sourceUrl }
}

function unwrapRows(response) {
  const value = response?.data
  if (Array.isArray(value)) return value
  if (Array.isArray(value?.observations)) return value.observations
  if (Array.isArray(value?.prices)) return value.prices
  if (Array.isArray(value?.items)) return value.items
  if (Array.isArray(response?.observations)) return response.observations
  throw new Error('The market price endpoint returned an unsupported response shape. No observations were displayed.')
}

function normalizeObservation(record, now) {
  const commodityValue = record?.commodity ?? record?.produce ?? record?.crop
  const commodity = clean(typeof commodityValue === 'object' ? commodityValue?.name : commodityValue)
    || clean(record?.commodityName ?? record?.produceName)
  const marketValue = record?.market ?? record?.location
  const market = clean(typeof marketValue === 'object' ? marketValue?.name ?? marketValue?.marketName : marketValue)
    || clean(record?.marketName ?? record?.marketLocation)
  const rawPrice = record?.price ?? record?.priceValue ?? record?.amount
  const currency = clean(record?.currency ?? record?.priceCurrency).toUpperCase()
  const rawUnit = clean(record?.unit ?? record?.measurementUnit).toLowerCase().replace(/\s+/g, ' ')
  const unit = UNIT_ALIASES[rawUnit]
  const unitLabel = clean(record?.unitLabel) || unit
  const priceType = ['wholesale', 'retail'].includes(record?.priceType) ? record.priceType : null
  const timestamp = normalizeTimestamp(record?.observedAt ?? record?.observed_at ?? record?.observedOn ?? record?.date)
  const { sourceName, verified, sourceUrl } = sourceFields(record ?? {})

  if (!commodity) return { error: 'Missing commodity identifier.' }
  if (!market) return { error: 'Missing market location.' }
  if (typeof rawPrice !== 'number' || !Number.isFinite(rawPrice) || rawPrice <= 0) return { error: 'Price must be a positive finite number.' }
  if (!/^[A-Z]{3}$/.test(currency)) return { error: 'Missing or invalid ISO currency code.' }
  if (!unit) return { error: `Unsupported measurement unit: ${rawUnit || 'missing'}.` }
  if (!timestamp) return { error: 'Missing or invalid observation date and time.' }
  if (!sourceName) return { error: 'Missing data source attribution.' }
  if (!verified) return { error: 'Source verification was not confirmed by the API.' }
  if (timestamp.epoch > now + FUTURE_CLOCK_SKEW_MS) return { error: 'Observation timestamp is in the future.' }

  const stale = now - timestamp.epoch > MARKET_OBSERVATION_MAX_AGE_MS
  const identity = [commodity, market, timestamp.value, unit, currency, priceType ?? ''].map((value) => value.toLowerCase()).join('|')
  return {
    observation: {
      id: String(record.id ?? record._id ?? identity),
      commodity,
      market,
      price: rawPrice,
      currency,
      unit: unitLabel,
      unitCode: unit,
      priceType,
      observedAt: timestamp.value,
      dateOnly: timestamp.dateOnly,
      sourceName,
      sourceUrl,
      verificationStatus: 'verified',
      freshness: stale ? 'stale' : 'fresh',
    },
    identity,
  }
}

/** Fetch and validate only source-attributed, explicitly verified observations. */
export async function fetchMarketObservations({ now = Date.now(), limit = 100 } = {}) {
  const response = await marketIntelligence.prices({ limit })
  const rows = unwrapRows(response)
  const observations = []
  const seen = new Set()
  const rejectedReasons = {}
  let duplicateCount = 0

  for (const row of rows) {
    const result = normalizeObservation(row, now)
    if (result.error) {
      rejectedReasons[result.error] = (rejectedReasons[result.error] ?? 0) + 1
      continue
    }
    if (seen.has(result.identity)) {
      duplicateCount += 1
      continue
    }
    seen.add(result.identity)
    observations.push(result.observation)
  }

  observations.sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt))
  return {
    observations,
    receivedCount: rows.length,
    rejectedCount: Object.values(rejectedReasons).reduce((sum, count) => sum + count, 0),
    rejectedReasons,
    duplicateCount,
    fetchedAt: new Date(now).toISOString(),
    endpoint: '/market-intelligence/prices',
  }
}
