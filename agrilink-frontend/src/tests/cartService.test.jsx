import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ cart: { clear: vi.fn() } }))
vi.mock('../services/api/endpoints.js', () => api)

import { clearServerCart } from '../features/cart/services/cartService'

describe('clearServerCart', () => {
  beforeEach(() => vi.clearAllMocks())

  it('clears the complete cart through one persistent server operation', async () => {
    api.cart.clear.mockResolvedValue({ cleared: true, removedCount: 2 })
    await expect(clearServerCart()).resolves.toEqual({ cleared: true, removedCount: 2 })
    expect(api.cart.clear).toHaveBeenCalledOnce()
  })

  it('propagates backend failure instead of reporting a cleared cart', async () => {
    api.cart.clear.mockRejectedValueOnce({ error: 'Clear failed.' })
    await expect(clearServerCart()).rejects.toMatchObject({ error: 'Clear failed.' })
    expect(api.cart.clear).toHaveBeenCalledOnce()
  })
})
