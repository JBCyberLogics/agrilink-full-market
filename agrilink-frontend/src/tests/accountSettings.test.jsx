import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'

const accountApi = vi.hoisted(() => ({
  getMyAccountProfile: vi.fn(),
  updateMyAccountProfile: vi.fn(),
  changeMyPassword: vi.fn(),
  deleteMyAccount: vi.fn(),
}))
const notificationApi = vi.hoisted(() => ({ preferences: vi.fn(), updatePreferences: vi.fn() }))

vi.mock('../features/settings/services/accountSettingsService', () => accountApi)
vi.mock('../services/api/endpoints.js', () => ({ notifications: notificationApi }))

import AccountSettings from '../features/settings/components/AccountSettings'

const farmer = { id: 'farmer-test', fullName: 'Amina Otieno', email: 'amina@example.test', role: 'seller', memberSince: '2024-01-10' }
const buyer = { id: 'buyer-test', fullName: 'Brian Kamau', email: 'brian@example.test', role: 'customer', memberSince: '2024-03-12' }

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  accountApi.getMyAccountProfile.mockResolvedValue(farmer)
  accountApi.updateMyAccountProfile.mockImplementation(async ({ fullName }) => ({ ...farmer, fullName }))
  accountApi.changeMyPassword.mockResolvedValue({ success: true })
  accountApi.deleteMyAccount.mockResolvedValue({ success: true })
  notificationApi.preferences.mockResolvedValue({ configured: false, preferences: { messages: true, orders: true }, delivery: { email: 'unavailable', push: 'unavailable' } })
  notificationApi.updatePreferences.mockImplementation(async (preferences) => ({ configured: true, preferences, delivery: { email: 'unavailable', push: 'unavailable' } }))
})

describe('account profile and settings', () => {
  it('loads and updates the authenticated farmer name, then refreshes the shared identity', async () => {
    const onProfileUpdated = vi.fn()
    render(<AccountSettings role="Farmer" onProfileUpdated={onProfileUpdated} />)

    expect(await screen.findByRole('heading', { name: 'Amina Otieno' })).toBeTruthy()
    expect(screen.getByText('Farm profile')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Personal information' }))
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Wanjiku Otieno' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(() => expect(accountApi.updateMyAccountProfile).toHaveBeenCalledWith({ fullName: 'Amina Wanjiku Otieno' }))
    await waitFor(() => expect(onProfileUpdated).toHaveBeenCalledWith(expect.objectContaining({ fullName: 'Amina Wanjiku Otieno' })))
    expect(await screen.findByText('The server accepted your profile update and the account has been refreshed.')).toBeTruthy()
  })

  it('loads buyer settings from the same self-profile boundary and changes a password', async () => {
    accountApi.getMyAccountProfile.mockResolvedValue(buyer)
    render(<AccountSettings role="Buyer" />)

    expect(await screen.findByRole('heading', { name: 'Brian Kamau' })).toBeTruthy()
    expect(screen.getByText('Buyer profile')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Security' }))
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'current-secret' } })
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-secret-123' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-secret-123' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))

    await waitFor(() => expect(accountApi.changeMyPassword).toHaveBeenCalledWith({
      currentPassword: 'current-secret',
      newPassword: 'new-secret-123',
      confirmPassword: 'new-secret-123',
    }))
    expect(await screen.findByText('The password endpoint confirmed the change.')).toBeTruthy()
    expect(screen.getByLabelText('Current password').value).toBe('')
  })

  it('requires reauthentication before account deletion and signs out after server success', async () => {
    const onDeleted = vi.fn()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    accountApi.getMyAccountProfile.mockResolvedValue(buyer)
    render(<AccountSettings role="Buyer" onDeleted={onDeleted} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Security' }))
    await screen.findByDisplayValue('brian@example.test')

    fireEvent.click(screen.getByRole('button', { name: 'Delete AgriLink account' }))
    fireEvent.change(screen.getAllByLabelText('Current password')[1], { target: { value: 'current-secret' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm permanent deletion' }))

    await waitFor(() => expect(accountApi.deleteMyAccount).toHaveBeenCalledWith({ password: 'current-secret' }))
    expect(onDeleted).toHaveBeenCalledTimes(1)
    confirm.mockRestore()
  })

  it('shows the backend error instead of a fallback account', async () => {
    accountApi.getMyAccountProfile.mockRejectedValue({ error: 'Profile service unavailable.' })
    render(<AccountSettings role="Farmer" />)
    expect((await screen.findByRole('alert')).textContent).toContain('Profile service unavailable.')
    expect(screen.queryByText('Complete your profile')).toBeNull()
  })

  it('asks before in-app navigation while profile edits are unsaved', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<AccountSettings role="Farmer" />)
    await screen.findByRole('heading', { name: 'Amina Otieno' })
    fireEvent.click(screen.getByRole('button', { name: 'Personal information' }))
    fireEvent.change(screen.getByLabelText('Last name'), { target: { value: 'Wanjiku' } })

    const routeChange = new Event('agrilink:before-route-change', { cancelable: true })
    expect(window.dispatchEvent(routeChange)).toBe(false)
    expect(confirm).toHaveBeenCalledWith('You have unsaved profile changes. Leave this page and discard them?')
    confirm.mockRestore()
  })

  it('loads and saves account-scoped in-app notification preferences', async () => {
    render(<AccountSettings role="Farmer" />)
    await screen.findByRole('heading', { name: 'Amina Otieno' })
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))

    expect(await screen.findByText(/current in-app defaults are on/i)).toBeTruthy()
    expect(notificationApi.preferences).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('checkbox', { name: /New messages/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save preferences' }))

    await waitFor(() => expect(notificationApi.updatePreferences).toHaveBeenCalledWith({ messages: false, orders: true }))
    expect(await screen.findByText('In-app notification preferences were saved to your account.')).toBeTruthy()
    expect(screen.getByText(/Email: unavailable · Mobile push: unavailable/)).toBeTruthy()
  })
})
