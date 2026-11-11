import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/main.js';
import { connectDatabase, disconnectDatabase } from '../src/database/connection.js';
import { initializeDatabase } from '../src/database/initialize.js';
import { Category, CartItem, IdempotencyKey, MarketDataSource, MarketPrice, Order, Payment, Product, ProviderSync, RefreshToken, User, AuditLog, AiConversation, AiMessage, AiUsage, Setting, PurchaseRequest, ContactMessage, Report, Withdraw, Conversation, Message, Notification, NotificationLog, Review } from '../src/database/models.js';
import { hashPassword } from '../src/services/password.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const uri = process.env.MONGODB_TEST_URI;
if (!uri) throw new Error('Set MONGODB_TEST_URI to an isolated local database ending in _test before running this workflow.');
const parsedUri = new URL(uri);
const databaseName = decodeURIComponent(parsedUri.pathname.slice(1));
if (parsedUri.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost'].includes(parsedUri.hostname) || !/^agrilink(?:_[a-z0-9-]+)?_test$/.test(databaseName)) {
  throw new Error('Refusing end-to-end test: MONGODB_TEST_URI must point to a loopback MongoDB database named agrilink_*_test.');
}

process.env.NODE_ENV = 'test';
// End-to-end fixtures must never send email to external addresses.
process.env.SMTP_HOST = '';
process.env.SMTP_FROM = '';
const app = createApp();
const suffix = randomUUID();
const password = 'AgriLink isolated test password 7!';
let farmerId: mongoose.Types.ObjectId | undefined;
let buyerId: mongoose.Types.ObjectId | undefined;
let adminId: mongoose.Types.ObjectId | undefined;
let categoryId: mongoose.Types.ObjectId | undefined;
let productId: mongoose.Types.ObjectId | undefined;
let reviewId: mongoose.Types.ObjectId | undefined;
let conversationId: mongoose.Types.ObjectId | undefined;
let contactMessageId: mongoose.Types.ObjectId | undefined;
let reportId: mongoose.Types.ObjectId | undefined;
let withdrawalId: mongoose.Types.ObjectId | undefined;
let marketSourceId: mongoose.Types.ObjectId | undefined;
let kamisSourceId: mongoose.Types.ObjectId | undefined;
let previousAiProviderSetting: any;
let testAiProviderSettingId: mongoose.Types.ObjectId | undefined;
let previousMatchingSetting: any;
let testMatchingSettingId: mongoose.Types.ObjectId | undefined;

async function csrf(agent: ReturnType<typeof request.agent>) {
  const response = await agent.get('/api/v1/auth/csrf');
  assert(response.status === 200, 'Could not obtain the CSRF token.');
  return String(response.body?.data?.csrfToken ?? '');
}

async function login(agent: ReturnType<typeof request.agent>, token: string, email: string, role: 'farmer' | 'buyer') {
  const response = await agent.post('/api/v1/auth/login').set('X-CSRF-Token', token).send({ email, password, role });
  assert(response.status === 200, `The ${role} session could not be created (${response.status}).`);
  return response.body.data.user;
}

