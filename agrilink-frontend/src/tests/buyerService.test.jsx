import { beforeEach, describe, expect, it, vi } from 'vitest'

const purchaseApi = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), cancel: vi.fn() }))
vi.mock('../services/api/endpoints.js', () => ({
  users: { myProfile: vi.fn() },
  purchaseRequests: purchaseApi,
  products: {}, categories: {}, favorites: {},
}))
vi.mock('../features/marketplace/services/marketplaceService.js', () => ({ savedListings: vi.fn().mockResolvedValue([]), toggleSaved: vi.fn() }))
import { buyerCancelRequest, buyerCreateRequest, buyerRequests } from '../features/buyer/services/buyerService.js'

describe('buyer purchase requests use the backend service contract', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns only records from the authenticated request endpoint', async () => {
    purchaseApi.list.mockResolvedValue({ data: [{ id: 'request-test-fixture', status: 'open' }] })
    await expect(buyerRequests()).resolves.toEqual({ requests: [{ id: 'request-test-fixture', status: 'open' }] })
    expect(purchaseApi.list).toHaveBeenCalledOnce()
  })

  it('returns the persisted request response from create', async () => {
    purchaseApi.create.mockResolvedValue({ id: 'request-test-fixture', status: 'open' })
    await expect(buyerCreateRequest({ productId: 'product-test-fixture', quantity: 4 })).resolves.toEqual({ request: { id: 'request-test-fixture', status: 'open' } })
  })

  it('sends cancellation through the ownership-checked endpoint', async () => {
    purchaseApi.cancel.mockResolvedValue({ cancelled: true })
    await expect(buyerCancelRequest('request-test-fixture')).resolves.toEqual({ cancelled: true })
    expect(purchaseApi.cancel).toHaveBeenCalledWith('request-test-fixture')
  })
})
