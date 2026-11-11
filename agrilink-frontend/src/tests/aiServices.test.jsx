import { beforeEach, describe, expect, it, vi } from 'vitest'

const client = vi.hoisted(() => ({ requestAI: vi.fn().mockResolvedValue({ ok: false, code: 'AI_PROXY_NOT_CONFIGURED' }) }))
vi.mock('../ai/client.js', () => client)

import { AI_CAPABILITIES as C } from '../ai/config.js'
import {
  agriculturalAssistant, cropAdvisor, harvestAdvisor, listingAssistant, marketAdvisor,
  matchingAssistant, netProfitAdvisor, priceAdvisor, produceFinder, purchaseAssistant,
  recommendationsCenter, supplierAdvisor,
} from '../ai/services/index.js'

describe('AI feature service dispatch', () => {
  beforeEach(() => client.requestAI.mockClear())

  it('routes every named capability to its matching identifier', async () => {
    const payload = { message: 'question', calculation: {}, history: [] }
    const calls = [
      [C.AGRICULTURAL_ASSISTANT, () => agriculturalAssistant(payload.message, payload.history)],
      [C.MARKET_ADVISOR, () => marketAdvisor(payload)],
      [C.RECOMMENDATIONS_CENTER, () => recommendationsCenter(payload)],
      [C.CROP_ADVISOR, () => cropAdvisor(payload)],
      [C.PRICE_ADVISOR, () => priceAdvisor(payload)],
      [C.LISTING_ASSISTANT, () => listingAssistant(payload)],
      [C.MATCHING_ASSISTANT, () => matchingAssistant(payload)],
      [C.HARVEST_ADVISOR, () => harvestAdvisor(payload)],
      [C.NET_PROFIT_ADVISOR, () => netProfitAdvisor(payload)],
      [C.PRODUCE_FINDER, () => produceFinder(payload)],
      [C.SUPPLIER_ADVISOR, () => supplierAdvisor(payload)],
      [C.PURCHASE_ASSISTANT, () => purchaseAssistant(payload)],
    ]

    for (const [, invoke] of calls) await invoke()
    expect(client.requestAI.mock.calls.map(([capability]) => capability)).toEqual(calls.map(([capability]) => capability))
    expect(client.requestAI).toHaveBeenCalledTimes(12)
  })
})
