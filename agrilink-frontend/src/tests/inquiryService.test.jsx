import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({ post: vi.fn() }))
const chats = vi.hoisted(() => ({ list: vi.fn(), setStatus: vi.fn() }))
const messages = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('../services/api/client.js', () => ({ api }))
vi.mock('../services/api/endpoints.js', () => ({ chats, messages }))

import { createInquiry, farmerInquiries, farmerRespondInquiry, normalizeInquiry } from '../features/inquiries/services/inquiryService.js'

beforeEach(() => {
  vi.clearAllMocks()
  api.post.mockResolvedValue({ id: 'message-1', conversationId: 'conversation-1' })
  chats.list.mockResolvedValue([{ id: 'conversation-1', participants: [{ id: 'self', fullName: 'Farmer account' }], recipient: { id: 'buyer', fullName: 'Buyer account' }, listingName: 'Green maize', message: 'Is this available?', reply: 'Yes.', status: 'replied' }])
  chats.setStatus.mockResolvedValue({ id: 'conversation-1', status: 'Closed' })
  messages.send.mockResolvedValue({ status: 'Replied', conversation: { id: 'conversation-1', recipient: { id: 'buyer', fullName: 'Buyer account' }, listingName: 'Green maize', message: 'Is this available?', reply: 'Thanks for your order.', status: 'replied' } })
})

describe('persisted buyer-farmer inquiries', () => {
  it('starts a listing-linked conversation using the real listing id and message', async () => {
    const result = await createInquiry({ listingId: 'listing-1', message: 'Is this available?' })
    expect(api.post).toHaveBeenCalledWith('/message/send-message', { productId: 'listing-1', text: 'Is this available?' })
    expect(result.inquiry).toMatchObject({ id: 'message-1', message: 'Is this available?', status: 'Open' })
  })

  it('shows the other participant and persisted conversation status', async () => {
    expect(normalizeInquiry({ id: 'conversation-1', participants: [{ id: 'self', fullName: 'Farmer account' }], recipient: { id: 'buyer', fullName: 'Buyer account' }, listingName: 'Green maize', message: 'Is this available?', reply: 'Yes.', status: 'replied' })).toMatchObject({ buyerName: 'Buyer account', listingName: 'Green maize', status: 'Replied', reply: 'Yes.' })
    const result = await farmerInquiries()
    expect(chats.list).toHaveBeenCalledTimes(1)
    expect(result.inquiries[0]).toMatchObject({ buyerName: 'Buyer account', message: 'Is this available?', status: 'Replied' })
  })

  it('persists a farmer response and returns the updated conversation', async () => {
    const result = await farmerRespondInquiry('conversation-1', 'Replied', 'Thanks for your order.')
    expect(messages.send).toHaveBeenCalledWith({ conversationId: 'conversation-1', text: 'Thanks for your order.' })
    expect(chats.setStatus).not.toHaveBeenCalled()
    expect(result.inquiry).toMatchObject({ id: 'conversation-1', status: 'Replied', reply: 'Thanks for your order.' })
  })

  it('closes an inquiry through the status endpoint without pretending to send a reply', async () => {
    const result = await farmerRespondInquiry('conversation-1', 'Closed')
    expect(chats.setStatus).toHaveBeenCalledWith('conversation-1', 'closed')
    expect(messages.send).not.toHaveBeenCalled()
    expect(result.inquiry).toMatchObject({ id: 'conversation-1', status: 'Closed' })
  })
})
