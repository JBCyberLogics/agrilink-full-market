/**
 * Complete AgriLink /api/v1 SDK — one function per backend operation
 * (OpenAPI "AgriLink API" 1.0.0, 25 modules). Feature code imports from here.
 */
import { api, request, requestRaw, tokens } from './client.js'

const enc = encodeURIComponent

/* OTP challenges are validated from the JSON body; these requests do not
   require an authenticated user session. CSRF protection remains in client.js. */
const otpRequestOptions = { auth: false }

/* ----------------------------------------------------------------- Auth */
export const auth = {
  login: async (body) => {
    const data = await api.post('/auth/login', body, { auth: false })
    tokens.set(data)
    return data
  },
  adminLogin: (body) => api.post('/auth/admin/login', body, { auth: false }),
  me: () => api.get('/auth/me'),
  refreshToken: () =>
    api.post('/auth/refresh-token', undefined, { auth: false }),
  googleLogin: async (body) => {
    const data = await api.post('/auth/google-login', body, { auth: false })
    tokens.set(data)
    return data
  },
  appleLogin: async (body) => {
    const data = await api.post('/auth/apple-login', body, { auth: false })
    tokens.set(data)
    return data
  },
  forgotPasswordOtp: (email) => api.post('/auth/forgot-password-otp', { email }, { auth: false }),
  forgotPasswordOtpResend: (token) => api.patch('/auth/forgot-password-otp-resend', { token }, { auth: false }),
  forgotPasswordOtpMatch: (token, otp) =>
    api.patch('/auth/forgot-password-otp-match', { otp, token }, otpRequestOptions),
  forgotPasswordReset: (token, newPassword, confirmPassword) =>
    api.patch(
      '/auth/forgot-password-reset',
      { newPassword, confirmPassword, token },
      otpRequestOptions,
    ),
  changePassword: (body) => api.patch('/auth/change-password', body),
  logout: async () => { const result = await api.post('/auth/logout', {}); tokens.clear(); return result },
}

/* ------------------------------------------------------------------ OTP */
export const otp = {
  resend: (token) => api.patch('/otp/resend-otp', { token }, otpRequestOptions),
}

/* ----------------------------------------------------------------- User */
export const users = {
  create: (body) => api.post('/users/create', body, { auth: false }),
  verifyOtp: (token, code) =>
    api.post('/users/create-user-verify-otp', { otp: code, token }, otpRequestOptions),
  myProfile: () => api.get('/users/my-profile'),
  updateMyProfile: (body) => api.patch('/users/update-my-profile', body),
  deleteMyAccount: (body) => request('/users/delete-my-account', { method: 'DELETE', body }),
  allUsers: (query) => api.list('/users/all-users', query),
  dashboardOverview: () => api.get('/users/dashboard-overview'),
  toggleBlock: (id) => api.patch(`/users/${id}/block`),
}

/* -------------------------------------------------------------- Product */
export const products = {
  create: (body) => api.post('/product/create-product', body),
  list: (query) => api.list('/product', query),
  mine: (query) => api.list('/product/seller', query),
  sellerRequirements: () => api.get('/product/seller-required-working'),
  bestSelling: (query) => api.get('/product/best-selling', query),
  overview: () => api.get('/product/overview'),
  get: (id) => api.get(`/product/${id}`),
  remove: (id) => api.del(`/product/${id}`),
  update: (id, body) => api.patch(`/product/${id}`, body),
  toggleAvailability: (id) => api.patch(`/product/${id}/toggle-availability`),
}

/* ------------------------------------------------------------- Category */
export const categories = {
  create: (body) => api.post('/category/create-category', body),
  list: () => api.get('/category'),
  remove: (id) => api.del(`/category/${id}`),
  update: (id, body) => api.patch(`/category/${id}`, body),
}

