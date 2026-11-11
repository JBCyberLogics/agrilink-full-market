import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import Footer from '../components/layout/Footer.jsx'
import { parseHash } from '../router/routes.js'

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('public footer', () => {
  it('only links to existing public or informational routes', () => {
    const { container } = render(<Footer onLogin={() => {}} />)
    const links = [...container.querySelectorAll('a[href^="#/"]')]

    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      window.history.replaceState(null, '', link.getAttribute('href'))
      expect(parseHash(), `${link.textContent.trim()} should resolve`).not.toBe('not-found')
    }
  })

  it('shows the current calendar year in the copyright line', () => {
    const { container } = render(<Footer />)
    const copyright = container.querySelector('footer > div:last-child p')
    expect(copyright?.textContent).toBe(`© ${new Date().getFullYear()} AgriLink Ltd. All rights reserved.`)
  })
})
