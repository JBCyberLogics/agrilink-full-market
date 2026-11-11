/**
 * PaymentPanel: pays one backend order with M-Pesa (STK push + status
 * polling) or PayPal (JS SDK buttons, client id served by the backend).
 * Reports success only after the server confirms the payment.
 */
import { useEffect, useRef, useState } from 'react'
import { Smartphone, CreditCard, Loader2, CheckCircle2, AlertCircle, RotateCw } from 'lucide-react'
import { payments } from '../../../services/api/endpoints.js'
import { kes } from '../../../utils/format'

const PHONE_RE = /^(?:\+?254|0)(7|1)\d{8}$/
const errText = (e, fallback) => e?.error || e?.message || fallback

function Alert({ tone = 'danger', children }) {
  if (!children) return null
  const ok = tone === 'ok'
  const Icon = ok ? CheckCircle2 : AlertCircle
  return (
    <p role={ok ? 'status' : 'alert'} className={`mt-3 flex items-start gap-2 rounded-lg border p-3 text-xs font-medium ${ok ? 'border-ok-line bg-ok-wash text-ok' : 'border-danger-line bg-danger-wash text-danger'}`}>
      <Icon size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
}

function MpesaPay({ order, defaultPhone, onPaid }) {
  const [phone, setPhone] = useState(defaultPhone || '')
  const [stage, setStage] = useState('idle') // idle | sending | waiting | failed
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const timer = useRef(null)
  useEffect(() => () => clearInterval(timer.current), [])

  const poll = (checkoutRequestID) => {
    let tries = 0
    clearInterval(timer.current)
    timer.current = setInterval(async () => {
      tries += 1
      try {
        const s = await payments.mpesaStatus(checkoutRequestID)
        const status = String(s?.status ?? '').toLowerCase()
        if (status === 'paid' || status === 'completed' || status === 'success') {
          clearInterval(timer.current)
          onPaid({ method: 'M-Pesa', receipt: s?.mpesaReceiptNumber })
        } else if (status === 'failed' || status === 'cancelled') {
          clearInterval(timer.current)
          setStage('failed')
          setError(s?.resultDesc || 'The M-Pesa payment was not completed.')
        }
      } catch (e) {
        if (tries > 3) {
          clearInterval(timer.current)
          setStage('failed')
          setError(errText(e, 'Could not check the payment status.'))
        }
      }
      if (tries >= 30) {
        clearInterval(timer.current)
        setStage('failed')
        setError('We did not get a confirmation from M-Pesa in time. If you entered your PIN, check your orders shortly.')
      }
    }, 4000)
  }

  const send = async (e) => {
    e.preventDefault()
    const clean = phone.replace(/\s/g, '')
    if (!PHONE_RE.test(clean)) return setError('Enter a valid Safaricom number, for example 0712345678.')
    setError('')
    setStage('sending')
    try {
      const normalized = clean.startsWith('+') ? clean.slice(1) : clean
      const res = await payments.mpesaInitiate({ phoneNumber: normalized, amount: Math.round(order.totalAmount), orderId: order.id })
      if (!res?.checkoutRequestID) throw { error: 'M-Pesa did not return a payment request.' }
      setInfo(res.message || 'Check your phone and enter your M-Pesa PIN.')
      setStage('waiting')
      poll(res.checkoutRequestID)
    } catch (e2) {
      setStage('failed')
      setError(errText(e2, 'Could not start the M-Pesa payment.'))
    }
  }

  return (
    <form onSubmit={send} noValidate>
      <label htmlFor={`mpesa-${order.id}`} className="mb-1.5 block text-[13px] font-semibold text-ink-3">M-Pesa phone number</label>
      <input
        id={`mpesa-${order.id}`}
        inputMode="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="0712345678"
        disabled={stage === 'sending' || stage === 'waiting'}
        className="h-11 w-full rounded-xl border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
      />
      <button
        type="submit"
        disabled={stage === 'sending' || stage === 'waiting'}
        className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-white shadow-lift transition-all hover:bg-primary-dark disabled:cursor-wait disabled:opacity-70"
      >
        {stage === 'sending' || stage === 'waiting' ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Smartphone size={16} aria-hidden="true" />}
        {stage === 'sending' ? 'Sending prompt…' : stage === 'waiting' ? 'Waiting for your PIN…' : stage === 'failed' ? 'Try again' : `Pay ${kes(order.totalAmount)} with M-Pesa`}
      </button>
      {stage === 'waiting' && <Alert tone="ok">{info}</Alert>}
      <Alert>{error}</Alert>
    </form>
  )
}

let paypalSdk = null
const loadPaypal = (clientId, currency) => {
  if (window.paypal) return Promise.resolve(window.paypal)
  if (!paypalSdk) {
    paypalSdk = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency || 'USD')}&intent=capture`
      s.onload = () => resolve(window.paypal)
      s.onerror = () => { paypalSdk = null; reject({ error: 'PayPal could not be loaded. Check your connection.' }) }
      document.head.appendChild(s)
    })
  }
  return paypalSdk
}

function PaypalPay({ order, onPaid }) {
  const box = useRef(null)
  const [state, setState] = useState('loading') // loading | ready | error
  const [error, setError] = useState('')
  const [amountUsd, setAmountUsd] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const cfg = await payments.paypalConfig()
        if (!cfg?.clientId) throw { error: 'PayPal is not configured on the server yet.' }
        const paypal = await loadPaypal(cfg.clientId, cfg.currency)
        if (!alive || !box.current) return
        box.current.innerHTML = ''
        await paypal
          .Buttons({
            style: { layout: 'vertical', shape: 'pill', label: 'pay' },
            createOrder: async () => {
              setError('')
              const baseUrl = `${window.location.origin}${window.location.pathname}`
              const r = await payments.paypalCreateOrder({
                orderId: order.id,
                returnUrl: `${baseUrl}#/buyer/orders`,
                cancelUrl: `${baseUrl}#/shop/checkout`,
              })
              if (r?.amountUsd) setAmountUsd(r.amountUsd)
              const paypalOrderId = r?.paypalOrderId ?? r?.providerOrderId
              if (!paypalOrderId) throw { error: 'PayPal did not return a payment order.' }
              return paypalOrderId
            },
            onApprove: async (data) => {
              try {
                const r = await payments.paypalCaptureOrder({ orderId: order.id, paypalOrderId: data.orderID })
                const st = String(r?.status ?? '').toLowerCase()
                if (st !== 'paid' && st !== 'completed') throw { error: `PayPal returned status ${st || 'unknown'}.` }
                onPaid({ method: 'PayPal', receipt: r?.captureId ?? data.orderID })
              } catch (e) {
                setError(errText(e, 'PayPal payment could not be captured.'))
              }
            },
            onCancel: () => setError('PayPal payment was cancelled.'),
            onError: (e) => setError(errText(e, 'PayPal reported an error.')),
          })
          .render(box.current)
        if (alive) setState('ready')
      } catch (e) {
        if (alive) {
          setState('error')
          setError(errText(e, 'PayPal is unavailable right now.'))
        }
      }
    })()
    return () => { alive = false }
  }, [order.id, onPaid])

  return (
    <div>
      {state === 'loading' && (
        <p className="flex items-center gap-2 text-xs text-muted"><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Loading PayPal…</p>
      )}
      <div ref={box} />
      {amountUsd && <p className="mt-2 text-xs text-muted">Charged in US dollars: about ${amountUsd}.</p>}
      <Alert>{error}</Alert>
    </div>
  )
}

