import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose, { Types } from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017/agrilink_test?replicaSet=agrilink-rs';
process.env.CORS_ORIGINS = 'http://localhost:5199,http://localhost:5173';
process.env.MARKETPLACE_APP_ORIGINS = 'http://localhost:5199';
process.env.ADMIN_APP_ORIGINS = 'http://localhost:5173';
process.env.USER_COOKIE_NAME = 'agrilink.checkout.test.sid';
process.env.ADMIN_COOKIE_NAME = 'agrilink.checkout.test.admin.sid';
process.env.SESSION_SECRET = 'checkout-isolated-test-session-secret-32';

const { createApp } = await import('../src/main.js');
const { connectDatabase, disconnectDatabase } = await import('../src/database/connection.js');
const { AuditLog, CartItem, IdempotencyKey, Notification, NotificationLog, Order, Product, RefreshToken, User } = await import('../src/database/models.js');
const notificationService = await import('../src/services/notifications.js');
const auditService = await import('../src/common/audit.js');
const app = createApp();
const userIds: Types.ObjectId[] = [];
const productIds: Types.ObjectId[] = [];

const checkoutAddress = {
  phone_number: '0712345678',
  address_line1: '12 River Road',
  city: 'Nairobi',
  state_code: 'Nairobi',
  postal_code: '00100',
  country_code: 'KE',
};

function setCookieHeaders(headers: string | string[] | undefined) {
  return Array.isArray(headers) ? headers : headers ? [headers] : [];
}

async function fixtureSession(role: 'buyer' | 'farmer' = 'buyer') {
  const buyerId = new Types.ObjectId();
  userIds.push(buyerId);
  const buyer = await User.create({
    _id: buyerId,
    email: `checkout-${role}-${randomUUID()}@example.invalid`,
    fullName: 'Isolated Checkout Buyer',
    role,
    isActive: true,
    isDeleted: false,
    refreshTokenVersion: 0,
  });
  const rawSession = randomBytes(48).toString('base64url');
  await RefreshToken.create({
    user: buyer._id,
    tokenHash: createHash('sha256').update(rawSession).digest('hex'),
    family: randomUUID(),
    refreshTokenVersion: 0,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    revokedAt: null,
  });

  const csrfResponse = await request(app).get('/api/v1/auth/csrf').expect(200);
  const csrfCookie = setCookieHeaders(csrfResponse.headers['set-cookie'])
    .map((cookie) => cookie.split(';', 1)[0] ?? '')
    .find((cookie) => cookie.startsWith('agrilink.csrf='));
  if (!csrfCookie) throw new Error('The test CSRF cookie was not issued.');

  return {
    buyer,
    csrf: csrfResponse.body.data.csrfToken as string,
    cookie: `${csrfCookie}; agrilink.checkout.test.sid=${rawSession}`,
  };
}

const fixtureBuyerSession = () => fixtureSession('buyer');

async function fixtureProduct(farmerId: Types.ObjectId, stock = 10) {
  if (!userIds.some((id) => id.equals(farmerId))) userIds.push(farmerId);
  await User.create({
    _id: farmerId,
    email: `checkout-farmer-${randomUUID()}@example.invalid`,
    fullName: 'Isolated Checkout Farmer',
    role: 'farmer',
    isActive: true,
    isDeleted: false,
  });
  const productId = new Types.ObjectId();
  productIds.push(productId);
  return Product.create({
    _id: productId,
    farmer: farmerId,
    sellerId: farmerId,
    name: 'Isolated test listing',
    unit: 'kg',
    currency: 'KES',
    priceCents: 12500,
    availableStock: stock,
    status: 'active',
    isAvailable: true,
    isDeleted: false,
  });
}

function submitCheckout(cookie: string, csrf: string, idempotencyKey: string) {
  return request(app)
    .post('/api/v1/checkout')
    .set('Origin', 'http://localhost:5199')
    .set('Cookie', cookie)
    .set('X-CSRF-Token', csrf)
    .set('Idempotency-Key', idempotencyKey)
    .send({ address: checkoutAddress, idempotencyKey });
}

