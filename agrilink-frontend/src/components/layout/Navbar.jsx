import { useEffect, useRef, useState } from 'react'
import { Sprout, Search, ShoppingBag, Menu, X, LogOut, ChevronDown, Plus, Minus, ArrowRight, Trash2 } from 'lucide-react'
import { kes } from '../../utils/format'
import ThemeToggle from '../ui/ThemeToggle'
import { getUserDisplayName, getUserInitials } from '../../utils/userDisplay'

/* The brand control is the main Home action. Authenticated Home uses the
   app's logout workflow; the public Marketplace link remains unchanged. */
function Brand({ onRoute, onHome, authenticated, booting }) {
  const signsOut = authenticated || booting
  return (
    <button
      type="button"
      onClick={() => signsOut ? onHome?.() : onRoute('shop')}
      aria-label={signsOut ? 'Home, sign out and return to the public landing page' : 'AgriLink home, back to the marketplace'}
      className="flex shrink-0 items-center rounded-md"
    >
      <img
        src="/images/logo.png"
        alt=""
        className="h-9 w-[116px] object-cover object-center sm:h-10 sm:w-[132px]"
      />
    </button>
  )
}

/* Wide central search — filters the marketplace feed live */
function SearchBar({ search, onSearch, id = 'nav-search' }) {
  return (
    <form
      role="search"
      onSubmit={(e) => e.preventDefault()}
      className="relative w-full max-w-[30rem]"
    >
      <Search
        size={18}
        aria-hidden="true"
        className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-muted-2"
      />
      <input
        id={id}
        type="search"
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search fresh produce, farms, counties…"
        aria-label="Search produce"
        className="h-11 w-full rounded-xl border border-line bg-paper-soft/80 pl-11 pr-10 text-sm text-ink outline-none transition-colors placeholder:text-muted-2 hover:border-line-strong hover:bg-paper focus:border-brand/50 focus:bg-paper focus:ring-4 focus:ring-brand/10"
      />
      {search && (
        <button
          type="button"
          onClick={() => onSearch('')}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 grid h-8 w-8 -translate-y-1/2 place-items-center rounded-lg text-muted-2 transition-colors hover:bg-soft hover:text-ink-4"
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
    </form>
  )
}

/* Cart with glass dropdown panel: qty steppers, remove, subtotal */
function CartButton({ cart = [], onQty, onRemove, count, onCheckout = () => {}, onClearCart }) {
  const [open, setOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState('')
  const subtotal = cart.reduce((sum, it) => sum + it.price * it.qty, 0)

  const clearCart = async () => {
    if (clearing) return
    if (typeof onClearCart !== 'function') {
      setClearError('Cart clearing is not available right now.')
      return
    }
    setClearing(true)
    setClearError('')
    try {
      await onClearCart()
      setConfirmClear(false)
    } catch (error) {
      setClearError(error?.error || 'Could not clear your cart. Please try again.')
    } finally {
      setClearing(false)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Shopping cart, ${count} item${count === 1 ? '' : 's'}`}
        className="relative grid h-10 w-10 place-items-center rounded-xl border border-transparent text-ink-4 transition-colors hover:border-line hover:bg-paper-soft hover:text-brand focus-visible:bg-soft sm:h-11 sm:w-11"
      >
        <ShoppingBag size={21} aria-hidden="true" />
        {/* Floating numeric badge — re-keyed every count change so the pop animation replays */}
        {count > 0 && (
          <span
            key={count}
            aria-hidden="true"
            className="absolute -right-0.5 -top-0.5 grid h-[19px] min-w-[19px] animate-pop place-items-center rounded-full bg-secondary px-1 text-[10px] font-bold text-neutral-900 ring-2 ring-paper"
          >
            {count}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden="true" />
      )}
      {open && (
        <div className="absolute right-0 z-50 mt-3 w-[min(20rem,calc(100vw-2rem))] animate-fade-up overflow-hidden rounded-2xl border border-line bg-paper shadow-[0_20px_60px_-28px_rgb(22_48_31_/_0.38)]">
          {/*---------------------------- cart items ----------------------------*/}
          <div className="flex items-center justify-between border-b border-line px-4 py-3.5">
            <p className="text-sm font-semibold text-ink">Your basket</p>
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-primary-soft px-2.5 py-1 text-[11px] font-semibold text-brand-deep">
                {count} item{count === 1 ? '' : 's'}
              </span>
              {cart.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setClearError('')
                    setConfirmClear(true)
                  }}
                  disabled={clearing}
                  className="inline-flex min-h-8 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-danger transition-colors hover:bg-danger-wash focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40 disabled:cursor-wait disabled:opacity-60"
                >
                  <Trash2 size={13} aria-hidden="true" /> Clear Cart
                </button>
              )}
            </div>
          </div>

          {confirmClear && cart.length > 0 && (
            <div role="group" aria-labelledby="clear-cart-confirmation" className="border-b border-danger-line bg-danger-wash/60 px-4 py-3">
              <p id="clear-cart-confirmation" className="text-sm font-semibold text-ink">Clear all items from your cart?</p>
              <p className="mt-1 text-xs text-muted">This will empty your basket.</p>
              {clearError && <p role="alert" className="mt-2 text-xs font-medium text-danger">{clearError}</p>}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setConfirmClear(false)
                    setClearError('')
                  }}
                  disabled={clearing}
                  className="min-h-9 rounded-lg border border-line bg-paper px-3 text-xs font-semibold text-ink-3 hover:bg-soft disabled:opacity-60"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={clearCart}
                  disabled={clearing}
                  className="min-h-9 rounded-lg bg-danger px-3 text-xs font-semibold text-white hover:bg-danger/90 disabled:cursor-wait disabled:opacity-60"
                >
                  {clearing ? 'Clearing…' : 'Confirm Clear'}
                </button>
              </div>
            </div>
          )}

          {cart.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-soft text-faint">
                <ShoppingBag size={22} aria-hidden="true" />
              </span>
              <p className="mt-3 text-sm font-medium text-muted">Your basket is empty</p>
              <p className="mt-1 text-xs text-muted-2">Fresh produce is one click away.</p>
            </div>
          ) : (
            <ul className="max-h-64 divide-y divide-line overflow-y-auto px-2">
              {cart.map((it) => (
                <li key={it.productId} className="flex items-center gap-3 px-2 py-3">
                  <img
                    src={it.image}
                    alt=""
                    loading="lazy"
                    className="h-11 w-11 shrink-0 rounded-lg bg-soft object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">{it.name}</p>
                    <p className="text-xs text-muted-2">
                      {kes(it.price)} / {it.unit}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => onQty(it.productId, -1)}
                      aria-label={`Decrease ${it.name} quantity`}
                      className={`grid h-7 w-7 place-items-center rounded-md border border-line text-muted transition-colors hover:border-danger-line hover:bg-danger-wash hover:text-danger`}
                    >
                      <Minus size={12} aria-hidden="true" />
                    </button>
                    <span className="w-5 text-center text-[13px] font-semibold tabular-nums">{it.qty}</span>
                    <button
                      type="button"
                      onClick={() => onQty(it.productId, +1)}
                      aria-label={`Increase ${it.name} quantity`}
                      className="grid h-7 w-7 place-items-center rounded-md border border-line text-muted transition-colors hover:border-brand/30 hover:bg-primary-soft hover:text-brand"
                    >
                      <Plus size={12} aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {cart.length > 0 && (
            <div className="border-t border-line bg-paper-soft/60 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted">Subtotal</span>
                <span className="font-display text-lg font-bold text-ink">{kes(subtotal)}</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  onCheckout()
                }}
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-white shadow-lift transition-all hover:bg-primary-dark active:scale-[0.98]"
              >
                Checkout <ArrowRight size={16} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/* Sign in button OR the signed in profile chip */
export function AuthArea({ user, onSignIn, onSignOut, mobile = false, booting = false }) {
  /* While the boot session check is in flight the slot holds a neutral
     placeholder — identical footprint, so the row never shifts when the
     real chip (or the Sign In button) arrives. No invented name/role. */
  if (!user && booting) {
    return (
      <div className={mobile ? 'flex items-center gap-2' : 'ml-1 flex items-center gap-2'}>
        <span
          role="status"
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-soft ${mobile ? '' : 'animate-pulse'}`}
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
            <circle cx="12" cy="8" r="4" className="fill-muted-2/40" />
            <path d="M4 20c1.5-3.5 4.5-5 8-5s6.5 1.5 8 5" className="stroke-muted-2/40" strokeWidth="2" strokeLinecap="round" />
          </svg>
          {!mobile && <span className="sr-only">Checking sign in status…</span>}
        </span>
      </div>
    )
  }
  if (user) {
    const displayName = getUserDisplayName(user)
    const roleLabel = typeof user.role === 'string' && user.role.trim() ? user.role : 'Account'
    return (
      <div className={mobile ? 'flex items-center gap-2' : 'ml-1 flex items-center gap-2'}>
        <span
          className={`grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-primary to-primary-dark font-display text-sm font-bold text-white ${user.role === 'Farmer' ? 'ring-2 ring-secondary ring-offset-2' : ''}`}
          aria-hidden="true"
        >
          {getUserInitials(user)}
        </span>
        {!mobile && (
          <span className="hidden leading-tight xl:block min-[1440px]:hidden">
            <span className="block max-w-[9rem] truncate text-[13px] font-semibold text-ink">{displayName}</span>
            <span
              className={`text-[10px] font-bold uppercase tracking-wider ${user.role === 'Farmer' ? 'text-brand-amber-deep' : 'text-brand'}`}
            >
              {roleLabel}
            </span>
          </span>
        )}
        <button
          type="button"
          onClick={onSignOut}
          title="Sign out"
          aria-label="Sign out"
          className="grid h-10 w-10 place-items-center rounded-xl border border-transparent text-muted-2 transition-colors hover:border-danger-line/50 hover:bg-danger-wash hover:text-danger"
        >
          <LogOut size={18} aria-hidden="true" />
        </button>
      </div>
    )
  }
  return (
    <button
      type="button"
      onClick={onSignIn}
      className="flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-white shadow-sm transition-all hover:bg-primary-dark active:scale-[0.98] sm:h-11 sm:px-5"
    >
      Sign In
    </button>
  )
}

/* Public destinations — visible to everyone, logged out or in.
   Role dashboards are NOT public links: an authenticated user only ever
   gets a link to THEIR OWN dashboard (see dashboardLinkFor below), so a
   buyer never sees a farmer entry point and vice versa. */
const PUBLIC_NAV_LINKS = [
  { id: 'shop', label: 'Marketplace' },
  { id: 'how-it-works', label: 'How it works' },
  { id: 'about', label: 'About' },
  { id: 'faq', label: 'FAQ' },
  { id: 'contact', label: 'Contact' },
]

/* Returns the authenticated user's own dashboard link, derived from the
   server-validated session role (user.role) — never from a manually
   selected frontend value, URL param or localStorage. Returns null for
   logged-out users (they see Login/Sign Up via AuthArea). */
function dashboardLinkFor(user) {
  if (!user) return null
  if (user.role === 'Farmer')
    return { id: 'farmer/dashboard', label: 'Farmer Dashboard' }
  if (user.role === 'Buyer')
    return { id: 'buyer/dashboard', label: 'Buyer Dashboard' }
  return null
}

/* Combined desktop + mobile link list: public links for everyone, plus
   the signed in user's own dashboard when authenticated. */
function navLinksFor(user) {
  if (!user) return PUBLIC_NAV_LINKS
  const own = dashboardLinkFor(user)
  return own ? [...PUBLIC_NAV_LINKS, own] : PUBLIC_NAV_LINKS
}

export default function Navbar({ user, route = 'shop', onRoute = () => {}, onHome, search, onSearch, cart, cartCount, onQty, onRemoveFromCart, onCheckout, onClearCart, onSignIn, onSignOut, onOpenAuth = () => {}, booting = false }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const mobileBtn = useRef(null)

  /* Escape closes the mobile menu and returns focus to the trigger. */
  useEffect(() => {
    if (!mobileOpen) return
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setMobileOpen(false)
        mobileBtn.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileOpen])

  /* Any route change (button, hash edit, back/forward) closes the menu,
     so the panel never lingers over a page the user already left. */
  useEffect(() => {
    setMobileOpen(false)
  }, [route])

  const isActive = (link) => {
    const base = link.id.split('/')[0]
    /* dashboard hubs stay active across their pages; simple pages match exactly */
    return base === 'shop'
      ? route === 'shop'
      : link.id.includes('/')
        ? route.startsWith(base + '/')
        : route === link.id
  }
  const showSellingCta = !user || user.role !== 'Farmer'

  return (
    <header className="agri-public-navbar fixed top-0 z-50 w-full border-b border-line/80 bg-paper/95 backdrop-blur-xl supports-[backdrop-filter]:bg-paper/90">
      <nav aria-label="Main" className="mx-auto flex h-[72px] max-w-screen-2xl items-center gap-2 px-4 sm:gap-4 sm:px-6 2xl:px-10">
        <Brand onRoute={onRoute} onHome={onHome} authenticated={!!user} booting={booting} />

        {/* Search stays close to the brand on compact widths and moves inline on wide screens. */}
        <div className="ml-1 hidden min-w-0 flex-1 justify-center md:flex min-[1440px]:ml-5">
          <SearchBar search={search} onSearch={onSearch} />
        </div>

        {/* right cluster */}
        <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-1.5 2xl:ml-4">
          <ul className="mr-1 hidden items-center gap-0.5 min-[1440px]:flex">
            {navLinksFor(user).map((link) => (
              <li key={link.id}>
                <button
                  type="button"
                  onClick={() => onRoute(link.id)}
                  aria-current={isActive(link) ? 'page' : undefined}
                  className={`rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors xl:px-3 ${
                    isActive(link)
                      ? 'bg-primary-soft text-brand-deep'
                      : 'text-ink-4 hover:bg-primary-soft/60 hover:text-brand-deep'
                  }`}
                >
                  {link.label}
                </button>
              </li>
            ))}
          </ul>

          {/* public sell-side CTA — hidden for signed in farmers who already
              live in their dashboard */}
          {showSellingCta && (
            <button
              type="button"
              onClick={() => onRoute('start-selling')}
              className="mr-1 hidden h-10 items-center rounded-xl border border-brand/30 bg-primary-soft/70 px-3 text-[13px] font-semibold text-brand-deep transition-colors hover:bg-primary-soft min-[1440px]:inline-flex"
            >
              Start Selling
            </button>
          )}

          <ThemeToggle className="h-10 w-10 border border-transparent hover:border-line sm:h-11 sm:w-11" size={18} />
          <CartButton cart={cart} count={cartCount} onQty={onQty} onRemove={onRemoveFromCart} onCheckout={onCheckout} onClearCart={onClearCart} />
          <div className="hidden sm:block">
            <AuthArea user={user} onSignIn={onSignIn} onSignOut={onSignOut} booting={booting} />
          </div>

          {/* mobile menu trigger */}
          <button
            ref={mobileBtn}
            type="button"
            onClick={() => {
              if (!mobileOpen) setMobileOpen(true)
              else {
                setMobileOpen(false)
                mobileBtn.current?.focus()
              }
            }}
            aria-expanded={mobileOpen}
            aria-controls="nav-mobile-menu"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            className="grid h-10 w-10 place-items-center rounded-xl border border-line text-ink-4 transition-colors hover:bg-paper-soft min-[1440px]:hidden sm:h-11 sm:w-11"
          >
            {mobileOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>
      </nav>

      {/* mobile search row */}
      <div className="border-t border-line/70 bg-paper-soft/70 px-4 py-2.5 md:hidden min-[1440px]:hidden">
        <SearchBar search={search} onSearch={onSearch} id="nav-search-mobile" />
      </div>

      {/* mobile dropdown panel */}
      {mobileOpen && (
        <div id="nav-mobile-menu" className="max-h-[calc(100dvh-8.5rem)] overflow-y-auto border-t border-line bg-paper p-4 shadow-[0_24px_40px_-32px_rgb(22_48_31_/_0.5)] min-[1440px]:hidden">
          <ul className="mx-auto max-w-3xl space-y-1">
            {navLinksFor(user).map((link) => (
              <li key={link.id}>
                <button
                  type="button"
                  onClick={() => {
                    onRoute(link.id)
                    setMobileOpen(false)
                  }}
                  aria-current={isActive(link) ? 'page' : undefined}
                  className={`flex min-h-11 w-full items-center justify-between rounded-xl px-3.5 py-3 text-sm font-medium transition-colors ${
                    isActive(link)
                      ? 'bg-primary-soft text-brand-deep'
                      : 'text-ink-3 hover:bg-soft'
                  }`}
                >
                  {link.label}
                  <ChevronDown size={16} className="rotate-[-90deg] text-faint" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
          {showSellingCta && (
            <button
              type="button"
              onClick={() => {
                onRoute('start-selling')
                setMobileOpen(false)
              }}
              className="mt-3 flex h-11 w-full items-center justify-center rounded-xl border border-brand/30 bg-primary-soft text-sm font-semibold text-brand-deep transition-colors hover:bg-primary-soft/80"
            >
              Start Selling
            </button>
          )}
          {/* appearance row — the shared theme controller (footer spec keeps
              the marketing footer off authenticated pages; this row follows
              the same visual language as the rest of the dropdown) */}
          <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-3 sm:hidden">
            <span className="flex items-center gap-2 text-sm font-medium text-ink-3">
              Appearance
            </span>
            <ThemeToggle className="h-10 w-10 border border-line" size={18} />
          </div>
          <div className="mt-3 border-t border-line/60 pt-3 sm:hidden">
            <AuthArea user={user} onSignIn={onSignIn} onSignOut={onSignOut} booting={booting} mobile />
          </div>
        </div>
      )}
    </header>
  )
}
