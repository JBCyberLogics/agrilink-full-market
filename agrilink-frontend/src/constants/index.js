// Shared image source. The marketplace hero cover is kept local for reliable
// rendering; listing thumbnails retain their existing remote sources.
const unsplash = (id, w = 800, h = 600) =>
  `https://images.unsplash.com/${id}?auto=format&fit=crop&w=${w}&h=${h}&q=80`

export const IMAGES = {
  heroCover: '/images/agriculture-field.webp',
  covers: {
    // subject-verified thumbnails used for freshly posted farmer listings
    Grains: 'https://live.staticflickr.com/4115/4776897224_c9c4e47bc9_b.jpg',
    'Fruits & Veg': unsplash('photo-1592924357228-91a4daadcfea', 1000, 700),
    Livestock: 'https://live.staticflickr.com/2523/3845505147_765bcbc099_b.jpg',
  },
}

// Category keys shared by products, filters and forms.
export const CATEGORIES = ['Grains', 'Fruits & Veg', 'Livestock']
export const CATEGORY_FILTERS = ['All', ...CATEGORIES]

/* NOTE (mock data policy): NO part of the app is backed by mock products
   anymore. The public marketplace feed is REAL database data served by
   /api/market/listings — everything a farmer posts appears there — and the
   farmer dashboard reads /api/farmer/*. This file keeps only the shared
   category/image assets. */
