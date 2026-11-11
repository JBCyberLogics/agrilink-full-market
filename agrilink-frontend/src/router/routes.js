/* ---------------------------------------------------------------- routing
   The app's existing convention is a hash-synced page state (no router
   dependency). Role dashboards extend it: #/farmer/dashboard, #/buyer/
   produce, … (each page set is guarded by the SERVER-verified session
   role). Legacy #farmer/#buyer aliases land on the first dashboard page;
   unknown hashes fall back to the shop. */

export const FARMER_PAGE_IDS = [
  'dashboard',
  'market-intelligence',
  'produce',
  'inquiries',
  'orders',
  'profile',
  'settings',
  'ai-market-advisor',
  'ai-agricultural-assistant',
  'ai-recommendations',
  'ai-crop-insights',
  'ai-price-recommendation',
  'ai-listing-improvement',
  'ai-buyer-matching',
  'ai-harvest-planner',
]

export const BUYER_PAGE_IDS = [
  'dashboard',
  'produce',
  'price-comparison',
  'requests',
  'inquiries',
  'saved',
  'orders',
  'profile',
  'settings',
  'ai-market-advisor',
  'ai-agricultural-assistant',
  'ai-recommendations',
  'ai-produce-finder',
  'ai-supplier-matching',
  'ai-purchase-planning',
]

export const ADMIN_PAGE_IDS = [
  'overview',
  'users',
  'farms',
  'products',
  'payouts',
  'support',
]


export const SHOP_PAGE_IDS = ['checkout']

/* Public content pages — plain top-level hash routes */
export const PUBLIC_PAGE_IDS = ['contact', 'how-it-works', 'about', 'start-selling', 'faq']


import { INFO_PAGES } from '../features/support/pages/InfoPage'
export const INFO_PAGE_IDS = Object.keys(INFO_PAGES)
/* Footer shortcuts that point at existing screens */
const ALIASES = { checkout: 'shop/checkout', orders: 'buyer/orders', categories: 'shop', farms: 'shop', help: 'faq', report: 'contact', disputes: 'contact' }

export const parseHash = () => {
  const h = window.location.hash.replace(/^#\/?/, '').toLowerCase()
  if (h === 'dev/ai-diagnostics') return import.meta.env?.DEV ? h : 'not-found'
  if (h === '' || h === 'shop') return 'shop'
  if (h.startsWith('shop/')) {
    const page = h.slice('shop/'.length)
    return SHOP_PAGE_IDS.includes(page) ? `shop/${page}` : 'not-found'
  }
  if (h === 'farmer') return 'farmer/dashboard' // legacy alias
  if (h.startsWith('farmer/')) {
    const page = h.slice('farmer/'.length)
    return FARMER_PAGE_IDS.includes(page) ? `farmer/${page}` : 'not-found'
  }
  if (h === 'buyer') return 'buyer/dashboard' // legacy alias
  if (h.startsWith('buyer/')) {
    const page = h.slice('buyer/'.length)
    return BUYER_PAGE_IDS.includes(page) ? `buyer/${page}` : 'not-found'
  }
  // --- ADD ADMIN ROUTE PARSING HERE ---
  if (h === 'admin') return 'admin/overview'
  if (h.startsWith('admin/')) {
    const page = h.slice('admin/'.length)
    return ADMIN_PAGE_IDS.includes(page) ? `admin/${page}` : 'not-found'
  }
  // ------------------------------------
  if (PUBLIC_PAGE_IDS.includes(h)) return h
  if (h.startsWith('info/') && INFO_PAGE_IDS.includes(h.slice(5))) return h
  if (ALIASES[h]) return ALIASES[h]
  if (INFO_PAGE_IDS.includes(h)) return `info/${h}`
  return 'not-found'
}
