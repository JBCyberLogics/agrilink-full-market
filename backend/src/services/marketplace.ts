import { Types } from 'mongoose';
import { Category, FarmerProfile, Product, User } from '../database/models.js';
import { normalizeRole } from '../common/identity.js';
import { HttpError } from '../common/http.js';

const unavailableStatuses = new Set(['archived', 'deleted', 'inactive', 'rejected', 'sold', 'soldout', 'unavailable']);
const publishedStatuses = new Set(['active', 'available', 'published']);
export const idText = (value: any) => String(value?._id ?? value?.id ?? value ?? '');

export function priceCentsOf(product: any) {
  const cents = Number(product?.priceCents);
  if (Number.isFinite(cents) && cents > 0 && Math.round(cents) > 0) return Math.round(cents);
  const price = product.pricePerUnit ?? product.price ?? product.discountPrice;
  const amount = Number(price);
  const calculatedCents = Math.round(amount * 100);
  if (Number.isFinite(amount) && amount > 0 && calculatedCents > 0) return calculatedCents;
  throw new HttpError(409, 'This listing has no valid price.', 'PRODUCT_PRICE_UNAVAILABLE');
}
export function stockOf(product: any) {
  const field = stockFieldOf(product);
  return field ? Number(product[field]) : null;
}
export function stockFieldOf(product: any): 'availableStock' | 'quantityAvailable' | 'stock' | 'quantity' | null {
  for (const field of ['availableStock', 'quantityAvailable', 'stock', 'quantity'] as const) {
    const value = product?.[field];
    if (value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0) return field;
  }
  return null;
}
export function productIsAvailable(product: any) {
  const status = String(product.status ?? '').toLowerCase();
  let priceIsValid = false;
  try { priceCentsOf(product); priceIsValid = true; } catch { /* incomplete legacy listing */ }
  const unit = product.unit ?? product.measurementUnit;
  return product.isDeleted !== true && product.isAvailable !== false
    && product.isAvailableForSale !== false && !unavailableStatuses.has(status)
    && publishedStatuses.has(status) && priceIsValid && stockOf(product) !== null
    && Number(stockOf(product)) > 0 && typeof product.name === 'string' && product.name.trim().length > 0
    && typeof unit === 'string' && unit.trim().length > 0 && product.currency === 'KES';
}
export async function categoryIdFrom(value: unknown) {
  const text = String(value ?? '').trim();
  if (!text) throw new HttpError(422, 'Choose a produce category.', 'CATEGORY_REQUIRED', 'category');
  if (Types.ObjectId.isValid(text)) {
    const found = await Category.findById(text);
    if (found && found.isActive !== false) return found._id;
  }
  const found = await Category.findOne({ name: { $regex: '^' + escapeRegex(text) + '$', $options: 'i' }, isActive: { $ne: false } });
  if (!found) throw new HttpError(422, 'This category is not available. Choose a listed category.', 'CATEGORY_NOT_FOUND', 'category');
  return found._id;
}
function escapeRegex(text: string) {
  return text.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

export async function productToApi(input: any) {
  const product = typeof input?.toObject === 'function' ? input.toObject() : input;
  const sellerId = product.farmer ?? product.sellerId ?? product.seller ?? product.user;
  const seller = sellerId && typeof sellerId === 'object' && sellerId.fullName
    ? sellerId : sellerId ? await User.findById(sellerId) : null;
  const categoryId = product.category?._id ?? product.category;
  const category = product.category && typeof product.category === 'object' && product.category.name
    ? product.category : Types.ObjectId.isValid(String(categoryId)) ? await Category.findById(categoryId) : null;
  let priceCents: number | null = null;
  try { priceCents = priceCentsOf(product); } catch { /* incomplete legacy listings remain visibly incomplete */ }
  const stock = stockOf(product);
  const status = typeof product.status === 'string' ? product.status.toLowerCase() : null;
  const sellerName = seller ? seller.fullName ?? seller.name ?? null : null;
  const farmerProfile: any = sellerId ? await FarmerProfile.findOne({ user: sellerId }).select('privacyPreferences').lean() : null;
  const privacy = farmerProfile?.privacyPreferences ?? {};
  const exposeName = privacy.showSellerName !== false;
  const exposeLocation = privacy.showLocation !== false;
  const exposeContact = privacy.shareContactInformation === true;
  const available = productIsAvailable(product) && priceCents !== null && stock !== null && stock > 0;
  return {
    _id: String(product._id), id: String(product._id),
    name: product.name ?? product.title ?? null,
    description: product.description ?? '',
    category: category ? { _id: String(category._id), id: String(category._id), name: category.name } : product.cropType ?? null,
    cropType: product.cropType ?? null, variety: product.variety ?? null,
    qualityGrade: product.qualityGrade ?? null, farmingMethod: product.farmingMethod ?? null,
    minOrderQuantity: product.minimumOrderQuantity ?? product.minOrderQuantity ?? null,
    organicClaim: product.organicClaim ?? null, status, priceCents,
    price: priceCents === null ? null : priceCents / 100,
    pricePerUnit: priceCents === null ? null : priceCents / 100, currency: product.currency ?? null,
    unit: product.unit ?? product.measurementUnit ?? null,
    measurementUnit: product.unit ?? product.measurementUnit ?? null,
    stock, quantityAvailable: stock, availableStock: stock,
    isAvailable: available,
    isAvailableForSale: available,
    images: Array.isArray(product.images) ? product.images : product.image ? [product.image] : [],
    image: Array.isArray(product.images) ? (product.images[0] ?? null) : product.image ?? null,
    farmer: seller ? { _id: idText(seller), id: idText(seller), fullName: exposeName ? sellerName : null, verified: seller.isVerified === true || seller.verificationStatus === 'verified', ...(exposeContact ? { contactInformation: { email: seller.email ?? null, phone: seller.phone ?? null } } : {}) } : null,
    seller: seller ? { _id: idText(seller), id: idText(seller), fullName: exposeName ? sellerName : null, verified: seller.isVerified === true || seller.verificationStatus === 'verified', ...(exposeContact ? { contactInformation: { email: seller.email ?? null, phone: seller.phone ?? null } } : {}) } : null,
    sellerId: seller ? idText(seller) : sellerId ? idText(sellerId) : null,
    location: exposeLocation ? product.marketLocation ?? product.town ?? product.county ?? seller?.county ?? null : null,
    county: exposeLocation ? product.county ?? seller?.county ?? null : null,
    createdAt: product.createdAt ?? null, updatedAt: product.updatedAt ?? null,
  };
}
export function ownerIdOf(product: any) {
  return product.farmer ?? product.sellerId ?? product.seller ?? product.user ?? null;
}
export async function requireOwnedProduct(id: unknown, user: any) {
  if (!Types.ObjectId.isValid(String(id ?? ''))) throw new HttpError(400, 'The listing identifier is invalid.', 'INVALID_ID');
  const product = await Product.findById(id);
  if (!product || product.isDeleted === true) throw new HttpError(404, 'Listing not found.', 'PRODUCT_NOT_FOUND');
  if (String(ownerIdOf(product)) !== String(user._id)) throw new HttpError(403, 'You cannot change another farmer’s listing.', 'FORBIDDEN');
  if (normalizeRole(user.role) !== 'farmer') throw new HttpError(403, 'Farmer access is required.', 'FORBIDDEN');
  return product;
}
export async function cartRowToApi(row: any) {
  const item = typeof row?.toObject === 'function' ? row.toObject() : row;
  const product = item.product ?? await Product.findById(item.productId);
  const quantity = Number.isFinite(Number(item.quantity)) ? Number(item.quantity) : null;
  if (!product) return { id: String(item._id), productId: String(item.productId), name: 'Listing details unavailable', quantity, qty: quantity, unavailable: true };
  const normalized = await productToApi(product);
  return {
    id: String(item._id), _id: String(item._id), productId: String(product._id), product: normalized,
    name: normalized.name, price: normalized.price, priceCents: normalized.priceCents,
    unit: normalized.unit, image: normalized.image, stock: normalized.stock,
    quantity, qty: quantity,
    unavailable: !normalized.isAvailable || normalized.priceCents === null || normalized.stock === null || !normalized.unit || !normalized.currency,
  };
}
