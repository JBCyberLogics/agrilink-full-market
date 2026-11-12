import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../common/auth.js';
import { requireRole } from '../common/identity.js';
import { HttpError, sendData, sendList } from '../common/http.js';
import { normalizeMatchingWeights } from '../common/algorithms.js';
import { objectId, pagination, parseBody } from '../common/validation.js';
import { Product, PurchaseRequest, Setting, User } from '../database/models.js';
import { productIsAvailable, productToApi, stockOf } from '../services/marketplace.js';
import { requirePlatformFeature } from '../services/platform-settings.js';

async function requestToApi(row: any) {
  const request = typeof row?.toObject === 'function' ? row.toObject() : row;
  const product = request.listingId ? await Product.findById(request.listingId) : null;
  const listing = product && product.isDeleted !== true ? await productToApi(product) : null;
  const status = String(request.status ?? '').toLowerCase();
  return {
    ...request,
    id: String(request._id),
    listing: listing ? {
      id: listing.id, name: listing.name, farmer: listing.farmer?.fullName ?? null,
      price: listing.price, currency: listing.currency, unit: listing.unit,
      stock: listing.stock, location: listing.location, imageUrl: listing.image,
    } : null,
    status: status === 'open' ? 'Pending' : status === 'cancelled' ? 'Cancelled' : status,
  };
}

