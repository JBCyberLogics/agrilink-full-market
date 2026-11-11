import { describe, expect, it } from 'vitest'
import {
  getAvailableHeroImageIndex,
  getNextHeroImageIndex,
  HERO_IMAGES,
} from '../features/marketplace/components/heroImages.js'

describe('hero image discovery and slideshow selection', () => {
  it('discovers the locally stored hero photographs without duplicate URLs', () => {
    expect(HERO_IMAGES).toContain('/images/agriculture-field.webp')
    expect(HERO_IMAGES).toContain('/images/harvest-aerial.webp')
    expect(HERO_IMAGES).toContain('/images/farmland-sunrise.webp')
    expect(new Set(HERO_IMAGES).size).toBe(HERO_IMAGES.length)
  })

  it('handles empty and single-image collections without rotating', () => {
    expect(getNextHeroImageIndex([], 0)).toBe(-1)
    expect(getNextHeroImageIndex(['/images/only.webp'], 0)).toBe(-1)
    expect(getAvailableHeroImageIndex([], 0)).toBe(-1)
  })

  it('wraps to the next slide and skips sources that failed to load', () => {
    const images = ['/one.webp', '/two.webp', '/three.webp']
    expect(getNextHeroImageIndex(images, 2)).toBe(0)
    expect(getNextHeroImageIndex(images, 0, new Set(['/two.webp']))).toBe(2)
    expect(getAvailableHeroImageIndex(images, 0, new Set(['/one.webp']))).toBe(1)
    expect(getNextHeroImageIndex(images, 0, new Set(images))).toBe(-1)
    expect(getAvailableHeroImageIndex(images, 0, new Set(images))).toBe(-1)
  })
})
