import { beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  auth: { changePassword: vi.fn(), logout: vi.fn() },
  users: { myProfile: vi.fn(), updateMyProfile: vi.fn(), deleteMyAccount: vi.fn() },
}))

vi.mock('../services/api/endpoints.js', () => api)

import {
  changeMyPassword,
  deleteMyAccount,
  getMyAccountProfile,
  updateMyAccountProfile,
} from '../features/settings/services/accountSettingsService'

describe('account settings API adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads the signed-in profile and normalizes backend fields', async () => {
    api.users.myProfile.mockResolvedValue({
      _id: 'user-1',
      fullName: 'Amina Otieno',
      email: 'amina@example.test',
      role: 'seller',
      image: 'https://example.test/profile.jpg',
      createdAt: '2024-01-10',
    })

    await expect(getMyAccountProfile()).resolves.toEqual({
      id: 'user-1',
      fullName: 'Amina Otieno',
      email: 'amina@example.test',
      role: 'seller',
      image: 'https://example.test/profile.jpg',
      memberSince: '2024-01-10',
    })
    expect(api.users.myProfile).toHaveBeenCalledOnce()
  })

  it('updates only the documented full name and re-reads the profile', async () => {
    api.users.myProfile.mockResolvedValue({ fullName: 'Amina Wanjiku Otieno', email: 'amina@example.test' })

    await expect(updateMyAccountProfile({ fullName: '  Amina Wanjiku Otieno  ' })).resolves.toMatchObject({
      fullName: 'Amina Wanjiku Otieno',
    })
    expect(api.users.updateMyProfile).toHaveBeenCalledWith({ fullName: 'Amina Wanjiku Otieno' })
    expect(api.users.myProfile).toHaveBeenCalledOnce()
  })

  it('sends password values to the existing password endpoint', async () => {
    api.auth.changePassword.mockResolvedValue({ success: true })
    const input = { currentPassword: 'current-secret', newPassword: 'new-secret-123', confirmPassword: 'new-secret-123' }

    await changeMyPassword(input)

    expect(api.auth.changePassword).toHaveBeenCalledWith(input)
  })

  it('clears local session tokens only after the server accepts account deletion', async () => {
    api.users.deleteMyAccount.mockResolvedValue({ success: true })
    await deleteMyAccount({ password: 'current-secret' })
    expect(api.users.deleteMyAccount).toHaveBeenCalledWith({ password: 'current-secret' })
    expect(api.auth.logout).toHaveBeenCalledOnce()

    api.users.deleteMyAccount.mockRejectedValueOnce({ error: 'Deletion failed.' })
    await expect(deleteMyAccount({ password: 'current-secret' })).rejects.toMatchObject({ error: 'Deletion failed.' })
    expect(api.auth.logout).toHaveBeenCalledOnce()
  })
})
