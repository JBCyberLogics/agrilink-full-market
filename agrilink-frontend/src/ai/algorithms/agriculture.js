import { rankByWeightedCriteria, weightedScore } from './scoring.js'

const DEFAULT_CROP_WEIGHTS = Object.freeze({ rainfall: 0.3, temperature: 0.3, soilPh: 0.25, soilType: 0.15 })

function rangeScore(value, range) {
  if (!Number.isFinite(value) || !range || (!Number.isFinite(range.min) && !Number.isFinite(range.max))) return null
  const min = Number.isFinite(range.min) ? range.min : null
  const max = Number.isFinite(range.max) ? range.max : null
  if (min !== null && max !== null && min > max) throw new RangeError('Crop suitability range minimum cannot exceed maximum.')
  if ((min === null || value >= min) && (max === null || value <= max)) return 100
  const reference = min ?? max
  const span = Math.max(min !== null && max !== null ? Math.abs(max - min) : 0, Math.abs(reference) * 0.1, 1)
  const distance = min !== null && value < min ? min - value : max !== null && value > max ? value - max : 0
  return Math.max(0, 100 - (distance / span) * 100)
}

/** Compare caller-supplied soil/climate observations against supplied crop requirements. */
export function scoreCropSuitability(crop, observations, weights = DEFAULT_CROP_WEIGHTS) {
  if (!crop || typeof crop !== 'object') throw new TypeError('A crop requirement record is required.')
  if (!observations || typeof observations !== 'object') throw new TypeError('Observation data must be an object.')
  const requirements = crop.requirements ?? {}
  const criteria = {
    rainfall: rangeScore(observations.rainfallMm, requirements.rainfallMm),
    temperature: rangeScore(observations.temperatureC, requirements.temperatureC),
    soilPh: rangeScore(observations.soilPh, requirements.soilPh),
    soilType: Array.isArray(requirements.soilTypes) && typeof observations.soilType === 'string' && observations.soilType.trim()
      ? (requirements.soilTypes.some((value) => String(value).trim().toLocaleLowerCase() === observations.soilType.trim().toLocaleLowerCase()) ? 100 : 0)
      : null,
  }
  const score = weightedScore(criteria, weights)
  const reasons = score.availableCriteria.map((key) => `${key} scored ${criteria[key].toFixed(1)} from the supplied observation and crop profile.`)
  return { crop: crop.name ?? null, criteria, ...score, reasons, nature: 'rule-based suitability score; not a trained prediction' }
}

export function rankCropSuitability(crops = [], observations = {}, weights = DEFAULT_CROP_WEIGHTS) {
  if (!Array.isArray(crops)) throw new TypeError('Crop profiles must be an array.')
  return crops.map((crop, index) => ({ crop, index, ...scoreCropSuitability(crop, observations, weights) }))
    .filter((entry) => entry.score !== null)
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage || a.index - b.index)
    .map(({ index, ...entry }, rank) => ({ ...entry, rank: rank + 1 }))
}

export const DEFAULT_CROP_SUITABILITY_WEIGHTS = DEFAULT_CROP_WEIGHTS

function validIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const date = new Date(`${value}T00:00:00.000Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null
}

/** Date-window rule using only user-supplied harvest, sales and storage data. */
export function evaluateHarvestWindow({ expectedHarvestDate, preferredWindowStart, preferredWindowEnd, storageDays = 0 } = {}) {
  const harvest = validIsoDate(expectedHarvestDate)
  const start = validIsoDate(preferredWindowStart)
  const end = validIsoDate(preferredWindowEnd)
  if (![harvest, start, end].every(Boolean) || !Number.isFinite(storageDays) || storageDays < 0) {
    return { status: 'insufficient-data', feasible: null, latestSellDate: null, reasons: ['A valid harvest date, sales-window start/end, and non-negative storage duration are required.'] }
  }
  if (end < start) return { status: 'invalid-window', feasible: null, latestSellDate: null, reasons: ['The sales-window end date must be on or after its start date.'] }
  const latestSellDate = new Date(harvest.getTime() + storageDays * 86_400_000)
  const latestSellDateText = latestSellDate.toISOString().slice(0, 10)
  if (harvest > end) return { status: 'late', feasible: false, latestSellDate: latestSellDateText, reasons: ['The expected harvest date falls after the preferred sales window.'] }
  if (latestSellDate < start) return { status: 'early', feasible: false, latestSellDate: latestSellDateText, reasons: ['The stated storage period ends before the preferred sales window starts.'] }
  if (harvest < start) return { status: 'early-with-storage', feasible: true, latestSellDate: latestSellDateText, reasons: ['The timing overlaps the preferred sales window only if the stated storage period is available.'] }
  return { status: 'within-window', feasible: true, latestSellDate: latestSellDateText, reasons: ['The expected harvest date falls within the preferred sales window.'] }
}

/** Create a logistics checklist relative to a farmer-entered harvest date. */
export function buildHarvestPlan({ expectedHarvestDate, expectedQuantity, location = '', today = new Date().toISOString().slice(0, 10) } = {}) {
  const harvest = validIsoDate(expectedHarvestDate)
  const current = validIsoDate(today)
  if (!harvest) throw new RangeError('Enter a valid expected harvest date.')
  if (!current) throw new RangeError('Current date must be a valid calendar date.')
  if (!Number.isFinite(expectedQuantity) || expectedQuantity <= 0) throw new RangeError('Expected harvest quantity must be greater than zero.')
  const daysUntilHarvest = Math.ceil((harvest.getTime() - current.getTime()) / 86_400_000)
  const milestones = [
    { daysBefore: 14, task: 'Confirm the expected quantity and quality with any buyer you have already selected.' },
    { daysBefore: 7, task: 'Arrange sorting, packaging, and transport based on the quantity you entered.' },
    { daysBefore: 1, task: 'Reconfirm collection, storage, and delivery arrangements.' },
    { daysBefore: 0, task: 'Record the actual harvested quantity and update the listing if it differs from the estimate.' },
  ]
  const checklist = milestones.map(({ daysBefore, task }) => {
    const date = new Date(harvest.getTime() - daysBefore * 86_400_000).toISOString().slice(0, 10)
    return { date, daysBefore, task, status: daysUntilHarvest < daysBefore ? 'due' : 'upcoming' }
  })
  return {
    status: daysUntilHarvest < 0 ? 'date-passed' : daysUntilHarvest === 0 ? 'harvest-day' : 'scheduled',
    expectedHarvestDate: harvest.toISOString().slice(0, 10),
    expectedQuantity,
    location: typeof location === 'string' ? location.trim() : '',
    daysUntilHarvest,
    timeline: daysUntilHarvest < 0
      ? `The entered harvest date was ${Math.abs(daysUntilHarvest)} day(s) ago. Confirm the actual harvest date before using this schedule.`
      : daysUntilHarvest === 0
        ? 'The entered harvest date is today. This schedule is based only on the date and quantity you supplied.'
        : `The entered harvest date is ${daysUntilHarvest} day(s) away. This schedule is based only on the date and quantity you supplied.` ,
    checklist,
    assumptions: [
      'This is a deterministic logistics checklist, not a crop-readiness, weather, market-demand, or price prediction.',
      'Milestone dates are planning reminders and should be adjusted to local crop and transport requirements.',
    ],
    nature: 'rule-based scheduling; not a trained prediction',
  }
}

/** Generic opportunity ranking helper retained for existing callers. */
export function rankAgriculturalOpportunities(items = [], { weights, getCriteria } = {}) {
  if (!Array.isArray(items)) throw new TypeError('Opportunities must be an array.')
  return rankByWeightedCriteria(items, { weights, getCriteria })
}
