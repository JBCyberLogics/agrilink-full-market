/**
 * Farmer service — profile, produce listing management and photo upload,
 * connected to the /api/v1 backend through the shared SDK.
 */
import { products, purchaseRequests, users } from '../../../services/api/endpoints.js'
import { API_BASE_CONFIGURED, request } from '../../../services/api/client.js'
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

export async function farmerProfile() {
  const u = (await users.myProfile()) ?? {}
  return {
    user: {
      id: u._id ?? u.id,
      name: u.fullName || u.name || '',
      email: u.email,
      role: 'Farmer',
      memberSince: u.createdAt,
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
  if (!url) throw { status: res.status, error: 'Upload succeeded but no image link was returned.', field: 'image' }
  return { url }
}
