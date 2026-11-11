/**
 * Auth session regression tests (AGRILINK-AUTH-SESSION-AND-FOOTER-FIX-001).
 *
 * Renders the whole <App /> with global fetch stubbed at the transport
 * boundary (the same pattern the AuthModal/Checkout suites use). The
 * isolated API responses are test-only fixtures; production login always
 * requires the backend to validate credentials and issue a cookie session.
 *
 * Regression targets (confirmed from the code, not guesswork):
 *   1. Buyer login lands on the Buyer dashboard (was: stayed on the shop).
 *   2. A protected route shows the boot "Checking your session…" state
 *      while the cookie-restore check is in flight, then the honest
 *      signed-out gate — the dashboard never renders before auth resolves.
 *   3. Role gates: a signed-in Buyer on #/farmer/* sees the buyer gate,
 *      never farmer content.
 *   4. Hash navigation (the Back/Forward mechanism of hash routing) never
 *      clears the authenticated state — auth lives at App level.
 *   5. The marketing footer stays on public pages and stays off the
 *      authenticated (and gated) farmer/buyer routes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within, act, cleanup } from '@testing-library/react'
import App from '../app/App'

const BUYER = { id: 'buyer-test-fixture', name: 'Test Buyer', email: 'buyer@example.test', role: 'Buyer' }
const SERVER_BUYER = { id: BUYER.id, fullName: BUYER.name, email: BUYER.email, role: 'customer', isEmailVerified: true }
const ok = (data) => new Response(JSON.stringify({ success: true, message: 'OK', data }), { status: 200, headers: { 'Content-Type': 'application/json' } })
const unauthorized = () => new Response(JSON.stringify({ success: false, code: 'UNAUTHENTICATED', message: 'Sign in to continue.' }), { status: 401, headers: { 'Content-Type': 'application/json' } })

let fetchMock

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  fetchMock = vi.fn(async (input, init = {}) => {
    const path = new URL(String(input), window.location.href).pathname.replace('/api/v1', '')
    if (path === '/auth/csrf') {
      document.cookie = 'agrilink.csrf=test-fixture.signature; Path=/'
      return ok({ csrfToken: 'test-fixture.signature' })
    }
    if (path === '/auth/me' || path === '/auth/refresh-token') return unauthorized()
    if (path === '/auth/login' && init.method === 'POST') return ok({ user: SERVER_BUYER, expiresAt: null })
    if (path === '/product' || path === '/favorite-product' || path === '/purchase-requests' || path === '/category') return ok([])
    if (path === '/cart') return ok({ items: [] })
    return ok({})
  })
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  cleanup()
})

function navigateHash(hash) {
  window.history.replaceState(null, '', hash)
  act(() => {
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

/* Drive the UI through the API client with isolated test-server responses. */
async function loginAsBuyer() {
  fireEvent.click(await screen.findByRole('button', { name: 'Sign In' }))
  const dialog = screen.getByRole('dialog')
  fireEvent.change(within(dialog).getByLabelText('Email address'), {
    target: { value: BUYER.email },
  })
  fireEvent.change(within(dialog).getByLabelText('Password'), {
    target: { value: 'demo1234' },
  })
  /* the shared AuthModal requires the role card even on the login tab */
  fireEvent.click(within(dialog).getByRole('radio', { name: /buyer/i }))
  fireEvent.click(within(dialog).getByRole('button', { name: 'Sign In' }))
  await waitFor(() => expect(window.location.hash).toBe('#/buyer/dashboard'))
  await waitFor(() => expect(screen.getByText('Available Produce')).toBeDefined())
}

describe('<App /> — buyer login and session behavior', () => {
  it('buyer login opens the Buyer dashboard with the modal closed', async () => {
    render(<App />)
    await loginAsBuyer()
    /* deep link + role routing: the seeded Buyer lands on their dashboard,
       not on the shop and definitely not on a farmer route */
    expect(window.location.hash).toBe('#/buyer/dashboard')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('Available Produce')).toBeDefined()
  })
  it('protected route while booting: session-check state, then the signed-out gate', async () => {
    window.history.replaceState(null, '', '#/buyer/dashboard')
    render(<App />)
    /* the cookie-restore check is in flight → loading state, not the
       dashboard and not a flashed access gate */
    expect(screen.getByText(/checking your session/i)).toBeDefined()
    expect(screen.queryByText('Available Produce')).toBeNull()
    /* the check settles without a session → honest gate */
    await waitFor(() => {
      expect(screen.getByText(/sign in as a buyer/i)).toBeDefined()
    })
    expect(screen.queryByText('Available Produce')).toBeNull()
    expect(screen.queryByRole('contentinfo')).toBeNull()
  })

  it('a signed-in Buyer hitting a farmer route meets the buyer gate, not farmer content', async () => {
    render(<App />)
    await loginAsBuyer()
    navigateHash('#/farmer/dashboard')
    expect(await screen.findByText(/you're browsing as a buyer/i)).toBeDefined()
    expect(screen.queryByText(/sign in as a farmer/i)).toBeNull()
  })

  it('hash navigation (Back/Forward equivalent) never clears the session', async () => {
    render(<App />)
    await loginAsBuyer()
    /* Back to the public landing — session state is app-level, so auth
       survives; the public chrome (footer) returns on public pages */
    navigateHash('#/')
    await waitFor(() => expect(screen.getByRole('contentinfo')).toBeDefined())
    expect(screen.queryByText('Available Produce')).toBeNull()
    /* Forward again to the buyer hub — still signed in, dashboard renders */
    navigateHash('#/buyer/dashboard')
    await waitFor(() => expect(screen.getByText('Available Produce')).toBeDefined())
    /* and the farmer gate proves the buyer identity is still alive */
    navigateHash('#/farmer/dashboard')
    expect(await screen.findByText(/you're browsing as a buyer/i)).toBeDefined()
  })

  it('public pages keep the footer; buyer routes never render it', async () => {
    window.history.replaceState(null, '', '#/contact')
    render(<App />)
    await waitFor(() => expect(screen.getByRole('contentinfo')).toBeDefined())
    /* a signed-out buyer route replaces gate + footer pairing */
    navigateHash('#/buyer/settings')
    expect(screen.queryByRole('contentinfo')).toBeNull()
    await waitFor(() => {
      expect(screen.getByText(/sign in as a buyer/i)).toBeDefined()
    })
    expect(screen.queryByRole('contentinfo')).toBeNull()
  })
})
