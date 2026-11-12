import { Router } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../common/auth.js';
import { writeAudit } from '../common/audit.js';
import { requireRole, normalizeRole } from '../common/identity.js';
import { HttpError, sendData, sendList } from '../common/http.js';
import { objectId, pagination, parseBody } from '../common/validation.js';
import { Category, Favorite, Order, Product, Review, User } from '../database/models.js';
import { cartRowToApi, categoryIdFrom, ownerIdOf, priceCentsOf, productIsAvailable, productToApi, requireOwnedProduct, stockOf } from '../services/marketplace.js';
import { requirePlatformFeature } from '../services/platform-settings.js';

export const productRouter = Router();
export const categoryRouter = Router();
export const favoriteRouter = Router();
export const reviewRouter = Router();

function productBaseFilter() {
  return {
    isDeleted: { $ne: true },
    status: { $in: ['active', 'available', 'published'] },
    isAvailable: { $ne: false },
    isAvailableForSale: { $ne: false },
    $and: [
      { $or: [{ name: { $type: 'string', $ne: '' } }, { title: { $type: 'string', $ne: '' } }] },
      { $or: [{ priceCents: { $gt: 0 } }, { pricePerUnit: { $gt: 0 } }, { price: { $gt: 0 } }, { discountPrice: { $gt: 0 } }] },
      { $or: [{ availableStock: { $gt: 0 } }, { quantityAvailable: { $gt: 0 } }, { stock: { $gt: 0 } }, { quantity: { $gt: 0 } }] },
      { $or: [{ unit: { $type: 'string', $ne: '' } }, { measurementUnit: { $type: 'string', $ne: '' } }] },
      { currency: 'KES' },
    ],
  };
}

