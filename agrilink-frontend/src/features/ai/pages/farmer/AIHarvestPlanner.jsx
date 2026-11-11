/**
 * AI Harvest and Selling Planner — farmer page.
 *
 * Builds a deterministic logistics schedule and offers optional proxy commentary.
 */
import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, LoaderCircle, RotateCw, Search, Sparkles, Truck } from 'lucide-react'
import { buildHarvestPlan } from '../../../../ai/algorithms/index.js'
import { useAIRequest } from '../../../../ai/hooks/useAIRequest.js'
import { AI_CAPABILITIES } from '../../../../ai/config.js'

const INITIAL_FORM = {
  produceType: '',
  expectedHarvestDate: '',
  expectedQuantity: '',
  location: '',
}

export default function AIHarvestPlanner() {
  const [form, setForm] = useState({ ...INITIAL_FORM })
  const [errors, setErrors] = useState({})
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [question, setQuestion] = useState('')
  const panelRef = useRef(null)
  const ai = useAIRequest(AI_CAPABILITIES.HARVEST_ADVISOR)

  const setField = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const validate = () => {
    const next = {}
    if (!form.produceType.trim()) next.produceType = 'Please enter a produce type.'
    if (!form.expectedHarvestDate) next.expectedHarvestDate = 'Please select a harvest date.'
    if (!form.expectedQuantity.trim()) next.expectedQuantity = 'Please enter a quantity.'
    else if (
      isNaN(Number(form.expectedQuantity)) ||
      Number(form.expectedQuantity) <= 0
    )
      next.expectedQuantity = 'Please enter a valid quantity greater than zero.'
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
      setResult(buildHarvestPlan({
        expectedHarvestDate: form.expectedHarvestDate,
        expectedQuantity: Number(form.expectedQuantity),
        location: form.location.trim(),
      }))
    } catch (err) {
      setError(err?.message || 'Could not get planning insights.')
    } finally {
      setSubmitting(false)
    }
  }

  const explainPlan = async () => {
    if (!result) return
    await ai.run({
      produceType: form.produceType.trim(),
      expectedHarvestDate: form.expectedHarvestDate,
      expectedQuantity: Number(form.expectedQuantity),
      location: form.location.trim(),
      question: question.trim() || undefined,
      logisticsPlan: result,
    })
  }

  if (!result && !error && !submitting) {
    return (
      <div className="space-y-6">
        <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
          <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
            <Truck size={16} aria-hidden="true" className="mr-2 text-farmer-brand" />
            AI Harvest and Selling Planner
          </h2>
          <p className="mt-1 text-xs text-farmer-muted">
            Build a date-based logistics checklist locally. Optional NVIDIA commentary is available through the authenticated AgriLink proxy.
          </p>
        </section>
        <form onSubmit={submit} noValidate className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
                Produce type
              </span>
              <input
                id="planner-produce-type"
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
                Expected harvest date
              </span>
              <input
                id="planner-harvest-date"
                type="date"
                value={form.expectedHarvestDate}
                onChange={setField('expectedHarvestDate')}
                aria-label="Expected harvest date"
                className="w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40"
              />
              {errors.expectedHarvestDate && (
                <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-farmer-danger" role="alert">
                  <AlertCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                  {errors.expectedHarvestDate}
                </p>
              )}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
                Expected quantity
              </span>
              <input
                id="planner-quantity"
                type="number"
                min="0.01"
                step="0.01"
                value={form.expectedQuantity}
                onChange={setField('expectedQuantity')}
                placeholder="e.g. 1000"
                aria-label="Expected quantity"
                aria-invalid={!!errors.expectedQuantity}
                className={`w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40 ${
                  errors.expectedQuantity
                    ? 'border-farmer-danger'
                    : 'border-farmer-line focus:border-farmer-brand/50'
                }`}
              />
              {errors.expectedQuantity && (
                <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-farmer-danger" role="alert">
                  <AlertCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                  {errors.expectedQuantity}
                </p>
              )}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
                Location
              </span>
              <input
                id="planner-location"
                type="text"
                value={form.location}
                onChange={setField('location')}
                placeholder="e.g. Nakuru"
                aria-label="Location"
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
            {submitting ? 'Building schedule…' : 'Build harvest schedule'}
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
          {error || 'Could not get planning insights.'}
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
            <p className="text-sm font-semibold text-farmer-ink">Building a date-based harvest schedule…</p>
            <p className="mt-0.5 text-xs text-farmer-muted">This deterministic schedule uses only your entered harvest date and quantity.</p>
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
        Planning timeline
      </h2>
      <p className="mt-2 text-sm text-farmer-ink leading-relaxed">
        {result.timeline || 'No timeline available.'}
      </p>
    </section>
    {result.checklist && result.checklist.length > 0 && (
      <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
        <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
          Preparation checklist
        </h2>
        <ul className="space-y-2">
          {result.checklist.map((item, i) => (
            <li key={i} className="flex items-start gap-3 rounded-lg border border-farmer-line px-4 py-3">
              <span className="mt-0.5 shrink-0">☐</span>
              <p className="min-w-0 text-sm text-farmer-ink">{item.task}</p>
              <p className="ml-auto shrink-0 text-xs text-farmer-muted">{item.date} · {item.daysBefore === 0 ? 'harvest day' : item.daysBefore + ' days before'}</p>
            </li>
          ))}
        </ul>
      </section>
    )}
    {result.sellingWindow && (
      <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
        <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
          <Truck size={16} aria-hidden="true" className="mr-2 text-farmer-brand" />
          Selling window
        </h2>
        <p className="text-sm text-farmer-ink leading-relaxed">
          {result.sellingWindow}
        </p>
      </section>
    )}
    <section className="rounded-xl border border-farmer-line bg-paper p-5 sm:p-6">
      <div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-farmer-surface text-farmer-brand"><Sparkles size={17} aria-hidden="true" /></span><div><h2 className="text-sm font-bold text-farmer-ink">NVIDIA planning guidance</h2><p className="mt-1 text-xs leading-relaxed text-farmer-muted">The deterministic schedule above remains the source for dates and quantities. An AI response can add contextual guidance but cannot predict crop readiness without trusted agronomy data.</p></div></div>
      <label className="mt-4 block"><span className="mb-1.5 block text-xs font-medium text-farmer-ink">Question about this schedule (optional)</span><input value={question} onChange={(event) => setQuestion(event.target.value)} className="w-full rounded-lg border border-farmer-line bg-paper px-3 py-2.5 text-sm text-farmer-ink focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/20" placeholder="What should I confirm before harvest?" /></label>
      {ai.error && <p className="mt-3 rounded-lg bg-danger-wash p-3 text-xs text-farmer-danger" role="alert">{ai.error}</p>}
      {ai.data?.timeline && <p className="mt-3 rounded-lg bg-farmer-page p-3 text-sm leading-relaxed text-farmer-ink" role="status">{ai.data.timeline}</p>}
      {ai.data?.sellingWindow && <p className="mt-2 rounded-lg bg-farmer-page p-3 text-sm leading-relaxed text-farmer-ink">{ai.data.sellingWindow}</p>}
      <button type="button" onClick={explainPlan} disabled={ai.isLoading || !result} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-farmer-primary px-4 text-xs font-semibold text-white hover:bg-farmer-primary-hover disabled:cursor-not-allowed disabled:opacity-50">{ai.isLoading ? <LoaderCircle size={14} className="animate-spin" aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}{ai.isLoading ? 'Requesting guidance…' : 'Ask AI about this schedule'}</button>
    </section>
    <p className="rounded-xl border border-farmer-line bg-paper px-4 py-3 text-xs leading-relaxed text-farmer-muted">
      This checklist is a logistics reminder based on your entered date. It does not predict crop readiness, weather, buyer demand, or market prices.
    </p>
  </div>
)
}
