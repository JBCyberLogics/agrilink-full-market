import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import FarmProfile from '../features/farmer/pages/FarmProfile.jsx'

const service = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }))
vi.mock('../features/farmer/services/farmerService.js', () => ({ farmerFarmProfile: service.load, farmerSaveFarmProfile: service.save }))

beforeEach(() => { vi.clearAllMocks(); service.load.mockResolvedValue({ exists: false, profile: {} }) })
afterEach(cleanup)

describe('FarmProfile persistence and identity boundary', () => {
  it('does not render a farm form when the farmer session is rejected', async () => {
    service.load.mockRejectedValue({ status: 403, code: 'SESSION_REALM_MISMATCH', error: 'Farmer session required.' })
    render(<FarmProfile />)
    expect((await screen.findByRole('alert')).textContent).toContain('Farmer session required.')
    expect(screen.queryByLabelText('Farm name')).toBeNull()
  })

  it('creates a farm profile with required user-entered fields and refreshes from the saved response', async () => {
    service.save.mockImplementation(async (profile) => profile)
    render(<FarmProfile />)
    fireEvent.change(await screen.findByLabelText(/Farm name/), { target: { value: 'My farm' } })
    fireEvent.change(screen.getByLabelText(/County/), { target: { value: 'User entered county' } })
    fireEvent.change(screen.getByLabelText(/Main crops/), { target: { value: 'Maize, Beans' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save farm profile' }))
    expect(await screen.findByText(/Farm profile saved and reloaded/)).toBeTruthy()
    expect(service.save).toHaveBeenCalledWith(expect.objectContaining({ farmName: 'My farm', county: 'User entered county', mainCrops: ['Maize', 'Beans'] }), false)
    await waitFor(() => expect(screen.getByDisplayValue('My farm')).toBeTruthy())
  })

  it('loads a saved profile and updates it using the persisted state', async () => {
    service.load.mockResolvedValue({ exists: true, profile: { farmName: 'Saved farm', county: 'Saved county', mainCrops: ['Maize'] } })
    service.save.mockImplementation(async (profile) => profile)
    render(<FarmProfile />)
    const farmName = await screen.findByDisplayValue('Saved farm')
    fireEvent.change(farmName, { target: { value: 'Updated farm' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save farm profile' }))
    expect(await screen.findByText(/Farm profile saved and reloaded/)).toBeTruthy()
    expect(service.save).toHaveBeenCalledWith(expect.objectContaining({ farmName: 'Updated farm' }), true)
  })
})
