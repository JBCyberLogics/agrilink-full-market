import { describe, expect, it } from 'vitest'
import { normalizeUser } from '../features/auth/services/authService.js'
import { getUserDisplayName, getUserFirstName, getUserInitials } from '../utils/userDisplay.js'

describe('safe account display', () => {
  it('normalizes incomplete buyer profiles without leaving an undefined display name', () => {
    const user = normalizeUser({ user: { role: 'Buyer' } })

    expect(user).toMatchObject({ role: 'Buyer', name: 'Account' })
    expect(getUserDisplayName(user)).toBe('Account')
    expect(getUserInitials(user)).toBe('A')
    expect(getUserFirstName(user)).toBe('')
  })

  it('builds a name from split fields and accepts backend role casing', () => {
    const user = normalizeUser({ role: 'buyer', firstName: 'Wanjiku', lastName: 'Kamau' })

    expect(user).toMatchObject({ role: 'Buyer', name: 'Wanjiku Kamau' })
    expect(getUserDisplayName(user)).toBe('Wanjiku Kamau')
    expect(getUserFirstName(user)).toBe('Wanjiku')
    expect(getUserInitials(user)).toBe('WK')
  })
})
