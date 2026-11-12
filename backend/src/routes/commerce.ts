import { createHash, randomBytes } from 'node:crypto';
import { Router, type Response } from 'express';
import { Types } from 'mongoose';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../common/auth.js';
import { writeAudit } from '../common/audit.js';
import { requireRole, normalizeRole, displayUser } from '../common/identity.js';
import { HttpError, logCheckoutDiagnostic, sendData, sendList } from '../common/http.js';
import { objectId, pagination, parseBody } from '../common/validation.js';
import { CartItem, IdempotencyKey, Order, Product, Report, User } from '../database/models.js';
import { cartRowToApi, ownerIdOf, priceCentsOf, productIsAvailable, stockOf, stockFieldOf } from '../services/marketplace.js';
import { productToApi } from '../services/marketplace.js';
import { createInAppNotification } from '../services/notifications.js';
import { requirePlatformFeature } from '../services/platform-settings.js';

export const cartRouter = Router();
export const checkoutRouter = Router();
export const orderRouter = Router();

const cartOwnerFilter = (userId: unknown) => ({ $or: [{ customerId: userId }, { userId }] });

cartRouter.get('/', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const rows = await CartItem.find(cartOwnerFilter(req.user._id)).sort({ createdAt: 1 });
  return sendData(res, { items: await Promise.all(rows.map(cartRowToApi)) });
});
async function addToCart(req: any, res: any) {
  await requirePlatformFeature('marketplaceEnabled');
  requireRole(req, ['buyer']);
  const body = parseBody(z.object({ productId: z.string().min(1), quantity: z.coerce.number().int().positive().max(100000) }), req.body);
  const productId = objectId(body.productId, 'productId');
  const product = await Product.findById(productId);
  if (!product || !productIsAvailable(product)) throw new HttpError(404, 'This listing is not available.', 'PRODUCT_UNAVAILABLE');
  const stock = stockOf(product);
  const current = await CartItem.findOne({ customerId: req.user._id, productId });
  const nextQuantity = Number(current?.quantity ?? 0) + body.quantity;
  if (stock === null || nextQuantity > stock) throw new HttpError(409, 'The requested quantity is not available.', 'INSUFFICIENT_STOCK', 'quantity', { available: stock });
  const priceCents = priceCentsOf(product);
  const sellerId = ownerIdOf(product);
  const saved = await CartItem.findOneAndUpdate(
    { customerId: req.user._id, productId },
    { $set: { customerId: req.user._id, userId: req.user._id, productId, sellerId, shopId: product.shopId ?? null, quantity: nextQuantity, price: priceCents / 100, priceCents, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } },
    { upsert: true, returnDocument: 'after', runValidators: true },
  );
  return sendData(res, await cartRowToApi(saved), 200, 'Cart updated.');
}
cartRouter.post(['/create-cart', '/'], requireAuth, addToCart);
cartRouter.patch('/items/:productId', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const productId = objectId(req.params.productId, 'productId');
  const body = parseBody(z.object({ quantity: z.coerce.number().int().positive().max(100000) }), req.body);
  const product = await Product.findById(productId);
  if (!product || !productIsAvailable(product)) throw new HttpError(409, 'This listing is not available.', 'PRODUCT_UNAVAILABLE');
  const stock = stockOf(product);
  if (stock === null || body.quantity > stock) throw new HttpError(409, 'The requested quantity is not available.', 'INSUFFICIENT_STOCK', 'quantity', { available: stock });
  const row = await CartItem.findOneAndUpdate(
    { customerId: req.user._id, productId },
    { $set: { quantity: body.quantity, price: priceCentsOf(product) / 100, priceCents: priceCentsOf(product), sellerId: ownerIdOf(product), updatedAt: new Date() } },
    { returnDocument: 'after' },
  );
  if (!row) throw new HttpError(404, 'Cart item not found.', 'CART_ITEM_NOT_FOUND');
  return sendData(res, await cartRowToApi(row));
});
cartRouter.patch('/:id/quantity/increment', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const row = await CartItem.findOne({ _id: objectId(req.params.id), ...cartOwnerFilter(req.user._id) });
  if (!row) throw new HttpError(404, 'Cart item not found.', 'CART_ITEM_NOT_FOUND');
  const product = await Product.findById(row.productId);
  const stock = product ? stockOf(product) : null;
  if (!product || stock === null || Number(row.quantity) >= stock) throw new HttpError(409, 'The requested quantity is not available.', 'INSUFFICIENT_STOCK');
  row.quantity = Number(row.quantity) + 1;
  row.price = priceCentsOf(product) / 100; row.priceCents = priceCentsOf(product);
  await row.save();
  return sendData(res, await cartRowToApi(row));
});
cartRouter.patch('/:id/quantity/decrement', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const row = await CartItem.findOne({ _id: objectId(req.params.id), ...cartOwnerFilter(req.user._id) });
  if (!row) throw new HttpError(404, 'Cart item not found.', 'CART_ITEM_NOT_FOUND');
  row.quantity = Math.max(0, Number(row.quantity) - 1);
  if (row.quantity === 0) await CartItem.deleteOne({ _id: row._id });
  else await row.save();
  return sendData(res, { id: String(row._id), quantity: row.quantity, removed: row.quantity === 0 });
});
cartRouter.delete('/:id', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const result = await CartItem.deleteOne({ _id: objectId(req.params.id), ...cartOwnerFilter(req.user._id) });
  if (!result.deletedCount) throw new HttpError(404, 'Cart item not found.', 'CART_ITEM_NOT_FOUND');
  return sendData(res, { removed: true });
});
cartRouter.delete('/items/:productId',requireAuth,async(req,res)=>{requireRole(req,['buyer']);const productId=objectId(req.params.productId,'productId');const result=await CartItem.deleteOne({customerId:req.user._id,productId});if(!result.deletedCount)throw new HttpError(404,'Cart item not found.','CART_ITEM_NOT_FOUND');return sendData(res,{removed:true,productId:String(productId)});});
cartRouter.delete('/', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const result = await CartItem.deleteMany(cartOwnerFilter(req.user._id));
  return sendData(res, { cleared: true, removedCount: result.deletedCount ?? 0 });
});

