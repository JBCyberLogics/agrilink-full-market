import { AI_CAPABILITIES } from '../config.js'
import { requestAI } from '../client.js'

export const cropAdvisor = (payload) => requestAI(AI_CAPABILITIES.CROP_ADVISOR, payload)
export const priceAdvisor = (payload) => requestAI(AI_CAPABILITIES.PRICE_ADVISOR, payload)
export const listingAssistant = (payload) => requestAI(AI_CAPABILITIES.LISTING_ASSISTANT, payload)
export const matchingAssistant = (payload) => requestAI(AI_CAPABILITIES.MATCHING_ASSISTANT, payload)
export const harvestAdvisor = (payload) => requestAI(AI_CAPABILITIES.HARVEST_ADVISOR, payload)
export const netProfitAdvisor = (payload) => requestAI(AI_CAPABILITIES.NET_PROFIT_ADVISOR, payload)
