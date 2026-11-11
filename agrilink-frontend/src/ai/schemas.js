import { AI_CAPABILITIES, AI_CONFIG } from './config.js'
import { AIIntegrationError } from './errors.js'

const text = { type: 'string', minLength: 1 }
const number = { type: 'number', minimum: 0 }
const positiveNumber = { type: 'number', exclusiveMinimum: 0 }
const optionalText = { type: 'string' }
const date = { type: 'string', format: 'date' }

function isCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

/** JSON-Schema-like contracts mirrored in docs/BACKEND_INTEGRATION_HANDOVER.md. */
export const AI_REQUEST_SCHEMAS = Object.freeze({
  [AI_CAPABILITIES.AGRICULTURAL_ASSISTANT]: {
    type: 'object', required: ['message'], properties: {
      message: { ...text, maxLength: AI_CONFIG.maxMessageLength },
      history: { type: 'array', maxItems: AI_CONFIG.maxConversationTurns * 2, items: { type: 'object' } },
    },
  },
  [AI_CAPABILITIES.MARKET_ADVISOR]: {
    type: 'object', required: ['produce', 'location', 'quantity', 'timePeriod'],
    properties: {
      produce: text,
      location: text,
      quantity: positiveNumber,
      timePeriod: { type: 'string', enum: ['week', 'month', 'quarter'] },
      verifiedObservations: { type: 'array', maxItems: 100, items: { type: 'object' } },
    },
  },
  [AI_CAPABILITIES.RECOMMENDATIONS_CENTER]: {
    type: 'object', required: ['role', 'produceType', 'location'],
    properties: {
      role: { type: 'string', enum: ['farmer', 'buyer'] }, produceType: text, location: text, budget: number,
      rankedCandidates: { type: 'array', maxItems: 10, items: { type: 'object' } },
    },
  },
  [AI_CAPABILITIES.CROP_ADVISOR]: {
    type: 'object', required: ['produceType', 'growingStage', 'location', 'expectedQuantity'],
    properties: { produceType: text, growingStage: text, location: text, expectedQuantity: positiveNumber, expectedHarvestDate: date },
  },
  [AI_CAPABILITIES.PRICE_ADVISOR]: {
    type: 'object', required: ['produce', 'quantity', 'qualityGrade', 'location', 'unit'],
    properties: {
      produce: text,
      quantity: positiveNumber,
      qualityGrade: text,
      location: text,
      unit: text,
      verifiedObservations: { type: 'array', maxItems: 100, items: { type: 'object' } },
    },
  },
  [AI_CAPABILITIES.LISTING_ASSISTANT]: {
    type: 'object', required: ['existingTitle', 'description'],
    properties: { existingTitle: text, description: text, qualityDetails: optionalText, quantity: optionalText, availability: optionalText },
  },
  [AI_CAPABILITIES.MATCHING_ASSISTANT]: {
    type: 'object', required: ['produceType', 'quantity', 'location', 'quality', 'availability'],
    properties: { produceType: text, quantity: positiveNumber, location: text, quality: optionalText, availability: optionalText },
  },
  [AI_CAPABILITIES.HARVEST_ADVISOR]: {
    type: 'object', required: ['produceType', 'expectedHarvestDate', 'expectedQuantity', 'location'],
    properties: {
      produceType: text, expectedHarvestDate: date, expectedQuantity: positiveNumber, location: text,
      logisticsPlan: { type: 'object' }, question: optionalText,
    },
  },
  [AI_CAPABILITIES.NET_PROFIT_ADVISOR]: {
    type: 'object', required: ['calculation'], properties: { calculation: { type: 'object' }, question: optionalText },
  },
  [AI_CAPABILITIES.PRODUCE_FINDER]: {
    type: 'object', required: ['produceType', 'requiredQuantity', 'location'],
    properties: {
      produceType: text, requiredQuantity: positiveNumber, location: text, unit: optionalText,
      qualityRequirements: optionalText, budgetRange: optionalText, requiredAvailabilityDate: date,
      rankedMatches: { type: 'array', maxItems: 10, items: { type: 'object' } }, question: optionalText,
    },
  },
  [AI_CAPABILITIES.SUPPLIER_ADVISOR]: {
    type: 'object', required: ['produceType', 'location'],
    properties: {
      produceType: text, quantity: positiveNumber, location: text, quality: optionalText, availability: optionalText,
      rankedSuppliers: { type: 'array', maxItems: 10, items: { type: 'object' } },
    },
  },
  [AI_CAPABILITIES.PURCHASE_ASSISTANT]: {
    type: 'object', required: ['produceRequirements', 'requiredQuantities', 'deliveryArea'],
    properties: {
      produceRequirements: text, requiredQuantities: positiveNumber, budget: number, purchaseDeadline: date, deliveryArea: text,
      purchasePlan: { type: 'object' }, question: optionalText,
    },
  },
})

