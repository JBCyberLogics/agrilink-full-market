import { request } from '../services/api/client.js'
import { AI_CAPABILITIES, AI_CONFIG } from './config.js'

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

export const NVIDIA_STATUS_CONTRACT = Object.freeze({
  method: 'POST',
  path: '/admin/ai/diagnostics',
  requiredResponse: { available: true, provider: 'nvidia', responseValidated: true },
})

const pathIsSafe = (path) => typeof path === 'string' && path.startsWith('/') && !path.startsWith('//')

/**
 * Ask a proposed authenticated backend diagnostics endpoint to verify NVIDIA
 * connectivity. This frontend never calls NVIDIA directly or sees its key.
 */
export async function checkNvidiaConnection() {
  if (!AI_CONFIG.proxyUrl) {
    return { status: 'BLOCKED', error: 'The AgriLink AI proxy URL is not configured.' }
  }
  if (!AI_CONFIG.statusEndpoint) {
    return { status: 'BLOCKED', error: 'The backend provider-status endpoint is not configured.' }
  }
  if (!pathIsSafe(AI_CONFIG.statusEndpoint)) {
    return { status: 'FAIL', error: 'The provider-status endpoint must be an API-relative path.' }
  }

  const started = performance.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), AI_CONFIG.timeoutMs)
  try {
    const response = await request(AI_CONFIG.statusEndpoint, { method: 'POST', body: {}, signal: controller.signal })
    const durationMs = Math.round(performance.now() - started)
    if (response?.provider !== 'nvidia' || response?.available !== true || response?.responseValidated !== true) {
      return { status: 'FAIL', durationMs, error: 'The backend did not confirm an active NVIDIA provider connection.' }
    }

    return {
      status: 'PASS',
      provider: 'nvidia',
      durationMs,
      checkedAt: typeof response.checkedAt === 'string' ? response.checkedAt : null,
      model: typeof response.model === 'string' ? response.model : null,
      responseValidated: true,
    }
  } catch (error) {
    const statusCode = error?.status
    const dependencyMissing = statusCode === 0 || statusCode === 401 || statusCode === 403 || statusCode === 404 || statusCode === 503
    return {
      status: dependencyMissing ? 'BLOCKED' : 'FAIL',
      durationMs: Math.round(performance.now() - started),
      error: error?.error || error?.message || 'The provider-status check failed.',
    }
  } finally {
    clearTimeout(timeout)
  }
}
