/**
 * Checkout: basket review, delivery details, order creation and payment.
 * Step 1 creates the order(s) from the basket (one order per farmer).
 * Step 2 pays each order with M-Pesa or PayPal. The basket is only
 * cleared after the server confirms the orders were created.
 */
import { useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ShoppingBag, Minus, Plus, Trash2, AlertCircle, Loader2, MapPin, Sprout } from 'lucide-react'
import { kes } from '../../../utils/format'
import { createOrder } from '../../orders/services/orderService'
import PaymentPanel from '../components/PaymentPanel'

const inputCls =
  'h-11 w-full rounded-xl border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 aria-[invalid=true]:border-danger-line'

const EMPTY_ADDRESS = { phone: '', line1: '', line2: '', city: '', county: '', postal: '' }

function Input({ id, label, value, onChange, error, ...rest }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-semibold text-ink-3">{label}</label>
      <input id={id} value={value} onChange={onChange} aria-invalid={error ? true : undefined} className={inputCls} {...rest} />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
}

export default function Checkout({ cart = [], user, onQty, onRemove, onBack, onAddMoreItems = onBack, onSignIn, onOrderPlaced, address, onAddressChange }) {
  const cartTotalAvailable = cart.every((it) => Number.isFinite(it.price) && it.price > 0 && Number.isFinite(it.qty) && it.qty > 0 && typeof it.unit === 'string' && Boolean(it.unit.trim()) && Number.isFinite(it.stock) && it.stock >= it.qty)
  const subtotal = cartTotalAvailable ? cart.reduce((sum, it) => sum + it.price * it.qty, 0) : null
  const [localAddress, setLocalAddress] = useState(EMPTY_ADDRESS)
  const addr = address ?? localAddress
  const [errors, setErrors] = useState({})
  const [status, setStatus] = useState(null) // null | submitting | error
  const [orderError, setOrderError] = useState('')
  const [orders, setOrders] = useState([])
  const [paidIds, setPaidIds] = useState([])
  const submitInFlight = useRef(false)

  if (!user) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center sm:px-6 lg:px-8">
        <AlertCircle size={40} className="mx-auto text-muted-2" aria-hidden="true" />
        <h2 className="mt-6 font-display text-lg font-bold text-ink">Sign in to check out</h2>
        <p className="mt-2 text-sm text-muted">Create an account or sign in to place your order. Your basket is kept while you sign in.</p>
        <button type="button" onClick={onSignIn} className="mt-8 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-white shadow-lift hover:bg-primary-dark">
          Sign In <ArrowRight size={16} aria-hidden="true" />
        </button>
      </main>
    )
  }

  const set = (k) => (e) => {
    const nextAddress = { ...addr, [k]: e.target.value }
    setLocalAddress(nextAddress)
    onAddressChange?.(nextAddress)
    setErrors((er) => ({ ...er, [k]: null }))
  }

  const validate = () => {
    const e = {}
    if (!/^(?:\+?254|0)(7|1)\d{8}$/.test(addr.phone.replace(/\s/g, ''))) e.phone = 'Enter a valid phone number, for example 0712345678.'
    if (addr.line1.trim().length < 3) e.line1 = 'Enter your street, building or estate.'
    if (addr.city.trim().length < 2) e.city = 'Enter your town or city.'
    if (addr.county.trim().length < 2) e.county = 'Enter your county.'
    if (!/^\d{5}$/.test(addr.postal.trim())) e.postal = 'Enter a 5 digit postal code, for example 00100.'
    return e
  }

  const placeOrder = async (e) => {
    e.preventDefault()
    if (submitInFlight.current) return
    if (!cart.length) return
    if (!cartTotalAvailable) {
      setStatus('error')
      setOrderError('A current price, unit, quantity and available stock are missing for one or more listings. Refresh the basket before checkout.')
      return
    }
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length) return
    submitInFlight.current = true
    setStatus('submitting')
    setOrderError('')
    try {
      const res = await createOrder({
        items: cart,
        address: {
          phone_number: addr.phone.replace(/\s/g, ''),
          address_line1: addr.line1.trim(),
          address_line2: addr.line2.trim() || undefined,
          city: addr.city.trim(),
          state_code: addr.county.trim(),
          postal_code: addr.postal.trim(),
          country_code: 'KE',
        },
      })
      if (!res.orders.length) throw { error: 'The server did not return an order.' }
      setOrders(res.orders)
      setStatus(null)
      onOrderPlaced?.(res.orders)
    } catch (err) {
      setStatus('error')
      if (err?.field && ['phone_number', 'postal_code', 'city', 'address_line1'].includes(err.field)) {
        const map = { phone_number: 'phone', postal_code: 'postal', city: 'city', address_line1: 'line1' }
        setErrors({ [map[err.field]]: err.error })
      }
      setOrderError(err?.error || err?.message || 'Could not place your order.')
    } finally {
      submitInFlight.current = false
    }
  }

  /* ------------------------------ step 2: pay ------------------------------ */
  if (orders.length) {
    const allPaid = orders.every((o) => paidIds.includes(o.id))
    return (
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-xl font-bold text-ink">Pay for your order</h1>
        <p className="mt-1 text-sm text-muted">
          {orders.length > 1
            ? `Your basket was split into ${orders.length} orders, one for each farmer. Pay each one below.`
            : 'Your order is reserved. Choose how you want to pay.'}
        </p>
        <div className="mt-6 space-y-4">
          {orders.map((o) => (
            <PaymentPanel
              key={o.id}
              order={o}
              defaultPhone={addr.phone}
              onPaid={(order) => setPaidIds((ids) => (ids.includes(order.id) ? ids : [...ids, order.id]))}
            />
          ))}
        </div>
        <a
          href="#/buyer/orders"
          className={`mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors ${allPaid ? 'bg-primary text-white hover:bg-primary-dark' : 'border border-line text-ink-4 hover:bg-soft'}`}
        >
          {allPaid ? 'View my orders' : 'Pay later from my orders'} <ArrowRight size={16} aria-hidden="true" />
        </a>
      </main>
    )
  }

  /* --------------------------- step 1: review & address --------------------------- */
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-8 flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="Back to marketplace" className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-4 hover:bg-soft">
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
        <ShoppingBag size={20} aria-hidden="true" className="text-brand" />
        <h1 className="font-display text-lg font-bold text-ink">Checkout</h1>
      </header>

      <section className="mb-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-ink">Your order</h2>
          <button
            type="button"
            onClick={onAddMoreItems}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-brand/25 bg-primary-soft/60 px-3.5 text-sm font-semibold text-brand-deep transition-colors hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40"
          >
            <Sprout size={16} aria-hidden="true" /> Add More Items
          </button>
        </div>
        {cart.length === 0 ? (
          <p className="text-sm text-muted">Your basket is empty.</p>
        ) : (
          <>
            {!cartTotalAvailable && <p role="status" className="mb-3 rounded-lg border border-line bg-soft px-3 py-2 text-xs text-muted">A current listing price, unit, quantity, or stock value is unavailable. Checkout is paused until the basket is refreshed.</p>}
            <ul className="divide-y divide-line/60">
              {cart.map((it) => (
                <li key={it.productId} className="flex items-center gap-3 px-1 py-4 sm:px-3">
                  <img src={it.image} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg bg-soft object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-ink">{it.name}</p>
                    <p className="text-xs text-muted">{kes(it.price)} per {it.unit ?? 'unit unavailable'}</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => onQty(it.productId, -1)} disabled={it.qty <= 1} aria-label={`Decrease ${it.name} quantity`} className="grid h-7 w-7 place-items-center rounded-md border border-line text-muted hover:bg-soft disabled:opacity-40">
                      <Minus size={12} aria-hidden="true" />
                    </button>
                    <span className="w-6 text-center text-sm font-semibold tabular-nums">{it.qty}</span>
                    <button type="button" onClick={() => onQty(it.productId, +1)} aria-label={`Increase ${it.name} quantity`} className="grid h-7 w-7 place-items-center rounded-md border border-line text-muted hover:bg-primary-soft hover:text-brand">
                      <Plus size={12} aria-hidden="true" />
                    </button>
                  </div>
                  <p className="hidden text-sm font-semibold tabular-nums text-ink sm:block">{it.price == null || it.qty == null ? 'Unavailable' : kes(it.price * it.qty)}</p>
                  <button type="button" onClick={() => onRemove(it.productId)} aria-label={`Remove ${it.name}`} className="rounded-lg p-1 text-muted-2 hover:bg-soft hover:text-danger">
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between border-t border-line pt-4 text-sm">
              <span className="text-muted">Subtotal</span>
              <span className="font-display text-lg font-bold tabular-nums text-ink">{kes(subtotal)}</span>
            </div>
          </>
        )}
      </section>

      {cart.length > 0 && (
        <form onSubmit={placeOrder} noValidate className="rounded-2xl border border-line bg-paper p-5 shadow-soft sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-ink">
            <MapPin size={16} className="text-brand" aria-hidden="true" /> Delivery details
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input id="co-phone" label="Phone number" inputMode="tel" placeholder="0712345678" value={addr.phone} onChange={set('phone')} error={errors.phone} />
            <Input id="co-postal" label="Postal code" inputMode="numeric" placeholder="00100" value={addr.postal} onChange={set('postal')} error={errors.postal} />
            <div className="sm:col-span-2">
              <Input id="co-line1" label="Street, building or estate" value={addr.line1} onChange={set('line1')} error={errors.line1} />
            </div>
            <div className="sm:col-span-2">
              <Input id="co-line2" label="Landmark or extra directions (optional)" value={addr.line2} onChange={set('line2')} />
            </div>
            <Input id="co-city" label="Town or city" value={addr.city} onChange={set('city')} error={errors.city} />
            <Input id="co-county" label="County" value={addr.county} onChange={set('county')} error={errors.county} />
          </div>

          {status === 'error' && orderError && (
            <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-danger-line bg-danger-wash p-3 text-xs font-medium text-danger">
              <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" /> {orderError}
            </p>
          )}

          <button type="submit" disabled={status === 'submitting' || !cartTotalAvailable} className="mt-6 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-white shadow-lift hover:bg-primary-dark disabled:cursor-wait disabled:opacity-60">
            {status === 'submitting' ? <><Loader2 size={16} className="animate-spin" aria-hidden="true" /> Placing order…</> : <>Continue to payment <ArrowRight size={16} aria-hidden="true" /></>}
          </button>
          <p className="mt-2 text-xs text-muted">Signed in as <strong>{user.name}</strong>. Pay with M-Pesa or PayPal on the next step.</p>
        </form>
      )}
    </main>
  )
}