productRouter.get('/', async (req, res) => {
  await requirePlatformFeature('marketplaceEnabled');
  const { page, limit, skip } = pagination(req.query as Record<string, unknown>);
  const filter: Record<string, any> = productBaseFilter();
  const search = String(req.query.search ?? req.query.q ?? '').trim().slice(0, 80);
  if (search) {
    const escaped = search.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
    filter.$or = [{ name: { $regex: escaped, $options: 'i' } }, { description: { $regex: escaped, $options: 'i' } }, { cropType: { $regex: escaped, $options: 'i' } }];
  }
  const county = String(req.query.county ?? '').trim().slice(0, 80);
  if (county) filter.county = { $regex: '^' + county.replace(/[.*+?^$()|[\]\\]/g, '\\$&') + '$', $options: 'i' };
  const category = String(req.query.category ?? '').trim();
  if (category) {
    if (Types.ObjectId.isValid(category)) filter.category = new Types.ObjectId(category);
    else {
      const found = await Category.findOne({ name: { $regex: '^' + category.replace(/[.*+?^$()|[\]\\]/g, '\\$&') + '$', $options: 'i' } });
      if (!found) return sendList(res, [], page, limit, 0);
      filter.category = found._id;
    }
  }
  const min = Number(req.query.minPrice);
  const max = Number(req.query.maxPrice);
  if (Number.isFinite(min) || Number.isFinite(max)) {
    const centsRange: Record<string, number> = {};
    const currencyRange: Record<string, number> = {};
    if (Number.isFinite(min)) { centsRange.$gte = Math.round(min * 100); currencyRange.$gte = min; }
    if (Number.isFinite(max)) { centsRange.$lte = Math.round(max * 100); currencyRange.$lte = max; }
    filter.$and!.push({ $or: [
      { priceCents: centsRange },
      { pricePerUnit: currencyRange },
      { price: currencyRange },
      { discountPrice: currencyRange },
    ] });
  }
  const sortField = ['createdAt', 'priceCents', 'name'].includes(String(req.query.sort)) ? String(req.query.sort) : 'createdAt';
  const direction = String(req.query.direction ?? '').toLowerCase() === 'asc' ? 1 : -1;
  const [rows, total] = await Promise.all([
    Product.find(filter).sort({ [sortField]: direction, _id: 1 }).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);
  const data = await Promise.all(rows.map(productToApi));
  return sendList(res, data, page, limit, total);
});

productRouter.get('/seller', requireAuth, async (req, res) => {
  requireRole(req, ['farmer']);
  const { page, limit, skip } = pagination(req.query as Record<string, unknown>);
  const filter = { $or: [{ farmer: req.user._id }, { sellerId: req.user._id }], isDeleted: { $ne: true } };
  const [rows, total] = await Promise.all([
    Product.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit),
    Product.countDocuments(filter),
  ]);
  return sendList(res, await Promise.all(rows.map(productToApi)), page, limit, total);
});
productRouter.get('/seller-required-working', requireAuth, (req, res) => {
  requireRole(req, ['farmer']);
  return sendData(res, { requiredFields: ['name', 'category', 'price', 'stock', 'measurementUnit'], uploadConfigured: true });
});
productRouter.get('/overview', requireAuth, async (req, res) => {
  const role = normalizeRole(req.user.role);
  if (role === 'farmer') {
    const [total, available, orderCount] = await Promise.all([
      Product.countDocuments({ $or: [{ farmer: req.user._id }, { sellerId: req.user._id }], isDeleted: { $ne: true } }),
      Product.countDocuments({ $or: [{ farmer: req.user._id }, { sellerId: req.user._id }], isDeleted: { $ne: true }, isAvailable: { $ne: false } }),
      Order.countDocuments({ $or: [{ farmer: req.user._id }, { sellerId: req.user._id }] }),
    ]);
    return sendData(res, { listings: total, availableListings: available, orders: orderCount });
  }
  if (role === 'buyer') {
    const orderCount = await Order.countDocuments({ $or: [{ buyer: req.user._id }, { customerId: req.user._id }] });
    return sendData(res, { orders: orderCount });
  }
  throw new HttpError(403, 'Farmer or buyer access is required.', 'FORBIDDEN');
});
productRouter.get('/best-selling', async (req, res) => {
  const limit = Math.max(1, Math.min(50, Number(req.query.limit) || 10));
  const rows = await Order.aggregate([
    { $unwind: { path: '$items', preserveNullAndEmptyArrays: false } },
    { $group: { _id: '$items.product', quantity: { $sum: '$items.quantity' }, orders: { $sum: 1 } } },
    { $sort: { quantity: -1 } }, { $limit: limit },
  ]);
  const ids = rows.map((r) => r._id).filter(Boolean);
  const products = await Product.find({ _id: { $in: ids }, isDeleted: { $ne: true } });
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const data = await Promise.all(rows.map(async (row) => {
    const product = byId.get(String(row._id));
    return product ? { ...(await productToApi(product)), unitsOrdered: row.quantity, orders: row.orders } : null;
  }));
  return sendData(res, data.filter(Boolean));
});
productRouter.post(['/create-product', '/'], requireAuth, async (req, res) => {
  await requirePlatformFeature('marketplaceEnabled');
  requireRole(req, ['farmer']);
  const body = parseBody(z.object({
    name: z.string().trim().min(2).max(120),
    category: z.union([z.string(), z.object({ id: z.string().optional(), _id: z.string().optional() })]),
    price: z.coerce.number().positive().max(100000000),
    priceCents: z.coerce.number().int().positive().optional(),
    stock: z.coerce.number().positive().max(100000000),
    quantity: z.coerce.number().positive().max(100000000).optional(),
    measurementUnit: z.string().trim().min(1).max(30),
    unit: z.string().trim().min(1).max(30).optional(),
    description: z.string().max(3000).optional().default(''),
    location: z.string().trim().max(120).optional(),
    county: z.string().trim().max(80).optional(),
    images: z.array(z.string().url().max(2048)).max(8).optional().default([]),
  }), req.body);
  const categoryId = await categoryIdFrom(typeof body.category === 'string' ? body.category : body.category.id ?? body.category._id);
  const stock = body.stock ?? body.quantity!;
  const priceCents = body.priceCents ?? Math.round(body.price * 100);
  const product = await Product.create({
    farmer: req.user._id, sellerId: req.user._id, category: categoryId,
    name: body.name, description: body.description, images: body.images,
    priceCents, pricePerUnit: priceCents / 100, currency: 'KES',
    quantityAvailable: stock, availableStock: stock, quantityReserved: 0,
    minimumOrderQuantity: 1, minOrderQuantity: 1,
    unit: body.unit ?? body.measurementUnit, measurementUnit: body.unit ?? body.measurementUnit,
    ...(body.location ? { marketLocation: body.location } : {}),
    county: body.county ?? req.user.county ?? '', status: 'active', isAvailable: true, isAvailableForSale: true,
    isDeleted: false, createdAt: new Date(), updatedAt: new Date(),
  });
  await writeAudit({ actor: req.user._id, action: 'product.created', resource: 'product', resourceId: String(product._id), metadata: { name: body.name } });
  return sendData(res, await productToApi(product), 201, 'Listing created.');
});
productRouter.get('/:id', async (req, res) => {
  await requirePlatformFeature('marketplaceEnabled');
  const id = objectId(req.params.id);
  const product = await Product.findById(id);
  if (!product || product.isDeleted === true) throw new HttpError(404, 'Listing not found.', 'PRODUCT_NOT_FOUND');
  return sendData(res, await productToApi(product));
});
productRouter.patch('/:id', requireAuth, async (req, res) => {
  const product = await requireOwnedProduct(req.params.id, req.user);
  const body = parseBody(z.object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().max(3000).optional(),
    category: z.string().optional(),
    price: z.coerce.number().positive().max(100000000).optional(),
    priceCents: z.coerce.number().int().positive().optional(),
    stock: z.coerce.number().nonnegative().max(100000000).optional(),
    quantity: z.coerce.number().nonnegative().max(100000000).optional(),
    images: z.array(z.string().url().max(2048)).max(8).optional(),
  }).strict(), req.body);
  const update: Record<string, unknown> = { updatedAt: new Date() };
  if (body.name !== undefined) update.name = body.name;
  if (body.description !== undefined) update.description = body.description;
  if (body.category !== undefined) update.category = await categoryIdFrom(body.category);
  if (body.price !== undefined || body.priceCents !== undefined) {
    const cents = body.priceCents ?? Math.round(Number(body.price) * 100);
    update.priceCents = cents; update.pricePerUnit = cents / 100;
  }
  const stock = body.stock ?? body.quantity;
  if (stock !== undefined) { update.quantityAvailable = stock; update.availableStock = stock; }
  if (body.images !== undefined) update.images = body.images;
  const saved = await Product.findByIdAndUpdate(product._id, { $set: update }, { returnDocument: 'after', runValidators: true });
  await writeAudit({ actor: req.user._id, action: 'product.updated', resource: 'product', resourceId: String(product._id), metadata: { fields: Object.keys(update) } });
  return sendData(res, await productToApi(saved));
});
productRouter.patch('/:id/toggle-availability', requireAuth, async (req, res) => {
  const product = await requireOwnedProduct(req.params.id, req.user);
  const next = !productIsAvailable(product);
  await Product.updateOne({ _id: product._id }, { $set: { isAvailable: next, isAvailableForSale: next, status: next ? 'active' : 'inactive', updatedAt: new Date() } });
  const saved = await Product.findById(product._id);
  return sendData(res, await productToApi(saved));
});
productRouter.delete('/:id', requireAuth, async (req, res) => {
  const product = await requireOwnedProduct(req.params.id, req.user);
  await Product.updateOne({ _id: product._id }, { $set: { isDeleted: true, isAvailable: false, isAvailableForSale: false, status: 'archived', archivedAt: new Date() } });
  await writeAudit({ actor: req.user._id, action: 'product.archived', resource: 'product', resourceId: String(product._id) });
  return sendData(res, { archived: true, id: String(product._id) });
});

