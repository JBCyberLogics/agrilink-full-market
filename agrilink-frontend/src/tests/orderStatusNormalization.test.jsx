import { describe, expect, it } from 'vitest'
import { normalizeOrder } from '../features/orders/services/orderService.js'

describe('order status normalization', () => {
  it.each([
    ['pending', 'Pending'],
    ['confirmed', 'Confirmed'],
    ['packed', 'Packed'],
    ['in_transit', 'In transit'],
    ['out_for_delivery', 'Out for delivery'],
    ['ready_for_pickup', 'Ready for pickup'],
    ['delivered', 'Delivered'],
    ['cancelled', 'Cancelled'],
  ])('preserves the %s delivery state', (source, label) => {
    expect(normalizeOrder({ status: source, paymentStatus: 'pending' }).status).toBe(label)
  })

  it('labels payment independently from delivery status and does not infer a result', () => {
    expect(normalizeOrder({ status: 'packed', paymentStatus: 'pending_verification' })).toMatchObject({
      status: 'Packed',
      paymentStatus: 'Pending verification',
    })
    expect(normalizeOrder({ status: 'pending' }).paymentStatus).toBe('Unavailable')
    expect(normalizeOrder({ status: 'pending', paymentStatus: 'paid' }).paymentStatus).toBe('Paid')
  })
})
