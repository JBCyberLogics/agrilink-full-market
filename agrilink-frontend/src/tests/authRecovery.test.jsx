import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'

const recoveryApi = vi.hoisted(() => ({
  forgotPassword: vi.fn(),
  resendForgotPasswordOtp: vi.fn(),
  verifyResetOtp: vi.fn(),
  resetPassword: vi.fn(),
}))

vi.mock('../features/auth/services/authService', () => recoveryApi)

import { ForgotPasswordStep } from '../features/auth/components/AuthSteps.jsx'

beforeEach(() => {
  cleanup()
  vi.clearAllMocks()
  recoveryApi.forgotPassword.mockResolvedValue({ token: 'opaque-recovery-challenge' })
  recoveryApi.resendForgotPasswordOtp.mockResolvedValue({ token: 'opaque-recovery-challenge' })
  recoveryApi.verifyResetOtp.mockResolvedValue({ token: 'opaque-one-use-reset-token' })
  recoveryApi.resetPassword.mockResolvedValue({ reset: true })
})

afterEach(() => vi.restoreAllMocks())

describe('password recovery flow', () => {
  it('moves through email, OTP, password reset, and returns to sign-in after success', async () => {
    const onDone = vi.fn()
    render(<ForgotPasswordStep initialEmail="farmer@example.test" onDone={onDone} onBack={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await waitFor(() => expect(recoveryApi.forgotPassword).toHaveBeenCalledWith('farmer@example.test'))
    expect(await screen.findByLabelText('6 digit code')).toBeTruthy()
    expect((await screen.findAllByRole('status')).some((node) => node.textContent.includes('We do not confirm whether an account uses this address.'))).toBe(true)
    expect(screen.getByRole('button', { name: /resend code in 30s/i }).disabled).toBe(true)

    fireEvent.change(screen.getByLabelText('6 digit code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    await waitFor(() => expect(recoveryApi.verifyResetOtp).toHaveBeenCalledWith('opaque-recovery-challenge', '123456'))

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a secure test password 8!' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'a secure test password 8!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    await waitFor(() => expect(recoveryApi.resetPassword).toHaveBeenCalledWith('opaque-one-use-reset-token', 'a secure test password 8!', 'a secure test password 8!'))

    fireEvent.click(await screen.findByRole('button', { name: 'Back to sign in' }))
    expect(onDone).toHaveBeenCalledWith('farmer@example.test')
  })

  it('shows a recovery service error without advancing the form', async () => {
    recoveryApi.forgotPassword.mockRejectedValueOnce({ error: 'Recovery email is unavailable.' })
    render(<ForgotPasswordStep initialEmail="farmer@example.test" onDone={vi.fn()} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Recovery email is unavailable.')
    expect(recoveryApi.verifyResetOtp).not.toHaveBeenCalled()
  })

  it('enforces the backend minimum length and confirmation before making a reset request', async () => {
    render(<ForgotPasswordStep initialEmail="farmer@example.test" onDone={vi.fn()} onBack={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send code' }))
    await screen.findByLabelText('6 digit code')
    fireEvent.change(screen.getByLabelText('6 digit code'), { target: { value: '123456' } })
    fireEvent.click(screen.getByRole('button', { name: 'Verify code' }))
    await screen.findByLabelText('New password')
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'short' } })
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'different' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Use at least 10 characters.')
    expect(recoveryApi.resetPassword).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'a secure test password 8!' } })
    fireEvent.click(screen.getByRole('button', { name: 'Update password' }))
    expect((await screen.findByRole('alert')).textContent).toContain("Passwords don't match.")
    expect(recoveryApi.resetPassword).not.toHaveBeenCalled()
  })
})
