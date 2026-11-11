/** Compatibility exports for the existing AI screens; implementation lives in src/ai. */
import { AI_CAPABILITIES } from '../ai/config.js'
import {
  agriculturalAssistant,
  cropAdvisor,
  harvestAdvisor,
  listingAssistant,
  marketAdvisor,
  matchingAssistant,
  priceAdvisor,
  produceFinder,
  purchaseAssistant,
  recommendationsCenter,
  requestAI,
  supplierAdvisor,
} from '../ai/services/index.js'

export const AI_SERVICE_NOT_CONFIGURED = 'AI is not connected yet. No AI response was generated.'
export const aiRequest = (capability, payload) => requestAI(capability, payload)

export const aiMarketAdvisor = marketAdvisor
export const aiAgriculturalAssistant = agriculturalAssistant
export const aiRecommendations = recommendationsCenter
export const aiCropInsights = cropAdvisor
export const aiPriceRecommendation = priceAdvisor
export const aiListingImprovement = listingAssistant
export const aiBuyerMatching = matchingAssistant
export const aiHarvestPlanner = harvestAdvisor
export const aiNetProfitAdvisor = (payload) => requestAI(AI_CAPABILITIES.NET_PROFIT_ADVISOR, payload)
export const aiProduceFinder = produceFinder
export const aiSupplierMatching = supplierAdvisor
export const aiPurchasePlanning = purchaseAssistant
