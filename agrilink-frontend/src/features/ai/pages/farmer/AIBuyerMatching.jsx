/**
 * AI Buyer Matching — farmer page.
 *
 * Provides a farmer-side buyer matching interface; buyer demand is unavailable in the current API.
 */
import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, MapPin, RotateCw, Search, Truck } from 'lucide-react'
import { farmerBuyerMatches } from '../../../farmer/services/farmerService.js'

const INITIAL_FORM = {
  produceType: '',
  quantity: '',
  unit: 'kg',
  location: '',
  quality: '',
  availability: '',
}

export default function AIBuyerMatching() {
  const [form, setForm] = useState({ ...INITIAL_FORM })
  const [errors, setErrors] = useState({})
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useRef(null)

  const setField = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const validate = () => {
    const next = {}
    if (!form.produceType.trim()) next.produceType = 'Please enter a produce type.'
    if (!form.quantity.trim()) next.quantity = 'Please enter a quantity.'
    else if (
      isNaN(Number(form.quantity)) ||
      Number(form.quantity) <= 0
    )
      next.quantity = 'Please enter a valid quantity greater than zero.'
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
    try {
      setResult(await farmerBuyerMatches({
        ...form,
        produceType: form.produceType.trim(),
        quantity: Number(form.quantity),
        location: form.location.trim(),
        quality: form.quality.trim(),
        availability: form.availability.trim(),
      }))
    } catch (err) {
      setError(err?.error || err?.message || 'Could not load buyer requests.')
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
            AI Buyer Matching
          </h2>
          <p className="mt-1 text-xs text-farmer-muted">
            Matches use open buyer requests for your active listings. Scores use real listing stock and buyer offers; missing quality or location evidence reduces score coverage. No geographic distance is estimated without coordinates.
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
                aria-invalid={!!errors.quantity}
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
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">Measurement unit</span>
              <select value={form.unit} onChange={setField('unit')} aria-label="Measurement unit" className="w-full rounded-lg border border-farmer-line bg-paper px-3 py-2.5 text-[13px] text-farmer-ink">
                <option value="kg">kg</option><option value="g">g</option><option value="tonne">tonne</option><option value="litre">litre</option><option value="bunch">bunch</option><option value="crate">crate</option><option value="tray">tray</option><option value="piece">piece</option>
              </select>
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
                placeholder="e.g. Nyeri"
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
            {submitting ? 'Checking open buyer requests…' : 'Find matching buyers'}
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
          {error || 'Could not get buyer matches.'}
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
            <p className="text-sm font-semibold text-farmer-ink">Checking open buyer requests…</p>
            <p className="mt-0.5 text-xs text-farmer-muted">
              Reading buyer requests and your current listing data.
            </p>
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
        Matching buyers
      </h2>
      <p className="mt-2 text-sm text-farmer-ink">
        Found {result.matches?.length ?? 0} open buyer request(s) that match your active listings.
      </p>
    </section>
    {result.matches?.length > 0 ? (
      <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
        <ul className="divide-y divide-farmer-line">
          {result.matches.map((match) => (
            <li key={match.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-farmer-ink">
                    {match.buyerName || 'Buyer'} · {match.produce}
                  </p>
                  <p className="mt-0.5 text-xs text-farmer-muted">
                    {match.location ? match.location : 'Location not specified'}
                  </p>
                </div>
                <div className="flex flex-col sm:flex-row items-end sm:items-start gap-2">
                  <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold">
                    {Number.isFinite(match.matchScore) ? `${match.matchScore}% match · ${match.scoreCoverage}% data` : 'Score unavailable'}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-xs text-farmer-muted">
                {match.quantity ? match.quantity + ' ' + match.unit : 'Quantity not specified'}
                {match.quality ? ' · ' + match.quality : ''}
              </p>
              <p className="mt-2 text-xs text-farmer-muted">
                {match.explanation || 'Match details are unavailable.'}
              </p>
            </li>
          ))}
        </ul>
      </section>
    ) : (
      <section className="rounded-xl border border-farmer-line bg-paper p-6 text-center">
        <MapPin size={18} aria-hidden="true" className="mx-auto text-farmer-muted" />
        <p className="mt-2 text-sm font-semibold text-farmer-ink">No matching open buyer requests</p>
        <p className="mt-1 text-xs text-farmer-muted">Requests appear here when a buyer asks for produce from one of your active listings.</p>
      </section>
    )}
    <p className="rounded-xl border border-farmer-line bg-paper px-4 py-3 text-xs leading-relaxed text-farmer-muted">
      Scores use the configured price, quality, distance, and availability weights. Missing factors reduce score coverage. Units are compared exactly; the system never converts units or estimates distance from place names.
    </p>
  </div>
)
}
