import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Hero from '../features/marketplace/components/Hero.jsx'
import { HERO_IMAGES, HERO_SLIDE_INTERVAL_MS } from '../features/marketplace/components/heroImages.js'

function createLoadedImageStub(onSource) {
  return class PreloadedImage {
    set src(source) {
      onSource?.(source, this)
    }
  }
}

function getVisibleSource(container) {
  return [...container.querySelectorAll('.agri-hero__slide')]
    .find((image) => image.classList.contains('is-visible'))
    ?.getAttribute('src')
}

describe('marketplace hero slideshow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.sessionStorage.clear()
    window.__AGRILINK_BOTPRESS_READY__ = false
    vi.stubGlobal('Image', createLoadedImageStub((source, image) => {
      Promise.resolve().then(() => image.onload?.({ target: { src: source } }))
    }))
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    window.__AGRILINK_BOTPRESS_READY__ = false
  })

  it('preloads the next image, waits six seconds, then crossfades to it', async () => {
    const { container } = render(<Hero onJoin={vi.fn()} />)
    const initialSource = getVisibleSource(container)

    await act(async () => { await Promise.resolve() })
    await act(async () => { vi.advanceTimersByTime(HERO_SLIDE_INTERVAL_MS - 1) })
    expect(getVisibleSource(container)).toBe(initialSource)

    await act(async () => { vi.advanceTimersByTime(1) })
    const nextSource = getVisibleSource(container)
    expect(nextSource).toBeTruthy()
    expect(nextSource).not.toBe(initialSource)

    await act(async () => { vi.advanceTimersByTime(1200) })
    expect(getVisibleSource(container)).toBe(nextSource)
  })

  it('skips a next image when its preload fails', async () => {
    const failedSource = HERO_IMAGES[1]
    vi.stubGlobal('Image', createLoadedImageStub((source, image) => {
      Promise.resolve().then(() => {
        if (source === failedSource) image.onerror?.({ target: { src: source } })
        else image.onload?.({ target: { src: source } })
      })
    }))

    const { container } = render(<Hero />)
    await act(async () => { await Promise.resolve() })

    const slideSources = [...container.querySelectorAll('.agri-hero__slide')]
      .map((image) => image.getAttribute('src'))
    expect(slideSources).not.toContain(failedSource)
    expect(getVisibleSource(container)).toBe(HERO_IMAGES[0])
  })

  it('keeps one slide still when reduced motion is enabled', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const { container } = render(<Hero />)
    const initialSource = getVisibleSource(container)

    await act(async () => { vi.advanceTimersByTime(HERO_SLIDE_INTERVAL_MS * 2) })
    expect(getVisibleSource(container)).toBe(initialSource)
    expect(container.querySelectorAll('.agri-hero__slide')).toHaveLength(1)
  })

  it('shows the Botpress invitation once after the provider is ready, then hides it for the tab session', async () => {
    window.__AGRILINK_BOTPRESS_READY__ = true
    const { container, unmount } = render(<Hero />)
    expect(container.querySelector('.agri-chat-teaser')).toBeTruthy()
    expect(window.sessionStorage.getItem('agrilink-botpress-teaser-shown')).toBe('true')

    await act(async () => { vi.advanceTimersByTime(6200) })
    expect(container.querySelector('.agri-chat-teaser')).toBeNull()

    unmount()
    const reopened = render(<Hero />)
    expect(reopened.container.querySelector('.agri-chat-teaser')).toBeNull()
  })
})