export const purchaseRequestRouter = Router();
purchaseRequestRouter.get('/', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const { page, limit, skip } = pagination(req.query as Record<string, unknown>);
  const filter = { buyer: req.user._id };
  const [rows, total] = await Promise.all([PurchaseRequest.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), PurchaseRequest.countDocuments(filter)]);
  return sendList(res, await Promise.all(rows.map(requestToApi)), page, limit, total);
});
purchaseRequestRouter.get('/matches', requireAuth, async (req, res) => {
  requireRole(req, ['farmer']);
  const { page, limit, skip } = pagination(req.query as Record<string, unknown>);
  const input = parseBody(z.object({
    produce: z.string().trim().min(2).max(100),
    quantity: z.coerce.number().positive().max(1000000),
    unit: z.string().trim().min(1).max(30),
    location: z.string().trim().max(100).optional(),
    quality: z.string().trim().max(100).optional(),
    availability: z.string().trim().max(100).optional(),
  }), req.query);
  const ownedListingIds = await Product.find({ $or: [{ farmer: req.user._id }, { sellerId: req.user._id }], isDeleted: { $ne: true } }).distinct('_id');
  const filter: Record<string, unknown> = { status: 'open', $or: [{ listingId: { $in: ownedListingIds } }, { listingId: { $exists: false } }] };
  filter.produce = { $regex: input.produce.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' };
  const now = new Date();
  filter.$and = [{ $or: [
    { deadline: { $exists: false } }, { deadline: null },
    { deadline: { $type: 'string', $gte: now.toISOString() } },
    { deadline: { $type: 'date', $gte: now } },
  ] }];
  const rows = await PurchaseRequest.find(filter).sort({ createdAt: -1 }).limit(500);
  const setting: any = await Setting.findOne({ scope: 'algorithm.matching' });
  const weights = normalizeMatchingWeights(setting?.value?.weights ?? { price: 0.35, quality: 0.25, distance: 0.2, availability: 0.2 });
  const buyerIds = [...new Set(rows.map((row: any) => String(row.buyer)))];
  const buyers = await User.find({ _id: { $in: buyerIds } }).select('fullName firstName lastName name').lean();
  const buyerNames = new Map(buyers.map((buyer: any) => [String(buyer._id), buyer.fullName ?? buyer.name ?? [buyer.firstName, buyer.lastName].filter(Boolean).join(' ') ?? 'Buyer']));
  const matches = (await Promise.all(rows.map(async (row: any) => {
    const product = row.listingId ? await Product.findOne({ _id: row.listingId, $or: [{ farmer: req.user._id }, { sellerId: req.user._id }] }) : null;
    if (!product || !productIsAvailable(product)) return null;
    const listing = await productToApi(product);
    if (String(row.unit ?? '').trim().toLowerCase() !== String(input.unit).trim().toLowerCase()
      || String(listing.unit ?? '').trim().toLowerCase() !== String(input.unit).trim().toLowerCase()) return null;
    const available = Math.min(input.quantity, Number(listing.stock));
    const factors: Record<string, number | null> = {
      price: Number.isFinite(row.proposedPrice) && Number(row.proposedPrice) >= 0 && Number.isFinite(listing.price) && Number(listing.price) > 0
        ? Math.min(Number(row.proposedPrice) / Number(listing.price), 1) : null,
      quality: row.quality && input.quality
        ? (String(row.quality).trim().toLowerCase() === input.quality.trim().toLowerCase() ? 1 : 0) : null,
      distance: null,
      availability: Number.isFinite(Number(row.quantity)) && Number(row.quantity) > 0
        ? Math.min(available / Number(row.quantity), 1) : null,
    };
    const applicable = Object.entries(weights).filter(([key, weight]) => weight > 0 && Number.isFinite(factors[key]));
    const appliedWeight = applicable.reduce((sum, [, weight]) => sum + weight, 0);
    if (!appliedWeight) return null;
    const score = applicable.reduce((sum, [key, weight]) => sum + Number(factors[key]) * weight, 0) / appliedWeight;
    const missingFactors = Object.keys(weights).filter((key) => !Number.isFinite(factors[key]));
    const explanation = [
      `${row.quantity} ${row.unit} requested for ${row.produce}.`,
      `Your stated quantity and current listing stock cover ${Math.min(available, Number(row.quantity))} ${row.unit}.`,
      factors.price === null ? 'Price fit is unavailable without a buyer offer.' : `Price fit compares the buyer offer with the current listing price.`,
      factors.quality === null ? 'Quality fit is unavailable without both a buyer requirement and your quality input.' : 'Quality labels match the values supplied.',
      'Distance is unavailable because these records do not include verified coordinates.',
      input.location ? `Your location input: ${input.location}.` : '',
      input.availability ? `Your availability note: ${input.availability}.` : '',
    ].filter(Boolean).join(' ');
    return {
      id: String(row._id), buyerId: String(row.buyer), buyerName: buyerNames.get(String(row.buyer)) || 'Buyer',
      produce: row.produce, quantity: row.quantity, unit: row.unit, location: row.deliveryArea || 'Location not specified',
      quality: row.quality ?? null, budget: row.budget ?? null, deadline: row.deadline ?? null,
      proposedPrice: row.proposedPrice ?? null, note: row.note ?? null, createdAt: row.createdAt ?? null,
      listing: { id: listing.id, name: listing.name, price: listing.price, currency: listing.currency, unit: listing.unit, stock: listing.stock },
      matchScore: Math.round(score * 10000) / 100, scoreCoverage: Math.round(appliedWeight * 10000) / 100,
      factors, missingFactors, weights, explanation,
    };
  }))).filter(Boolean).sort((a: any, b: any) => b.matchScore - a.matchScore || b.scoreCoverage - a.scoreCoverage);
  return sendList(res, matches.slice(skip, skip + limit), page, limit, matches.length);
});
purchaseRequestRouter.post('/', requireAuth, async (req, res) => {
  await requirePlatformFeature('marketplaceEnabled');
  requireRole(req, ['buyer']);
  const listingSchema = z.object({
    listingId: z.string().min(1).max(80),
    quantity: z.coerce.number().positive().max(1000000),
    proposedPrice: z.coerce.number().positive().max(100000000).optional(),
    note: z.string().max(1000).optional().default(''),
  }).strict();
  const generalSchema = z.object({
    produce: z.string().trim().min(2).max(100),
    quantity: z.coerce.number().positive().max(1000000),
    unit: z.string().trim().min(1).max(30),
    deliveryArea: z.string().trim().min(2).max(100),
    quality: z.string().trim().max(100).optional(),
    budget: z.coerce.number().positive().optional(),
    deadline: z.string().datetime().optional(),
  }).strict();
  const body = parseBody(z.union([listingSchema, generalSchema]), req.body);
  let requestData: Record<string, unknown>;
  if ('listingId' in body) {
    const product = await Product.findById(objectId(body.listingId, 'listingId'));
    if (!product || !productIsAvailable(product)) throw new HttpError(409, 'This listing is no longer available for requests.', 'PRODUCT_UNAVAILABLE');
    const stock = stockOf(product);
    if (stock === null || body.quantity > stock) throw new HttpError(422, 'Requested quantity exceeds the current available stock.', 'REQUEST_QUANTITY_EXCEEDS_STOCK', 'quantity', { available: stock });
    const normalized = await productToApi(product);
    requestData = {
      listingId: product._id, produce: normalized.name, quantity: body.quantity,
      unit: normalized.unit, deliveryArea: normalized.location ?? '',
      proposedPrice: body.proposedPrice, note: body.note,
    };
  } else requestData = body;
  const row = await PurchaseRequest.create({ buyer: req.user._id, ...requestData, status: 'open', createdAt: new Date(), updatedAt: new Date() });
  return sendData(res, await requestToApi(row), 201);
});
purchaseRequestRouter.post('/:id/cancel', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const id = objectId(req.params.id);
  const row = await PurchaseRequest.findOne({ _id: id, buyer: req.user._id });
  if (!row) throw new HttpError(404, 'Purchase request not found.', 'REQUEST_NOT_FOUND');
  if (row.status !== 'open') throw new HttpError(409, 'This purchase request can no longer be cancelled.', 'REQUEST_CANNOT_CANCEL');
  row.status = 'cancelled'; row.cancelledAt = new Date(); await row.save();
  return sendData(res, { id: String(row._id), status: 'Cancelled' });
});
purchaseRequestRouter.patch('/:id/cancel', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const id = objectId(req.params.id);
  const row = await PurchaseRequest.findOne({ _id: id, buyer: req.user._id });
  if (!row) throw new HttpError(404, 'Purchase request not found.', 'REQUEST_NOT_FOUND');
  if (row.status !== 'open') throw new HttpError(409, 'This purchase request can no longer be cancelled.', 'REQUEST_CANNOT_CANCEL');
  row.status = 'cancelled'; row.cancelledAt = new Date(); await row.save();
  return sendData(res, { id: String(row._id), status: 'Cancelled' });
});

export const adminPurchaseRequestRouter = Router();
adminPurchaseRequestRouter.get('/', requirePermission('users.read'), async (req, res) => {
  const { page, limit, skip } = pagination(req.query as Record<string, unknown>);
  const [rows, total] = await Promise.all([PurchaseRequest.find({}).sort({ createdAt: -1 }).skip(skip).limit(limit), PurchaseRequest.countDocuments({})]);
  return sendList(res, rows.map((r) => ({ id: String(r._id), ...r.toObject() })), page, limit, total);
});
