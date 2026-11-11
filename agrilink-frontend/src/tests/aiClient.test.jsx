import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ requestRaw: vi.fn() }))

const config = vi.hoisted(() => ({
  AI_CONFIG: { proxyUrl: 'https://agrilink-proxy.test/ai', timeoutMs: 10 },
  AI_CAPABILITY_LIST: ['shared/agricultural-assistant'],
}))

vi.mock('../ai/config.js', () => config)
vi.mock('../services/api/client.js', () => api)
vi.mock('../ai/schemas.js', () => ({
  validateAIRequest: vi.fn(),
  validateAIResponse: (_capability, data) => {
    if (!data || typeof data.content !== 'string') throw new Error('Invalid response contract')
    return data
  },
}))

import { requestAI } from '../ai/client.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
})
beforeEach(() => vi.clearAllMocks())

describe('AI client backend contract', () => {
  it('sends a session-authenticated capability request and validates the returned payload', async () => {
    api.requestRaw.mockResolvedValue({
      success: true,
      data: { capability: 'shared/agricultural-assistant', data: { content: 'Response from an isolated backend fixture.' }, meta: { provider: 'nvidia', model: 'test-model' } },
    })
    const result = await requestAI('shared/agricultural-assistant', { message: 'Test request' })
    expect(api.requestRaw).toHaveBeenCalledWith('/ai/shared/agricultural-assistant', expect.objectContaining({
      method: 'POST',
      body: { message: 'Test request' },
    }))
    expect(result).toMatchObject({ ok: true, data: { content: 'Response from an isolated backend fixture.' }, meta: { provider: 'nvidia', model: 'test-model' } })
  })

  it('surfaces provider proxy rate limits and retry metadata without retrying in the browser', async () => {
    api.requestRaw.mockRejectedValue({ status: 429, code: 'RATE_LIMITED', error: 'Slow down', retryAfter: '7', details: { retryAfter: '7' } })
    const result = await requestAI('shared/agricultural-assistant', { message: 'Test request' })
    expect(result).toMatchObject({ ok: false, code: 'AI_RATE_LIMITED', status: 429, details: { retryAfter: '7' } })
    expect(api.requestRaw).toHaveBeenCalledOnce()
  })

  it('rejects invalid response shapes and capability mismatches', async () => {
    api.requestRaw.mockResolvedValueOnce({ success: true, data: { capability: 'shared/agricultural-assistant', data: {} } })
    await expect(requestAI('shared/agricultural-assistant', { message: 'Test request' })).resolves.toMatchObject({ ok: false, code: 'AI_REQUEST_FAILED' })
    api.requestRaw.mockResolvedValueOnce({ success: true, data: { capability: 'buyer/produce-finder', data: { content: 'wrong' } } })
    await expect(requestAI('shared/agricultural-assistant', { message: 'Test request' })).resolves.toMatchObject({ ok: false, code: 'AI_RESPONSE_MISMATCH' })
  })

  it('reports proxy network failures and request timeouts', async () => {
    api.requestRaw.mockRejectedValueOnce(new TypeError('offline'))
    await expect(requestAI('shared/agricultural-assistant', { message: 'Test request' })).resolves.toMatchObject({ ok: false, code: 'AI_NETWORK_ERROR' })

    vi.useFakeTimers()
    api.requestRaw.mockImplementationOnce((_path, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    }))
    const pending = requestAI('shared/agricultural-assistant', { message: 'Test request' })
    await vi.advanceTimersByTimeAsync(11)
    await expect(pending).resolves.toMatchObject({ ok: false, code: 'AI_REQUEST_TIMEOUT' })
  })
})
