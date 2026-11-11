/** The shared API client is the only browser route to the AI provider. */
import { API_BASE, API_BASE_CONFIGURED } from '../services/api/client.js'
const configuredProxy = API_BASE_CONFIGURED ? `${API_BASE}/ai` : ''
const configuredStatusEndpoint = API_BASE_CONFIGURED ? '/admin/ai/diagnostics' : ''

export const AI_CONFIG = Object.freeze({
  proxyUrl: configuredProxy.replace(/\/$/, ''),
  statusEndpoint: configuredStatusEndpoint,
  timeoutMs: 30_000,
  maxConversationTurns: 12,
  maxMessageLength: 4_000,
  // The backend selects the provider. The browser never chooses a vendor model.
  provider: 'server-selected',
})

export const AI_CAPABILITIES = Object.freeze({
  AGRICULTURAL_ASSISTANT: 'shared/agricultural-assistant',
  MARKET_ADVISOR: 'shared/market-advisor',
  RECOMMENDATIONS_CENTER: 'shared/recommendations-center',
  CROP_ADVISOR: 'farmer/crop-advisor',
  PRICE_ADVISOR: 'farmer/price-advisor',
  LISTING_ASSISTANT: 'farmer/listing-assistant',
  MATCHING_ASSISTANT: 'farmer/matching-assistant',
  HARVEST_ADVISOR: 'farmer/harvest-advisor',
  NET_PROFIT_ADVISOR: 'farmer/net-profit-advisor',
  PRODUCE_FINDER: 'buyer/produce-finder',
  SUPPLIER_ADVISOR: 'buyer/supplier-advisor',
  PURCHASE_ASSISTANT: 'buyer/purchase-assistant',
})

export const AI_CAPABILITY_LIST = Object.freeze(Object.values(AI_CAPABILITIES))

export function aiProxyIsConfigured() {
  return API_BASE_CONFIGURED
}
