import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

const deps = vi.hoisted(() => ({ farmerBuyerMatches: vi.fn() }))
vi.mock('../features/farmer/services/farmerService.js', () => ({ farmerBuyerMatches: deps.farmerBuyerMatches }))

import AIBuyerMatching from '../features/ai/pages/farmer/AIBuyerMatching.jsx'

describe('farmer buyer matching', () => {
  beforeEach(() => deps.farmerBuyerMatches.mockReset())

  it('loads and displays only backend buyer requests and their score coverage', async () => {
    deps.farmerBuyerMatches.mockResolvedValue({ matches: [{
      id: 'request-1', buyerName: 'Buyer account', produce: 'Maize', quantity: 2, unit: 'kg',
      location: 'Kiambu', matchScore: 97.45, scoreCoverage: 55,
      explanation: '2 kg requested. Distance is unavailable because these records do not include verified coordinates.',
    }] })
    render(<AIBuyerMatching />)
    fireEvent.change(screen.getByLabelText('Produce type'), { target: { value: 'Maize' } })
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: 'Kiambu' } })
    fireEvent.click(screen.getByRole('button', { name: /Find matching buyers/i }))

    await waitFor(() => expect(deps.farmerBuyerMatches).toHaveBeenCalledWith(expect.objectContaining({
      produceType: 'Maize', quantity: 5, unit: 'kg', location: 'Kiambu',
    })))
    expect(await screen.findByText('Buyer account · Maize')).toBeTruthy()
    expect(screen.getByText('97.45% match · 55% data')).toBeTruthy()
    expect(screen.getByText(/Distance is unavailable/)).toBeTruthy()
  })

  it('shows an honest empty state when there are no matching requests', async () => {
    deps.farmerBuyerMatches.mockResolvedValue({ matches: [] })
    render(<AIBuyerMatching />)
    fireEvent.change(screen.getByLabelText('Produce type'), { target: { value: 'Maize' } })
    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: /Find matching buyers/i }))

    expect(await screen.findByText('No matching open buyer requests')).toBeTruthy()
    expect(screen.getByText(/Requests appear here when a buyer asks for produce/)).toBeTruthy()
  })
})
