import { users, purchaseRequests } from '../../../services/api/endpoints.js'
import { savedListings, toggleSaved } from '../../marketplace/services/marketplaceService.js'
import { normalizeUser } from '../../auth/services/authService.js'

/** Fetch the authenticated buyer profile; never substitute a mock account. */
export const buyerProfile = async () => {
  const user = normalizeUser(await users.myProfile())
  if (!user?.id || user.role !== 'Buyer') throw { status: 403, code: 'SESSION_REALM_MISMATCH', error: 'Sign in with a buyer account to view this profile.' }
  return {
    user: {
      id: user.id,
      name: user.name,
      email: user.email ?? '',
      role: user.role,
      image: user.image ?? null,
      memberSince: user.raw?.createdAt ?? user.raw?.created_at ?? null,
    },
  }
}

/** Saved items are backed by authenticated marketplace endpoints. */
export const buyerSaved = async () => ({ saved: await savedListings() })
export const buyerSave = (id) => toggleSaved(id)
export const buyerUnsave = (id) => toggleSaved(id)

export async function buyerRequests() { return { requests: (await purchaseRequests.list()).data ?? [] } }
export async function buyerCreateRequest(input) { return { request: await purchaseRequests.create(input) } }
export async function buyerCancelRequest(id) { return purchaseRequests.cancel(id) }
