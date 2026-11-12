import mongoose, { Schema, type Model } from 'mongoose';

const loose = (fields: Record<string, unknown> = {}, options: Record<string, unknown> = {}) =>
  new Schema(fields as any, { strict: false, minimize: false, timestamps: true, ...options });

function modelFor(name: string, schema: Schema, collection: string): Model<any> {
  return (mongoose.models[name] as Model<any> | undefined) ?? mongoose.model(name, schema, collection) as unknown as Model<any>;
}

const userSchema = loose({
  email: { type: String, lowercase: true, trim: true, index: true },
  fullName: String,
  firstName: String,
  lastName: String,
  role: { type: String, index: true },
  passwordHash: { type: String, select: false },
  password: { type: String, select: false },
  refreshTokenVersion: { type: Number, default: 0, select: false },
  isActive: { type: Boolean, default: true },
  isDeleted: { type: Boolean, default: false },
  isEmailVerified: { type: Boolean, default: false },
  notificationPreferences: Schema.Types.Mixed,
  accountPreferences: Schema.Types.Mixed,
  image: String,
  phone: String,
  county: String,
});
export const User = modelFor('AgriLinkUser', userSchema, 'users');

export const FarmerProfile = modelFor('AgriLinkFarmerProfile', loose({ user: Schema.Types.ObjectId, privacyPreferences: Schema.Types.Mixed }), 'farmerprofiles');
export const BuyerProfile = modelFor('AgriLinkBuyerProfile', loose({ user: Schema.Types.ObjectId }), 'buyerprofiles');
export const Farm = modelFor('AgriLinkFarm', loose({ farmer: Schema.Types.ObjectId, isActive: Boolean }), 'farms');
export const Product = modelFor('AgriLinkProduct', loose({
  farmer: Schema.Types.ObjectId, sellerId: Schema.Types.ObjectId, category: Schema.Types.Mixed,
  priceCents: Number, price: Number, pricePerUnit: Number, quantityAvailable: Number,
  availableStock: Number, status: String, isAvailable: Boolean, isDeleted: Boolean,
}), 'products');
export const Category = modelFor('AgriLinkCategory', loose({ name: String, slug: String, isActive: Boolean }), 'categories');
export const Shop = modelFor('AgriLinkShop', loose({ sellerId: Schema.Types.ObjectId, owner: Schema.Types.ObjectId }), 'shops');
export const CartItem = modelFor('AgriLinkCartItem', loose({ customerId: Schema.Types.ObjectId, productId: Schema.Types.ObjectId, quantity: Number }), 'carts');
export const Order = modelFor('AgriLinkOrder', loose({ buyer: Schema.Types.ObjectId, customerId: Schema.Types.ObjectId, farmer: Schema.Types.ObjectId, sellerId: Schema.Types.ObjectId, status: String, deliveryStage: String, statusHistory: [Schema.Types.Mixed], acceptedAt: Date }), 'orders');
export const Payment = modelFor('AgriLinkPayment', loose({ order: Schema.Types.ObjectId, orderId: Schema.Types.ObjectId, payer: Schema.Types.ObjectId, status: String }), 'payments');
export const Notification = modelFor('AgriLinkNotification', loose({ user: Schema.Types.ObjectId, userId: Schema.Types.ObjectId, isRead: Boolean }), 'notifications');
export const NotificationLog = modelFor('AgriLinkNotificationLog', loose({ userId: Schema.Types.ObjectId, status: String }), 'notificationlogs');
export const MarketPrice = modelFor('AgriLinkMarketPrice', loose({ crop: String, county: String, observedAt: Date, isDemo: Boolean }), 'marketprices');
export const MarketDataSource = modelFor('AgriLinkMarketDataSource', loose({ name: String, sourceType: String, baseUrl: String, isActive: Boolean, createdBy: Schema.Types.ObjectId, updatedBy: Schema.Types.ObjectId }), 'marketdatasources');
export const ProviderSync = modelFor('AgriLinkProviderSync', loose({ source: Schema.Types.ObjectId, status: String, startedAt: Date, completedAt: Date, recordsSeen: Number, recordsAccepted: Number, recordsRejected: Number }), 'providersyncs');
export const RefreshToken = modelFor('AgriLinkRefreshToken', loose({
  user: { type: Schema.Types.ObjectId, index: true }, tokenHash: { type: String, select: false },
  family: String, expiresAt: { type: Date, index: true }, revokedAt: Date, refreshTokenVersion: Number,
}), 'refreshtokens');
export const IdempotencyKey = modelFor('AgriLinkIdempotencyKey', loose({
  key: { type: String, unique: true }, userId: Schema.Types.ObjectId, bodyHash: String,
  response: Schema.Types.Mixed, expiresAt: { type: Date, index: true },
}), 'idempotencykeys');
export const VerificationRequest = modelFor('AgriLinkVerificationRequest', loose({ user: Schema.Types.ObjectId, status: String }), 'verificationrequests');
export const AuditLog = modelFor('AgriLinkAuditLog', loose({ actor: Schema.Types.ObjectId, action: String, resource: String }), 'auditlogs');
export const Conversation = modelFor('AgriLinkConversation', loose({ participants: [Schema.Types.ObjectId], productId: Schema.Types.ObjectId, createdBy: Schema.Types.ObjectId, status: String, statusUpdatedBy: Schema.Types.ObjectId, statusUpdatedAt: Date, lastMessageAt: Date }), 'conversations');
export const Message = modelFor('AgriLinkMessage', loose({ conversation: Schema.Types.ObjectId, sender: Schema.Types.ObjectId, text: String }), 'messages');
export const AiConversation = modelFor('AgriLinkAiConversation', loose({ user: Schema.Types.ObjectId, capability: String }), 'aiconversations');
export const AiMessage = modelFor('AgriLinkAiMessage', loose({ conversation: Schema.Types.ObjectId, role: String, content: String }), 'aimessages');
export const ContactMessage = modelFor('AgriLinkContactMessage', loose({ email: String, status: String }), 'contactmessages');
export const Report = modelFor('AgriLinkReport', loose({ reporter: Schema.Types.ObjectId, status: String }), 'reports');
export const Setting = modelFor('AgriLinkSetting', loose({ scope: String, value: Schema.Types.Mixed }), 'settings');
export const FAQ = modelFor('AgriLinkFAQ', loose({ question: String, answer: String, isActive: Boolean }), 'faqs');
export const NewsletterSubscriber = modelFor('AgriLinkNewsletterSubscriber', loose({ email: String, status: String }), 'newslettersubscribers');
export const Offer = modelFor('AgriLinkOffer', loose({ sellerId: Schema.Types.ObjectId, isActive: Boolean }), 'offers');
export const Review = modelFor('AgriLinkReview', loose({ reviewer: Schema.Types.ObjectId, productId: Schema.Types.ObjectId, orderId: Schema.Types.ObjectId, rating: Number, isVerifiedPurchase: Boolean, status: String, isVisible: Boolean }), 'reviews');
export const Favorite = modelFor('AgriLinkFavorite', loose({ user: Schema.Types.ObjectId, product: Schema.Types.ObjectId }), 'favorites');
export const Withdraw = modelFor('AgriLinkWithdraw', loose({ sellerId: Schema.Types.ObjectId, status: String }), 'withdraws');
export const Otp = modelFor('AgriLinkOtp', loose({
  sentTo: String, purpose: String, otp: { type: String, select: false },
  otpHash: { type: String, select: false }, tokenHash: { type: String, select: false },
  registrationData: { type: Schema.Types.Mixed, select: false }, expiresAt: Date, status: String,
  attempts: Number, resendAttempts: Number, resendInProgress: Boolean, resendStartedAt: Date,
}), 'otps');
export const PurchaseRequest = modelFor('AgriLinkPurchaseRequest', loose({ buyer: Schema.Types.ObjectId, status: String }), 'purchaserequests');
export const Announcement = modelFor('AgriLinkAnnouncement', loose({ author: Schema.Types.ObjectId, status: String }), 'announcements');
export const AiUsage = modelFor('AgriLinkAiUsage', loose({ user: Schema.Types.ObjectId, capability: String, status: String }), 'aiusage');
export const AdminRole = modelFor('AgriLinkAdminRole', loose({ name: String, permissions: [String], isActive: Boolean }), 'adminroles');

export const allExistingModels = {
  User, FarmerProfile, BuyerProfile, Farm, Product, Category, Shop, CartItem, Order, Payment,
  Notification, NotificationLog, MarketPrice, MarketDataSource, ProviderSync, RefreshToken, IdempotencyKey, VerificationRequest,
  AuditLog, Conversation, Message, AiConversation, AiMessage, ContactMessage, Report, Setting,
  FAQ, NewsletterSubscriber, Offer, Review, Favorite, Withdraw, Otp, PurchaseRequest, Announcement, AiUsage, AdminRole,
};
