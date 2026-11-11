import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'

const api = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../services/api/client.js', () => ({ API_BASE: 'http://localhost:4300/api/v1', API_BASE_CONFIGURED: true, request: api.request }))

import { AI_DIAGNOSTIC_FEATURES, NVIDIA_STATUS_CONTRACT, checkNvidiaConnection } from '../ai/diagnostics.js'
import { runAlgorithmSmokeTest } from '../ai/algorithmDiagnostics.js'

describe('AI diagnostics contracts', () => {
  it('registers each of the twelve independent AI capabilities', () => {
    expect(AI_DIAGNOSTIC_FEATURES).toHaveLength(12)
    expect(new Set(AI_DIAGNOSTIC_FEATURES.map((feature) => feature.id)).size).toBe(12)
    expect(NVIDIA_STATUS_CONTRACT.method).toBe('POST')
  })

  it('does not claim NVIDIA connectivity when the configured provider is unavailable', async () => {
    api.request.mockRejectedValueOnce({ status: 503, error: 'Configure a base URL, model, and key before testing the provider.' })
    const result = await checkNvidiaConnection()
    expect(result.status).toBe('BLOCKED')
    expect(result.error).toMatch(/configure a base URL/i)
    expect(api.request).toHaveBeenCalledWith('/admin/ai/diagnostics', expect.objectContaining({ method: 'POST', body: {} }))
  })

  it('reports a provider diagnostic as available only after a validated backend response', async () => {
    api.request.mockResolvedValueOnce({ available: true, provider: 'nvidia', model: 'configured-test-model', responseValidated: true, checkedAt: '2026-11-06T00:00:00.000Z' })
    const result = await checkNvidiaConnection()
    expect(result).toMatchObject({ status: 'PASS', provider: 'nvidia', model: 'configured-test-model', responseValidated: true })
  })

  it('runs local algorithm checks without claiming external AI results', () => {
    for (const feature of AI_DIAGNOSTIC_FEATURES) {
      const result = runAlgorithmSmokeTest(feature.id)
      expect(['PASS', 'NOT_APPLICABLE']).toContain(result.status)
    }
    expect(runAlgorithmSmokeTest('shared/market-advisor').status).toBe('PASS')
    expect(runAlgorithmSmokeTest('farmer/listing-assistant').status).toBe('PASS')
    expect(runAlgorithmSmokeTest('farmer/matching-assistant').status).toBe('PASS')
  })
})
