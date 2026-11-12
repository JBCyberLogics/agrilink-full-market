import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const accountApi = vi.hoisted(() => ({
  getMyAccountProfile: vi.fn(), updateMyAccountProfile: vi.fn(), changeMyPassword: vi.fn(), deleteMyAccount: vi.fn(),
}))
const profileApi = vi.hoisted(() => ({
  isProfilePersistenceConfigured: vi.fn(), isAvatarStorageConfigured: vi.fn(), isEmailChangeConfigured: vi.fn(),
  readExtendedProfile: vi.fn(), createExtendedProfile: vi.fn(), updateExtendedProfile: vi.fn(), deleteExtendedProfile: vi.fn(),
  readPrivacyPreferences: vi.fn(), savePrivacyPreferences: vi.fn(), readAccountPreferences: vi.fn(), saveAccountPreferences: vi.fn(),
  removeProfilePicture: vi.fn(), requestEmailChange: vi.fn(), uploadProfilePicture: vi.fn(), verifyEmailChange: vi.fn(),
}))
const notificationApi = vi.hoisted(() => ({ preferences: vi.fn(), updatePreferences: vi.fn() }))

vi.mock('../features/settings/services/accountSettingsService', () => accountApi)
vi.mock('../features/settings/services/profileSettingsService', () => profileApi)
vi.mock('../services/api/endpoints.js', () => ({ notifications: notificationApi }))

import AccountSettings from '../features/settings/components/AccountSettings.jsx'

const user = { id: 'farmer-test', fullName: 'Amina Otieno', email: 'farmer@example.test', role: 'farmer', createdAt: '2026-01-01T00:00:00.000Z' }
const originalProfile = { _id: 'profile-id', user: user.id, farmName: 'Old farm name', county: 'Kiambu', mainCrops: ['Maize'], createdAt: '2026-01-01T00:00:00.000Z', verificationStatus: 'unverified' }

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  accountApi.getMyAccountProfile.mockResolvedValue(user)
  accountApi.updateMyAccountProfile.mockResolvedValue(user)
  accountApi.changeMyPassword.mockResolvedValue({ changed: true })
  accountApi.deleteMyAccount.mockResolvedValue({ deleted: true })
  profileApi.isProfilePersistenceConfigured.mockReturnValue(true)
  profileApi.isAvatarStorageConfigured.mockReturnValue(false)
  profileApi.isEmailChangeConfigured.mockReturnValue(false)
  profileApi.readExtendedProfile.mockResolvedValue({ configured: true, profile: originalProfile })
  profileApi.updateExtendedProfile.mockResolvedValue({ role: 'farmer', profile: { ...originalProfile, farmName: 'Updated farm name' } })
  notificationApi.preferences.mockResolvedValue({ configured: false, preferences: { messages: true, orders: true }, delivery: { email: 'unavailable', push: 'unavailable' } })
  notificationApi.updatePreferences.mockResolvedValue({ configured: true, preferences: { messages: true, orders: true } })
})

afterEach(() => vi.restoreAllMocks())

describe('authenticated profile PATCH integration', () => {
  it('sends only changed editable profile fields and reloads the persisted result', async () => {
    profileApi.readExtendedProfile
      .mockResolvedValueOnce({ configured: true, profile: originalProfile })
      .mockResolvedValueOnce({ configured: true, profile: { ...originalProfile, farmName: 'Updated farm name' } })
    render(<AccountSettings role="Farmer" />)
    await screen.findByRole('heading', { name: 'Amina Otieno' })
    fireEvent.click(screen.getByRole('button', { name: 'Farm profile' }))
    fireEvent.change(screen.getByLabelText('Farm name'), { target: { value: 'Updated farm name' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(profileApi.updateExtendedProfile).toHaveBeenCalledWith({ farmName: 'Updated farm name' }))
    expect(await screen.findByText('The server accepted your profile update and the account has been refreshed.')).toBeTruthy()
    expect(screen.getByLabelText('Farm name').value).toBe('Updated farm name')
    expect(profileApi.readExtendedProfile).toHaveBeenCalledTimes(2)
  })

  it('shows a field-specific 422 response and leaves the saved profile unchanged', async () => {
    profileApi.updateExtendedProfile.mockRejectedValue({ status: 422, field: 'farmName', error: 'Enter a valid farm name.' })
    render(<AccountSettings role="Farmer" />)
    await screen.findByRole('heading', { name: 'Amina Otieno' })
    fireEvent.click(screen.getByRole('button', { name: 'Farm profile' }))
    fireEvent.change(screen.getByLabelText('Farm name'), { target: { value: 'New value' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    expect((await screen.findByRole('alert')).textContent).toContain('Enter a valid farm name.')
    expect(screen.getAllByText('Enter a valid farm name.')).toHaveLength(2)
    expect(document.querySelector('#profile-farmName')?.value).toBe('New value')
    expect(profileApi.readExtendedProfile).toHaveBeenCalledTimes(1)
  })
})
