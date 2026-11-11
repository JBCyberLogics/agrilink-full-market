/**
 * Marketplace service — the public produce feed from the /api/v1 backend.
 * Backend product records are normalized into the listing shape the UI
 * renders, plus the richer agricultural metadata is preserved on `raw`.
 */
import { products, categories, favorites } from '../../../services/api/endpoints.js'

const firstImage = (p) => {
  const img = Array.isArray(p.images) ? p.images[0] : p.images ?? p.image ?? p.imageUrl
  return typeof img === 'string' ? img : img?.url ?? null
}

const nameOf = (v) => (typeof v === 'string' ? v : v?.name ?? v?.title ?? '')

/* Category id -> display name. Populated once categories are fetched. */
const categoryNameCache = new Map()

export function primeCategoryNames(list = []) {
  for (const c of list) {
    const id = c._id ?? c.id
    if (id && nameOf(c)) categoryNameCache.set(String(id), nameOf(c))
  }
}

const resolveCategory = (p) => {
  // 1. populate()-style object
  if (p.category && typeof p.category === 'object') {
    return nameOf(p.category) || null
  }
  // 2. cached id -> name
  if (p.category) {
    const cached = categoryNameCache.get(String(p.category))
    if (cached) return cached
  }
  // 3. fall back to crop type, then generic
  return nameOf(p.cropType) || null
}

const resolveLocation = (p, seller) => {
  const loc = p.marketLocation ?? p.location ?? p.address ?? seller.address ?? seller.location
  if (typeof loc === 'string' && loc.trim()) return loc
  if (loc && typeof loc === 'object') {
    return loc.city ?? loc.town ?? loc.county ?? ''
  }
  // assemble from discrete fields
  const parts = [p.town, p.county].filter(Boolean)
  return parts.length ? parts.join(', ') : ''
}

const resolvePrice = (p) => {
  const candidates = [
    p.pricePerUnit,
    p.priceCents == null ? null : Number(p.priceCents) / 100,
    p.price,
    p.discountPrice,
  ]
  for (const candidate of candidates) {
    if (candidate == null || candidate === '') continue
    const value = Number(candidate)
    if (Number.isFinite(value) && value > 0) return value
  }
  return null
}

const resolveStock = (p) => {
  const candidates = [p.availableStock, p.quantityAvailable, p.stock, p.quantity, p.availableQuantity]
  for (const c of candidates) {
    if (c != null && c !== '' && Number.isFinite(Number(c)) && Number(c) >= 0) return Number(c)
  }
  return null
}

export function isCompleteMarketplaceListing(listing) {
  return Boolean(
    listing?.id &&
    typeof listing.name === 'string' && listing.name.trim() &&
    Number.isFinite(listing.price) && listing.price > 0 &&
    Number.isFinite(listing.stock) && listing.stock > 0 &&
    typeof listing.unit === 'string' && listing.unit.trim() &&
    listing.available === true,
  )
}

export const normalizeProduct = (p = {}) => {
  const seller = p.seller ?? p.sellerId ?? p.user ?? p.shop ?? {}
  return {
    id: p._id ?? p.id,
    name: p.name ?? p.title ?? null,
    description: p.description ?? '',
    category: resolveCategory(p),
    cropType: nameOf(p.cropType) || null,
    variety: p.variety ?? null,
    qualityGrade: p.qualityGrade ?? null,
    farmingMethod: p.farmingMethod ?? null,
    minOrderQuantity: p.minOrderQuantity != null ? Number(p.minOrderQuantity) : null,
    organicClaim: p.organicClaim ?? null,
    status: p.status ?? null,
    price: resolvePrice(p),
    unit: p.unit ?? p.measurementUnit ?? null,
    stock: resolveStock(p),
    available: typeof p.isAvailable === 'boolean' ? p.isAvailable : typeof p.available === 'boolean' ? p.available : null,
    imageUrl: firstImage(p),
    images: Array.isArray(p.images) ? p.images : [],
    farmer: seller.fullName ?? seller.name ?? seller.shopName ?? null,
    sellerVerified: seller.verified === true || seller.isVerified === true,
    location: resolveLocation(p, seller) || null,
    raw: p,
  }
}

/** Public feed — returns { listings, meta } */
export async function marketListings(query = { limit: 100 }) {
  const { data, meta } = await products.list(query)
  return { listings: (data ?? []).map(normalizeProduct).filter(isCompleteMarketplaceListing), meta }
}

export const marketProduct = async (id) => {
  const listing = normalizeProduct(await products.get(id))
  if (!isCompleteMarketplaceListing(listing)) throw { error: 'This listing does not have complete current price and availability details.' }
  return listing
}

export async function marketCategories() {
  const data = await categories.list()
  const list = (Array.isArray(data) ? data : data?.data ?? []).map((c) => ({
    id: c._id ?? c.id,
    name: nameOf(c),
  }))
  primeCategoryNames(list)
  return list
}

/** Favorites — the backend toggles; returns normalized saved listings */
export async function savedListings() {
  const { data } = await favorites.list({ limit: 100 })
  return (data ?? []).map((f) => normalizeProduct(f.product ?? f.productId ?? f))
}
export const toggleSaved = (productId) => favorites.toggle(productId)