try {
  await connectDatabase(uri);
  await initializeDatabase(databaseName);
  const passwordHash = await hashPassword(password);
  const [farmer, buyer, admin, category] = await Promise.all([
    User.create({ email: `farmer-${suffix}@example.test`, fullName: 'Isolated Test Farmer', role: 'farmer', passwordHash, isActive: true, isDeleted: false, isEmailVerified: true, county: 'Kiambu', createdAt: new Date() }),
    User.create({ email: `buyer-${suffix}@example.test`, fullName: 'Isolated Test Buyer', role: 'buyer', passwordHash, isActive: true, isDeleted: false, isEmailVerified: true, county: 'Kiambu', createdAt: new Date() }),
    User.create({ email: `admin-${suffix}@example.test`, fullName: 'Isolated Test Administrator', role: 'super_admin', passwordHash, isActive: true, isDeleted: false, isEmailVerified: true, createdAt: new Date() }),
    Category.create({ name: `Isolated Test Category ${suffix}`, slug: `isolated-test-${suffix}`, isActive: true, createdAt: new Date() }),
  ]);
  farmerId = farmer._id; buyerId = buyer._id; adminId = admin._id; categoryId = category._id;

  const farmerAgent = request.agent(app);
  const farmerCsrf = await csrf(farmerAgent);
  await login(farmerAgent, farmerCsrf, farmer.email, 'farmer');
  const createdListing = await farmerAgent.post('/api/v1/products').set('X-CSRF-Token', farmerCsrf).send({
    name: `Isolated test produce ${suffix}`, category: category.name, price: 125, stock: 10, measurementUnit: 'kg', description: 'Isolated end-to-end test record.',
  });
  assert(createdListing.status === 201, `Farmer listing creation failed (${createdListing.status}).`);
  productId = new mongoose.Types.ObjectId(createdListing.body.data.id);
  const savedProduct = await Product.findById(productId).lean();
  assert(savedProduct?.priceCents === 12500 && savedProduct?.quantityAvailable === 10, 'The listing did not persist its authoritative price and stock.');
  const feed = await request(app).get('/api/v1/products').query({ search: suffix });
  assert(feed.status === 200 && feed.body.data.some((row: any) => row.id === String(productId)), 'The persisted listing did not appear in marketplace search.');

  const buyerAgent = request.agent(app);
  const buyerCsrf = await csrf(buyerAgent);
  await login(buyerAgent, buyerCsrf, buyer.email, 'buyer');
  const inquiry = await buyerAgent.post('/api/v1/message/send-message').set('X-CSRF-Token', buyerCsrf).send({ productId: String(productId), text: `Isolated produce inquiry ${suffix}.` });
  assert(inquiry.status === 201 && inquiry.body.data.conversationId && inquiry.body.data.listingName === `Isolated test produce ${suffix}`, 'The buyer inquiry did not persist against its actual listing.');
  conversationId = new mongoose.Types.ObjectId(inquiry.body.data.conversationId);
  const farmerConversation = await farmerAgent.get('/api/v1/messages/conversations');
  const farmerInquiry = farmerConversation.body.data.conversations.find((row: any) => row.id === String(conversationId));
  assert(farmerConversation.status === 200 && farmerInquiry?.listingName === `Isolated test produce ${suffix}` && farmerInquiry?.message === `Isolated produce inquiry ${suffix}.` && farmerInquiry?.recipient?.email === buyer.email && farmerInquiry?.status === 'Open', 'The farmer did not receive the real buyer and listing details for the inquiry.');
  const farmerUnreadMessages = await farmerAgent.get('/api/v1/chat/unread-count');
  assert(farmerUnreadMessages.status === 200 && farmerUnreadMessages.body.data.count === 1, 'The farmer unread-message count did not include the new message notification.');
  const sentReply = await farmerAgent.post('/api/v1/messages/send-message').set('X-CSRF-Token', farmerCsrf).send({ chatId: String(conversationId), text: 'The listed produce is available for collection.' });
  assert(sentReply.status === 201 && sentReply.body.data.status === 'Replied', 'The farmer reply was not persisted as a conversation response.');
  const buyerConversation = await buyerAgent.get('/api/v1/messages/conversations');
  const buyerInquiry = buyerConversation.body.data.conversations.find((row: any) => row.id === String(conversationId));
  assert(buyerInquiry?.reply === 'The listed produce is available for collection.' && buyerInquiry?.status === 'Replied', 'The buyer did not see the persisted farmer reply and status.');
  const buyerStatusGate = await buyerAgent.patch(`/api/v1/messages/conversations/${conversationId}/status`).set('X-CSRF-Token', buyerCsrf).send({ status: 'closed' });
  assert(buyerStatusGate.status === 403, 'A buyer changed farmer-owned inquiry status.');
  const closeInquiry = await farmerAgent.patch(`/api/v1/messages/conversations/${conversationId}/status`).set('X-CSRF-Token', farmerCsrf).send({ status: 'closed' });
  assert(closeInquiry.status === 200 && closeInquiry.body.data.status === 'Closed', 'The farmer could not persist a conversation close action.');
  const buyerClosedConversation = await buyerAgent.get('/api/v1/messages/conversations');
  assert(buyerClosedConversation.body.data.conversations.find((row: any) => row.id === String(conversationId))?.status === 'Closed', 'The buyer did not see the persisted closed status.');
  const farmerNotifications = await farmerAgent.get('/api/v1/notifications');
  const inquiryNotification = farmerNotifications.body.data.find((row: any) => row.metadata?.conversationId === String(conversationId));
  assert(inquiryNotification, 'The buyer message notification was not persisted for the farmer.');
  const readInquiryNotification = await farmerAgent.patch(`/api/v1/notifications/${inquiryNotification.id}/read`).set('X-CSRF-Token', farmerCsrf).send({});
  const farmerUnreadAfterRead = await farmerAgent.get('/api/v1/chat/unread-count');
  assert(readInquiryNotification.status === 200 && farmerUnreadAfterRead.body.data.count === 0, 'Marking the message notification read did not update its unread count.');
  const defaultNotificationPreferences = await farmerAgent.get('/api/v1/notification/preferences');
  assert(defaultNotificationPreferences.status === 200 && defaultNotificationPreferences.body.data.configured === false && defaultNotificationPreferences.body.data.preferences.messages === true && defaultNotificationPreferences.body.data.delivery.push === 'unavailable', 'Notification preferences did not report their explicit defaults and unavailable delivery channels.');
  const optedOut = await farmerAgent.patch('/api/v1/notification/preferences').set('X-CSRF-Token', farmerCsrf).send({ messages: false });
  assert(optedOut.status === 200 && optedOut.body.data.configured === true && optedOut.body.data.preferences.messages === false, 'The farmer could not persist an account-scoped message-notification preference.');
  const followUpMessage = await buyerAgent.post('/api/v1/messages/send-message').set('X-CSRF-Token', buyerCsrf).send({ chatId: String(conversationId), text: 'Please confirm the available quantity.' });
  const farmerUnreadAfterOptOut = await farmerAgent.get('/api/v1/chat/unread-count');
  assert(followUpMessage.status === 201 && farmerUnreadAfterOptOut.status === 200 && farmerUnreadAfterOptOut.body.data.count === 0, 'A disabled message preference still created an unread in-app alert.');
  const excessiveRequest = await buyerAgent.post('/api/v1/purchase-requests').set('X-CSRF-Token', buyerCsrf).send({ listingId: String(productId), quantity: 11, proposedPrice: 1 });
  assert(excessiveRequest.status === 422 && excessiveRequest.body.code === 'REQUEST_QUANTITY_EXCEEDS_STOCK', 'The purchase-request API allowed quantities above authoritative stock.');
  const purchaseRequest = await buyerAgent.post('/api/v1/purchase-requests').set('X-CSRF-Token', buyerCsrf).send({ listingId: String(productId), quantity: 2, proposedPrice: 120, note: 'Please confirm collection availability.' });
  assert(purchaseRequest.status === 201 && purchaseRequest.body.data.listing?.id === String(productId) && purchaseRequest.body.data.listing?.price === 125 && purchaseRequest.body.data.proposedPrice === 120 && purchaseRequest.body.data.status === 'Pending', `The buyer listing request did not persist with authoritative listing price and separate offer (${purchaseRequest.status}).`);
  const buyerRequests = await buyerAgent.get('/api/v1/purchase-requests');
  assert(buyerRequests.status === 200 && buyerRequests.body.data.some((row: any) => row.id === purchaseRequest.body.data.id && row.listing?.name === `Isolated test produce ${suffix}` && row.proposedPrice === 120), 'Buyer request history did not include the live listing and offer details.');
  const farmerPurchaseMatches = await farmerAgent.get('/api/v1/purchase-requests/matches').query({ produce: suffix, quantity: 5, unit: 'kg', location: 'Kiambu', availability: 'Ready now' });
  const scoredBuyerRequest = farmerPurchaseMatches.body.data.find((row: any) => row.id === purchaseRequest.body.data.id);
  assert(farmerPurchaseMatches.status === 200 && scoredBuyerRequest?.buyerId === String(buyerId) && scoredBuyerRequest?.quantity === 2 && scoredBuyerRequest.matchScore > 0 && scoredBuyerRequest.scoreCoverage === 55 && scoredBuyerRequest.factors.distance === null && scoredBuyerRequest.missingFactors.includes('distance'), 'The listing owner could not see and transparently score the real buyer request.');
  const buyerPurchaseMatchesGate = await buyerAgent.get('/api/v1/purchase-requests/matches');
  assert(buyerPurchaseMatchesGate.status === 403, 'A buyer accessed the farmer purchase-request match feed.');
  const added = await buyerAgent.post('/api/v1/cart/create-cart').set('X-CSRF-Token', buyerCsrf).send({ productId: String(productId), quantity: 3 });
  assert(added.status === 200 && added.body.data.quantity === 3, 'The buyer cart did not persist the requested quantity.');
  const beforeCheckout = await CartItem.countDocuments({ customerId: buyerId, productId });
  assert(beforeCheckout === 1, 'Expected one persisted buyer cart row.');

  const key = `isolated-${suffix}`;
  const address = { phone_number: '+254700000000', address_line1: 'Test collection point', city: 'Kiambu', state_code: 'Kiambu', postal_code: '00900', country_code: 'KE' };
  const checkout = await buyerAgent.post('/api/v1/checkout').set('X-CSRF-Token', buyerCsrf).set('Idempotency-Key', key).send({ address });
  assert(checkout.status === 201 && checkout.body.data.orders.length === 1, `Transactional checkout failed (${checkout.status}).`);
  const orderId = checkout.body.data.orders[0].id;
  const [savedOrder, afterCheckoutProduct, remainingCart] = await Promise.all([
    Order.findById(orderId).lean(), Product.findById(productId).lean(), CartItem.countDocuments({ customerId: buyerId }),
  ]);
  assert(savedOrder?.totalCents === 37500 && savedOrder?.paymentStatus === 'pending', 'The order total or initial payment state is incorrect.');
  assert(afterCheckoutProduct?.availableStock === 7 && remainingCart === 0, 'Checkout did not atomically reserve stock and clear the cart.');

  const replay = await buyerAgent.post('/api/v1/checkout').set('X-CSRF-Token', buyerCsrf).set('Idempotency-Key', key).send({ address });
  assert(replay.status === 200 && replay.body.data.idempotentReplay === true && replay.body.data.orders[0].id === orderId, 'Repeated checkout did not return the original order.');
  const afterReplay = await Product.findById(productId).lean();
  assert(afterReplay?.availableStock === 7 && await Order.countDocuments({ buyer: buyerId }) === 1, 'Idempotent replay changed stock or created a duplicate order.');
  const buyerOrderNotifications = await buyerAgent.get('/api/v1/notifications');
  const farmerOrderNotifications = await farmerAgent.get('/api/v1/notifications');
  assert(buyerOrderNotifications.body.data.some((row: any) => row.type === 'order' && row.metadata?.orderId === orderId) && farmerOrderNotifications.body.data.some((row: any) => row.type === 'order' && row.metadata?.orderId === orderId), 'A successful checkout did not create in-app notifications for the buyer and farmer.');

  const buyerOrders = await buyerAgent.get('/api/v1/orders');
  const farmerOrders = await farmerAgent.get('/api/v1/orders');
  assert(buyerOrders.status === 200 && buyerOrders.body.data.some((row: any) => row.id === orderId), 'Buyer order history did not return the persisted order.');
  assert(farmerOrders.status === 200 && farmerOrders.body.data.some((row: any) => row.id === orderId), 'Farmer order management did not return the persisted order.');
  const forbiddenEdit = await buyerAgent.patch(`/api/v1/products/${productId}`).set('X-CSRF-Token', buyerCsrf).send({ price: 1 });
  assert(forbiddenEdit.status === 403, 'A buyer could modify a farmer-owned listing.');
  const mpesaUnavailable = await buyerAgent.post('/api/v1/payments/mpesa/initiate').set('X-CSRF-Token', buyerCsrf).send({ orderId, phoneNumber: '+254700000000' });
  const paypalUnavailable = await buyerAgent.post('/api/v1/payments/paypal/create-order').set('X-CSRF-Token', buyerCsrf).send({ orderId, returnUrl: 'http://localhost:5199/payment-return', cancelUrl: 'http://localhost:5199/payment-cancel' });
  assert(mpesaUnavailable.status === 503 && mpesaUnavailable.body.code === 'MPESA_NOT_CONFIGURED', 'M-Pesa reported success while its sandbox credentials were absent.');
  assert(paypalUnavailable.status === 503 && paypalUnavailable.body.code === 'PAYPAL_NOT_CONFIGURED', 'PayPal reported success while its sandbox credentials were absent.');
  assert(await Payment.countDocuments({ order: orderId }) === 0, 'An unconfigured payment provider created a payment record.');
  for (const stage of ['confirmed', 'packed', 'in_transit', 'delivered']) {
    const updated = await farmerAgent.patch(`/api/v1/order/${orderId}/delivery-stage`).set('X-CSRF-Token', farmerCsrf).send({ stage });
    const savedStage: any = await Order.findById(orderId).lean();
    assert(updated.status === 200 && updated.body.data.status === stage, `The farmer could not persist delivery stage ${stage} (${updated.status}: ${JSON.stringify({ responseStatus: updated.body?.data?.status, storedStatus: savedStage?.status, storedDeliveryStage: savedStage?.deliveryStage, message: updated.body?.message })}).`);
  }
  const reviewEligibility = await buyerAgent.get('/api/v1/review/can-review').query({ productId: String(productId) });
  assert(reviewEligibility.status === 200 && reviewEligibility.body.data.eligible === true && reviewEligibility.body.data.orderId === orderId, 'A delivered buyer order did not authorize a verified review.');
  const submittedReview = await buyerAgent.post('/api/v1/review').set('X-CSRF-Token', buyerCsrf).send({ productId: String(productId), rating: 5, comment: 'The delivered produce matched the listing.' });
  assert(submittedReview.status === 201 && submittedReview.body.data.verifiedPurchase === true && submittedReview.body.data.rating === 5, 'A review was not saved with a real delivered-order relationship.');
  reviewId = new mongoose.Types.ObjectId(submittedReview.body.data.id);
  const visibleReviews = await request(app).get(`/api/v1/review/product/${productId}`);
  const reviewSummary = await request(app).get(`/api/v1/review/product/${productId}/summary`);
  assert(visibleReviews.status === 200 && visibleReviews.body.data.some((row: any) => row.id === String(reviewId) && row.reviewerName === buyer.fullName && row.verifiedPurchase) && reviewSummary.body.data.count === 1 && reviewSummary.body.data.averageRating === 5, 'Public review listing and aggregate did not read the saved review.');
  const duplicateReview = await buyerAgent.post('/api/v1/review').set('X-CSRF-Token', buyerCsrf).send({ productId: String(productId), rating: 4 });
  assert(duplicateReview.status === 409 && duplicateReview.body.code === 'REVIEW_ALREADY_EXISTS', 'The buyer created more than one review for the same listing.');
  const farmerReviewDelete = await farmerAgent.delete(`/api/v1/review/${reviewId}`).set('X-CSRF-Token', farmerCsrf);
  assert(farmerReviewDelete.status === 403, 'A farmer deleted a buyer-owned review.');
  const editedReview = await buyerAgent.patch(`/api/v1/review/${reviewId}`).set('X-CSRF-Token', buyerCsrf).send({ rating: 4, comment: 'The delivered produce matched the listing and the seller communicated clearly.' });
  const revisedSummary = await request(app).get(`/api/v1/review/product/${productId}/summary`);
  assert(editedReview.status === 200 && revisedSummary.body.data.count === 1 && revisedSummary.body.data.averageRating === 4, 'A buyer review edit did not update the public persisted aggregate.');
  const reviewAfterCreate = await buyerAgent.get('/api/v1/review/can-review').query({ productId: String(productId) });
  assert(reviewAfterCreate.status === 200 && reviewAfterCreate.body.data.eligible === false && reviewAfterCreate.body.data.reason === 'already_reviewed', 'A buyer could not see that the listing was already reviewed.');
  const adminGate = await request(app).get('/api/v1/admin/dashboard');
  assert(adminGate.status === 401, 'An unauthenticated caller reached administrator data.');
  const farmerAdminGate = await farmerAgent.get('/api/v1/admin/market-data/sources');
  assert(farmerAdminGate.status === 403, 'A farmer reached administrator-only market-source data.');

  const adminAgent = request.agent(app);
  const adminCsrf = await csrf(adminAgent);
  const adminLogin = await adminAgent.post('/api/v1/auth/admin/login').set('X-CSRF-Token', adminCsrf).send({ email: admin.email, password });
  assert(adminLogin.status === 200, 'The isolated administrator session could not be created.');
  const contactMessage = await adminAgent.post('/api/v1/contact-message').set('X-CSRF-Token', adminCsrf).send({ name: `Isolated contact ${suffix}`, email: `contact-${suffix}@example.test`, subject: 'E2E support workflow', message: 'This support request is stored only in the isolated database.' });
  assert(contactMessage.status === 201, 'A public support request was not persisted.');
  contactMessageId = new mongoose.Types.ObjectId(contactMessage.body.data.id);
  const adminSupport = await adminAgent.get('/api/v1/admin/support').query({ search: suffix });
  assert(adminSupport.status === 200 && adminSupport.body.data.some((row: any) => row.id === String(contactMessageId)), 'AgriLink Control could not find the persisted support request.');
  const farmerSupportGate = await farmerAgent.get('/api/v1/admin/support');
  assert(farmerSupportGate.status === 403, 'A farmer accessed administrator support records.');
  const supportReply = await adminAgent.post(`/api/v1/admin/support/${contactMessageId}/reply`).set('X-CSRF-Token', adminCsrf).send({ reply: 'The team has recorded this response for follow-up.' });
  const savedContactMessage: any = await ContactMessage.findById(contactMessageId).lean();
  assert(supportReply.status === 200 && supportReply.body.data.deliveryStatus === 'not_configured' && savedContactMessage?.replies?.[0]?.deliveryStatus === 'not_configured' && savedContactMessage?.status === 'response_recorded', 'The support reply was not saved with honest email-delivery status.');
  const createdReport = await buyerAgent.post('/api/v1/reports').set('X-CSRF-Token', buyerCsrf).send({ type: 'listing', reason: `Isolated report ${suffix} requires review.`, resourceId: String(productId) });
  assert(createdReport.status === 201, 'The buyer report was not persisted.');
  reportId = new mongoose.Types.ObjectId(createdReport.body.data.id);
  const adminReports = await adminAgent.get('/api/v1/admin/reports').query({ search: suffix });
  assert(adminReports.status === 200 && adminReports.body.data.some((row: any) => row.id === String(reportId) && row.reporter?.email === buyer.email), 'AgriLink Control could not load the report and its actual reporter.');
  const updatedReport = await adminAgent.patch(`/api/v1/admin/reports/${reportId}`).set('X-CSRF-Token', adminCsrf).send({ status: 'under_review', resolution: 'Assigned for administrator review.' });
  assert(updatedReport.status === 200 && updatedReport.body.data.status === 'under_review', 'The administrator could not persist a report status change.');
  withdrawalId = new mongoose.Types.ObjectId();
  await Withdraw.create({ _id: withdrawalId, sellerId: farmerId, amountCents: 25000, currency: 'KES', method: 'M-Pesa', status: 'pending', createdAt: new Date() });
  const adminWithdrawals = await adminAgent.get('/api/v1/admin/withdrawals').query({ search: farmer.email });
  assert(adminWithdrawals.status === 200 && adminWithdrawals.body.data.some((row: any) => row.id === String(withdrawalId) && row.farmer?.email === farmer.email && row.amountCents === 25000 && row.currency === 'KES'), 'AgriLink Control could not load the persisted payout request with actual farmer and currency details.');
  const farmerWithdrawalsGate = await farmerAgent.get('/api/v1/admin/withdrawals');
  assert(farmerWithdrawalsGate.status === 403, 'A farmer accessed the administrator payout-request list.');
  previousMatchingSetting = await Setting.findOne({ scope: 'algorithm.matching' }).lean();
  const configuredMatching = await adminAgent.put('/api/v1/admin/algorithms/matching').set('X-CSRF-Token', adminCsrf).send({ price: 0.1, quality: 0.4, distance: 0.3, availability: 0.2 });
  testMatchingSettingId = (await Setting.findOne({ scope: 'algorithm.matching' }).select('_id').lean())?._id;
  assert(configuredMatching.status === 200 && configuredMatching.body.data.weights.quality === 0.4, 'The administrator could not configure normalized matching weights.');
  const userMatchingConfig = await farmerAgent.get('/api/v1/algorithms/matching');
  assert(userMatchingConfig.status === 200 && userMatchingConfig.body.data.weights.quality === 0.4 && userMatchingConfig.body.data.version === configuredMatching.body.data.version, 'The live matching consumer did not receive the configured algorithm weights.');
  const sourceName = `Isolated source ${suffix}`;
  const sourceResponse = await adminAgent.post('/api/v1/admin/market-data/sources').set('X-CSRF-Token', adminCsrf).send({ name: sourceName, sourceType: 'manual', description: 'Isolated test provenance source.' });
  assert(sourceResponse.status === 201, `Market source registration failed (${sourceResponse.status}).`);
  marketSourceId = new mongoose.Types.ObjectId(sourceResponse.body.data.id);
  const observation = { produce: `Isolated produce ${suffix}`, market: 'Limuru', location: 'Kiambu', price: 70, currency: 'KES', unit: 'kg', observedAt: new Date(Date.now() - 60_000).toISOString(), source: sourceName, sourceReference: `record-${suffix}` };
  const submission = await adminAgent.post('/api/v1/admin/market-data/observations').set('X-CSRF-Token', adminCsrf).send(observation);
  assert(submission.status === 201 && submission.body.data.verificationStatus === 'pending', `Observation submission failed (${submission.status}).`);
  const publicBeforeReview = await request(app).get('/api/v1/market-intelligence/prices').query({ produce: observation.produce });
  assert(publicBeforeReview.status === 200 && publicBeforeReview.body.data.length === 0, 'Unverified observations were exposed to marketplace users.');
  const reviewed = await adminAgent.patch(`/api/v1/admin/market-data/observations/${submission.body.data.id}/review`).set('X-CSRF-Token', adminCsrf).send({ status: 'verified', reason: 'Source record and measurement provenance reviewed.' });
  assert(reviewed.status === 200, `Observation verification failed (${reviewed.status}).`);
  const publicAfterReview = await request(app).get('/api/v1/market-intelligence/prices').query({ produce: observation.produce });
  assert(publicAfterReview.status === 200 && publicAfterReview.body.data[0]?.price === 70 && publicAfterReview.body.data[0]?.source === sourceName, `Verified provenance was not returned to market consumers: ${JSON.stringify({ status: publicAfterReview.status, body: publicAfterReview.body })}`);
  const correction = await adminAgent.patch(`/api/v1/admin/market-data/observations/${submission.body.data.id}/correction`).set('X-CSRF-Token', adminCsrf).send({ price: 72, reason: 'Source correction confirmed from the cited record.' });
  assert(correction.status === 200 && correction.body.data.verificationStatus === 'pending', 'A market correction did not require re-verification.');
  const hiddenAfterCorrection = await request(app).get('/api/v1/market-intelligence/prices').query({ produce: observation.produce });
  assert(hiddenAfterCorrection.status === 200 && hiddenAfterCorrection.body.data.length === 0, 'A corrected but unverified observation remained public.');
  const reverified = await adminAgent.patch(`/api/v1/admin/market-data/observations/${submission.body.data.id}/review`).set('X-CSRF-Token', adminCsrf).send({ status: 'verified', reason: 'Corrected value and source provenance reviewed.' });
  assert(reverified.status === 200, 'The corrected observation could not be re-verified.');

  // Keep the provider disabled in this isolated database so these checks never
  // call an external model or mistake an unavailable provider for a response.
  previousAiProviderSetting = await Setting.findOne({ scope: 'ai.provider' }).lean();
  await Setting.updateOne({ scope: 'ai.provider' }, { $set: { scope: 'ai.provider', value: { enabled: false } } }, { upsert: true });
  testAiProviderSettingId = (await Setting.findOne({ scope: 'ai.provider' }).select('_id').lean())?._id;
  const capabilityRequests: Array<{ path: string; body: Record<string, unknown>; agent: ReturnType<typeof request.agent> }> = [
    { path: '/api/v1/ai/shared/agricultural-assistant', body: { message: 'How should I prepare for harvest?' }, agent: farmerAgent },
    { path: '/api/v1/ai/shared/market-advisor', body: { produce: observation.produce, location: 'Kiambu', quantity: 10, timePeriod: 'week' }, agent: buyerAgent },
    { path: '/api/v1/ai/shared/recommendations-center', body: { role: 'buyer', produceType: `Isolated test produce ${suffix}`, location: 'Kiambu' }, agent: buyerAgent },
    { path: '/api/v1/ai/farmer/crop-advisor', body: { produceType: 'maize', growingStage: 'flowering', location: 'Kiambu', expectedQuantity: 10 }, agent: farmerAgent },
    { path: '/api/v1/ai/farmer/price-advisor', body: { produce: observation.produce, quantity: 10, qualityGrade: 'Grade A', location: 'Kiambu', unit: 'kg' }, agent: farmerAgent },
    { path: '/api/v1/ai/farmer/listing-assistant', body: { existingTitle: 'Maize', description: 'Harvested maize', qualityDetails: 'Grade A' }, agent: farmerAgent },
    { path: '/api/v1/ai/farmer/matching-assistant', body: { produceType: `Isolated test produce ${suffix}`, quantity: 2, location: 'Kiambu' }, agent: farmerAgent },
    { path: '/api/v1/ai/farmer/harvest-advisor', body: { produceType: 'maize', expectedHarvestDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10), expectedQuantity: 10, location: 'Kiambu' }, agent: farmerAgent },
    { path: '/api/v1/ai/buyer/produce-finder', body: { produceType: `Isolated test produce ${suffix}`, requiredQuantity: 2, location: 'Kiambu', unit: 'kg' }, agent: buyerAgent },
    { path: '/api/v1/ai/buyer/supplier-advisor', body: { produceType: `Isolated test produce ${suffix}`, location: 'Kiambu', quantity: 2 }, agent: buyerAgent },
    { path: '/api/v1/ai/buyer/purchase-assistant', body: { produceRequirements: 'maize', requiredQuantities: 2, deliveryArea: 'Kiambu' }, agent: buyerAgent },
  ];
  for (const capability of capabilityRequests) {
    const unavailable = await capability.agent.post(capability.path).set('X-CSRF-Token', capability.agent === farmerAgent ? farmerCsrf : buyerCsrf).send(capability.body);
    assert(unavailable.status === 503 && unavailable.body.code === 'AI_PROVIDER_NOT_CONFIGURED', `An unavailable AI capability returned something other than an explicit unavailable state (${capability.path}: ${unavailable.status}, ${unavailable.body.code}).`);
  }
  const wrongRole = await buyerAgent.post('/api/v1/ai/farmer/crop-advisor').set('X-CSRF-Token', buyerCsrf).send({ produceType: 'maize', growingStage: 'flowering', location: 'Kiambu', expectedQuantity: 10 });
  assert(wrongRole.status === 403, 'A buyer reached a farmer-only AI capability.');
  const netProfit = await farmerAgent.post('/api/v1/ai/farmer/net-profit-advisor').set('X-CSRF-Token', farmerCsrf).send({ calculation: { expectedSellingPrice: 100, sellableQuantity: 10, productionCost: 200, harvestCost: 100, packagingCost: 0, transportAndSellingCost: 0, otherCost: 0, targetProfit: 200 } });
  assert(netProfit.status === 200 && netProfit.body.data.data.revenue === 1000 && netProfit.body.data.data.totalCosts === 300 && netProfit.body.data.data.netProfit === 700 && netProfit.body.data.meta.provider === 'deterministic', 'The net-profit capability did not return the transparent calculation from user inputs.');
  const duplicate = await adminAgent.post('/api/v1/admin/market-data/observations').set('X-CSRF-Token', adminCsrf).send({ ...observation, price: 72 });
  assert(duplicate.status === 409, 'Duplicate market observations were not rejected.');

  const kamisSource = await adminAgent.post('/api/v1/admin/market-data/sources').set('X-CSRF-Token', adminCsrf).send({ name: 'KAMIS', sourceType: 'kamis_public_export' });
  assert(kamisSource.status === 201 && kamisSource.body.data.adapterStatus === 'ready', 'The official KAMIS source adapter could not be registered.');
  kamisSourceId = new mongoose.Types.ObjectId(kamisSource.body.data.id);
  const providerDate = new Date().toISOString().slice(0, 10);
  const kamisHtml = `<table><tr><th>Market</th><th>Commodity</th><th>Classification</th><th>Grade</th><th>Sex</th><th>Wholesale</th><th>Retail</th><th>Supply Volume</th><th>County</th><th>Date</th></tr><tr><td>Kibuye</td><td>Adapter maize</td><td>Test classification</td><td>-</td><td>-</td><td>65.00/Kg</td><td>65.00/Kg</td><td>500</td><td>Kisumu</td><td>${providerDate}</td></tr></table>`;
  const originalFetch = globalThis.fetch;
  const liveKamisE2e = process.env.KAMIS_LIVE_E2E === '1';
  if (!liveKamisE2e) globalThis.fetch = (async () => new Response(kamisHtml, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } })) as typeof fetch;
  else {
    let liveSnapshot: string | undefined;
    globalThis.fetch = (async (input, init) => {
      if (liveSnapshot === undefined) {
        const response = await originalFetch(input, init);
        liveSnapshot = await response.text();
        return new Response(liveSnapshot, { status: response.status, headers: { 'content-type': response.headers.get('content-type') ?? '' } });
      }
      return new Response(liveSnapshot, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' } });
    }) as typeof fetch;
  }
  let kamisSync: any;
  try {
    kamisSync = await adminAgent.post(`/api/v1/admin/market-data/sources/${kamisSourceId}/sync`).set('X-CSRF-Token', adminCsrf).send({});
    const syncDiagnostic = await ProviderSync.findOne({ source: kamisSourceId }).lean();
    const importedRows = await MarketPrice.find({ sourceId: kamisSourceId }).sort({ _id: 1 }).lean();
    assert(kamisSync.status === 200 && (liveKamisE2e ? kamisSync.body.data.recordsAccepted > 0 : kamisSync.body.data.recordsAccepted === 2), `The KAMIS sync did not persist its observations (${kamisSync.status}): ${JSON.stringify({ response: kamisSync.body, syncError: (syncDiagnostic as any)?.error })}`);
    assert(importedRows.length > 0, 'The KAMIS sync response succeeded without persisting observations.');
    const sampleProduce = liveKamisE2e ? String(importedRows[0]?.produce) : 'Adapter maize';
    const publicKamis = await request(app).get('/api/v1/market-intelligence/prices').query({ produce: sampleProduce });
    assert(publicKamis.status === 200 && publicKamis.body.data.length > 0, 'Synced KAMIS observations were not visible through the validated public API.');
    assert(publicKamis.body.data.every((row: any) => row.currency === 'KES' && row.source === 'KAMIS' && row.observationTimePrecision === 'date'), 'KAMIS source currency, provenance, or date precision was lost.');
    if (!liveKamisE2e) {
      assert(publicKamis.body.data.length === 2 && publicKamis.body.data.every((row: any) => row.unit === 'kg'), 'Fixture KAMIS observations were not visible with the expected unit.');
      assert(new Set(publicKamis.body.data.map((row: any) => row.priceType)).size === 2, 'Equal wholesale and retail quotes were incorrectly merged.');
    }
    const replaySync = await adminAgent.post(`/api/v1/admin/market-data/sources/${kamisSourceId}/sync`).set('X-CSRF-Token', adminCsrf).send({});
    assert(replaySync.status === 200 && replaySync.body.data.recordsAccepted === 0, 'A repeated provider sync duplicated identical market observations.');
  } finally { globalThis.fetch = originalFetch; }
  const fetchBeforeFailure = globalThis.fetch;
  globalThis.fetch = (async () => { throw new Error('simulated upstream outage'); }) as typeof fetch;
  try {
    const providerFailure = await adminAgent.post(`/api/v1/admin/market-data/sources/${kamisSourceId}/sync`).set('X-CSRF-Token', adminCsrf).send({});
    assert(providerFailure.status === 502 && providerFailure.body.code === 'MARKET_PROVIDER_UNAVAILABLE', 'An upstream KAMIS error did not produce an honest unavailable response.');
  } finally { globalThis.fetch = fetchBeforeFailure; }
  const adminSummary = await adminAgent.get('/api/v1/admin/dashboard');
  assert(adminSummary.status === 200 && adminSummary.body.data.users === 3 && adminSummary.body.data.orders >= 1, 'The admin overview did not read persisted test records.');
  const today = new Date().toISOString().slice(0, 10);
  const analytics = await adminAgent.get('/api/v1/admin/analytics/summary').query({ from: today, to: today });
  assert(analytics.status === 200 && analytics.body.data.totalOrders === 1, 'Date-filtered admin analytics did not count the persisted test order.');

  await disconnectDatabase();
  await connectDatabase(uri);
  const afterReconnect = await Order.findById(orderId).lean();
  assert(afterReconnect?.totalCents === 37500, 'Order data did not survive a backend-style MongoDB reconnect.');
  console.log(JSON.stringify({ result: 'passed', isolatedDatabase: databaseName, workflows: ['farmer login and listing persistence', 'marketplace discovery', 'buyer-farmer inquiry creation, listing context, persisted reply, role-protected status and read notification', 'account-scoped notification preference persistence and enforcement', 'buyer listing-linked purchase request and history', 'buyer login and cart persistence', 'transactional checkout, stock reservation and buyer/farmer notifications', 'idempotent checkout replay', 'farmer and buyer order views', 'delivered-order review eligibility, verified review creation, duplicate prevention, ownership, editing and live aggregate', 'provider-unavailable payment safety', 'all twelve AI capabilities with explicit provider-unavailable state and deterministic net-profit calculation', 'AI role authorization', 'admin matching-weight update and authenticated retrieval by the live scoring client', 'admin login and live dashboard metrics', 'date-filtered analytics', 'administrator support search, reply persistence and honest email-unavailable state', 'report listing and administrator status update', 'payout request listing with farmer and currency provenance', 'support and payout administrator authorization', 'market-source registration', 'KAMIS sync, quote-type preservation, public visibility and idempotent replay', 'KAMIS upstream failure handling', 'pending/verified/corrected market-observation lifecycle', 'duplicate observation rejection', 'ownership and role authorization', 'MongoDB reconnect persistence'], applicationDatabaseTouched: false }));
} finally {
  if (testMatchingSettingId) {
    if (previousMatchingSetting) await Setting.replaceOne({ _id: testMatchingSettingId }, previousMatchingSetting).catch(() => undefined);
    else await Setting.deleteOne({ _id: testMatchingSettingId }).catch(() => undefined);
  }
  if (testAiProviderSettingId) {
    if (previousAiProviderSetting) await Setting.replaceOne({ _id: testAiProviderSettingId }, previousAiProviderSetting).catch(() => undefined);
    else await Setting.deleteOne({ _id: testAiProviderSettingId }).catch(() => undefined);
  }
  if (farmerId || buyerId || adminId || productId || categoryId || marketSourceId || kamisSourceId || contactMessageId || reportId || withdrawalId || conversationId || reviewId) {
    if (productId) await Product.deleteOne({ _id: productId }).catch(() => undefined);
    if (contactMessageId) await ContactMessage.deleteOne({ _id: contactMessageId }).catch(() => undefined);
    if (reportId) await Report.deleteOne({ _id: reportId }).catch(() => undefined);
    if (withdrawalId) await Withdraw.deleteOne({ _id: withdrawalId }).catch(() => undefined);
    if (reviewId) await Review.deleteOne({ _id: reviewId }).catch(() => undefined);
    if (conversationId) {
      await Promise.all([
        Message.deleteMany({ conversation: conversationId }),
        Conversation.deleteOne({ _id: conversationId }),
        Notification.deleteMany({ $or: [{ 'metadata.conversationId': String(conversationId) }] }),
      ]).catch(() => undefined);
    }
    if (categoryId) await Category.deleteOne({ _id: categoryId }).catch(() => undefined);
    if (marketSourceId) await MarketDataSource.deleteOne({ _id: marketSourceId }).catch(() => undefined);
    if (kamisSourceId) {
      await Promise.all([
        MarketPrice.deleteMany({ sourceId: kamisSourceId }),
        ProviderSync.deleteMany({ source: kamisSourceId }),
        MarketDataSource.deleteOne({ _id: kamisSourceId }),
      ]).catch(() => undefined);
    }
    const userIds = [farmerId, buyerId, adminId].filter(Boolean);
    if (userIds.length) {
      const conversations = await AiConversation.find({ user: { $in: userIds } }).distinct('_id').catch(() => []);
      await Promise.all([
        CartItem.deleteMany({ customerId: { $in: userIds } }), PurchaseRequest.deleteMany({ buyer: { $in: userIds } }), Order.deleteMany({ $or: [{ buyer: { $in: userIds } }, { farmer: { $in: userIds } }] }),
        Notification.deleteMany({ $or: [{ user: { $in: userIds } }, { userId: { $in: userIds } }] }), NotificationLog.deleteMany({ userId: { $in: userIds } }),
        IdempotencyKey.deleteMany({ userId: { $in: userIds } }), RefreshToken.deleteMany({ user: { $in: userIds } }),
        AuditLog.deleteMany({ actor: { $in: userIds } }), MarketPrice.deleteMany({ submittedBy: { $in: userIds } }), User.deleteMany({ _id: { $in: userIds } }),
        AiUsage.deleteMany({ user: { $in: userIds } }), AiMessage.deleteMany({ conversation: { $in: conversations } }), AiConversation.deleteMany({ user: { $in: userIds } }),
      ]).catch(() => undefined);
    }
  }
  await disconnectDatabase();
}
