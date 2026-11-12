/**
 * Farmer service — profile, produce listing management and photo upload,
 * connected to the /api/v1 backend through the shared SDK.
 */
import { products, purchaseRequests, users } from '../../../services/api/endpoints.js'
import { API_BASE_CONFIGURED, request } from '../../../services/api/client.js'
import { normalizeUser } from '../../auth/services/authService.js'
import { normalizeProduct } from '../../marketplace/services/marketplaceService.js'

const unwrapList = (res) => (Array.isArray(res) ? res : res?.data ?? res?.products ?? res?.result ?? [])

export async function farmerListings() {
  const res = await products.mine()
  return { listings: unwrapList(res).map(normalizeProduct) }
}

export async function farmerBuyerMatches(input = {}) {
  const response = await purchaseRequests.matches({
    produce: input.produceType,
    quantity: Number(input.quantity),
    unit: input.unit,
    location: input.location,
    quality: input.quality,
    availability: input.availability,
  })
  return { matches: response.data ?? [], meta: response.meta ?? null }
}

export async function farmerCreateListing(data = {}) {
  const result = await products.create({
    name: data.name,
    category: data.category,
    location: data.location,
    price: Number(data.price),
    stock: Number(data.stock ?? data.quantity ?? 0),
    measurementUnit: data.unit,
    images: data.imageUrl ? [data.imageUrl] : [],
    description: data.description ?? '',
  })
  return { listing: normalizeProduct(result?.data ?? result) }
}

export async function farmerDeleteListing(id) {
  await products.remove(id)
  return { ok: true, id }
}

export async function farmerUpdateListing(id, data = {}) {
  const result = await products.update(id, {
    name: data.name,
    price: Number(data.price),
    stock: Number(data.stock),
  })
  return { listing: normalizeProduct(result?.data ?? result) }
}

export async function farmerToggleListingAvailability(id) {
  const result = await products.toggleAvailability(id)
  return { listing: normalizeProduct(result?.data ?? result) }
}

export async function farmerProfile() {
  const u = normalizeUser(await users.myProfile())
  if (!u?.id || u.role !== 'Farmer') {
    throw {
      status: 403,
      code: 'SESSION_REALM_MISMATCH',
      error: 'Sign in with a farmer account to view this profile.',
    }
  }
  return {
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      image: u.image,
      memberSince: u.raw?.createdAt ?? u.raw?.created_at ?? null,
    },
  }
}

export async function farmerUploadImage(file) {
  if (!API_BASE_CONFIGURED) {
    throw {
      status: 0,
      code: 'API_BASE_NOT_CONFIGURED',
      error: 'The AgriLink backend is not configured. Set VITE_API_BASE_URL and restart Vite before uploading images.',
      field: 'image',
    }
  }
  const fd = new FormData()
  fd.append('file', file)
  const payload = await request('/upload/image', { method: 'POST', body: fd })
  const url = payload?.url || payload?.imageUrl || payload?.image || ''
  if (!url) throw { status: 502, error: 'The backend did not return an image URL.', field: 'image' }
  return { url }
}

export async function farmerFarmProfile() {
  const result = await request('/profiles/me')
  if (result?.role !== 'Farmer') throw { status: 403, code: 'SESSION_REALM_MISMATCH', error: 'Sign in with a farmer account to manage farm details.' }
  return { exists: Boolean(result.profile), profile: result.profile ?? {} }
}

export async function farmerSaveFarmProfile(profile, exists) {
  const result = await request('/profiles/me', { method: exists ? 'PATCH' : 'POST', body: { profile } })
  if (result?.role !== 'Farmer' || !result?.profile) throw { status: 502, code: 'INVALID_PROFILE_RESPONSE', error: 'The server did not confirm the saved farm profile.' }
  return result.profile
}

export async function farmerAccountPreferences() {
  return request('/users/account-preferences')
}