categoryRouter.get('/', async (_req, res) => {
  const rows = await Category.find({ isActive: { $ne: false } }).sort({ name: 1 });
  return sendData(res, rows.map((x) => ({ id: String(x._id), _id: String(x._id), name: x.name, slug: x.slug, image: x.image ?? null })));
});
categoryRouter.post(['/create-category', '/'], requirePermission('marketplace.manage'), async (req, res) => {
  const body = parseBody(z.object({ name: z.string().trim().min(2).max(80), image: z.string().url().max(2048).optional() }), req.body);
  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const row = await Category.create({ name: body.name, slug, isActive: true, image: body.image, createdAt: new Date(), updatedAt: new Date() });
  await writeAudit({ actor: req.user._id, action: 'category.created', resource: 'category', resourceId: String(row._id), metadata: { name: row.name } });
  return sendData(res, { id: String(row._id), _id: String(row._id), name: row.name, slug: row.slug }, 201);
});
categoryRouter.patch('/:id', requirePermission('marketplace.manage'), async (req, res) => {
  const id = objectId(req.params.id);
  const body = parseBody(z.object({ name: z.string().trim().min(2).max(80).optional(), image: z.string().url().max(2048).nullable().optional(), isActive: z.boolean().optional() }).strict(), req.body);
  const update: Record<string, unknown> = { ...body, updatedAt: new Date() };
  if (body.name) update.slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const row = await Category.findByIdAndUpdate(id, { $set: update }, { returnDocument: 'after' });
  if (!row) throw new HttpError(404, 'Category not found.', 'CATEGORY_NOT_FOUND');
  await writeAudit({ actor: req.user._id, action: 'category.updated', resource: 'category', resourceId: String(id), metadata: { fields: Object.keys(update) } });
  return sendData(res, { id: String(row._id), _id: String(row._id), name: row.name, slug: row.slug, isActive: row.isActive !== false });
});
categoryRouter.delete('/:id', requirePermission('marketplace.manage'), async (req, res) => {
  const id = objectId(req.params.id);
  if (await Product.exists({ category: id, isDeleted: { $ne: true } })) throw new HttpError(409, 'This category still has active listings.', 'CATEGORY_IN_USE');
  await Category.updateOne({ _id: id }, { $set: { isActive: false, deactivatedAt: new Date() } });
  await writeAudit({ actor: req.user._id, action: 'category.deactivated', resource: 'category', resourceId: String(id) });
  return sendData(res, { deactivated: true, id: String(id) });
});

