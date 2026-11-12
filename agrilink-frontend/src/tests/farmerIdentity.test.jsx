import { afterEach, describe, expect, it, vi } from 'vitest'
import { users } from '../services/api/endpoints.js'
import { farmerProfile } from '../features/farmer/services/farmerService.js'

afterEach(() => vi.restoreAllMocks())

describe('Farmer profile identity', () => {
  it('normalizes the server-returned Farmer identity from the self-profile envelope', async () => {
    vi.spyOn(users, 'myProfile').mockResolvedValue({
      user: { id: 'farmer-id', fullName: 'Verified Test Farmer', email: 'farmer@example.invalid', role: 'seller', createdAt: '2026-01-01T00:00:00.000Z' },
    })

    await expect(farmerProfile()).resolves.toMatchObject({
      user: { id: 'farmer-id', name: 'Verified Test Farmer', email: 'farmer@example.invalid', role: 'Farmer' },
    })
  })

  it('rejects an administrator identity instead of adapting it into a Farmer profile', async () => {
    vi.spyOn(users, 'myProfile').mockResolvedValue({
      user: { id: 'admin-id', fullName: 'Private Administrator', email: 'admin@example.invalid', role: 'super_admin' },
    })

    await expect(farmerProfile()).rejects.toMatchObject({ status: 403, code: 'SESSION_REALM_MISMATCH' })
  })
})