export default function PaymentPanel({ order, defaultPhone, onPaid }) {
  const [method, setMethod] = useState('mpesa')
  const [paid, setPaid] = useState(null)

  const handlePaid = useRef(null)
  handlePaid.current = (r) => { setPaid(r); onPaid?.(order, r) }
  const stablePaid = useRef((r) => handlePaid.current(r)).current

  if (paid) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-ok-line bg-ok-wash p-4 text-ok">
        <CheckCircle2 size={18} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-ok-strong">Paid with {paid.method}</p>
          <p className="mt-0.5 text-xs text-ink-4">
            Order #{String(order.id).slice(-6)} for {kes(order.totalAmount)}{paid.receipt ? `. Receipt ${paid.receipt}` : ''}.
          </p>
        </div>
      </div>
    )
  }

  const tab = (id, label, Icon) => (
    <button
      type="button"
      role="radio"
      aria-checked={method === id}
      onClick={() => setMethod(id)}
      className={`flex flex-1 items-center justify-center gap-2 rounded-xl border px-3 py-3 text-sm font-semibold transition-colors ${method === id ? 'border-brand bg-primary-soft text-brand-deep' : 'border-line text-ink-4 hover:bg-soft'}`}
    >
      <Icon size={16} aria-hidden="true" /> {label}
    </button>
  )

  return (
    <div className="rounded-xl border border-line p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-ink">Order #{String(order.id).slice(-6)}</p>
        <p className="font-display text-base font-bold text-ink tabular-nums">{kes(order.totalAmount)}</p>
      </div>
      <div role="radiogroup" aria-label="Payment method" className="mb-4 flex gap-2">
        {tab('mpesa', 'M-Pesa', Smartphone)}
        {tab('paypal', 'PayPal or card', CreditCard)}
      </div>
      {method === 'mpesa' ? (
        <MpesaPay order={order} defaultPhone={defaultPhone} onPaid={stablePaid} />
      ) : (
        <PaypalPay order={order} onPaid={stablePaid} />
      )}
    </div>
  )
}

export { RotateCw }
