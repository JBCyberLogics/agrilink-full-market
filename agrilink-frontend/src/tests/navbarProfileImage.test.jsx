import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AuthArea } from '../components/layout/Navbar.jsx'

afterEach(cleanup)

describe('authenticated navbar profile image', () => {
  it('renders the persisted profile image and updates it immediately when identity changes', () => {
    const { rerender } = render(<AuthArea user={{ id: 'farmer-a', name: 'Farmer A', role: 'Farmer', image: 'http://localhost:4300/uploads/new-image.png' }} />)
    expect(screen.getByAltText('').getAttribute('src')).toBe('http://localhost:4300/uploads/new-image.png')
    rerender(<AuthArea user={{ id: 'farmer-a', name: 'Farmer A', role: 'Farmer', image: 'http://localhost:4300/uploads/replaced-image.png' }} />)
    expect(screen.getByAltText('').getAttribute('src')).toBe('http://localhost:4300/uploads/replaced-image.png')
  })

  it('uses the identity initials when the account has no profile image', () => {
    render(<AuthArea user={{ id: 'farmer-a', name: 'Farmer A', role: 'Farmer', image: null }} />)
    expect(document.querySelector('img')).toBeNull()
    expect(screen.getByText('FA')).toBeTruthy()
  })
})
