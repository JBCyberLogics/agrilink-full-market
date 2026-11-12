import { AI_CAPABILITIES } from './config.js'

export const AI_DIAGNOSTIC_FEATURES = Object.freeze([
  { id: AI_CAPABILITIES.AGRICULTURAL_ASSISTANT, name: 'Agricultural Assistant', role: 'Shared' },
  { id: AI_CAPABILITIES.MARKET_ADVISOR, name: 'AI Market Advisor', role: 'Shared' },
  { id: AI_CAPABILITIES.RECOMMENDATIONS_CENTER, name: 'Recommendations Center', role: 'Shared' },
  { id: AI_CAPABILITIES.CROP_ADVISOR, name: 'AI Crop Advisor', role: 'Farmer' },
  { id: AI_CAPABILITIES.PRICE_ADVISOR, name: 'AI Price Advisor', role: 'Farmer' },
  { id: AI_CAPABILITIES.LISTING_ASSISTANT, name: 'AI Listing Assistant', role: 'Farmer' },
  { id: AI_CAPABILITIES.MATCHING_ASSISTANT, name: 'AI Matching Assistant', role: 'Farmer' },
  { id: AI_CAPABILITIES.HARVEST_ADVISOR, name: 'AI Harvest Advisor', role: 'Farmer' },
  { id: AI_CAPABILITIES.NET_PROFIT_ADVISOR, name: 'AI Net Profit Advisor', role: 'Farmer' },
  { id: AI_CAPABILITIES.PRODUCE_FINDER, name: 'AI Produce Finder', role: 'Buyer' },
  { id: AI_CAPABILITIES.SUPPLIER_ADVISOR, name: 'AI Supplier Advisor', role: 'Buyer' },
  { id: AI_CAPABILITIES.PURCHASE_ASSISTANT, name: 'AI Purchase Assistant', role: 'Buyer' },
])

export const AI_PROVIDER_DIAGNOSTIC_CONTRACT = Object.freeze({
  path: '/admin/ai/providers/:id/diagnostics',
  requiredPermission: 'ai.configure',
  owner: 'AgriLink Control',
  liveInferenceRequiresExplicitConfirmation: true,
})

/** Farmer/Buyer tools cannot query Admin-only provider credentials or diagnostics. */
export async function checkProviderConnection() {
  return {
    status: 'BLOCKED',
    error: 'Provider diagnostics are restricted to AgriLink Control. No request was sent.',
  }
}