const addressSchema = z.object({
  phone_number: z.string().trim().min(7).max(24),
  address_line1: z.string().trim().min(3).max(200),
  address_line2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(2).max(100),
  state_code: z.string().trim().min(2).max(100),
  postal_code: z.string().trim().min(3).max(20),
  country_code: z.string().trim().length(2).default('KE'),
});
const orderKey = (userId: unknown, key: string) => createHash('sha256').update(String(userId) + ':' + key).digest('hex');
const idempotencyObjectId = (key: string) => new Types.ObjectId(key.slice(0, 24));
const addressHash = (address: unknown) => createHash('sha256').update(JSON.stringify(address)).digest('hex');

function newOrderNumber() {
  return 'AL-' + Date.now().toString(36).toUpperCase() + '-' + randomBytes(4).toString('hex').toUpperCase();
}
function normalizeLegacyAddress(order: any) {
  if (order.deliveryAddress) return order.deliveryAddress;
  const keys = ['phone_number', 'address_line1', 'address_line2', 'city', 'state_code', 'postal_code', 'country_code'];
  const address = Object.fromEntries(keys.filter((key) => order[key] !== undefined && order[key] !== null).map((key) => [key, order[key]]));
  return Object.keys(address).length ? address : null;
}
export async function orderToApi(input: any) {
  const order = typeof input?.toObject === 'function' ? input.toObject() : input;
  const legacy = Array.isArray(order.productList);
  const itemsRaw = legacy ? order.productList : Array.isArray(order.items) ? order.items : [];
  const items = await Promise.all(itemsRaw.map(async (item: any) => {
    const productId = item.product ?? item.productId ?? item._id;
    const product = productId && Types.ObjectId.isValid(String(productId)) ? await Product.findById(productId) : null;
    const rawPrice = Number(item.price);
    const unitPriceCents = Number.isFinite(item.unitPriceCents) && Number(item.unitPriceCents) > 0
      ? Number(item.unitPriceCents)
      : Number.isFinite(rawPrice) && rawPrice > 0 ? Math.round(rawPrice * 100) : null;
    const quantity = Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0 ? Number(item.quantity) : null;
    const subtotalCents = Number.isFinite(item.subtotalCents) && Number(item.subtotalCents) >= 0
      ? Number(item.subtotalCents)
      : unitPriceCents !== null && quantity !== null ? unitPriceCents * quantity : null;
    return {
      product: product ? { _id: String(product._id), name: product.name, measurementUnit: product.unit ?? product.measurementUnit } : item.product ?? item.productId ?? null,
      productId: product ? String(product._id) : String(productId ?? ''),
      name: item.name ?? product?.name ?? null,
      quantity,
      unit: item.unit ?? product?.unit ?? product?.measurementUnit ?? null,
      unitPriceCents,
      price: unitPriceCents === null ? null : unitPriceCents / 100,
      subtotalCents,
    };
  }));
  const buyerId = order.buyer ?? order.customerId;
  const farmerId = order.farmer ?? order.sellerId;
  const subtotalCents = Number.isFinite(order.subtotalCents) ? Number(order.subtotalCents)
    : Number.isFinite(Number(order.totalAmount)) && order.totalAmount !== null && order.totalAmount !== undefined ? Math.round(Number(order.totalAmount) * 100) : null;
  const deliveryFeeCents = Number.isFinite(order.deliveryFeeCents) ? Number(order.deliveryFeeCents) : null;
  const totalCents = Number.isFinite(order.totalCents) ? Number(order.totalCents)
    : subtotalCents !== null && deliveryFeeCents !== null ? subtotalCents + deliveryFeeCents : null;
  const [buyer, farmer] = await Promise.all([
    buyerId ? User.findById(buyerId) : null,
    farmerId ? User.findById(farmerId) : null,
  ]);
  return {
    _id: String(order._id), id: String(order._id),
    orderNumber: order.orderNumber ?? String(order._id),
    buyer: buyer ? { id: String(buyer._id), name: displayUser(buyer).fullName } : buyerId ? String(buyerId) : null,
    farmer: farmer ? { id: String(farmer._id), name: displayUser(farmer).fullName } : farmerId ? String(farmerId) : null,
    customerId: buyerId ? String(buyerId) : null,
    sellerId: farmerId ? String(farmerId) : null,
    items, orderItems: items,
    subtotalCents, deliveryFeeCents, totalCents,
    totalAmount: totalCents === null ? null : totalCents / 100, currency: order.currency ?? null,
    deliveryAddress: normalizeLegacyAddress(order),
    deliveryStage: order.status ?? order.deliveryStage ?? null,
    status: order.status ?? order.deliveryStage ?? null,
    paymentStatus: order.paymentStatus ?? null,
    createdAt: order.createdAt ?? order.orderDate ?? null,
    statusHistory: Array.isArray(order.statusHistory) ? order.statusHistory : [],
  };
}

