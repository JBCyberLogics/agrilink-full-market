import { beforeEach, describe, expect, it, vi } from 'vitest'

const { api, request, requestRaw, tokens } = vi.hoisted(() => ({
  api: { post: vi.fn(), patch: vi.fn() },
  request: vi.fn(),
  requestRaw: vi.fn(),
  tokens: { set: vi.fn(), clear: vi.fn() },
}))

vi.mock('../services/api/client.js', () => ({ api, request, requestRaw, tokens }))

import { auth, otp, users } from '../services/api/endpoints.js'

describe('OTP endpoint request headers', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps the challenge token in the body without sending a custom token header', () => {
    users.verifyOtp('signup-challenge', '123456')
    expect(api.post).toHaveBeenCalledWith(
      '/users/create-user-verify-otp',
      { otp: '123456', token: 'signup-challenge' },
      { auth: false },
    )
  })

  it('keeps other challenge workflows in the body with CSRF handled by the shared client', () => {
    otp.resend('signup-challenge')
    auth.forgotPasswordOtpMatch('reset-challenge', '654321')
    auth.forgotPasswordReset('reset-challenge', 'new-password', 'new-password')

    expect(api.patch).toHaveBeenNthCalledWith(1, '/otp/resend-otp', { token: 'signup-challenge' }, { auth: false })
    expect(api.patch).toHaveBeenNthCalledWith(2, '/auth/forgot-password-otp-match', { otp: '654321', token: 'reset-challenge' }, { auth: false })
    expect(api.patch).toHaveBeenNthCalledWith(3, '/auth/forgot-password-reset', { newPassword: 'new-password', confirmPassword: 'new-password', token: 'reset-challenge' }, { auth: false })
  })
})
