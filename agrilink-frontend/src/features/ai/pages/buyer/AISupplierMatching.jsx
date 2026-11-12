/**
 * AI Supplier Matching — buyer page.
 *
 * Ranks suppliers from current marketplace listing records.
 */
import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, LoaderCircle, MapPin, RotateCw, Search, Sparkles, Truck } from 'lucide-react'
import { rankSuppliersFromMarketplace } from '../../services/hybridIntelligence.js'
import { useAIRequest } from '../../../../ai/hooks/useAIRequest.js'
import { AI_CAPABILITIES } from '../../../../ai/config.js'

const INITIAL_FORM = {
  produceType: '',
  quantity: '',
  unit: 'kg',
  location: '',
  quality: '',
  availability: '',
}

export default function AISupplierMatching() {
  const [form, setForm] = useState({ ...INITIAL_FORM })
  const [errors, setErrors] = useState({})
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useRef(null)
  const ai = useAIRequest(AI_CAPABILITIES.SUPPLIER_ADVISOR)

  const setField = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const explainSuppliers = async () => {
    if (!result?.suppliers?.length) return
    await ai.run({
      produceType: form.produceType.trim(),
      location: form.location.trim(),
      quantity: form.quantity ? Number(form.quantity) : undefined,
      quality: form.quality.trim() || undefined,
      availability: form.availability.trim() || undefined,
      rankedSuppliers: result.suppliers.slice(0, 10).map((supplier) => ({
        supplierId: supplier.supplierId,
        listingId: supplier.listingId,
        produce: supplier.produce,
        score: supplier.matchScore,
        dataCoverage: supplier.scoreCoverage,
        reasons: supplier.reasons,
        price: supplier.price,
        currency: supplier.currency,
        unit: supplier.unit,
        quantity: supplier.quantity,
        quality: supplier.quality,
      })),
    })
  }

  const validate = () => {
    const next = {}
    if (!form.produceType.trim()) next.produceType = 'Please enter a produce type.'
    if (!form.location.trim()) next.location = 'Please enter a location.'
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
      const response = await rankSuppliersFromMarketplace({
        produceType: form.produceType.trim(),
        quantity: form.quantity ? Number(form.quantity) : undefined,
        unit: form.unit,
        location: form.location.trim(),
        quality: form.quality.trim(),
        availability: form.availability.trim(),
      })
      if (response.ok) {
        setResult(response.data)
      } else {
        setError(response.error || 'Could not find matching suppliers.')
      }
    } catch (err) {
      setError(err?.message || 'Could not find matching suppliers.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!result && !error && !submitting) {
    return (
      <div className="space-y-6">
        <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
          <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
            <Truck size={16} aria-hidden="true" className="mr-2 text-farmer-brand" />
            AI Supplier Matching
          </h2>
          <p className="mt-1 text-xs text-farmer-muted">
            Ranking uses actual active marketplace listings. Missing distance, quality, price, or quantity data is reported as unavailable and reduces score coverage.
          </p>
        </section>
        <form onSubmit={submit} noValidate className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
                Produce type
              </span>
              <input
                id="match-produce-type"
                type="text"
                value={form.produceType}
                onChange={setField('produceType')}
                placeholder="e.g. maize, tomatoes…"
                aria-label="Produce type"
                aria-invalid={!!errors.produceType}
                className={`w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40 ${
                  errors.produceType
                    ? 'border-farmer-danger'
                    : 'border-farmer-line focus:border-farmer-brand/50'
                }`}
              />
              {errors.produceType && (
                <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-farmer-danger" role="alert">
                  <AlertCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                  {errors.produceType}
                </p>
              )}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">Measurement unit</span>
              <select value={form.unit} onChange={setField('unit')} aria-label="Measurement unit" className="w-full rounded-lg border border-farmer-line bg-paper px-3 py-2.5 text-[13px] text-farmer-ink"><option value="kg">kg</option><option value="g">g</option><option value="tonne">tonne</option><option value="litre">litre</option><option value="bunch">bunch</option><option value="crate">crate</option><option value="tray">tray</option><option value="piece">piece</option></select>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
                Quantity
              </span>
              <input
                id="match-quantity"
                type="number"
                min="0.01"
                step="0.01"
                value={form.quantity}
                onChange={setField('quantity')}
                placeholder="e.g. 500"
                aria-label="Quantity"
                className={`w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40 ${
                  errors.quantity
                    ? 'border-farmer-danger'
                    : 'border-farmer-line focus:border-farmer-brand/50'
                }`}
              />
              {errors.quantity && (
                <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-farmer-danger" role="alert">
                  <AlertCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                  {errors.quantity}
                </p>
              )}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
                Location
              </span>
              <input
                id="match-location"
                type="text"
                value={form.location}
                onChange={setField('location')}
                placeholder="e.g. Thika"
                aria-label="Location"
                className="w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
                Quality
              </span>
              <input
                id="match-quality"
                type="text"
                value={form.quality}
                onChange={setField('quality')}
                placeholder="e.g. Grade A, organic"
                aria-label="Quality"
                className="w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
                Availability
              </span>
              <input
                id="match-availability"
                type="text"
                value={form.availability}
                onChange={setField('availability')}
                placeholder="e.g. Ready in 1 week"
                aria-label="Availability"
                className="w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={submitting}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-farmer-primary text-sm font-semibold text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed hover:bg-farmer-primary-hover"
          >
            <Search size={15} aria-hidden="true" />
            {submitting ? 'Matching suppliers…' : 'Find matching suppliers'}
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
          {error || 'Could not get supplier matches.'}
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
            <p className="text-sm font-semibold text-farmer-ink">Ranking actual supplier listings…</p>
            <p className="mt-0.5 text-xs text-farmer-muted">No performance history is assumed unless verified records are returned.</p>
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
        Matching suppliers
      </h2>
      <p className="mt-2 text-sm text-farmer-ink">
        {result.suppliers && result.suppliers.length > 0
          ? result.suppliers.length + ' matching supplier(s) found'
          : 'No matching suppliers found.'}
      </p>
    </section>
    {result.suppliers && result.suppliers.length > 0 && (
      <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
        <ul className="divide-y divide-farmer-line">
          {result.suppliers.map((supplier, i) => (
            <li key={i} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-farmer-ink">
                    {supplier.supplierName || 'Supplier'}
                  </p>
                  <p className="mt-0.5 text-xs text-farmer-muted">
                    {supplier.location ? supplier.location : 'Location not specified'}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-end sm:items-start gap-2">
                  <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold">
                    {Number.isFinite(supplier.matchScore) ? supplier.matchScore.toFixed(1) + '% · ' + supplier.scoreCoverage + '% data' : 'Insufficient score data'}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-xs text-farmer-muted">
                {Number.isFinite(supplier.quantity) ? supplier.quantity + ' ' + supplier.unit : 'Quantity not specified'}
                {supplier.quality ? ' · ' + supplier.quality : ''}
                {Number.isFinite(supplier.price) ? ' · ' + supplier.currency + ' ' + supplier.price + ' / ' + supplier.unit : ' · price not reported'}
              </p>
              <p className="mt-2 text-xs text-farmer-muted">
                {supplier.reasons?.join(' ') || 'Match based on available listing fields.'}
              </p>
            </li>
          ))}
        </ul>
      </section>
    )}
    <section className="rounded-xl border border-farmer-line bg-paper p-5 sm:p-6">
      <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-farmer-surface text-farmer-brand"><Sparkles size={17} aria-hidden="true" /></span><div><h2 className="text-sm font-bold text-farmer-ink">AI provider explanation</h2><p className="mt-1 text-xs leading-relaxed text-farmer-muted">Supplier selection and scores remain determined by the listing algorithm. The model can explain only the supplied shortlist.</p></div></div>
      {ai.error && <p className="mt-3 rounded-lg bg-danger-wash p-3 text-xs text-farmer-danger" role="alert">{ai.error}</p>}
      {ai.data?.summary && <p className="mt-3 rounded-lg bg-farmer-page p-3 text-sm leading-relaxed text-farmer-ink" role="status">{ai.data.summary}</p>}
      <button type="button" onClick={explainSuppliers} disabled={ai.isLoading || !result.suppliers?.length} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-farmer-primary px-4 text-xs font-semibold text-white hover:bg-farmer-primary-hover disabled:cursor-not-allowed disabled:opacity-50">{ai.isLoading ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}{ai.isLoading ? 'Requesting explanation…' : 'Explain supplier ranking'}</button>
    </section>
    <p className="rounded-xl border border-farmer-line bg-paper px-4 py-3 text-xs leading-relaxed text-farmer-muted">
      Ranking uses listing-level information. Buyer-supplier distance and verified fulfilment history are not available from the current API, so those criteria are omitted rather than inferred.
    </p>
  </div>
)
}
