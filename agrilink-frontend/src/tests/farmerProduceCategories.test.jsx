import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const services = vi.hoisted(() => ({
  categories: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  update: vi.fn(),
  toggleAvailability: vi.fn(),
  upload: vi.fn(),
  accountPreferences: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('../features/marketplace/services/marketplaceService.js', () => ({ marketCategories: services.categories }))
vi.mock('../features/farmer/services/farmerService.js', () => ({
  farmerCreateListing: services.create,
  farmerDeleteListing: services.remove,
  farmerUpdateListing: services.update,
  farmerToggleListingAvailability: services.toggleAvailability,
  farmerUploadImage: services.upload,
  farmerAccountPreferences: services.accountPreferences,
}))
vi.mock('../features/farmer/hooks/useFarmerListings.js', () => ({
  default: () => ({ status: 'ok', listings: [], error: null, refresh: services.refresh }),
}))

import MyProduce from '../features/farmer/pages/MyProduce.jsx'

describe('farmer produce category integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    services.categories.mockResolvedValue([{ id: 'active-category-id', name: 'Root Vegetables' }])
    services.accountPreferences.mockResolvedValue({ preferences: { defaultListingUnit: null } })
    services.create.mockResolvedValue({ listing: { id: 'persisted-listing-id', name: 'Cassava', category: 'Root Vegetables', price: 50, unit: 'kg', stock: 8, available: true } })
  })
  afterEach(cleanup)

  it('loads persisted active categories and submits the selected category id', async () => {
    render(<MyProduce />)
    const categorySelect = await screen.findByLabelText('Category')
    expect(categorySelect.querySelector('option[value="active-category-id"]')?.textContent).toBe('Root Vegetables')
    expect(screen.queryByRole('option', { name: 'Grains' })).toBeNull()

    fireEvent.change(screen.getByLabelText('Produce name'), { target: { value: 'Cassava' } })
    fireEvent.change(categorySelect, { target: { value: 'active-category-id' } })
    fireEvent.change(screen.getByLabelText('Price per unit (KSh)'), { target: { value: '50' } })
    fireEvent.change(screen.getByLabelText('Available stock'), { target: { value: '8' } })
    fireEvent.change(screen.getByLabelText('Pickup / farm location'), { target: { value: 'User entered county' } })
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'User entered quality details' } })
    fireEvent.click(screen.getByRole('button', { name: 'Post produce' }))

    await screen.findByText('Listing saved to your produce.')
    expect(services.create).toHaveBeenCalledWith(expect.objectContaining({ name: 'Cassava', category: 'active-category-id', price: 50, stock: 8, location: 'User entered county', description: 'User entered quality details' }))
  })
})
