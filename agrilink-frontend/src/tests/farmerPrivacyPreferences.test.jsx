import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const accountApi = vi.hoisted(() => ({ getMyAccountProfile: vi.fn(), updateMyAccountProfile: vi.fn(), changeMyPassword: vi.fn(), deleteMyAccount: vi.fn() }))
const settingsApi = vi.hoisted(() => ({
  createExtendedProfile: vi.fn(), deleteExtendedProfile: vi.fn(), isAvatarStorageConfigured: vi.fn(), isEmailChangeConfigured: vi.fn(), isProfilePersistenceConfigured: vi.fn(), readExtendedProfile: vi.fn(), removeProfilePicture: vi.fn(), requestEmailChange: vi.fn(), updateExtendedProfile: vi.fn(), uploadProfilePicture: vi.fn(), verifyEmailChange: vi.fn(), readPrivacyPreferences: vi.fn(), savePrivacyPreferences: vi.fn(), readAccountPreferences: vi.fn(), saveAccountPreferences: vi.fn(),
}))
const notificationApi = vi.hoisted(() => ({ preferences: vi.fn(), updatePreferences: vi.fn() }))

vi.mock('../features/settings/services/accountSettingsService', () => accountApi)
vi.mock('../features/settings/services/profileSettingsService', () => settingsApi)
vi.mock('../services/api/endpoints.js', () => ({ notifications: notificationApi }))

import AccountSettings from '../features/settings/components/AccountSettings.jsx'

beforeEach(() => {
  cleanup(); vi.clearAllMocks()
  accountApi.getMyAccountProfile.mockResolvedValue({ id: 'farmer-id', fullName: 'Farmer Name', email: 'farmer@example.test', role: 'seller', memberSince: null })
  settingsApi.isProfilePersistenceConfigured.mockReturnValue(true)
  settingsApi.isAvatarStorageConfigured.mockReturnValue(true)
  settingsApi.isEmailChangeConfigured.mockReturnValue(false)
  settingsApi.readExtendedProfile.mockResolvedValue({ configured: true, profile: { farmName: 'User farm', county: 'User county', mainCrops: ['Maize'] } })
  settingsApi.readPrivacyPreferences.mockResolvedValue({ configured: true, preferences: { showSellerName: true, showLocation: true, shareContactInformation: false } })
  settingsApi.savePrivacyPreferences.mockImplementation(async (preferences) => preferences)
  settingsApi.readAccountPreferences.mockResolvedValue({ configured: false, preferences: { defaultListingUnit: null } })
  settingsApi.saveAccountPreferences.mockImplementation(async (preferences) => ({ preferences }))
  notificationApi.preferences.mockResolvedValue({ configured: false, preferences: { messages: true, orders: true }, delivery: { email: 'unavailable', push: 'unavailable' } })
})
afterEach(cleanup)

describe('Farmer privacy and account preferences', () => {
  it('loads, persists, and applies the real seller visibility choices', async () => {
    render(<AccountSettings role="Farmer" />)
    await screen.findByRole('heading', { name: 'Farmer Name' })
    fireEvent.click(screen.getByRole('button', { name: 'Privacy' }))
    const showName = await screen.findByLabelText(/Show my name on public listings/)
    const shareContact = screen.getByLabelText(/Share my contact details with marketplace visitors/)
    fireEvent.click(showName)
    fireEvent.click(shareContact)
    fireEvent.click(screen.getByRole('button', { name: 'Save privacy settings' }))
    await waitFor(() => expect(settingsApi.savePrivacyPreferences).toHaveBeenCalledWith({ showSellerName: false, showLocation: true, shareContactInformation: true }))
    expect(await screen.findByText(/enforced on public listing responses/)).toBeTruthy()
  })

  it('saves a default listing unit that the produce form can load from the account API', async () => {
    render(<AccountSettings role="Farmer" />)
    await screen.findByRole('heading', { name: 'Farmer Name' })
    fireEvent.click(screen.getByRole('button', { name: 'Account preferences' }))
    const unit = await screen.findByLabelText('Default unit for new produce listings')
    fireEvent.change(unit, { target: { value: 'crate' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))
    await waitFor(() => expect(settingsApi.saveAccountPreferences).toHaveBeenCalledWith({ defaultListingUnit: 'crate' }))
    expect(await screen.findByText(/New produce forms will use it/)).toBeTruthy()
  })
})
