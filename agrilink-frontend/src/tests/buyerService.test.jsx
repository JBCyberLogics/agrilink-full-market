import { beforeEach, describe, expect, it, vi } from 'vitest'

const purchaseApi = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), cancel: vi.fn() }))
const usersApi = vi.hoisted(() => ({ myProfile: vi.fn() }))
vi.mock('../services/api/endpoints.js', () => ({
  users: usersApi,
  purchaseRequests: purchaseApi,
  products: {}, categories: {}, favorites: {},
}))
vi.mock('../features/marketplace/services/marketplaceService.js', () => ({ savedListings: vi.fn().mockResolvedValue([]), toggleSaved: vi.fn() }))
import { buyerCancelRequest, buyerCreateRequest, buyerProfile, buyerRequests } from '../features/buyer/services/buyerService.js'

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

  it('uses the backend identity role and rejects an administrator as a buyer', async () => {
    usersApi.myProfile.mockResolvedValue({ user: { id: 'buyer-test-fixture', fullName: 'Buyer', role: 'customer' } })
    await expect(buyerProfile()).resolves.toMatchObject({ user: { id: 'buyer-test-fixture', name: 'Buyer', role: 'Buyer' } })

    usersApi.myProfile.mockResolvedValue({ user: { id: 'admin-test-fixture', fullName: 'Administrator', role: 'admin' } })
    await expect(buyerProfile()).rejects.toMatchObject({ status: 403, code: 'SESSION_REALM_MISMATCH' })
  })
})