favoriteRouter.get('/', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const rows = await Favorite.find({ user: req.user._id }).sort({ createdAt: -1 });
  const data = await Promise.all(rows.map(async (row) => {
    const product = await Product.findById(row.product);
    return product ? { id: String(row._id), product: await productToApi(product) } : null;
  }));
  return sendData(res, data.filter(Boolean));
});
favoriteRouter.post('/', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const productId = objectId(req.body?.productId, 'productId');
  const product = await Product.findById(productId);
  if (!product || product.isDeleted === true) throw new HttpError(404, 'Listing not found.', 'PRODUCT_NOT_FOUND');
  const existing = await Favorite.findOne({ user: req.user._id, product: productId });
  if (existing) {
    await Favorite.deleteOne({ _id: existing._id });
    return sendData(res, { saved: false, productId: String(productId) });
  }
  await Favorite.create({ user: req.user._id, product: productId, createdAt: new Date() });
  return sendData(res, { saved: true, productId: String(productId) }, 201);
});

const visibleReviewFilter = (productId: Types.ObjectId) => ({ productId, isVisible: { $ne: false }, status: { $nin: ['rejected', 'hidden'] }, rating: { $gte: 1, $lte: 5 } });
async function reviewOwnerViews(rows: any[]) {
  const reviewerIds = rows.map((row) => row.reviewer).filter((id) => id && Types.ObjectId.isValid(String(id)));
  const reviewers = reviewerIds.length ? await User.find({ _id: { $in: reviewerIds } }).select('fullName firstName lastName').lean() : [];
  const byId = new Map(reviewers.map((user: any) => [String(user._id), user]));
  return rows.map((row: any) => {
    const user: any = byId.get(String(row.reviewer));
    const reviewerName = user?.fullName ?? user?.name ?? [user?.firstName, user?.lastName].filter(Boolean).join(' ') ?? null;
    return { id: String(row._id), _id: String(row._id), productId: String(row.productId), rating: Number(row.rating), comment: row.comment ?? '', reviewerName: reviewerName || null, verifiedPurchase: row.isVerifiedPurchase === true, createdAt: row.createdAt ?? null, updatedAt: row.updatedAt ?? null };
  });
}
async function deliveredOrderForBuyer(userId: Types.ObjectId, productId: Types.ObjectId) {
  return Order.findOne({ $or: [{ buyer: userId }, { customerId: userId }], status: { $in: ['delivered', 'completed'] }, 'items.product': productId }).sort({ updatedAt: -1 });
}

