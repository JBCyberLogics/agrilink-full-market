/**
 * Orders service — buyer checkout (server cart → order), buyer order
 * history and farmer order management on the /api/v1 backend.
 */
import { orders } from '../../../services/api/endpoints.js'

const unwrapList = (res) => (Array.isArray(res) ? res : res?.data ?? res?.result ?? [])

const STATUS_LABEL = {
  pending: 'Pending', confirmed: 'Confirmed', packed: 'Packed', in_transit: 'In transit',
  out_for_delivery: 'Out for delivery', ready_for_pickup: 'Ready for pickup', delivered: 'Delivered',
  cancelled: 'Cancelled', canceled: 'Cancelled',
}
const label = (s) => s == null || s === '' ? 'Unknown' : STATUS_LABEL[String(s).toLowerCase()] ?? String(s)
const PAYMENT_STATUS_LABEL = {
  pending: 'Pending', pending_verification: 'Pending verification', paid: 'Paid',
  failed: 'Failed', cancelled: 'Cancelled', canceled: 'Cancelled', refunded: 'Refunded',
}
const paymentLabel = (s) => s == null || s === '' ? 'Unavailable' : PAYMENT_STATUS_LABEL[String(s).toLowerCase()] ?? String(s)

const positiveNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

/* UI transitions → backend delivery stage */
const STAGE_FOR = {
  Confirmed: 'confirmed', Packed: 'packed', 'In transit': 'in_transit',
  'Out for delivery': 'out_for_delivery', 'Ready for pickup': 'ready_for_pickup', Delivered: 'delivered',
}

export function normalizeOrder(o = {}) {
  const candidateItems = o.orderItems ?? o.items ?? o.products
  const items = Array.isArray(candidateItems) ? candidateItems : []
  const first = items[0] ?? {}
  const product = first.product ?? first.productId ?? {}
  const quantity = items.length > 1 ? null : positiveNumber(first.quantity ?? o.quantity)
  const rawPrice = first.unitPrice ?? first.price ?? product.price
  const unitPrice = items.length > 1 ? null : positiveNumber(rawPrice)
  const rawTotal = o.totalAmount ?? o.totalPrice ?? o.total ?? (o.totalCents == null ? null : Number(o.totalCents) / 100)
  const totalAmount = positiveNumber(rawTotal)
  return {
    id: o._id ?? o.id,
    name: items.length > 1 ? `Order with ${items.length} items` : product.name ?? first.name ?? o.name ?? 'Order item details unavailable',
    quantity,
    unit: product.measurementUnit ?? product.unit ?? first.unit ?? null,
    unitPrice,
    totalAmount,
    status: label(o.deliveryStage ?? o.status ?? o.orderStatus),
    paymentStatus: paymentLabel(o.paymentStatus),
    buyerName: o.user?.fullName ?? o.user?.name ?? o.customer?.name ?? 'Buyer name unavailable',
    createdAt: o.createdAt,
    items,
  }
}

/** The backend cart is authoritative. Checkout sends only the address and an
 * idempotency key; prices and quantities are recalculated by the server. */
export async function createOrder({ items = [], address } = {}) {
  if (!items.length) throw { error: 'Your basket is empty.' }
  if (!address) throw { error: 'A delivery address is required.' }
  const keyName = 'agrilink.checkout.idempotency-key'
  let idempotencyKey = sessionStorage.getItem(keyName)
  if (!idempotencyKey) {
    idempotencyKey = crypto.randomUUID()
    sessionStorage.setItem(keyName, idempotencyKey)
  }
  const result = await orders.create({ address, idempotencyKey })
  sessionStorage.removeItem(keyName)
  const list = (Array.isArray(result?.orders) ? result.orders : Array.isArray(result) ? result : [result]).filter(Boolean)
  return { ok: true, orders: list.map((o) => ({ ...normalizeOrder(o), raw: o })) }
}

export async function buyerOrders() {
  return { orders: unwrapList(await orders.list()).map(normalizeOrder) }
}

export async function farmerOrders() {
  return { orders: unwrapList(await orders.list()).map(normalizeOrder) }
}

export async function farmerUpdateOrderStatus(id, status) {
  if (status === 'Cancelled') {
    await orders.remove(id)
    return { order: { id, status: 'Cancelled' } }
  }
  const stage = STAGE_FOR[status]
  if (!stage) throw { status: 400, error: `"${status}" is not a valid order update.` }
  const result = await orders.updateDeliveryStage(id, { stage })
  const updated = normalizeOrder({ _id: id, ...(result?.data ?? result ?? {}) })
  return { order: { ...updated, id } }
}
