export class AIIntegrationError extends Error {
  constructor(message, { code = 'AI_REQUEST_FAILED', status = 0, details } = {}) {
    super(message)
    this.name = 'AIIntegrationError'
    this.code = code
    this.status = status
    this.details = details
  }
}

export function toAIError(error) {
  if (error instanceof AIIntegrationError) return error
  const payload = error?.details && typeof error.details === 'object' ? error.details : null
  return new AIIntegrationError(
    error?.message || error?.error || 'The AI request could not be completed.',
    { code: error?.code || payload?.code || 'AI_REQUEST_FAILED', status: error?.status || 0, details: { ...(payload?.details ?? {}), ...(error?.retryAfter ? { retryAfter: error.retryAfter } : {}) } },
  )
}
