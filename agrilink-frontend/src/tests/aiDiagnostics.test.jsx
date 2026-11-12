import { describe, expect, it } from 'vitest'
import { vi } from 'vitest'

const api = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('../services/api/client.js', () => ({ API_BASE: 'http://localhost:4300/api/v1', API_BASE_CONFIGURED: true, request: api.request }))

import { AI_DIAGNOSTIC_FEATURES, AI_PROVIDER_DIAGNOSTIC_CONTRACT, checkProviderConnection } from '../ai/diagnostics.js'
import { runAlgorithmSmokeTest } from '../ai/algorithmDiagnostics.js'

describe('AI diagnostics contracts', () => {
  it('registers each of the twelve independent AI capabilities', () => {
    expect(AI_DIAGNOSTIC_FEATURES).toHaveLength(12)
    expect(new Set(AI_DIAGNOSTIC_FEATURES.map((feature) => feature.id)).size).toBe(12)
    expect(AI_PROVIDER_DIAGNOSTIC_CONTRACT.owner).toBe('AgriLink Control')
    expect(AI_PROVIDER_DIAGNOSTIC_CONTRACT.requiredPermission).toBe('ai.configure')
  })

  it('keeps provider diagnostics out of the Farmer/Buyer session realm', async () => {
    const result = await checkProviderConnection()
    expect(result.status).toBe('BLOCKED')
    expect(result.error).toMatch(/AgriLink Control/i)
    expect(api.request).not.toHaveBeenCalled()
  })

  it('marks live inference as requiring explicit Admin confirmation', () => {
    expect(AI_PROVIDER_DIAGNOSTIC_CONTRACT.liveInferenceRequiresExplicitConfirmation).toBe(true)
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