async function cleanFixtures() {
  if (userIds.length) {
    await Promise.all([
      CartItem.deleteMany({ $or: [{ customerId: { $in: userIds } }, { userId: { $in: userIds } }] }),
      Order.deleteMany({ $or: [{ buyer: { $in: userIds } }, { customerId: { $in: userIds } }] }),
      IdempotencyKey.deleteMany({ userId: { $in: userIds } }),
      RefreshToken.deleteMany({ user: { $in: userIds } }),
      Notification.deleteMany({ $or: [{ user: { $in: userIds } }, { userId: { $in: userIds } }] }),
      NotificationLog.deleteMany({ userId: { $in: userIds } }),
      AuditLog.deleteMany({ actor: { $in: userIds } }),
    ]);
    await User.deleteMany({ _id: { $in: userIds } });
  }
  if (productIds.length) await Product.deleteMany({ _id: { $in: productIds } });
  userIds.length = 0;
  productIds.length = 0;
}

beforeAll(async () => {
  await connectDatabase(process.env.MONGODB_URI!, { test: true });
});
afterEach(cleanFixtures);
afterAll(async () => {
  await cleanFixtures();
  await disconnectDatabase();
});

describe('checkout isolated MongoDB integration', () => {
  it('persists buyer-owned orders, reserves actual stock, clears only the buyer cart, and replays idempotently', async () => {
    const { buyer, csrf, cookie } = await fixtureBuyerSession();
    const farmerId = new Types.ObjectId();
    const product: any = await fixtureProduct(farmerId, 10);
    await CartItem.create({ customerId: buyer._id, userId: buyer._id, productId: product._id, quantity: 2 });
    const idempotencyKey = randomUUID();

    const first = await submitCheckout(cookie, csrf, idempotencyKey);
    expect(first.status).toBe(201);
    expect(first.body.data.orders).toHaveLength(1);
    const returnedOrder = first.body.data.orders[0];
    expect(returnedOrder).toMatchObject({
      customerId: String(buyer._id),
      sellerId: String(farmerId),
      subtotalCents: 25000,
      totalCents: 25000,
      currency: 'KES',
      paymentStatus: 'pending',
    });

    const [savedOrder, savedProduct, buyerCart, savedKey] = await Promise.all([
      Order.findById(returnedOrder.id).lean(),
      Product.findById(product._id).lean(),
      CartItem.find({ customerId: buyer._id }).lean(),
      IdempotencyKey.findOne({ userId: buyer._id }),
    ]);
    expect(String(savedOrder?.buyer)).toBe(String(buyer._id));
    expect(savedOrder?.items[0]).toMatchObject({ quantity: 2, unitPriceCents: 12500, subtotalCents: 25000 });
    expect(savedProduct?.availableStock).toBe(8);
    expect(buyerCart).toHaveLength(0);
    expect(savedKey?.response?.orderIds).toContain(returnedOrder.id);

    const replay = await submitCheckout(cookie, csrf, idempotencyKey);
    expect(replay.status).toBe(200);
    expect(replay.body.data.idempotentReplay).toBe(true);
    expect(replay.body.data.orders.map((order: any) => order.id)).toEqual([returnedOrder.id]);
    expect((await Product.findById(product._id).lean())?.availableStock).toBe(8);
    expect(await Order.countDocuments({ buyer: buyer._id })).toBe(1);

    const list = await request(app).get('/api/v1/order')
      .set('Origin', 'http://localhost:5199')
      .set('Cookie', cookie)
      .expect(200);
    expect(list.body.data.map((order: any) => order.id)).toContain(returnedOrder.id);
    const detail = await request(app).get(`/api/v1/order/${returnedOrder.id}`)
      .set('Origin', 'http://localhost:5199')
      .set('Cookie', cookie)
      .expect(200);
    expect(detail.body.data.id).toBe(returnedOrder.id);
  });

  it('deduplicates concurrent requests with the same idempotency key', async () => {
    const { buyer, csrf, cookie } = await fixtureBuyerSession();
    const farmerId = new Types.ObjectId();
    const product: any = await fixtureProduct(farmerId, 10);
    await CartItem.create({ customerId: buyer._id, userId: buyer._id, productId: product._id, quantity: 2 });
    const idempotencyKey = randomUUID();

    const [first, second] = await Promise.all([
      submitCheckout(cookie, csrf, idempotencyKey),
      submitCheckout(cookie, csrf, idempotencyKey),
    ]);

    expect([first.status, second.status].sort()).toEqual([200, 201]);
    expect(first.body.data.orders[0].id).toBe(second.body.data.orders[0].id);
    expect(await Order.countDocuments({ buyer: buyer._id })).toBe(1);
    expect((await Product.findById(product._id).lean())?.availableStock).toBe(8);
    expect(await CartItem.countDocuments({ customerId: buyer._id })).toBe(0);
    expect(await IdempotencyKey.countDocuments({ userId: buyer._id })).toBe(1);
  });

  it('records successful request, commit, and idempotency outcomes without the raw key', async () => {
    const { buyer, csrf, cookie } = await fixtureBuyerSession();
    const product: any = await fixtureProduct(new Types.ObjectId(), 3);
    await CartItem.create({ customerId: buyer._id, userId: buyer._id, productId: product._id, quantity: 1 });
    const idempotencyKey = randomUUID();
    const logInfo = vi.spyOn(console, 'info').mockImplementation(() => {});

    try {
      const response = await submitCheckout(cookie, csrf, idempotencyKey);
      expect(response.status).toBe(201);
      const diagnostic = logInfo.mock.calls
        .map((call) => JSON.parse(String(call[0])))
        .find((record) => record.event === 'checkout_completed');
      expect(diagnostic).toMatchObject({
        requestId: response.headers['x-request-id'],
        route: '/api/v1/checkout',
        stage: 'response_sent',
        transactionOutcome: 'committed',
        idempotencyOutcome: 'record_committed',
      });
      expect(JSON.stringify(diagnostic)).not.toContain(idempotencyKey);
    } finally {
      logInfo.mockRestore();
    }
  });

  it('rejects an unauthenticated checkout without creating orders', async () => {
    const orderCountBefore = await Order.countDocuments({});
    const csrfResponse = await request(app).get('/api/v1/auth/csrf').expect(200);
    const csrfCookie = setCookieHeaders(csrfResponse.headers['set-cookie'])
      .map((cookie) => cookie.split(';', 1)[0] ?? '')
      .find((cookie) => cookie.startsWith('agrilink.csrf='));
    const response = await request(app)
      .post('/api/v1/checkout')
      .set('Origin', 'http://localhost:5199')
      .set('Cookie', csrfCookie ?? '')
      .set('X-CSRF-Token', csrfResponse.body.data.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ address: checkoutAddress });
    expect(response.status).toBe(401);
    expect(await Order.countDocuments({})).toBe(orderCountBefore);
  });

  it('rejects a Farmer session from Buyer checkout', async () => {
    const { csrf, cookie } = await fixtureSession('farmer');
    const response = await submitCheckout(cookie, csrf, randomUUID());
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });

  it('rejects an empty buyer cart without clearing another buyer cart', async () => {
    const first = await fixtureBuyerSession();
    const second = await fixtureBuyerSession();
    const farmerId = new Types.ObjectId();
    const product: any = await fixtureProduct(farmerId);
    await CartItem.create({ customerId: second.buyer._id, userId: second.buyer._id, productId: product._id, quantity: 1 });

    const response = await submitCheckout(first.cookie, first.csrf, randomUUID());
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('CART_EMPTY');
    expect(await CartItem.countDocuments({ customerId: second.buyer._id })).toBe(1);
    expect(await Order.countDocuments({ buyer: first.buyer._id })).toBe(0);
  });

  it('returns a sanitized unavailable-listing error for a dangling cart reference', async () => {
    const { buyer, csrf, cookie } = await fixtureBuyerSession();
    const missingProductId = new Types.ObjectId();
    await CartItem.create({ customerId: buyer._id, userId: buyer._id, productId: missingProductId, quantity: 1 });
    const response = await submitCheckout(cookie, csrf, randomUUID());
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PRODUCT_UNAVAILABLE');
    expect(await Order.countDocuments({ buyer: buyer._id })).toBe(0);
    expect(await CartItem.countDocuments({ customerId: buyer._id })).toBe(1);
  });

  it('rejects a deleted listing without reserving stock or clearing the cart', async () => {
    const { buyer, csrf, cookie } = await fixtureBuyerSession();
    const product: any = await fixtureProduct(new Types.ObjectId(), 5);
    product.isDeleted = true;
    await product.save();
    const cart = await CartItem.create({ customerId: buyer._id, userId: buyer._id, productId: product._id, quantity: 1 });

    const response = await submitCheckout(cookie, csrf, randomUUID());
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PRODUCT_UNAVAILABLE');
    expect((await Product.findById(product._id).lean())?.availableStock).toBe(5);
    expect(await CartItem.findById(cart._id)).not.toBeNull();
    expect(await Order.countDocuments({ buyer: buyer._id })).toBe(0);
  });

  it('rejects a malformed legacy product reference instead of leaking a Mongoose cast exception', async () => {
    const { buyer, csrf, cookie } = await fixtureBuyerSession();
    await CartItem.collection.insertOne({
      _id: new Types.ObjectId(),
      customerId: buyer._id,
      userId: buyer._id,
      productId: 'malformed-listing-reference',
      quantity: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const response = await submitCheckout(cookie, csrf, randomUUID());
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PRODUCT_UNAVAILABLE');
    expect(response.body.message).toBe('A listing in your cart is no longer available.');
    expect(await Order.countDocuments({ buyer: buyer._id })).toBe(0);
  });

  it('rejects insufficient and invalid quantities without changing stock or the cart', async () => {
    const { buyer, csrf, cookie } = await fixtureBuyerSession();
    const product: any = await fixtureProduct(new Types.ObjectId(), 2);
    const cart = await CartItem.create({ customerId: buyer._id, userId: buyer._id, productId: product._id, quantity: 3 });

    const insufficient = await submitCheckout(cookie, csrf, randomUUID());
    expect(insufficient.status).toBe(409);
    expect(insufficient.body.code).toBe('INSUFFICIENT_STOCK');
    expect((await Product.findById(product._id).lean())?.availableStock).toBe(2);
    expect(await CartItem.findById(cart._id)).not.toBeNull();

    cart.quantity = 1.5;
    await cart.save();
    const invalidQuantity = await submitCheckout(cookie, csrf, randomUUID());
    expect(invalidQuantity.status).toBe(409);
    expect(invalidQuantity.body.code).toBe('INVALID_CART_QUANTITY');
    expect((await Product.findById(product._id).lean())?.availableStock).toBe(2);
    expect(await Order.countDocuments({ buyer: buyer._id })).toBe(0);
  });

  it('rolls stock and cart changes back when order persistence fails', async () => {
    const { buyer, csrf, cookie } = await fixtureBuyerSession();
    const product: any = await fixtureProduct(new Types.ObjectId(), 5);
    await CartItem.create({ customerId: buyer._id, userId: buyer._id, productId: product._id, quantity: 2 });
    const idempotencyKey = randomUUID();
    const createOrder = vi.spyOn(Order, 'create').mockRejectedValueOnce(new Error('isolated persistence failure email: isolated@example.invalid phone_number: 0712345678 address_line1: "123 Private Lane"'));
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await submitCheckout(cookie, csrf, idempotencyKey);
      expect(response.status).toBe(500);
      expect(response.body).toMatchObject({ success: false, code: 'INTERNAL_ERROR', message: 'The request could not be completed.' });
      expect(response.body).not.toHaveProperty('stack');
      expect((await Product.findById(product._id).lean())?.availableStock).toBe(5);
      expect(await CartItem.countDocuments({ customerId: buyer._id })).toBe(1);
      expect(await Order.countDocuments({ buyer: buyer._id })).toBe(0);
      expect(await IdempotencyKey.countDocuments({ userId: buyer._id })).toBe(0);
      expect(logError).toHaveBeenCalledOnce();
      const diagnostic = JSON.parse(String(logError.mock.calls[0]?.[0]));
      expect(diagnostic).toMatchObject({
        event: 'checkout_failed', route: '/api/v1/checkout', errorName: 'Error',
        stage: 'order_persistence', transactionOutcome: 'aborted', idempotencyOutcome: 'new_key',
        requestId: response.headers['x-request-id'],
      });
      expect(diagnostic.message).toContain('isolated persistence failure');
      expect(diagnostic.stack).toContain('Error: isolated persistence failure');
      expect(JSON.stringify(diagnostic)).not.toContain('isolated@example.invalid');
      expect(JSON.stringify(diagnostic)).not.toContain('0712345678');
      expect(JSON.stringify(diagnostic)).not.toContain('123 Private Lane');
      expect(JSON.stringify(diagnostic)).not.toContain(idempotencyKey);
    } finally {
      createOrder.mockRestore();
      logError.mockRestore();
    }
  });

  it('returns the committed order when a post-commit notification fails', async () => {
    const { buyer, csrf, cookie } = await fixtureBuyerSession();
    const farmerId = new Types.ObjectId();
    const product: any = await fixtureProduct(farmerId, 4);
    await CartItem.create({ customerId: buyer._id, userId: buyer._id, productId: product._id, quantity: 1 });
    const notification = vi.spyOn(notificationService, 'createInAppNotification').mockRejectedValue(new Error('isolated notification failure'));
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await submitCheckout(cookie, csrf, randomUUID());
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.orders).toHaveLength(1);
      expect(await Order.countDocuments({ buyer: buyer._id })).toBe(1);
      expect((await Product.findById(product._id).lean())?.availableStock).toBe(3);
      expect(await CartItem.countDocuments({ customerId: buyer._id })).toBe(0);
      expect(JSON.parse(String(logError.mock.calls[0]?.[0]))).toMatchObject({
        event: 'checkout_post_commit_notification_failed',
        transactionOutcome: 'committed',
        idempotencyOutcome: 'record_committed',
      });
    } finally {
      notification.mockRestore();
      logError.mockRestore();
    }
  });

  it('returns the committed order when the post-commit audit write fails', async () => {
    const { buyer, csrf, cookie } = await fixtureBuyerSession();
    const farmerId = new Types.ObjectId();
    const product: any = await fixtureProduct(farmerId, 4);
    await CartItem.create({ customerId: buyer._id, userId: buyer._id, productId: product._id, quantity: 1 });
    const audit = vi.spyOn(auditService, 'writeAudit').mockRejectedValueOnce(new Error('isolated audit failure'));
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await submitCheckout(cookie, csrf, randomUUID());
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.orders).toHaveLength(1);
      expect(await Order.countDocuments({ buyer: buyer._id })).toBe(1);
      expect((await Product.findById(product._id).lean())?.availableStock).toBe(3);
      expect(await CartItem.countDocuments({ customerId: buyer._id })).toBe(0);
      expect(JSON.parse(String(logError.mock.calls[0]?.[0]))).toMatchObject({
        event: 'checkout_post_commit_audit_failed',
        transactionOutcome: 'committed',
        idempotencyOutcome: 'record_committed',
      });
    } finally {
      audit.mockRestore();
      logError.mockRestore();
    }
  });

  it('uses the committed transaction snapshot if post-commit order reads fail', async () => {
    const { buyer, csrf, cookie } = await fixtureBuyerSession();
    const farmerId = new Types.ObjectId();
    const product: any = await fixtureProduct(farmerId, 4);
    await CartItem.create({ customerId: buyer._id, userId: buyer._id, productId: product._id, quantity: 1 });
    const findOrders = vi.spyOn(Order, 'find').mockRejectedValueOnce(new Error('isolated post-commit read failure'));
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});

    try {
      const response = await submitCheckout(cookie, csrf, randomUUID());
      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      expect(response.body.data.responseDetailsDegraded).toBe(true);
      expect(response.body.data.orders).toHaveLength(1);
      expect(await Order.countDocuments({ buyer: buyer._id })).toBe(1);
      expect((await Product.findById(product._id).lean())?.availableStock).toBe(3);
      expect(await CartItem.countDocuments({ customerId: buyer._id })).toBe(0);
      expect(JSON.parse(String(logError.mock.calls[0]?.[0]))).toMatchObject({
        event: 'checkout_committed_order_read_failed',
        transactionOutcome: 'committed',
        idempotencyOutcome: 'record_committed',
      });
    } finally {
      findOrders.mockRestore();
      logError.mockRestore();
    }
  });

  it('does not allow a Buyer to retrieve another Buyer’s order', async () => {
    const owner = await fixtureBuyerSession();
    const otherBuyer = await fixtureBuyerSession();
    const farmerId = new Types.ObjectId();
    const product: any = await fixtureProduct(farmerId);
    const order: any = await Order.create({
      buyer: owner.buyer._id,
      customerId: owner.buyer._id,
      farmer: farmerId,
      sellerId: farmerId,
      items: [{ product: product._id, name: product.name, quantity: 1, unitPriceCents: 12500, subtotalCents: 12500 }],
      subtotalCents: 12500,
      deliveryFeeCents: 0,
      totalCents: 12500,
      currency: 'KES',
      status: 'pending',
      paymentStatus: 'pending',
    });

    const response = await request(app)
      .get(`/api/v1/order/${order._id}`)
      .set('Origin', 'http://localhost:5199')
      .set('Cookie', otherBuyer.cookie);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
  });
});
