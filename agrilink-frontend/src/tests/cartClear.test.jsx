import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import Navbar from '../components/layout/Navbar'
import { ThemeProvider } from '../app/providers/theme'

const cart = [{ productId: 'produce-1', name: 'Mangoes', price: 80, unit: 'kg', qty: 2, stock: 10, image: '' }]

const renderNavbar = (props = {}) => render(
  <ThemeProvider>
    <Navbar
      route="shop"
      user={null}
      search=""
      onSearch={vi.fn()}
      cart={cart}
      cartCount={2}
      onQty={vi.fn()}
      onRemoveFromCart={vi.fn()}
      onCheckout={vi.fn()}
      onClearCart={vi.fn().mockResolvedValue({ cleared: true })}
      {...props}
    />
  </ThemeProvider>,
)

function StatefulCartNavbar({ onClearCart }) {
  const [items, setItems] = useState(cart)
  return (
    <ThemeProvider>
      <Navbar
        route="shop"
        user={null}
        search=""
        onSearch={vi.fn()}
        cart={items}
        cartCount={items.reduce((sum, item) => sum + item.qty, 0)}
        onQty={vi.fn()}
        onRemoveFromCart={vi.fn()}
        onCheckout={vi.fn()}
        onClearCart={async () => {
          await onClearCart()
          setItems([])
        }}
      />
    </ThemeProvider>
  )
}

afterEach(() => cleanup())

describe('cart clear control', () => {
  it('is only shown in a populated cart', () => {
    renderNavbar({ cart: [], cartCount: 0 })
    fireEvent.click(screen.getByRole('button', { name: /shopping cart/i }))
    expect(screen.queryByRole('button', { name: /clear cart/i })).toBeNull()
  })

  it('requires confirmation and cancellation leaves the basket untouched', () => {
    const onClearCart = vi.fn().mockResolvedValue({ cleared: true })
    renderNavbar({ onClearCart })
    fireEvent.click(screen.getByRole('button', { name: /shopping cart/i }))
    fireEvent.click(screen.getByRole('button', { name: /clear cart/i }))
    expect(screen.getByText(/clear all items from your cart/i)).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onClearCart).not.toHaveBeenCalled()
    expect(screen.getByText('Mangoes')).toBeDefined()
  })

  it('shows a backend error and leaves the basket visible', async () => {
    const onClearCart = vi.fn().mockRejectedValue({ error: 'Cart delete failed.' })
    renderNavbar({ onClearCart })
    fireEvent.click(screen.getByRole('button', { name: /shopping cart/i }))
    fireEvent.click(screen.getByRole('button', { name: /clear cart/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm clear/i }))
    expect((await screen.findByRole('alert')).textContent).toContain('Cart delete failed.')
    expect(screen.getByText('Mangoes')).toBeDefined()
  })

  it('shows the empty state and updated count only after the backend succeeds', async () => {
    const onClearCart = vi.fn().mockResolvedValue({ cleared: true })
    render(<StatefulCartNavbar onClearCart={onClearCart} />)
    fireEvent.click(screen.getByRole('button', { name: /shopping cart/i }))
    fireEvent.click(screen.getByRole('button', { name: /clear cart/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm clear/i }))

    expect(await screen.findByText(/your basket is empty/i)).toBeDefined()
    expect(screen.getByRole('button', { name: /shopping cart, 0 items/i })).toBeDefined()
    expect(onClearCart).toHaveBeenCalledOnce()
  })

  it('disables confirmation while the backend request is pending', async () => {
    let resolveRequest
    const onClearCart = vi.fn(() => new Promise((resolve) => { resolveRequest = resolve }))
    renderNavbar({ onClearCart })
    fireEvent.click(screen.getByRole('button', { name: /shopping cart/i }))
    fireEvent.click(screen.getByRole('button', { name: /clear cart/i }))
    fireEvent.click(screen.getByRole('button', { name: /confirm clear/i }))
    expect(screen.getByRole('button', { name: /clearing/i }).disabled).toBe(true)
    resolveRequest({ cleared: true })
    await waitFor(() => expect(screen.queryByText(/clear all items from your cart/i)).toBeNull())
  })
})

describe('main Home action', () => {
  it('uses the logout callback for an authenticated user', () => {
    const onHome = vi.fn()
    const onRoute = vi.fn()
    renderNavbar({ user: { name: 'Buyer', role: 'Buyer' }, onHome, onRoute })
    fireEvent.click(screen.getByRole('button', { name: /home, sign out/i }))
    expect(onHome).toHaveBeenCalledOnce()
    expect(onRoute).not.toHaveBeenCalled()
  })

  it('keeps public Home navigation on the marketplace', () => {
    const onHome = vi.fn()
    const onRoute = vi.fn()
    renderNavbar({ onHome, onRoute })
    fireEvent.click(screen.getByRole('button', { name: /agrilink home/i }))
    expect(onRoute).toHaveBeenCalledWith('shop')
    expect(onHome).not.toHaveBeenCalled()
  })
})
