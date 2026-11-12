import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

const contactApi = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../services/api/endpoints.js', () => ({ contactMessages: contactApi }))

import ContactPage from '../features/support/pages/Contact.jsx'

const fillContactForm = () => {
  fireEvent.change(screen.getByLabelText('Full name *'), { target: { value: 'Test User' } })
  fireEvent.change(screen.getByLabelText('Email address *'), { target: { value: 'user@example.test' } })
  fireEvent.change(screen.getByLabelText('User type *'), { target: { value: 'Farmer' } })
  fireEvent.change(screen.getByLabelText('Message *'), { target: { value: 'Please help with my account access.' } })
}

describe('public support request', () => {
  beforeEach(() => contactApi.create.mockReset())
  afterEach(cleanup)

  it('persists the validated support request and confirms only receipt', async () => {
    contactApi.create.mockResolvedValue({ id: 'persisted-id', status: 'received' })
    render(<ContactPage />)
    fillContactForm()
    await act(async () => { fireEvent.submit(screen.getByRole('button', { name: 'Send message' }).closest('form')) })

    await screen.findByRole('status')
    expect(contactApi.create).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Test User',
      email: 'user@example.test',
      category: 'General enquiry',
      userType: 'Farmer',
      message: 'Please help with my account access.',
      subject: 'General enquiry · Farmer',
    }))
    expect(screen.getByText(/received and recorded for the support team/i)).toBeDefined()
  })

})
