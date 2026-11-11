/**
 * Inquiries service — buyer ↔ farmer conversations backed by the
 * /api/v1 chat and message modules.
 */
import { api } from '../../../services/api/client.js'
import { chats } from '../../../services/api/endpoints.js'

const unwrapList = (res) => (Array.isArray(res) ? res : res?.data ?? res?.result ?? [])

export function normalizeInquiry(c = {}) {
  const other = c.recipient ?? c.otherParty ?? c.user ?? (c.participants ?? []).find((p) => p && typeof p === 'object') ?? {}
  const rawStatus = String(c.status ?? 'open').toLowerCase()
  const status = rawStatus.includes('clos') ? 'Closed' : rawStatus.includes('repl') ? 'Replied' : 'Open'
  return {
    id: c._id ?? c.id,
    listingName: c.listingName ?? c.product?.name ?? c.productName ?? 'Produce inquiry',
    buyerName: other.fullName ?? other.name ?? 'Buyer',
    message: c.message ?? c.initialMessage?.text ?? '',
    reply: c.reply ?? '',
    status,
    createdAt: c.createdAt ?? c.updatedAt,
  }
}

export async function createInquiry({ listingId, message } = {}) {
  const result = await api.post('/message/send-message', { productId: listingId, text: message })
  return { ok: true, inquiry: normalizeInquiry({ ...(result?.data ?? result ?? {}), message, status: 'Open' }) }
}

export async function buyerInquiries() {
  return { inquiries: unwrapList(await chats.list()).map(normalizeInquiry) }
}

export async function farmerInquiries() {
  return { inquiries: unwrapList(await chats.list()).map(normalizeInquiry) }
}

export async function farmerRespondInquiry(id, status, reply = '') {
  if (reply.trim()) await api.post('/message/send-message', { chatId: id, text: reply.trim() })
  const nextStatus = String(status).toLowerCase() === 'closed' ? 'closed' : 'replied'
  const result = await chats.setStatus(id, nextStatus)
  return { inquiry: { id, status: result?.status ?? status, reply } }
}
