import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  announceSessionChanged: vi.fn(),
  announceSessionEnded: vi.fn(),
  clear: vi.fn(),
}))

vi.mock('../services/api/endpoints.js', () => ({
  auth: { login: mocks.login },
  users: {},
  otp: {},
}))
vi.mock('../services/api/client.js', () => ({
  announceSessionChanged: mocks.announceSessionChanged,
  announceSessionEnded: mocks.announceSessionEnded,
  tokens: { clear: mocks.clear },
}))

import { login } from '../features/auth/services/authService.js'

const GENERIC = 'Unable to sign in with those credentials. Please check your details and try again.'

beforeEach(() => vi.clearAllMocks())

describe('marketplace login role privacy', () => {
  it('normalizes a legacy role-specific rejection and strips account role details', async () => {
    mocks.login.mockRejectedValue({
      status: 403,
      code: 'ACCOUNT_ROLE_MISMATCH',
      field: 'role',
      error: 'This account is registered as a Farmer.',
      accountRole: 'Farmer',
    })

    await expect(login({ email: 'account@example.com', password: 'long-password', role: 'Buyer' }))
      .rejects.toEqual({ status: 401, code: 'INVALID_CREDENTIALS', error: GENERIC })
    expect(mocks.login).toHaveBeenCalledWith({ email: 'account@example.com', password: 'long-password', role: 'customer' })
  })

  it('uses the same generic response for an ordinary invalid-credentials response', async () => {
    mocks.login.mockRejectedValue({ status: 401, code: 'INVALID_CREDENTIALS', error: 'Email or password is incorrect.' })

    await expect(login({ email: 'account@example.com', password: 'wrong-password', role: 'Farmer' }))
      .rejects.toEqual({ status: 401, code: 'INVALID_CREDENTIALS', error: GENERIC })
  })

  it('accepts the server identity and role when credentials match the selected role', async () => {
    mocks.login.mockResolvedValue({ user: { id: 'server-user-id', email: 'farmer@example.com', fullName: 'Farmer', role: 'farmer' } })

    const result = await login({ email: 'farmer@example.com', password: 'long-password', role: 'Farmer' })

    expect(result).toMatchObject({ id: 'server-user-id', role: 'Farmer' })
    expect(mocks.announceSessionChanged).toHaveBeenCalledOnce()
  })
})
