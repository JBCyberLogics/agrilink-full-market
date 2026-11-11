/**
 * AI Crop and Produce Insights — farmer page.
 *
 * Provides optional AI guidance and a local suitability comparison using only supplied agronomy inputs.
 */
import { useRef, useState } from 'react'
import { AlertCircle, CheckCircle2, RotateCw, Search, ShoppingBag, Sprout, Truck } from 'lucide-react'
import { aiCropInsights } from '../../../../services/ai'
import { scoreCropSuitability } from '../../../../ai/algorithms/index.js'

const INITIAL_FORM = {
  produceType: '',
  growingStage: '',
  location: '',
  expectedQuantity: '',
  expectedHarvestDate: '',
  rainfallMm: '',
  temperatureC: '',
  soilPh: '',
  soilType: '',
  rainfallMin: '',
  rainfallMax: '',
  temperatureMin: '',
  temperatureMax: '',
  soilPhMin: '',
  soilPhMax: '',
  soilTypes: '',
}


export default function AICropInsights() {
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
    if (!form.growingStage.trim()) next.growingStage = 'Please enter a growing stage.'
    if (!form.location.trim()) next.location = 'Please enter a location.'
    if (!form.expectedQuantity.trim()) next.expectedQuantity = 'Please enter a quantity.'
    else if (
      !Number.isFinite(Number(form.expectedQuantity)) ||
      Number(form.expectedQuantity) <= 0
    )
      next.expectedQuantity = 'Please enter a valid quantity greater than zero.'
    for (const [key, label] of [['rainfallMm', 'Observed rainfall'], ['temperatureC', 'Observed temperature'], ['soilPh', 'Observed soil pH'], ['rainfallMin', 'Minimum rainfall'], ['rainfallMax', 'Maximum rainfall'], ['temperatureMin', 'Minimum temperature'], ['temperatureMax', 'Maximum temperature'], ['soilPhMin', 'Minimum soil pH'], ['soilPhMax', 'Maximum soil pH']]) {
      if (form[key] !== '' && !Number.isFinite(Number(form[key]))) next[key] = `${label} must be a valid number.`
    }
    if (form.rainfallMm !== '' && Number(form.rainfallMm) < 0) next.rainfallMm = 'Rainfall cannot be negative.'
    if (form.soilPh !== '' && (Number(form.soilPh) < 0 || Number(form.soilPh) > 14)) next.soilPh = 'Soil pH must be between 0 and 14.'
    for (const [minKey, maxKey, label] of [['rainfallMin', 'rainfallMax', 'rainfall'], ['temperatureMin', 'temperatureMax', 'temperature'], ['soilPhMin', 'soilPhMax', 'soil pH']]) {
      if (form[minKey] !== '' && form[maxKey] !== '' && Number(form[minKey]) > Number(form[maxKey])) next[maxKey] = `Maximum ${label} must be at least the minimum.`
    }
    return next
  }

  const localSuitability = () => {
    const requirements = {}
    const addRange = (key, minKey, maxKey) => {
      if (form[minKey] !== '' || form[maxKey] !== '') {
        requirements[key] = {
          ...(form[minKey] !== '' ? { min: Number(form[minKey]) } : {}),
          ...(form[maxKey] !== '' ? { max: Number(form[maxKey]) } : {}),
        }
      }
    }
    addRange('rainfallMm', 'rainfallMin', 'rainfallMax')
    addRange('temperatureC', 'temperatureMin', 'temperatureMax')
    addRange('soilPh', 'soilPhMin', 'soilPhMax')
    if (form.soilTypes.trim()) requirements.soilTypes = form.soilTypes.split(',').map((value) => value.trim()).filter(Boolean)
    const observations = {
      rainfallMm: form.rainfallMm === '' ? undefined : Number(form.rainfallMm),
      temperatureC: form.temperatureC === '' ? undefined : Number(form.temperatureC),
      soilPh: form.soilPh === '' ? undefined : Number(form.soilPh),
      soilType: form.soilType.trim() || undefined,
    }
    if (!Object.keys(requirements).length) return null
    const result = scoreCropSuitability({ name: form.produceType.trim(), requirements }, observations)
    return result.score === null ? null : result
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
      const suitability = localSuitability()
      const response = await aiCropInsights({
        produceType: form.produceType.trim(),
        growingStage: form.growingStage.trim(),
        location: form.location.trim(),
        expectedQuantity: Number(form.expectedQuantity),
        expectedHarvestDate: form.expectedHarvestDate,
      })
      if (response.ok) {
        setResult({ ai: response.data, localSuitability: suitability, aiError: null })
      } else {
        if (suitability) setResult({ ai: null, localSuitability: suitability, aiError: response.error })
        else setError(response.error || 'Could not get crop insights. Add field observations and requirement ranges for a local suitability score.')
      }
    } catch (err) {
      setError(err?.message || 'Could not get crop insights.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!result && !error && !submitting) {
    return (
      <div className="space-y-6">
        <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
          <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
            <Sprout size={16} aria-hidden="true" className="mr-2 text-farmer-brand" />
            AI Crop and Produce Insights
          </h2>
          <p className="mt-1 text-xs text-farmer-muted">
            Get AI powered insights on market opportunities for your produce.
            AI responses require backend integration, try submitting to see the
            current status.
          </p>
        </section>
        <form onSubmit={submit} noValidate className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
                Produce type
              </span>
              <input
                id="crop-produce-type"
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
                Growing stage
              </span>
              <input
                id="crop-growing-stage"
                type="text"
                value={form.growingStage}
                onChange={setField('growingStage')}
                placeholder="e.g. flowering, fruiting, harvest-ready"
                aria-label="Growing stage"
                aria-invalid={!!errors.growingStage}
                className={`w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40 ${
                  errors.growingStage
                    ? 'border-farmer-danger'
                    : 'border-farmer-line focus:border-farmer-brand/50'
                }`}
              />
              {errors.growingStage && (
                <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-farmer-danger" role="alert">
                  <AlertCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                  {errors.growingStage}
                </p>
              )}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
                Location
              </span>
              <input
                id="crop-location"
                type="text"
                value={form.location}
                onChange={setField('location')}
                placeholder="e.g. Nyeri"
                aria-label="Location"
                aria-invalid={!!errors.location}
                className={`w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40 ${
                  errors.location
                    ? 'border-farmer-danger'
                    : 'border-farmer-line focus:border-farmer-brand/50'
                }`}
              />
              {errors.location && (
                <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-farmer-danger" role="alert">
                  <AlertCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                  {errors.location}
                </p>
              )}
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
                Expected quantity
              </span>
              <input
                id="crop-expected-quantity"
                type="number"
                min="0.01"
                step="0.01"
                value={form.expectedQuantity}
                onChange={setField('expectedQuantity')}
                placeholder="e.g. 500"
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
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
              Expected harvest date
            </span>
            <input
              id="crop-harvest-date"
              type="date"
              value={form.expectedHarvestDate}
              onChange={setField('expectedHarvestDate')}
              aria-label="Expected harvest date"
              className="w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40"
            />
          </label>
          <details className="rounded-xl border border-farmer-line bg-farmer-page/50 p-4 sm:p-5">
            <summary className="cursor-pointer text-sm font-semibold text-farmer-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-farmer-brand">Optional crop suitability score</summary>
            <p className="mt-2 text-xs leading-relaxed text-farmer-muted">Enter field observations and crop requirement ranges from a source you trust. AgriLink supplies no default agronomy values. The local score is a transparent rule-based comparison, not a trained prediction.</p>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['rainfallMm', 'Observed rainfall (mm)', 'e.g. 650'], ['temperatureC', 'Observed temperature (°C)', 'e.g. 22'],
                ['soilPh', 'Observed soil pH', 'e.g. 6.2'], ['soilType', 'Observed soil type', 'e.g. loam'],
                ['rainfallMin', 'Crop minimum rainfall (mm)', 'e.g. 500'], ['rainfallMax', 'Crop maximum rainfall (mm)', 'e.g. 900'],
                ['temperatureMin', 'Crop minimum temperature (°C)', 'e.g. 18'], ['temperatureMax', 'Crop maximum temperature (°C)', 'e.g. 28'],
                ['soilPhMin', 'Crop minimum soil pH', 'e.g. 5.5'], ['soilPhMax', 'Crop maximum soil pH', 'e.g. 7'],
                ['soilTypes', 'Suitable soil types (comma-separated)', 'e.g. loam, clay loam'],
              ].map(([key, label, placeholder]) => (
                <label key={key} className="block">
                  <span className="mb-1.5 block text-xs font-medium text-farmer-ink">{label}</span>
                  <input type={key === 'soilType' || key === 'soilTypes' ? 'text' : 'number'} step="any" value={form[key]} onChange={setField(key)} placeholder={placeholder} aria-label={label} aria-invalid={!!errors[key]} className={`w-full rounded-lg border bg-paper px-3 py-2.5 text-sm text-farmer-ink focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/20 ${errors[key] ? 'border-farmer-danger' : 'border-farmer-line'}`} />
                  {errors[key] && <p className="mt-1 text-xs text-farmer-danger" role="alert">{errors[key]}</p>}
                </label>
              ))}
            </div>
          </details>
          <button
            type="submit"
            disabled={submitting}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-farmer-primary text-sm font-semibold text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed hover:bg-farmer-primary-hover"
          >
            <Search size={15} aria-hidden="true" />
            {submitting ? 'Analyzing…' : 'Get crop insights'}
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
          {error || 'Could not get crop insights.'}
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
            <p className="text-sm font-semibold text-farmer-ink">Analyzing your request…</p>
            <p className="mt-0.5 text-xs text-farmer-muted">
              This uses the AI service, responses depend on backend integration.
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
        Opportunity summary
      </h2>
      {result.ai?.summary && <p className="mt-2 text-sm text-farmer-ink leading-relaxed">{result.ai.summary}</p>}
      {result.aiError && <p className="mt-3 rounded-lg bg-farmer-page p-3 text-xs text-farmer-muted" role="status">AI guidance is unavailable: {result.aiError}</p>}
    </section>
    {result.localSuitability && <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8"><h2 className="font-display text-base font-bold text-farmer-ink">Rule-based crop suitability</h2><p className="mt-2 text-sm font-semibold text-farmer-ink">{result.localSuitability.score.toFixed(1)} / 100 · {result.localSuitability.coverage}% data coverage</p><p className="mt-1 text-xs text-farmer-muted">This score compares only values and crop ranges you entered. It is not a trained ML prediction or trusted agronomy recommendation.</p><dl className="mt-4 grid gap-2 sm:grid-cols-2">{Object.entries(result.localSuitability.criteria).filter(([, value]) => value !== null).map(([key, value]) => <div key={key} className="flex justify-between gap-4 rounded-lg border border-farmer-line px-3 py-2 text-xs"><dt className="text-farmer-muted">{key}</dt><dd className="font-semibold text-farmer-ink">{value.toFixed(1)} / 100</dd></div>)}</dl>{result.localSuitability.reasons.length > 0 && <ul className="mt-3 space-y-1 text-xs text-farmer-muted">{result.localSuitability.reasons.map((reason, index) => <li key={index}>• {reason}</li>)}</ul>}</section>}
    {result.ai?.marketDemand && (
      <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
        <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
          <Truck size={16} aria-hidden="true" className="mr-2 text-farmer-brand" />
          Market demand
        </h2>
        <p className="text-sm text-farmer-ink leading-relaxed">
          {result.ai.marketDemand}
        </p>
      </section>
    )}
    {result.ai?.buyerInterest && (
      <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
        <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
          <ShoppingBag size={16} aria-hidden="true" className="mr-2 text-farmer-brand" />
          Buyer interest
        </h2>
        <p className="text-sm text-farmer-ink leading-relaxed">
          {result.ai.buyerInterest}
        </p>
      </section>
    )}
    {result.ai?.nextSteps && result.ai.nextSteps.length > 0 && (
      <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
        <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
          Suggested next steps
        </h2>
        <ul className="space-y-2">
          {result.ai.nextSteps.map((step, i) => (
            <li key={i} className="flex items-start gap-3 rounded-lg border border-farmer-line px-4 py-3">
              <span className="mt-0.5 shrink-0">•</span>
              <p className="min-w-0 text-sm text-farmer-ink">{step}</p>
            </li>
          ))}
        </ul>
      </section>
    )}
  </div>
)
}