/** Serialize the actual order document created in the committed transaction,
 * without secondary User/Product reads. This is only used if post-commit reads
 * fail, so a persisted checkout is not turned into a misleading generic 500. */
function orderSnapshotToApi(input: any) {
  const order = typeof input?.toObject === 'function' ? input.toObject() : input;
  const rawItems = Array.isArray(order.items) ? order.items : Array.isArray(order.productList) ? order.productList : [];
  const items = rawItems.map((item: any) => {
    const productId = item.product ?? item.productId ?? item._id;
    const cents = Number.isFinite(Number(item.unitPriceCents)) && Number(item.unitPriceCents) > 0
      ? Number(item.unitPriceCents)
      : Number.isFinite(Number(item.price)) && Number(item.price) > 0 ? Math.round(Number(item.price) * 100) : null;
    const quantity = Number.isFinite(Number(item.quantity)) && Number(item.quantity) > 0 ? Number(item.quantity) : null;
    const subtotalCents = Number.isFinite(Number(item.subtotalCents))
      ? Number(item.subtotalCents)
      : cents !== null && quantity !== null ? cents * quantity : null;
    return {
      product: productId ? { _id: String(productId), name: item.name ?? null, measurementUnit: item.unit ?? null } : null,
      productId: productId ? String(productId) : '',
      name: item.name ?? null,
      quantity,
      unit: item.unit ?? null,
      unitPriceCents: cents,
      price: cents === null ? null : cents / 100,
      subtotalCents,
    };
  });
  const buyerId = order.buyer ?? order.customerId;
  const farmerId = order.farmer ?? order.sellerId;
  const subtotalCents = Number.isFinite(Number(order.subtotalCents)) ? Number(order.subtotalCents) : null;
  const deliveryFeeCents = Number.isFinite(Number(order.deliveryFeeCents)) ? Number(order.deliveryFeeCents) : null;
  const totalCents = Number.isFinite(Number(order.totalCents)) ? Number(order.totalCents)
    : subtotalCents !== null && deliveryFeeCents !== null ? subtotalCents + deliveryFeeCents : null;
  return {
    _id: String(order._id), id: String(order._id),
    orderNumber: order.orderNumber ?? String(order._id),
    buyer: buyerId ? String(buyerId) : null,
    farmer: farmerId ? String(farmerId) : null,
    customerId: buyerId ? String(buyerId) : null,
    sellerId: farmerId ? String(farmerId) : null,
    items, orderItems: items,
    subtotalCents, deliveryFeeCents, totalCents,
    totalAmount: totalCents === null ? null : totalCents / 100,
    currency: order.currency ?? null,
    deliveryAddress: normalizeLegacyAddress(order),
    deliveryStage: order.status ?? order.deliveryStage ?? null,
    status: order.status ?? order.deliveryStage ?? null,
    paymentStatus: order.paymentStatus ?? null,
    createdAt: order.createdAt ?? order.orderDate ?? null,
    statusHistory: Array.isArray(order.statusHistory) ? order.statusHistory : [],
  };
}