export const AI_RESPONSE_SCHEMAS = Object.freeze({
  [AI_CAPABILITIES.AGRICULTURAL_ASSISTANT]: { requiredAnyString: ['content', 'message', 'reply'] },
  [AI_CAPABILITIES.MARKET_ADVISOR]: { requiredStrings: ['summary'], optionalArrays: ['factors', 'recommendedActions'] },
  [AI_CAPABILITIES.RECOMMENDATIONS_CENTER]: { requiredStrings: ['summary'], optionalArrays: ['items', 'categories'] },
  [AI_CAPABILITIES.CROP_ADVISOR]: { requiredStrings: ['summary'], optionalArrays: ['nextSteps'] },
  [AI_CAPABILITIES.PRICE_ADVISOR]: { requiredNumbers: ['suggestedMinPrice', 'suggestedMaxPrice'], optionalArrays: ['factors'] },
  [AI_CAPABILITIES.LISTING_ASSISTANT]: { requiredStrings: ['improvedTitle', 'improvedDescription'], optionalArrays: ['suggestions'] },
  [AI_CAPABILITIES.MATCHING_ASSISTANT]: { requiredArrays: ['matches'] },
  [AI_CAPABILITIES.HARVEST_ADVISOR]: { requiredStrings: ['timeline'], optionalArrays: ['checklist'] },
  [AI_CAPABILITIES.NET_PROFIT_ADVISOR]: { requiredStrings: ['summary'], optionalArrays: ['actions'] },
  [AI_CAPABILITIES.PRODUCE_FINDER]: { requiredArrays: ['matches'], optionalStrings: ['summary'] },
  [AI_CAPABILITIES.SUPPLIER_ADVISOR]: { requiredStrings: ['summary'], optionalArrays: ['suppliers'] },
  [AI_CAPABILITIES.PURCHASE_ASSISTANT]: { requiredStrings: ['summary'], optionalArrays: ['checklist', 'shortlist'] },
})

function isValidType(value, schema) {
  if (schema.type === 'string') {
    if (typeof value !== 'string') return false
    if (schema.minLength && value.trim().length < schema.minLength) return false
    if (schema.maxLength && value.length > schema.maxLength) return false
    if (schema.format === 'date' && value && !isCalendarDate(value)) return false
    if (schema.enum && !schema.enum.includes(value)) return false
    return true
  }
  if (schema.type === 'number') return Number.isFinite(value) && value >= (schema.minimum ?? -Infinity) && (schema.exclusiveMinimum === undefined || value > schema.exclusiveMinimum)
  if (schema.type === 'array') return Array.isArray(value) && (schema.maxItems === undefined || value.length <= schema.maxItems)
  if (schema.type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value)
  return true
}

export function validateAIRequest(capability, payload) {
  const schema = AI_REQUEST_SCHEMAS[capability]
  if (!schema) throw new AIIntegrationError(`Unknown AI capability: ${capability}`, { code: 'AI_UNKNOWN_CAPABILITY' })
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AIIntegrationError('The AI request must be an object.', { code: 'AI_INVALID_REQUEST' })
  }
  for (const key of schema.required) {
    const value = payload[key]
    if (value === undefined || value === null || value === '') {
      throw new AIIntegrationError(`Missing required AI request field: ${key}.`, { code: 'AI_INVALID_REQUEST', details: { field: key } })
    }
  }
  for (const [key, fieldSchema] of Object.entries(schema.properties)) {
    if (payload[key] !== undefined && payload[key] !== null && !isValidType(payload[key], fieldSchema)) {
      throw new AIIntegrationError(`Invalid AI request field: ${key}.`, { code: 'AI_INVALID_REQUEST', details: { field: key } })
    }
  }
  if (capability === AI_CAPABILITIES.AGRICULTURAL_ASSISTANT && Array.isArray(payload.history)) {
    const invalidTurn = payload.history.find((turn) => !turn || !['user', 'assistant'].includes(turn.role)
      || typeof turn.content !== 'string' || !turn.content.trim() || turn.content.length > AI_CONFIG.maxMessageLength)
    if (invalidTurn) {
      throw new AIIntegrationError('Chat history must contain bounded user or assistant messages.', { code: 'AI_INVALID_REQUEST', details: { field: 'history' } })
    }
  }
  return payload
}

export function validateAIResponse(capability, data) {
  const schema = AI_RESPONSE_SCHEMAS[capability]
  if (!schema || !data || typeof data !== 'object' || Array.isArray(data)) {
    throw new AIIntegrationError('The AI service returned an invalid response object.', { code: 'AI_INVALID_RESPONSE' })
  }
  if (schema.requiredAnyString && !schema.requiredAnyString.some((key) => typeof data[key] === 'string' && data[key].trim())) {
    throw new AIIntegrationError('The AI response is missing its text content.', { code: 'AI_INVALID_RESPONSE' })
  }
  for (const key of schema.requiredStrings ?? []) {
    if (typeof data[key] !== 'string' || !data[key].trim()) throw new AIIntegrationError(`The AI response is missing ${key}.`, { code: 'AI_INVALID_RESPONSE' })
  }
  for (const key of schema.requiredNumbers ?? []) {
    if (!Number.isFinite(data[key])) throw new AIIntegrationError(`The AI response is missing ${key}.`, { code: 'AI_INVALID_RESPONSE' })
  }
  if (capability === AI_CAPABILITIES.PRICE_ADVISOR && (data.suggestedMinPrice < 0 || data.suggestedMaxPrice < data.suggestedMinPrice)) {
    throw new AIIntegrationError('The AI response returned an invalid price range.', { code: 'AI_INVALID_RESPONSE' })
  }
  for (const key of schema.requiredArrays ?? []) {
    if (!Array.isArray(data[key])) throw new AIIntegrationError(`The AI response is missing ${key}.`, { code: 'AI_INVALID_RESPONSE' })
  }
  for (const key of schema.optionalArrays ?? []) {
    if (data[key] !== undefined && !Array.isArray(data[key])) throw new AIIntegrationError(`The AI response field ${key} must be an array.`, { code: 'AI_INVALID_RESPONSE' })
  }
  for (const key of schema.optionalStrings ?? []) {
    if (data[key] !== undefined && typeof data[key] !== 'string') throw new AIIntegrationError(`The AI response field ${key} must be a string.`, { code: 'AI_INVALID_RESPONSE' })
  }
  return data
}
