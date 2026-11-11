import { users, purchaseRequests } from '../../../services/api/endpoints.js'
import { savedListings, toggleSaved } from '../../marketplace/services/marketplaceService.js'

/** Fetch the authenticated buyer profile; never substitute a mock account. */
export const buyerProfile = async () => {
  const response = await users.myProfile()
  const user = response?.user ?? response?.data?.user ?? response?.data ?? response
  if (!user || typeof user !== 'object') throw { error: 'The server returned an invalid buyer profile.' }
  return {
    user: {
      id: user._id ?? user.id,
      name: user.fullName ?? user.name ?? '',
      email: user.email ?? '',
      role: 'Buyer',
      image: user.image ?? null,
      memberSince: user.createdAt ?? user.created_at ?? null,
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
