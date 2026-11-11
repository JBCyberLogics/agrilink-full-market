import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const reviewApi = vi.hoisted(() => ({
  summary: vi.fn(),
  forProduct: vi.fn(),
  canReview: vi.fn(),
  create: vi.fn(),
}))

vi.mock('../services/api/endpoints.js', () => ({ reviews: reviewApi }))

import ProductDetailModal from '../features/marketplace/components/ProductDetailModal.jsx'

const product = { id: 'listing-123', name: 'Green maize', category: 'Grains', farmer: 'Farmer account', price: 40, stock: 12, unit: 'kg' }

beforeEach(() => {
  vi.clearAllMocks()
  reviewApi.summary.mockResolvedValue({ productId: product.id, count: 0, averageRating: null })
  reviewApi.forProduct.mockResolvedValue({ data: [] })
  reviewApi.canReview.mockResolvedValue({ eligible: false, reason: 'no_delivered_order' })
  reviewApi.create.mockResolvedValue({ id: 'review-1' })
})

describe('marketplace buyer reviews', () => {
  it('shows an honest empty state and delivered-order eligibility', async () => {
    render(<ProductDetailModal product={product} open onClose={() => {}} />)

    expect(await screen.findByText('No reviews yet')).toBeTruthy()
    expect(screen.getByText(/available after an order containing this listing is delivered/i)).toBeTruthy()
    expect(screen.queryByText(/5\.0/)).toBeNull()
  })

  it('submits a verified review and refreshes from the backend response', async () => {
    let reviewSaved = false
    reviewApi.canReview.mockImplementation(async () => reviewSaved
      ? { eligible: false, reason: 'already_reviewed' }
      : { eligible: true, orderId: 'delivered-order-1' })
    reviewApi.create.mockImplementation(async (body) => {
      reviewSaved = true
      expect(body).toEqual({ productId: product.id, rating: 4, comment: 'Fresh produce and helpful updates.' })
      return { id: 'review-1', verifiedPurchase: true }
    })
    reviewApi.summary.mockImplementation(async () => reviewSaved
      ? { productId: product.id, count: 1, averageRating: 4 }
      : { productId: product.id, count: 0, averageRating: null })
    reviewApi.forProduct.mockImplementation(async () => ({ data: reviewSaved ? [{ id: 'review-1', rating: 4, comment: 'Fresh produce and helpful updates.', reviewerName: 'Mumbi Njeri', verifiedPurchase: true }] : [] }))
    render(<ProductDetailModal product={product} open onClose={() => {}} />)

    fireEvent.change(await screen.findByRole('combobox', { name: 'Your rating' }), { target: { value: '4' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Review comment' }), { target: { value: 'Fresh produce and helpful updates.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit verified review' }))

    await waitFor(() => expect(reviewApi.create).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Mumbi Njeri')).toBeTruthy()
    expect(screen.getByText('Verified purchase')).toBeTruthy()
    expect(screen.getByText(/4\.0/)).toBeTruthy()
  })
})