reviewRouter.get('/product/:id', async (req, res) => {
  const productId = objectId(req.params.id);
  const { page, limit, skip } = pagination(req.query as Record<string, unknown>);
  const filter = visibleReviewFilter(productId);
  const [rows, total] = await Promise.all([Review.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit), Review.countDocuments(filter)]);
  return sendList(res, await reviewOwnerViews(rows), page, limit, total);
});
reviewRouter.get('/product/:id/summary', async (req, res) => {
  const productId = objectId(req.params.id);
  const [summary] = await Review.aggregate([{ $match: visibleReviewFilter(productId) }, { $group: { _id: null, count: { $sum: 1 }, averageRating: { $avg: '$rating' } } }]);
  return sendData(res, { productId: String(productId), count: summary?.count ?? 0, averageRating: Number.isFinite(summary?.averageRating) ? Math.round(summary.averageRating * 10) / 10 : null });
});
reviewRouter.get('/can-review', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const productId = objectId(req.query.productId, 'productId');
  const [prior, deliveredOrder] = await Promise.all([Review.exists({ reviewer: req.user._id, productId }), deliveredOrderForBuyer(req.user._id, productId)]);
  const reason = prior ? 'already_reviewed' : !deliveredOrder ? 'no_delivered_order' : null;
  return sendData(res, { productId: String(productId), eligible: !reason, reason, orderId: deliveredOrder ? String(deliveredOrder._id) : null });
});
reviewRouter.post('/', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const body = parseBody(z.object({ productId: z.string(), rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional() }).strict(), req.body);
  const productId = objectId(body.productId, 'productId');
  const order = await deliveredOrderForBuyer(req.user._id, productId);
  if (!order) throw new HttpError(403, 'A review is available after an order containing this listing is delivered.','REVIEW_ORDER_REQUIRED');
  if (await Review.exists({ reviewer: req.user._id, productId })) throw new HttpError(409, 'You have already reviewed this listing.','REVIEW_ALREADY_EXISTS');
  let review: any;
  try { review = await Review.create({ reviewer: req.user._id, productId, orderId: order._id, rating: body.rating, comment: body.comment ?? '', isVerifiedPurchase: true, status: 'published', isVisible: true, createdAt: new Date(), updatedAt: new Date() }); }
  catch (error: any) { if (error?.code === 11000) throw new HttpError(409, 'You have already reviewed this listing.','REVIEW_ALREADY_EXISTS'); throw error; }
  return sendData(res, (await reviewOwnerViews([review]))[0], 201);
});
reviewRouter.patch('/:id', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const id = objectId(req.params.id);
  const body = parseBody(z.object({ rating: z.coerce.number().int().min(1).max(5).optional(), comment: z.string().trim().max(2000).optional() }).strict().refine((value) => Object.keys(value).length > 0), req.body);
  const review = await Review.findOneAndUpdate({ _id: id, reviewer: req.user._id }, { $set: { ...body, updatedAt: new Date() } }, { returnDocument: 'after', runValidators: true });
  if (!review) throw new HttpError(404, 'Review not found.','REVIEW_NOT_FOUND');
  return sendData(res, (await reviewOwnerViews([review]))[0]);
});
reviewRouter.delete('/:id', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const id = objectId(req.params.id);
  const result = await Review.deleteOne({ _id: id, reviewer: req.user._id });
  if (!result.deletedCount) throw new HttpError(404, 'Review not found.','REVIEW_NOT_FOUND');
  return sendData(res, { deleted: true, id: String(id) });
});
