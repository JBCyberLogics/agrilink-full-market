import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const service = vi.hoisted(() => ({ list: vi.fn(), respond: vi.fn() }))
vi.mock('../features/inquiries/services/inquiryService.js', () => ({ farmerInquiries: service.list, farmerRespondInquiry: service.respond }))
import FarmerInquiries from '../features/inquiries/pages/FarmerInquiries.jsx'

beforeEach(() => { cleanup(); vi.clearAllMocks(); service.list.mockResolvedValue({ inquiries: [{ id: 'conversation-1', buyerName: 'Buyer', listingName: 'Produce', message: 'Is it available?', status: 'Open', createdAt: '2026-01-01T00:00:00Z', messages: [{ id: 'message-1', fromCurrentUser: false, text: 'Is it available?', createdAt: '2026-01-01T00:00:00Z' }] }] }) })
afterEach(cleanup)

describe('Farmer inquiry replies', () => {
  it('requires a real reply and updates conversation history after the server confirms sending', async () => {
    service.respond.mockResolvedValue({ inquiry: { id: 'conversation-1', buyerName: 'Buyer', listingName: 'Produce', message: 'Is it available?', reply: 'Yes, it is.', status: 'Replied', messages: [{ id: 'message-1', fromCurrentUser: false, text: 'Is it available?' }, { id: 'message-2', fromCurrentUser: true, text: 'Yes, it is.' }] } })
    render(<FarmerInquiries />)
    const send = await screen.findByRole('button', { name: 'Send reply' })
    expect(send.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Reply to buyer'), { target: { value: 'Yes, it is.' } })
    fireEvent.click(send)
    await waitFor(() => expect(service.respond).toHaveBeenCalledWith('conversation-1', 'Replied', 'Yes, it is.'))
    expect(await screen.findByText('Yes, it is.')).toBeTruthy()
    expect(screen.getByText('Replied')).toBeTruthy()
  })
})