checkoutRouter.use((_req, res, next) => {
  res.locals.checkoutDiagnostics = {
    stage: 'authentication',
    transactionOutcome: 'not_started',
    idempotencyOutcome: 'not_checked',
  };
  next();
});

function checkoutStage(res: Response, stage: string) {
  if (res.locals.checkoutDiagnostics) res.locals.checkoutDiagnostics.stage = stage;
}

checkoutRouter.post('/', requireAuth, async (req, res) => {
  checkoutStage(res, 'platform_feature_check');
  await requirePlatformFeature('marketplaceEnabled');
  checkoutStage(res, 'buyer_authorization');
  requireRole(req, ['buyer']);
  checkoutStage(res, 'request_validation');
  const address = parseBody(addressSchema, req.body?.address ?? req.body);
  const clientKey = String(req.get('idempotency-key') ?? '').trim();
  if (clientKey.length < 16 || clientKey.length > 128) throw new HttpError(400, 'Checkout requires an Idempotency-Key header.', 'IDEMPOTENCY_KEY_REQUIRED');
  const key = orderKey(req.user._id, clientKey);
  const idempotencyId = idempotencyObjectId(key);
  const bodyHash = addressHash(address);
  checkoutStage(res, 'idempotency_lookup');
  res.locals.checkoutDiagnostics.idempotencyOutcome = 'lookup_started';
  const prior = await IdempotencyKey.findOne({ _id: idempotencyId, userId: req.user._id });
  if (prior) {
    res.locals.checkoutDiagnostics.idempotencyOutcome = 'existing_record_replay';
    res.locals.checkoutDiagnostics.transactionOutcome = 'previously_committed';
    if (prior.bodyHash !== bodyHash) throw new HttpError(409, 'This checkout key was already used with different delivery details.', 'IDEMPOTENCY_CONFLICT');
    const ids = prior.response?.orderIds ?? [];
    try {
      checkoutStage(res, 'idempotent_order_read');
      const rows = await Order.find({ _id: { $in: ids } });
      checkoutStage(res, 'idempotent_response_serialization');
      const apiOrders = await Promise.all(rows.map(orderToApi));
      checkoutStage(res, 'response_sent');
      logCheckoutDiagnostic(res, 'checkout_replayed');
      return sendData(res, { orders: apiOrders, idempotentReplay: true });
    } catch (error) {
      logCheckoutDiagnostic(res, 'checkout_committed_response_unavailable', error);
      throw new HttpError(503, 'This checkout was already committed, but its order details are temporarily unavailable. Check your orders before trying again.', 'CHECKOUT_COMMITTED_RESULT_UNAVAILABLE');
    }
  }

  checkoutStage(res, 'transaction_session_start');
  const session = await (await import('mongoose')).default.startSession();
  let orderIds: string[] = [];
  let createdFresh = false;
  let committedOrderSnapshots: any[] = [];
  let responseDetailsDegraded = false;
  try {
    res.locals.checkoutDiagnostics.transactionOutcome = 'in_progress';
    res.locals.checkoutDiagnostics.idempotencyOutcome = 'new_key';
    checkoutStage(res, 'transaction_cart_read');
    await session.withTransaction(async () => {
      orderIds = [];
      createdFresh = false;
      committedOrderSnapshots = [];
      checkoutStage(res, 'transaction_idempotency_check');
      const repeated = await IdempotencyKey.findOne({ _id: idempotencyId, userId: req.user._id }).session(session);
      if (repeated) {
        if (repeated.bodyHash !== bodyHash) throw new HttpError(409, 'This checkout key was already used with different delivery details.', 'IDEMPOTENCY_CONFLICT');
        orderIds = repeated.response?.orderIds ?? [];
        res.locals.checkoutDiagnostics.idempotencyOutcome = 'concurrent_replay';
        return;
      }
      checkoutStage(res, 'transaction_cart_read');
      const cartRows = await CartItem.find(cartOwnerFilter(req.user._id)).session(session);
      if (!cartRows.length) throw new HttpError(409, 'Your cart is empty.', 'CART_EMPTY');
      const grouped = new Map<string, any>();
      for (const cart of cartRows) {
        checkoutStage(res, 'listing_validation');
        if (!Types.ObjectId.isValid(String(cart.productId ?? ''))) {
          throw new HttpError(409, 'A listing in your cart is no longer available.', 'PRODUCT_UNAVAILABLE');
        }
        const product = await Product.findById(cart.productId).session(session);
        if (!product || !productIsAvailable(product)) throw new HttpError(409, 'A listing in your cart is no longer available.', 'PRODUCT_UNAVAILABLE');
        const quantity = Number(cart.quantity);
        if (!Number.isInteger(quantity) || quantity < 1) throw new HttpError(409, 'A cart quantity is invalid.', 'INVALID_CART_QUANTITY');
        const stock = stockOf(product);
        const stockField = stockFieldOf(product);
        if (stock === null || quantity > stock) throw new HttpError(409, 'A listing no longer has the requested quantity.', 'INSUFFICIENT_STOCK', undefined, { productId: String(product._id), available: stock });
        const farmerId = ownerIdOf(product);
        if (!farmerId || !Types.ObjectId.isValid(String(farmerId))) throw new HttpError(409, 'A listing has no valid farmer record.', 'PRODUCT_OWNER_UNAVAILABLE');
        const price = priceCentsOf(product);
        if (!stockField) throw new HttpError(409, 'A listing does not have verifiable stock.', 'PRODUCT_STOCK_UNAVAILABLE');
        checkoutStage(res, 'inventory_reservation');
        const set: Record<string, unknown> = { [stockField]: stock - quantity, updatedAt: new Date() };
        const stockFilter: Record<string, unknown> = { _id: product._id, [stockField]: product[stockField] };
        const changed = await Product.updateOne(stockFilter, { $set: set }, { session });
        if (changed.modifiedCount !== 1) throw new HttpError(409, 'Stock changed while checking out. Review your cart and try again.', 'STOCK_CHANGED');
        const ownerKey = String(farmerId);
        const line = {
          product: product._id, name: product.name, quantity,
          unit: product.unit ?? product.measurementUnit,
          unitPriceCents: price, subtotalCents: price * quantity, stockField,
        };
        const group = grouped.get(ownerKey) ?? { farmer: new Types.ObjectId(ownerKey), items: [], subtotalCents: 0 };
        group.items.push(line); group.subtotalCents += line.subtotalCents; grouped.set(ownerKey, group);
      }
      const docs = [...grouped.values()].map((group) => ({
        orderNumber: newOrderNumber(),
        buyer: req.user._id, customerId: req.user._id,
        farmer: group.farmer, sellerId: group.farmer,
        items: group.items, subtotalCents: group.subtotalCents,
        deliveryFeeCents: 0, totalCents: group.subtotalCents, currency: 'KES',
        deliveryMethod: 'buyer_arranged',
        deliveryAddress: address,
        status: 'pending', paymentStatus: 'pending',
        stockReserved: true,
        statusHistory: [{ status: 'pending', at: new Date(), by: req.user._id }],
        createdAt: new Date(), updatedAt: new Date(),
      }));
      checkoutStage(res, 'order_persistence');
      const created = await Order.create(docs, { session });
      orderIds = created.map((order: any) => String(order._id));
      createdFresh = true;
      committedOrderSnapshots = created.map((order: any) => order.toObject());
      checkoutStage(res, 'cart_clear');
      await CartItem.deleteMany(cartOwnerFilter(req.user._id), { session });
      checkoutStage(res, 'idempotency_persistence');
      await IdempotencyKey.create([{
        _id: idempotencyId, key, userId: req.user._id, bodyHash, response: { orderIds },
        createdAt: new Date(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }], { session });
      res.locals.checkoutDiagnostics.idempotencyOutcome = 'record_staged';
    });
    res.locals.checkoutDiagnostics.transactionOutcome = 'committed';
    if (res.locals.checkoutDiagnostics.idempotencyOutcome === 'record_staged') {
      res.locals.checkoutDiagnostics.idempotencyOutcome = 'record_committed';
    }
  } catch (error: any) {
    const unknownCommit = typeof error?.hasErrorLabel === 'function'
      ? error.hasErrorLabel('UnknownTransactionCommitResult')
      : Array.isArray(error?.errorLabels) && error.errorLabels.includes('UnknownTransactionCommitResult');
    res.locals.checkoutDiagnostics.transactionOutcome = unknownCommit ? 'unknown_commit_result' : 'aborted';
    if (res.locals.checkoutDiagnostics.idempotencyOutcome === 'record_staged') {
      res.locals.checkoutDiagnostics.idempotencyOutcome = unknownCommit ? 'commit_unknown' : 'rolled_back';
    }
    if (error?.code === 11000) {
      checkoutStage(res, 'duplicate_key_resolution');
      const repeated = await IdempotencyKey.findOne({ _id: idempotencyId, userId: req.user._id });
      if (repeated?.bodyHash === bodyHash) {
        orderIds = repeated.response?.orderIds ?? [];
        createdFresh = false;
        committedOrderSnapshots = [];
        res.locals.checkoutDiagnostics.transactionOutcome = 'duplicate_request_not_committed';
        res.locals.checkoutDiagnostics.idempotencyOutcome = 'replayed_after_duplicate';
      }
      else throw new HttpError(409, 'This checkout key conflicts with an earlier request.', 'IDEMPOTENCY_CONFLICT');
    } else throw error;
  } finally {
    try {
      await session.endSession();
    } catch (error) {
      const diagnostics = res.locals.checkoutDiagnostics;
      const previousStage = diagnostics.stage;
      diagnostics.stage = 'transaction_session_cleanup';
      logCheckoutDiagnostic(res, 'checkout_session_cleanup_failed', error);
      diagnostics.stage = previousStage;
    }
  }

  let rows: any[];
  try {
    checkoutStage(res, 'post_commit_order_read');
    rows = await Order.find({ _id: { $in: orderIds } });
    if (!rows.length && committedOrderSnapshots.length) {
      rows = committedOrderSnapshots;
      responseDetailsDegraded = true;
    }
    if (!rows.length && orderIds.length) throw new Error('Committed checkout order records were not returned.');
  } catch (error) {
    logCheckoutDiagnostic(res, 'checkout_committed_order_read_failed', error);
    if (createdFresh && committedOrderSnapshots.length) {
      rows = committedOrderSnapshots;
      responseDetailsDegraded = true;
    }
    else throw new HttpError(503, 'Your checkout was already committed, but its order details are temporarily unavailable. Check your orders before trying again.', 'CHECKOUT_COMMITTED_RESULT_UNAVAILABLE');
  }

  if (createdFresh) {
    checkoutStage(res, 'post_commit_notifications');
    const notificationResults = await Promise.allSettled(rows.flatMap((order: any) => {
      const orderNumber = String(order.orderNumber ?? order._id);
      return [
        createInAppNotification(order.buyer ?? order.customerId, 'order', 'Order placed', `Your order ${orderNumber} was created.`, { orderId: String(order._id), status: order.status }),
        createInAppNotification(order.farmer ?? order.sellerId, 'order', 'New order', `Order ${orderNumber} has been placed.`, { orderId: String(order._id), status: order.status }),
      ];
    }));
    for (const result of notificationResults) {
      if (result.status === 'rejected') logCheckoutDiagnostic(res, 'checkout_post_commit_notification_failed', result.reason);
    }
  }

  checkoutStage(res, 'post_commit_audit');
  try {
    await writeAudit({ actor: req.user._id, action: 'checkout.completed', resource: 'order', metadata: { orderCount: rows.length } });
  } catch (error) {
    logCheckoutDiagnostic(res, 'checkout_post_commit_audit_failed', error);
  }

  checkoutStage(res, 'response_serialization');
  try {
    const apiOrders = await Promise.all(rows.map(orderToApi));
    checkoutStage(res, 'response_sent');
    logCheckoutDiagnostic(res, createdFresh ? 'checkout_completed' : 'checkout_replayed');
    return sendData(res, {
      orders: apiOrders,
      idempotentReplay: !createdFresh,
      ...(responseDetailsDegraded ? { responseDetailsDegraded: true } : {}),
    }, createdFresh ? 201 : 200, createdFresh ? 'Order created.' : 'Existing order returned.');
  } catch (error) {
    logCheckoutDiagnostic(res, 'checkout_post_commit_serialization_failed', error);
    if (createdFresh && committedOrderSnapshots.length) {
      checkoutStage(res, 'response_sent_from_committed_snapshot');
      logCheckoutDiagnostic(res, 'checkout_completed_degraded');
      return sendData(res, { orders: committedOrderSnapshots.map(orderSnapshotToApi), idempotentReplay: false, responseDetailsDegraded: true }, 201, 'Order created. Some details could not be refreshed.');
    }
    throw new HttpError(503, 'Your checkout was already committed, but its order details are temporarily unavailable. Check your orders before trying again.', 'CHECKOUT_COMMITTED_RESULT_UNAVAILABLE');
  }
});

orderRouter.post('/create-order', requireAuth, async (_req, _res, next) => {
  next(new HttpError(410, 'Use the checkout endpoint with an Idempotency-Key header.', 'CHECKOUT_ENDPOINT_CHANGED'));
});
orderRouter.get('/', requireAuth, async (req, res) => {
  const role = normalizeRole(req.user.role);
  const ownerFilter = role === 'buyer'
    ? { $or: [{ buyer: req.user._id }, { customerId: req.user._id }] }
    : role === 'farmer' ? { $or: [{ farmer: req.user._id }, { sellerId: req.user._id }] } : null;
  if (!ownerFilter) throw new HttpError(403, 'Farmer or buyer access is required.', 'FORBIDDEN');
  const { page, limit, skip } = pagination(req.query as Record<string, unknown>);
  const [rows, total] = await Promise.all([
    Order.find(ownerFilter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Order.countDocuments(ownerFilter),
  ]);
  return sendList(res, await Promise.all(rows.map(orderToApi)), page, limit, total);
});
orderRouter.get('/:id', requireAuth, async (req, res) => {
  const order = await Order.findById(objectId(req.params.id));
  if (!order) throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
  const role = normalizeRole(req.user.role);
  const owner = role === 'buyer'
    ? String(order.buyer ?? order.customerId) === String(req.user._id)
    : role === 'farmer' ? String(order.farmer ?? order.sellerId) === String(req.user._id) : false;
  if (!owner) throw new HttpError(403, 'You cannot view this order.', 'FORBIDDEN');
  return sendData(res, await orderToApi(order));
});
orderRouter.patch('/:id/delivery-stage', requireAuth, async (req, res) => {
  requireRole(req, ['farmer']);
  const id = objectId(req.params.id);
  const body = parseBody(z.object({ stage: z.enum(['confirmed', 'packed', 'in_transit', 'out_for_delivery', 'delivered', 'ready_for_pickup']) }), req.body);
  const order = await Order.findOne({ _id: id, $or: [{ farmer: req.user._id }, { sellerId: req.user._id }] });
  if (!order) throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
  const current = String(order.status ?? order.deliveryStage ?? 'pending').toLowerCase();
  const allowed: Record<string, string[]> = {
    pending: ['confirmed', 'packed', 'ready_for_pickup'], confirmed: ['packed', 'ready_for_pickup'],
    packed: ['in_transit', 'ready_for_pickup'], in_transit: ['out_for_delivery', 'delivered'],
    out_for_delivery: ['delivered'], ready_for_pickup: ['delivered'],
  };
  if (!allowed[current]?.includes(body.stage)) throw new HttpError(409, 'This order status change is not allowed.', 'INVALID_ORDER_TRANSITION');
  order.status = body.stage; order.deliveryStage = body.stage;
  order.statusHistory = [...(Array.isArray(order.statusHistory) ? order.statusHistory : []), { status: body.stage, at: new Date(), by: req.user._id }];
  if (body.stage === 'packed' && !order.acceptedAt) order.acceptedAt = new Date();
  await order.save();
  await createInAppNotification(order.buyer ?? order.customerId, 'order', 'Order status updated', `Your order ${String(order.orderNumber ?? order._id)} is now ${body.stage.replaceAll('_',' ')}.`, { orderId: String(order._id), status: body.stage });
  await writeAudit({ actor: req.user._id, action: 'order.status_changed', resource: 'order', resourceId: String(id), metadata: { stage: body.stage } });
  return sendData(res, await orderToApi(order));
});
orderRouter.post('/:id/cancel', requireAuth, async (req, res) => {
  const role = normalizeRole(req.user.role);
  if (role !== 'buyer' && role !== 'farmer') throw new HttpError(403, 'Farmer or buyer access is required.', 'FORBIDDEN');
  const id = objectId(req.params.id);
  const session = await (await import('mongoose')).default.startSession();
  let updated: any;
  try {
    await session.withTransaction(async () => {
      const ownerFilter = role === 'buyer' ? { $or: [{ buyer: req.user._id }, { customerId: req.user._id }] } : { $or: [{ farmer: req.user._id }, { sellerId: req.user._id }] };
      const order = await Order.findOne({ _id: id, ...ownerFilter }).session(session);
      if (!order) throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
      if (!['pending', 'confirmed'].includes(String(order.status ?? '').toLowerCase()) || ['paid', 'completed', 'success'].includes(String(order.paymentStatus ?? '').toLowerCase())) {
        throw new HttpError(409, 'This order cannot be cancelled online. Contact support for payment or delivery assistance.', 'ORDER_CANNOT_CANCEL');
      }
      const items = order.stockReserved === true && Array.isArray(order.items) ? order.items : [];
      for (const item of items) {
        if (!item.product) continue;
        const product = await Product.findById(item.product).session(session);
        if (!product) continue;
        const quantity = Number(item.quantity ?? 0);
        const stockField = ['availableStock', 'quantityAvailable', 'stock', 'quantity'].includes(String(item.stockField))
          ? String(item.stockField) : stockFieldOf(product);
        if (stockField && Number.isFinite(Number(product[stockField]))) {
          await Product.updateOne({ _id: product._id }, { $set: { [stockField]: Number(product[stockField]) + quantity, updatedAt: new Date() } }, { session });
        }
      }
      order.status = 'cancelled'; order.paymentStatus = 'cancelled'; order.stockReserved = false;
      order.statusHistory = [...(Array.isArray(order.statusHistory) ? order.statusHistory : []), { status: 'cancelled', at: new Date(), by: req.user._id }];
      await order.save({ session }); updated = order;
    });
  } finally { await session.endSession(); }
  await writeAudit({ actor: req.user._id, action: 'order.cancelled', resource: 'order', resourceId: String(id) });
  return sendData(res, await orderToApi(updated));
});
orderRouter.post('/:id/return', requireAuth, async (req, res) => {
  requireRole(req, ['buyer']);
  const order = await Order.findOne({ _id: objectId(req.params.id), $or: [{ buyer: req.user._id }, { customerId: req.user._id }] });
  if (!order) throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
  const reason = parseBody(z.object({ reason: z.string().trim().min(10).max(1200) }), req.body).reason;
  const report = await Report.create({ reporter: req.user._id, order: order._id, type: 'return_request', reason, status: 'submitted', createdAt: new Date() });
  await writeAudit({ actor: req.user._id, action: 'order.return_requested', resource: 'order', resourceId: String(order._id), metadata: { reportId: String(report._id) } });
  return sendData(res, { id: String(report._id), status: 'submitted' }, 202);
});
orderRouter.delete('/:id', requireAuth, (_req, _res, next) => next(new HttpError(405, 'Orders are retained as financial records. Use the cancellation workflow where allowed.', 'ORDER_DELETE_NOT_ALLOWED')));

export const adminOrderRouter = Router();
adminOrderRouter.get('/', requirePermission('orders.read'), async (req, res) => {
  const { page, limit, skip } = pagination(req.query as Record<string, unknown>);
  const filter = req.query.status ? { status: String(req.query.status) } : {};
  const [rows, total] = await Promise.all([Order.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit), Order.countDocuments(filter)]);
  return sendList(res, await Promise.all(rows.map(orderToApi)), page, limit, total);
});
adminOrderRouter.patch('/:id/status', requirePermission('orders.manage'), async (req, res) => {
  const id = objectId(req.params.id);
  const body = parseBody(z.object({ status: z.enum(['pending', 'confirmed', 'packed', 'in_transit', 'out_for_delivery', 'ready_for_pickup', 'delivered', 'cancelled']), reason: z.string().trim().min(5).max(500) }), req.body);
  const session = await (await import('mongoose')).default.startSession();
  let updated: any;
  try {
    await session.withTransaction(async () => {
      const order = await Order.findById(id).session(session);
      if (!order) throw new HttpError(404, 'Order not found.', 'ORDER_NOT_FOUND');
      const current = String(order.status ?? order.deliveryStage ?? 'pending').toLowerCase();
      const allowed: Record<string, string[]> = {
        pending: ['confirmed', 'cancelled'], confirmed: ['packed', 'ready_for_pickup', 'cancelled'],
        packed: ['in_transit', 'ready_for_pickup'], in_transit: ['out_for_delivery', 'delivered'],
        out_for_delivery: ['delivered'], ready_for_pickup: ['delivered'],
      };
      if (current !== body.status && !allowed[current]?.includes(body.status)) throw new HttpError(409, 'This order status change is not allowed.', 'INVALID_ORDER_TRANSITION');
      if (body.status === 'cancelled' && ['paid', 'completed', 'success'].includes(String(order.paymentStatus).toLowerCase())) {
        throw new HttpError(409, 'Paid orders require the verified refund workflow.', 'REFUND_REVIEW_REQUIRED');
      }
      if (body.status === 'cancelled' && order.stockReserved === true && Array.isArray(order.items)) {
        for (const item of order.items as any[]) {
          if (!item.product) continue;
          const product = await Product.findById(item.product).session(session);
          if (!product) continue;
          const field = ['availableStock', 'quantityAvailable', 'stock', 'quantity'].includes(String(item.stockField))
            ? String(item.stockField) : stockFieldOf(product);
          if (field && Number.isFinite(Number(product[field]))) {
            await Product.updateOne({ _id: product._id }, { $set: { [field]: Number(product[field]) + Number(item.quantity ?? 0), updatedAt: new Date() } }, { session });
          }
        }
        order.stockReserved = false;
        order.paymentStatus = 'cancelled';
      }
      order.status = body.status;
      order.statusHistory = [...(Array.isArray(order.statusHistory) ? order.statusHistory : []), { status: body.status, reason: body.reason, at: new Date(), by: req.user._id }];
      await order.save({ session });
      updated = order;
    });
  } finally { await session.endSession(); }
  await writeAudit({ actor: req.user._id, action: 'admin.order_status_changed', resource: 'order', resourceId: String(id), metadata: { status: body.status, reason: body.reason } });
  return sendData(res, await orderToApi(updated));
});
