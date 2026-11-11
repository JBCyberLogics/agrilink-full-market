/**
 * AI Purchase Planning — buyer page.
 *
 * Creates a least-cost purchase plan from real marketplace listing records.
 */
import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, LoaderCircle, RotateCw, Search, Sparkles, Truck } from 'lucide-react'
import { createPurchasePlanFromMarketplace } from '../../services/hybridIntelligence.js'
import { useAIRequest } from '../../../../ai/hooks/useAIRequest.js'
import { AI_CAPABILITIES } from '../../../../ai/config.js'

const INITIAL_FORM = {
  produceRequirements: '',
  requiredQuantities: '',
  unit: 'kg',
  budget: '',
  purchaseDeadline: '',
  deliveryArea: '',
}


export default function AIPurchasePlanning() {
  const [form, setForm] = useState({ ...INITIAL_FORM })
  const [errors, setErrors] = useState({})
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useRef(null)
  const ai = useAIRequest(AI_CAPABILITIES.PURCHASE_ASSISTANT)

  const setField = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const validate = () => {
    const next = {}
    if (!form.produceRequirements.trim()) next.produceRequirements = 'Please enter produce requirements.'
    if (!form.requiredQuantities.trim()) next.requiredQuantities = 'Please enter required quantities.'
    else if (
      isNaN(Number(form.requiredQuantities)) ||
      Number(form.requiredQuantities) <= 0
    )
      next.requiredQuantities = 'Please enter a valid quantity greater than zero.'
    if (!form.deliveryArea.trim()) next.deliveryArea = 'Please enter a delivery area.'
    if (form.budget !== '' && (!Number.isFinite(Number(form.budget)) || Number(form.budget) < 0)) next.budget = 'Budget must be a non-negative amount.'
    if (/[\n,;]/.test(form.produceRequirements)) next.produceRequirements = 'Create a plan for one produce item at a time.'
    return next
  }

  const submit = async (e) => {
    e.preventDefault()
    const validationErrors = validate()
    setErrors(validationErrors)
    if (Object.keys(validationErrors).length > 0) {
      panelRef.current?.querySelector('[aria-invalid="true"]')?.focus()
      return
    }
    setSubmitting(true)
    setError('')
    setResult(null)
    ai.reset()
    try {
      const response = await createPurchasePlanFromMarketplace({
        produceRequirements: form.produceRequirements.trim(),
        requiredQuantities: Number(form.requiredQuantities),
        unit: form.unit,
        budget: form.budget ? Number(form.budget) : undefined,
        purchaseDeadline: form.purchaseDeadline,
        deliveryArea: form.deliveryArea.trim(),
      })
      if (response.ok) {
        setResult(response.data)
      } else {
        setError(response.error || 'Could not create purchase plan.')
      }
    } catch (err) {
      setError(err?.message || 'Could not create purchase plan.')
    } finally {
      setSubmitting(false)
    }
  }

  const explainPlan = async () => {
    if (!result?.plan) return
    await ai.run({
      produceRequirements: form.produceRequirements.trim(),
      requiredQuantities: Number(form.requiredQuantities),
      budget: form.budget ? Number(form.budget) : undefined,
      purchaseDeadline: form.purchaseDeadline || undefined,
      deliveryArea: form.deliveryArea.trim(),
      question: 'Explain this allocation and its shortages using only the supplied listing records and calculations.',
      purchasePlan: {
        status: result.plan.status,
        complete: result.plan.complete,
        withinBudget: result.plan.withinBudget,
        currency: result.plan.currency,
        totalCost: result.plan.totalCost,
        costsByCurrency: result.plan.costsByCurrency,
        allocations: result.plan.allocations.map(({ offerId, supplierId, quantity, unit, unitPrice, currency, cost }) => ({ offerId, supplierId, quantity, unit, unitPrice, currency, cost })),
        shortages: result.plan.shortages.map(({ remaining, reason }) => ({ remaining, reason })),
        assumptions: result.plan.assumptions,
      },
    })
  }

  if (!result && !error && !submitting) {
    return (
      <div className="space-y-6">
        <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
          <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
            <Truck size={16} aria-hidden="true" className="mr-2 text-farmer-brand" />
            AI Purchase Planning
          </h2>
          <p className="mt-1 text-xs text-farmer-muted">
            Allocate one produce requirement across compatible active listings, using the lowest observed listing prices first. No supplier or price is generated when the marketplace has no matching data.
          </p>
        </section>
        <form onSubmit={submit} noValidate className="space-y-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
              One produce item
            </span>
            <textarea
              id="planning-produce-requirements"
              rows={4}
              value={form.produceRequirements}
              onChange={setField('produceRequirements')}
              placeholder="e.g. maize"
              aria-label="Produce requirements"
              aria-invalid={!!errors.produceRequirements}
              className={`w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40 ${
                errors.produceRequirements
                  ? 'border-farmer-danger'
                  : 'border-farmer-line focus:border-farmer-brand/50'
              }`}
            />
            {errors.produceRequirements && (
              <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-farmer-danger" role="alert">
                <AlertCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                {errors.produceRequirements}
              </p>
            )}
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
              Required quantities
            </span>
            <input
              id="planning-quantities"
              type="number"
              min="0.01"
              step="0.01"
              value={form.requiredQuantities}
              onChange={setField('requiredQuantities')}
              placeholder="e.g. 1000"
              aria-label="Required quantities"
              aria-invalid={!!errors.requiredQuantities}
              className={`w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40 ${
                errors.requiredQuantities
                  ? 'border-farmer-danger'
                  : 'border-farmer-line focus:border-farmer-brand/50'
                }`}
              />
              {errors.requiredQuantities && (
                <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-farmer-danger" role="alert">
                  <AlertCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                  {errors.requiredQuantities}
                </p>
              )}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">Measurement unit</span>
              <select value={form.unit} onChange={setField('unit')} aria-label="Measurement unit" className="w-full rounded-lg border border-farmer-line bg-paper px-3 py-2.5 text-[13px] text-farmer-ink"><option value="kg">kg</option><option value="g">g</option><option value="tonne">tonne</option><option value="litre">litre</option><option value="bunch">bunch</option><option value="crate">crate</option><option value="tray">tray</option><option value="piece">piece</option></select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
                Budget (KSh)
              </span>
              <input
                id="planning-budget"
                type="number"
                min="0"
                step="0.01"
                value={form.budget}
                onChange={setField('budget')}
                placeholder="e.g. 50000"
                aria-label="Budget"
                aria-invalid={!!errors.budget}
                className="w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40"
              />
              {errors.budget && <p className="mt-1 text-xs font-medium text-farmer-danger" role="alert">{errors.budget}</p>}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
                Purchase deadline
              </span>
              <input
                id="planning-deadline"
                type="date"
                value={form.purchaseDeadline}
                onChange={setField('purchaseDeadline')}
                aria-label="Purchase deadline"
                className="w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
                Delivery area
              </span>
              <input
                id="planning-delivery-area"
                type="text"
                value={form.deliveryArea}
                onChange={setField('deliveryArea')}
                placeholder="e.g. Thika, Kiambu County"
                aria-label="Delivery area"
                aria-invalid={!!errors.deliveryArea}
                className="w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40"
              />
              {errors.deliveryArea && <p className="mt-1 text-xs font-medium text-farmer-danger" role="alert">{errors.deliveryArea}</p>}
            </label>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-farmer-primary text-sm font-semibold text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed hover:bg-farmer-primary-hover"
          >
            <Search size={15} aria-hidden="true" />
            {submitting ? 'Optimizing compatible listings…' : 'Create smart purchase plan'}
          </button>
        </form>
      </div>
  )
}


if (error) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-farmer-line bg-paper p-6 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-danger-wash text-farmer-danger">
          <AlertCircle size={20} aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-semibold text-farmer-ink">
          {error || 'Could not create purchase plan.'}
        </p>
        <button
          type="button"
          onClick={() => setError('')}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-farmer-primary px-4 text-[13px] font-semibold text-white hover:bg-farmer-primary-hover"
        >
          <RotateCw size={14} aria-hidden="true" /> Try again
        </button>
      </section>
    </div>
  )
}

