// Vite discovers root-level hero photography at build time. Newly added
// supported images join the slideshow on the next dev-server rebuild or
// production build; deployed builds do not watch for runtime uploads.
const discoveredImageModules = import.meta.glob(
  '/images/*.{jpg,jpeg,png,webp,avif}',
  { eager: true, import: 'default', query: '?url' },
)

export const HERO_IMAGES = [...new Set(
  Object.entries(discoveredImageModules)
    .filter(([, source]) => typeof source === 'string' && source.length > 0)
    .sort(([first], [second]) => first.localeCompare(second, undefined, {
      numeric: true,
      sensitivity: 'base',
      ignorePunctuation: true,
    }))
    .map(([, source]) => source),
)]

export const HERO_SLIDE_INTERVAL_MS = 6000

/** Returns the next available image, skipping failed sources and wrapping. */
export function getNextHeroImageIndex(images, currentIndex, failedSources = new Set()) {
  if (!Array.isArray(images) || images.length < 2) return -1

  for (let offset = 1; offset < images.length; offset += 1) {
    const candidate = (currentIndex + offset + images.length) % images.length
    if (!failedSources.has(images[candidate])) return candidate
  }

  return -1
}

/** Finds a usable current slide after the active image reports a load error. */
export function getAvailableHeroImageIndex(images, currentIndex, failedSources = new Set()) {
  if (!Array.isArray(images) || images.length === 0) return -1

  for (let offset = 0; offset < images.length; offset += 1) {
    const candidate = (currentIndex + offset) % images.length
    if (!failedSources.has(images[candidate])) return candidate
  }

  return -1
}
