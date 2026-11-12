import { requestRaw } from '../services/api/client.js'
import { AI_CONFIG, AI_CAPABILITY_LIST } from './config.js'
import { AIIntegrationError, toAIError } from './errors.js'
import { validateAIRequest, validateAIResponse } from './schemas.js'

const capabilitySet = new Set(AI_CAPABILITY_LIST)

/**
 * Call AgriLink's AI gateway. Provider credentials are never read by this
 * module and must only be configured in the proxy's server environment.
 */
export async function requestAI(capability, request, { signal } = {}) {
  let timedOut = false
  try {
    if (!capabilitySet.has(capability)) {
      throw new AIIntegrationError(`Unknown AI capability: ${capability}`, { code: 'AI_UNKNOWN_CAPABILITY' })
    }
    validateAIRequest(capability, request)
    if (!AI_CONFIG.proxyUrl) {
      throw new AIIntegrationError(
        'AI is not connected yet. No AI response was generated. Configure the AgriLink AI proxy to enable this tool.',
        { code: 'AI_PROXY_NOT_CONFIGURED' },
      )
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, AI_CONFIG.timeoutMs)
    const relayAbort = () => controller.abort(signal?.reason)
    if (signal?.aborted) relayAbort()
    else signal?.addEventListener('abort', relayAbort, { once: true })

    try {
      const envelope = await requestRaw(`/ai/${capability}`, { method: 'POST', body: request, signal: controller.signal })
      if (envelope?.success === false) {
        const detail = envelope?.error
        const rateLimited = envelope?.status === 429
        throw new AIIntegrationError(
          envelope?.message ?? (typeof detail === 'string' ? detail : detail?.message) ?? (rateLimited ? 'The AI service is rate limited. Wait before retrying.' : 'AI proxy request failed.'),
          {
            code: rateLimited ? 'AI_RATE_LIMITED' : envelope?.code ?? detail?.code ?? 'AI_PROXY_ERROR',
            status: envelope?.status ?? 0,
            details: envelope?.details ?? null,
          },
        )
      }
      const result = envelope?.data
      if (result?.capability && result.capability !== capability) {
        throw new AIIntegrationError('The AI proxy returned a response for a different capability.', { code: 'AI_RESPONSE_MISMATCH' })
      }
      const data = validateAIResponse(capability, result?.data ?? result)
      return { ok: true, data, meta: result?.meta ?? null, conversationId: result?.conversationId ?? null }
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', relayAbort)
    }
  } catch (error) {
    const normalized = toAIError(error)
    if (timedOut) return { ok: false, error: 'The AI request timed out. Please try again.', code: 'AI_REQUEST_TIMEOUT' }
    if (signal?.aborted || error?.name === 'AbortError') return { ok: false, error: 'The AI request was cancelled.', code: 'AI_REQUEST_CANCELLED' }
    if (error instanceof TypeError) return { ok: false, error: 'Could not reach the AgriLink AI service.', code: 'AI_NETWORK_ERROR' }
    if (normalized.status === 429) return { ok: false, error: normalized.message, code: 'AI_RATE_LIMITED', status: 429, details: normalized.details }
    return { ok: false, error: normalized.message, code: normalized.code, status: normalized.status, details: normalized.details }
  }
}
