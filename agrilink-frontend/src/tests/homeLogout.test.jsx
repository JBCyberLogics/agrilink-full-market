import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const authService = vi.hoisted(() => ({
  me: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
  invalidateServerSession: vi.fn(),
  signup: vi.fn(),
  verifySignup: vi.fn(),
  resendSignupOtp: vi.fn(),
  forgotPassword: vi.fn(),
  verifyResetOtp: vi.fn(),
  resetPassword: vi.fn(),
}))

vi.mock('../features/auth/services/authService', () => authService)

import App from '../app/App'

const BUYER = { id: 'buyer-1', name: 'Buyer Account', email: 'buyer@example.test', role: 'Buyer' }

beforeEach(() => {
  vi.clearAllMocks()
  authService.me.mockResolvedValue(BUYER)
  authService.invalidateServerSession.mockRejectedValue({
    code: 'AUTH_LOGOUT_NOT_CONFIGURED',
    error: 'Logout contract unavailable.',
  })
  authService.logout.mockImplementation(() => {
    localStorage.removeItem('agrilink.accessToken')
    localStorage.removeItem('agrilink.refreshToken')
  })
  localStorage.clear()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, data: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
  window.history.replaceState(null, '', '#/')
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('authenticated Home action', () => {
  it('attempts server logout, clears local auth, and returns to the public hero', async () => {
    render(<App />)

    await screen.findByRole('button', { name: /home, sign out/i })
    fireEvent.click(screen.getByRole('button', { name: /home, sign out/i }))

    await waitFor(() => {
      expect(window.location.hash).toBe('#shop')
      expect(screen.getByRole('heading', { name: /from the farm gate, straight to your table/i })).toBeDefined()
    })
    expect(authService.invalidateServerSession).toHaveBeenCalledOnce()
    expect(authService.logout).toHaveBeenCalledOnce()
    expect(screen.getByText(/server session invalidation could not be confirmed/i)).toBeDefined()
  })

  it('keeps protected content gated after Home and a direct protected-route visit', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /home, sign out/i })
    fireEvent.click(screen.getByRole('button', { name: /home, sign out/i }))
    await screen.findByRole('heading', { name: /from the farm gate, straight to your table/i })

    act(() => {
      window.history.replaceState(null, '', '#/buyer/dashboard')
      window.dispatchEvent(new HashChangeEvent('hashchange'))
    })

    expect(await screen.findByText(/sign in as a buyer/i)).toBeDefined()
    expect(screen.queryByText('Available Produce')).toBeNull()
  })

  it('syncs a same-origin tab logout through the existing storage event', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /home, sign out/i })

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'agrilink.marketplace.session-event',
        oldValue: 'signed-out:previous',
        newValue: `signed-out:${Date.now()}`,
      }))
    })

    expect(await screen.findByRole('heading', { name: /from the farm gate, straight to your table/i })).toBeDefined()
    expect(screen.getByText(/session ended in another tab/i)).toBeDefined()
  })

  it('reloads marketplace identity after another same-origin tab changes accounts', async () => {
    render(<App />)
    await screen.findByRole('button', { name: /home, sign out/i })
    authService.me.mockResolvedValue({ id: 'farmer-2', name: 'Farmer Account', email: 'farmer@example.test', role: 'Farmer' })

    act(() => {
      window.dispatchEvent(new StorageEvent('storage', {
        key: 'agrilink.marketplace.session-event',
        oldValue: 'identity-changed:previous',
        newValue: `identity-changed:${Date.now()}`,
      }))
    })

    expect(await screen.findByRole('button', { name: /farmer dashboard/i })).toBeDefined()
    expect(screen.queryByRole('button', { name: /buyer dashboard/i })).toBeNull()
  })
})
