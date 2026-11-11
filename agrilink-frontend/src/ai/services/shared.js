import { AI_CAPABILITIES } from '../config.js'
import { requestAI } from '../client.js'

export const agriculturalAssistant = (message, history = []) =>
  requestAI(AI_CAPABILITIES.AGRICULTURAL_ASSISTANT, { message, history })
export const marketAdvisor = (payload) => requestAI(AI_CAPABILITIES.MARKET_ADVISOR, payload)
export const recommendationsCenter = (payload) => requestAI(AI_CAPABILITIES.RECOMMENDATIONS_CENTER, payload)