/* ----------------------------------------------------------------- Cart */
export const cart = {
  add: (productId, quantity) => api.post('/cart/create-cart', { productId, quantity }),
  get: () => api.get('/cart'),
  increment: (id) => api.patch(`/cart/${id}/quantity/increment`),
  decrement: (id) => api.patch(`/cart/${id}/quantity/decrement`),
  remove: (id) => api.del(`/cart/${id}`),
  update: (productId, quantity) => api.patch(`/cart/items/${enc(productId)}`, { quantity }),
  removeProduct: (productId) => api.del(`/cart/items/${enc(productId)}`),
  clear: () => api.del('/cart'),
}
export const purchaseRequests = {
  list: (query) => api.list('/purchase-requests', query),
  matches: (query) => api.list('/purchase-requests/matches', query),
  create: (body) => api.post('/purchase-requests', body),
  cancel: (id) => api.patch(`/purchase-requests/${enc(id)}/cancel`, {}),
}

/* --------------------------------------------------------------- Orders */
export const orders = {
  create: (body) => api.post('/checkout', body, { headers: { 'Idempotency-Key': body.idempotencyKey } }),
  list: (query) => api.list('/order', query),
  get: (id) => api.get(`/order/${id}`),
  remove: (id) => api.post(`/order/${id}/cancel`, {}),
  /** stage: packed | in_transit | out_for_delivery | delivered | ready_for_pickup */
  updateDeliveryStage: (id, body) => api.patch(`/order/${id}/delivery-stage`, body),
  requestReturn: (id, body) => api.post(`/order/${id}/return`, body),
}

/* -------------------------------------------------------------- Payment */
export const payments = {
  mpesaInitiate: (body) => api.post('/payments/mpesa/initiate', body),
  mpesaStatus: (checkoutRequestID) => api.get(`/payments/mpesa/status/${enc(checkoutRequestID)}`),
  paypalConfig: () => api.get('/payments/paypal/config'),
  paypalCreateOrder: (body) => api.post('/payments/paypal/create-order', body),
  paypalCaptureOrder: (body) => api.post('/payments/paypal/capture-order', body),
  paypalStatus: (paypalOrderId) => api.get(`/payments/paypal/status/${enc(paypalOrderId)}`),
  list: (query) => api.list('/payments', query),
  mine: (query) => api.list('/payment/user', query),
  incomeRatio: (query) => api.get('/payment/all-income-rasio', query),
  incomeRatioByDays: (query) => api.get('/payment/all-income-rasio-by-days', query),
  get: (id) => api.get(`/payment/${id}`),
  remove: (id) => api.del(`/payment/${id}`),
}

/* ------------------------------------------------------------- Withdraw */
export const withdrawals = {
  list: (query) => api.list('/admin/withdrawals', query),
}

/* ---------------------------------------------------------------- Offer */
export const offers = {
  create: (body) => api.post('/offer/add-offer', body),
  get: (id) => api.get(`/offer/${id}`),
  remove: (id) => api.del(`/offer/${id}`),
  update: (id, body) => api.patch(`/offer/${id}`, body),
  updateImage: (id, body) => api.patch(`/offer/${id}/image`, body),
  mine: (query) => api.list('/offer', query),
  active: (query) => api.list('/offer/active', query),
  bestDeals: (query) => api.list('/offer/best-deals', query),
}

/* ------------------------------------------------------------- Favorite */
export const favorites = {
  list: (query) => api.list('/favorite-product', query),
  toggle: (productId) => api.post('/favorite-product', { productId }),
}

/* -------------------------------------------------------------- Ratings */
export const reviews = {
  create: (body) => api.post('/review', body),
  forProduct: (productId, query) => api.list(`/review/product/${enc(productId)}`, query),
  summary: (productId) => api.get(`/review/product/${enc(productId)}/summary`),
  canReview: (query) => api.get('/review/can-review', query),
  remove: (id) => api.del(`/review/${enc(id)}`),
  update: (id, body) => api.patch(`/review/${enc(id)}`, body),
}

/* --------------------------------------------------------- Chat/Message */
export const chats = {
  list: async (query) => {
    const result = await api.get('/messages/conversations', query)
    return result?.conversations ?? []
  },
  unreadCount: () => api.get('/chat/unread-count'),
  setStatus: (id, status) => api.patch(`/messages/conversations/${enc(id)}/status`, { status }),
}
export const messages = {
  list: (chatId, query) => api.get('/messages/messages', { conversationId: chatId, ...query }),
  send: (body) => api.post('/messages/send-message', body),
}

