import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn() }))
vi.mock('../services/api/endpoints.js', () => ({
  products: api,
  categories: { list: vi.fn().mockResolvedValue([]) },
  favorites: { list: vi.fn().mockResolvedValue({ data: [] }), toggle: vi.fn() },
}))

import { isCompleteMarketplaceListing, marketListings, normalizeProduct } from '../features/marketplace/services/marketplaceService.js'

describe('marketplace listing data integrity', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps missing price, stock, unit and seller details unavailable', () => {
    const listing = normalizeProduct({ id: 'listing-fixture' })
    expect(listing).toMatchObject({
      id: 'listing-fixture', name: null, category: null, price: null, unit: null,
      stock: null, available: null, farmer: null, location: null,
    })
    expect(isCompleteMarketplaceListing(listing)).toBe(false)
  })

  it('normalizes an explicitly priced and stocked listing without inventing a seller badge', () => {
    const listing = normalizeProduct({
      id: 'listing-fixture', name: 'Maize', priceCents: 2500, quantityAvailable: 8,
      currency: 'KES', unit: 'kg', isAvailable: true, farmer: { fullName: 'Farm contact' },
    })
    expect(listing).toMatchObject({ name: 'Maize', price: 25, stock: 8, unit: 'kg', available: true, sellerVerified: false })
    expect(isCompleteMarketplaceListing(listing)).toBe(true)
  })

  it('withholds records missing current price or available stock from the public feed', async () => {
    api.list.mockResolvedValue({ data: [
      { id: 'complete', name: 'Maize', price: 25, stock: 8, unit: 'kg', isAvailable: true },
      { id: 'missing-price', name: 'Beans', stock: 8, unit: 'kg', isAvailable: true },
      { id: 'missing-stock', name: 'Tomatoes', price: 40, unit: 'crate', isAvailable: true },
    ], meta: { total: 3 } })

    const result = await marketListings()

    expect(result.listings.map((listing) => listing.id)).toEqual(['complete'])
    expect(result.meta).toEqual({ total: 3 })
  })
})