if (submitting) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-farmer-line bg-paper p-6">
        <div className="flex items-center gap-3">
          <span
            className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-farmer-brand/30 border-t-farmer-primary"
            aria-hidden="true"
          />
          <div>
            <p className="text-sm font-semibold text-farmer-ink">Allocating actual listing inventory…</p>
            <p className="mt-0.5 text-xs text-farmer-muted">The plan uses same-produce, same-unit, same-currency listing data only.</p>
          </div>
        </div>
      </section>
    </div>
  )
}

return (
  <div className="space-y-6">
    <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
      <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
        <CheckCircle2 size={16} aria-hidden="true" className="mr-2 text-farmer-success" />
        Purchase plan summary
      </h2>
      <p className="mt-2 text-sm text-farmer-ink leading-relaxed">
        {result.summary || 'No summary available.'}
      </p>
    </section>
    {result.checklist && result.checklist.length > 0 && (
      <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
        <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
          Requirement checklist
        </h2>
        <ul className="space-y-2">
          {result.checklist.map((item, i) => (
            <li key={i} className="flex items-start gap-3 rounded-lg border border-farmer-line px-4 py-3">
              <span className="mt-0.5 shrink-0">☐</span>
              <p className="min-w-0 text-sm text-farmer-ink">{item}</p>
            </li>
          ))}
        </ul>
      </section>
    )}
    {result.shortlist && result.shortlist.length > 0 && (
      <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
        <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
          <Truck size={16} aria-hidden="true" className="mr-2 text-farmer-brand" />
          Shortlist
        </h2>
        <ul className="space-y-3">
          {result.shortlist.map((item, i) => (
            <li key={i} className="flex items-start gap-3 rounded-lg border border-farmer-line px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-farmer-ink">
                  {item.item || 'Produce item'}
                </p>
                <p className="mt-0.5 text-xs text-farmer-muted">
                  {item.quantity ? item.quantity + ' ' + item.unit : 'Quantity not specified'}
                  {item.quality ? ' · ' + item.quality : ''}
                </p>
              </div>
              <div className="flex flex-col sm:flex-row items-end sm:items-start gap-2">
                <p className="text-sm font-semibold text-farmer-ink tabular-nums">
                  {Number.isFinite(item.price) ? `${item.currency} ${item.price} / ${item.unit} · ${item.currency} ${item.total} total` : 'Price not specified'}
                  {item.supplier && <span className="block text-[10px] text-farmer-muted">Seller: {item.supplier}</span>}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    )}
    {result.costBreakdown && (
      <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
        <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
          Potential cost breakdown
        </h2>
        <p className="text-sm text-farmer-ink leading-relaxed">
          {result.costBreakdown}
        </p>
      </section>
    )}
    <section className="rounded-xl border border-farmer-line bg-paper p-5 sm:p-6">
      <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-farmer-surface text-farmer-brand"><Sparkles size={17} aria-hidden="true" /></span><div><h2 className="text-sm font-bold text-farmer-ink">NVIDIA plan explanation</h2><p className="mt-1 text-xs leading-relaxed text-farmer-muted">The local optimizer calculates allocations and costs. NVIDIA may explain this exact plan; it cannot add listings or change the arithmetic.</p></div></div>
      {ai.error && <p className="mt-3 rounded-lg bg-danger-wash p-3 text-xs text-farmer-danger" role="alert">{ai.error}</p>}
      {ai.data?.summary && <p className="mt-3 rounded-lg bg-farmer-page p-3 text-sm leading-relaxed text-farmer-ink" role="status">{ai.data.summary}</p>}
      <button type="button" onClick={explainPlan} disabled={ai.isLoading || !result.plan} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-farmer-primary px-4 text-xs font-semibold text-white hover:bg-farmer-primary-hover disabled:cursor-not-allowed disabled:opacity-50">{ai.isLoading ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}{ai.isLoading ? 'Requesting explanation…' : 'Explain this purchase plan'}</button>
    </section>
    <p className="rounded-xl border border-farmer-line bg-paper px-4 py-3 text-xs leading-relaxed text-farmer-muted">
      This plan is deterministic and based on marketplace listings returned by the API. It does not place an order or guarantee stock.
    </p>
  </div>
)
}

