/**
 * Inquiries service — buyer ↔ farmer conversations backed by the
 * /api/v1 chat and message modules.
 */
import { api } from '../../../services/api/client.js'
import { chats, messages as messageApi } from '../../../services/api/endpoints.js'

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
    messages: Array.isArray(c.messages) ? c.messages.map((message) => ({ id: message.id ?? message._id, senderId: message.senderId ?? null, fromCurrentUser: message.fromCurrentUser === true, text: message.text ?? message.message ?? '', createdAt: message.createdAt ?? null })) : [],
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
  if (String(status).toLowerCase() === 'closed') {
    const result = await chats.setStatus(id, 'closed')
    return { inquiry: { id, status: result?.status ?? 'Closed' } }
  }
  const text = String(reply ?? '').trim()
  if (!text) throw { status: 422, code: 'REPLY_REQUIRED', field: 'reply', error: 'Write a reply before sending.' }
  const result = await messageApi.send({ conversationId: id, text })
  if (result?.conversation) return { inquiry: normalizeInquiry(result.conversation) }
  const refreshed = await farmerInquiries()
  const inquiry = refreshed.inquiries.find((item) => item.id === id)
  if (!inquiry) throw { status: 502, error: 'The reply was sent, but the updated conversation could not be retrieved.' }
  return { inquiry }
}
