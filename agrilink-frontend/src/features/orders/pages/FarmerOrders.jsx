/**
 * Farmer Orders — orders involving the authenticated farmer's own listings,
 * from /api/farmer/orders. The farmer can confirm or cancel pending orders.
 * With no payment provider configured, every order starts as
 * Pending / Unpaid — confirmation and payment go live in a later stage.
 * Nothing is simulated: every row is a server-backed record.
 */
import { useEffect, useState } from 'react'
import { Receipt, AlertCircle, RotateCw, Truck } from 'lucide-react'
import { farmerOrders, farmerUpdateOrderStatus } from '../../orders/services/orderService'
import { kes, fmtDate } from '../../../utils/format'
import EmptyState from '../../../components/feedback/EmptyState'
import ConfirmDelete from '../../../components/ui/ConfirmDelete'

const NEXT_STATUS_ACTIONS = {
  Confirmed: [['Packed', 'Mark packed'], ['Ready for pickup', 'Mark ready for pickup']],
  Packed: [['In transit', 'Mark in transit'], ['Ready for pickup', 'Mark ready for pickup']],
  'In transit': [['Out for delivery', 'Mark out for delivery'], ['Delivered', 'Mark delivered']],
  'Out for delivery': [['Delivered', 'Mark delivered']],
  'Ready for pickup': [['Delivered', 'Mark collected']],
}

export default function Orders() {
  const [status, setStatus] = useState('loading') // loading | ok | error
  const [orders, setOrders] = useState([])
  const [error, setError] = useState('')
  const [canceling, setCanceling] = useState(null) // order id being cancelled

  useEffect(() => {
    let alive = true
    farmerOrders()
      .then((d) => alive && setOrders(d.orders ?? []))
      .then(() => alive && setStatus('ok'))
      .catch(() => alive && setStatus('error'))
    return () => {
      alive = false
    }
  }, [])

  const refresh = () => {
    setStatus('loading')
    farmerOrders()
      .then((d) => setOrders(d.orders ?? []))
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'))
  }

  const updateStatus = async (id, newStatus) => {
    try {
      const d = await farmerUpdateOrderStatus(id, newStatus)
      setOrders((prev) => prev.map((o) => (o.id === d.order.id ? { ...o, status: d.order.status, paymentStatus: d.order.paymentStatus ?? o.paymentStatus } : o)))
    } catch (err) {
      /* the transport rejects with { status, error }: surface the server's
         exact message through the callers' existing error mapping */
      throw new Error(err?.error || err?.message || `Could not ${newStatus} this order.`)
    }
  }

  const cancel = async (id) => {
    setCanceling(id)
    try {
      await updateStatus(id, 'Cancelled')
      refresh()
    } catch (err) {
      setError(err?.message || 'Could not cancel this order. Please try again.')
    } finally {
      setCanceling(null)
    }
  }

  const advance = async (id, nextStatus) => {
    setCanceling(id)
    try {
      await updateStatus(id, nextStatus)
      refresh()
    } catch (err) {
      setError(err?.message || `Could not update this order to ${nextStatus}. Please try again.`)
    } finally {
      setCanceling(null)
    }
  }

  if (status === 'loading')
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading orders">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-farmer-line bg-paper/70" />
        ))}
      </div>
    )

  if (status === 'error')
    return (
      <div className="rounded-xl border border-farmer-line bg-paper p-6 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-danger-wash text-farmer-danger">
          <AlertCircle size={20} aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-semibold text-farmer-ink">{error || 'Could not load your orders.'}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-farmer-primary px-4 text-[13px] font-semibold text-white hover:bg-farmer-primary-hover"
        >
          <RotateCw size={14} aria-hidden="true" /> Try again
        </button>
      </div>
    )

  if (orders.length === 0)
    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
          <EmptyState icon={Receipt} title="No orders yet.">
            When buyers place orders for your produce, they will appear here as pending records until you confirm
            or cancel them.
          </EmptyState>
        </section>
      </div>
    )

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
            <Truck size={16} aria-hidden="true" className="mr-2 text-farmer-brand" />
            Orders for your produce
          </h2>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-farmer-line bg-paper px-4 text-[13px] font-semibold text-farmer-ink hover:border-farmer-brand/40 hover:text-farmer-brand"
          >
            <RotateCw size={14} aria-hidden="true" /> Refresh
          </button>
        </div>
        <ul className="divide-y divide-farmer-line">
          {orders.map((o) => (
            <li key={o.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-farmer-ink">{o.name}</p>
                  <p className="mt-0.5 text-xs text-farmer-muted">
                    {o.buyerName} &middot; {o.quantity == null ? 'Quantity unavailable' : o.quantity.toLocaleString('en-KE')} {o.unit ?? 'unit unavailable'}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-end sm:items-start gap-2">
                  <p className="text-sm font-semibold text-farmer-ink tabular-nums">{kes(o.totalAmount)}</p>
                  <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold">
                    {o.status}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-xs text-farmer-muted">Placed {fmtDate(o.createdAt)} · Payment: {o.paymentStatus}</p>
              {o.status === 'Pending' && (
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => advance(o.id, 'Confirmed')}
                    disabled={canceling === o.id}
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-farmer-line bg-paper px-3 text-[12px] font-semibold text-farmer-ink hover:border-farmer-brand/40 hover:text-farmer-brand disabled:opacity-50"
                  >
                    Confirm
                  </button>
                  <ConfirmDelete
                    label={`Cancel order for ${o.name}`}
                    onConfirm={() => cancel(o.id)}
                    className={canceling === o.id ? 'opacity-50' : ''}
                  />
                </div>
              )}
              {NEXT_STATUS_ACTIONS[o.status]?.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {NEXT_STATUS_ACTIONS[o.status].map(([nextStatus, actionLabel]) => (
                    <button
                      key={nextStatus}
                      type="button"
                      onClick={() => advance(o.id, nextStatus)}
                      disabled={canceling === o.id}
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-farmer-line bg-paper px-3 text-[12px] font-semibold text-farmer-ink hover:border-farmer-brand/40 hover:text-farmer-brand disabled:opacity-50"
                    >
                      {actionLabel}
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