/* ----------------------------------------------------------------- Shop */
export const shops = {
  create: (body) => api.post('/shop/create-shop', body),
  list: (query) => api.list('/shop', query),
  mine: () => api.get('/shop/my-shop'),
  get: (id) => api.get(`/shop/${id}`),
  updateSettings: (body) => api.patch('/shop/my-shop/settings', body),
  verify: (id) => api.patch(`/shop/verify/${id}`),
  reject: (id, body) => api.patch(`/shop/reject/${id}`, body),
}

/* ------------------------------------------------------------- Shipment */
export const shipping = {
  rates: (orderId, body) => api.post(`/shipping/rates/${orderId}`, body),
  tracking: (orderId) => api.get(`/shipping/tacking/${orderId}`),
}

/* ------------------------------------------------------- Pickup address */
export const pickupAddress = {
  get: () => api.get('/pickup-address'),
  update: (body) => api.patch('/pickup-address', body),
}

/* -------------------------------------------------- Market Intelligence */
export const marketIntelligence = {
  prices: (query) => api.list('/market-intelligence/prices', query),
  createPrice: (body) => api.post('/market-intelligence/prices', body),
  pricesByCrop: (crop, query) => api.list(`/market-intelligence/prices/${enc(crop)}`, query),
  trends: (query) => api.get('/market-intelligence/trends', query),
  compare: (query) => api.get('/market-intelligence/compare', query),
  demand: (query) => api.get('/market-intelligence/demand', query),
  recommendations: (query) => api.get('/market-intelligence/recommendations', query),
}

/* ---------------------------------------------------- Agri Intelligence */
export const agri = {
  chat: (body) => api.post('/ai/shared/agricultural-assistant', body),
  analyzeCrop: (body) => api.post('/ai/farmer/crop-advisor', body),
  cropHistory: (query) => api.list('/crop-analysis/history', query),
  cropAnalysis: (id) => api.get(`/crop-analysis/${id}`),
  weatherCurrent: (query) => api.get('/weather/current', query),
  weatherForecast: (query) => api.get('/weather/forecast', query),
  agriculturalAdvice: (query) => api.get('/weather/agricultural-advice', query),
}

/* --------------------------------------------------------- Notification */
export const notifications = {
  create: (body) => api.post('/notification/create-notification', body),
  list: (query) => api.list('/notification', query),
  markAllRead: () => api.patch('/notification/read-all', {}),
  markRead: (id) => api.patch(`/notifications/${id}/read`, {}),
  remove: (id) => api.del(`/notification/${id}`),
  preferences: () => api.get('/notification/preferences'),
  updatePreferences: (body) => api.patch('/notification/preferences', body),
}

/* ----------------------------------------------------------- Newsletter */
export const newsletter = {
  subscribe: (email) => api.post('/newsletter/subscribe', { email }, { auth: false }),
  unsubscribe: (email) => api.post('/newsletter/unsubscribe', { email }, { auth: false }),
  list: (query) => api.list('/newsletter', query),
  remove: (id) => api.del(`/newsletter/${id}`),
}

/* ------------------------------------------------------ Contact message */
export const contactMessages = {
  list: (query) => api.list('/admin/support', query),
  create: (body) => api.post('/contact-message', body),
  get: (id) => api.get(`/admin/support/${enc(id)}`),
  updateStatus: (id, status, resolutionNote) => api.patch(`/admin/support/${enc(id)}`, { status, resolutionNote }),
  reply: (id, body) => api.post(`/admin/support/${enc(id)}/reply`, body),
}

/* ------------------------------------------------------ Settings / FAQ */
export const settings = {
  get: () => api.get('/setting', undefined, { auth: false }),
  update: (body) => api.patch('/setting', body),
}
export const faq = {
  create: (body) => api.post('/faq/create-faq', body),
  list: () => api.get('/faq', undefined, { auth: false }),
  remove: (id) => api.del(`/faq/${id}`),
  update: (id, body) => api.patch(`/faq/${id}`, body),
}

/* --------------------------------------------------------------- Report */
export const reports = {
  list: (query) => api.list('/admin/reports', query),
  create: (body) => api.post('/reports', body),
  update: (id, status, resolution) => api.patch(`/admin/reports/${enc(id)}`, { status, resolution }),
}
