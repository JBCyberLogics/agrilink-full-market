/**
 * AI Listing Improvement — farmer page.
 *
 * Requests a listing rewrite through the secure AI proxy and audits unsupported claims locally.
 */
import { useRef, useState } from 'react'
import { AlertCircle, Check, CheckCircle2, Copy, RotateCw, Search, ShieldAlert } from 'lucide-react'
import { aiListingImprovement } from '../../../../services/ai'
import { auditListingRewrite } from '../../../../ai/algorithms/index.js'

const INITIAL_FORM = {
  existingTitle: '',
  description: '',
  qualityDetails: '',
  quantity: '',
  availability: '',
}

export default function AIListingImprovement() {
  const [form, setForm] = useState({ ...INITIAL_FORM })
  const [errors, setErrors] = useState({})
  const [result, setResult] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [copyMessage, setCopyMessage] = useState('')
  const panelRef = useRef(null)

  const setField = (key) => (e) =>
    setForm((prev) => ({ ...prev, [key]: e.target.value }))

  const claimAudit = result ? auditListingRewrite({
    ...form,
    existingTitle: form.existingTitle,
  }, result) : null

  const copySuggestion = async () => {
    const text = [result.improvedTitle, result.improvedDescription].filter(Boolean).join('\n\n')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard access is unavailable in this browser.')
      await navigator.clipboard.writeText(text)
      setCopyMessage('Suggestion copied.')
    } catch (copyError) {
      setCopyMessage(copyError?.message || 'Could not copy the suggestion.')
    }
  }

  const validate = () => {
    const next = {}
    if (!form.existingTitle.trim()) next.existingTitle = 'Please enter an existing title.'
    if (!form.description.trim()) next.description = 'Please enter a produce description.'
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
    setCopyMessage('')
    setResult(null)
    try {
      const response = await aiListingImprovement({
        existingTitle: form.existingTitle.trim(),
        description: form.description.trim(),
        qualityDetails: form.qualityDetails.trim(),
        quantity: form.quantity.trim(),
        availability: form.availability.trim(),
      })
      if (response.ok) {
        setResult(response.data)
      } else {
        setError(response.error || 'Could not improve listing.')
      }
    } catch (err) {
      setError(err?.message || 'Could not improve listing.')
    } finally {
      setSubmitting(false)
    }
  }

  if (!result && !error && !submitting) {
    return (
      <div className="space-y-6">
        <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
          <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
            <Search size={16} aria-hidden="true" className="mr-2 text-farmer-brand" />
            AI Listing Improvement
          </h2>
          <p className="mt-1 text-xs text-farmer-muted">
          Get wording suggestions based on your supplied listing details. The secure AgriLink AI proxy is required to generate a rewrite.
          </p>
          {copyMessage && <p className="mt-3 text-xs text-farmer-muted" role="status">{copyMessage}</p>}
        </section>
        <form onSubmit={submit} noValidate className="space-y-5">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
              Existing title
            </span>
            <input
              id="improve-existing-title"
              type="text"
              value={form.existingTitle}
              onChange={setField('existingTitle')}
              placeholder="e.g. Fresh maize for sale"
              aria-label="Existing listing title"
              aria-invalid={!!errors.existingTitle}
              className={`w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40 ${
                errors.existingTitle
                  ? 'border-farmer-danger'
                  : 'border-farmer-line focus:border-farmer-brand/50'
              }`}
            />
            {errors.existingTitle && (
              <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-farmer-danger" role="alert">
                <AlertCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                {errors.existingTitle}
              </p>
            )}
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
              Produce description
            </span>
            <textarea
              id="improve-description"
              rows={4}
              value={form.description}
              onChange={setField('description')}
              placeholder="Describe your produce quality, freshness, and any special features…"
              aria-label="Produce description"
              aria-invalid={!!errors.description}
              className={`w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40 ${
                errors.description
                  ? 'border-farmer-danger'
                  : 'border-farmer-line focus:border-farmer-brand/50'
              }`}
            />
            {errors.description && (
              <p className="mt-1 flex items-start gap-1.5 text-xs font-medium text-farmer-danger" role="alert">
                <AlertCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
                {errors.description}
              </p>
            )}
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
              Quality details
            </span>
            <input
              id="improve-quality-details"
              type="text"
              value={form.qualityDetails}
              onChange={setField('qualityDetails')}
              placeholder="e.g. Grade A, pesticide-free, sun-dried"
              aria-label="Quality details"
              className="w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
              Quantity
            </span>
            <input
              id="improve-quantity"
              type="text"
              value={form.quantity}
              onChange={setField('quantity')}
              placeholder="e.g. 500 kg"
              aria-label="Quantity"
              className="w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-farmer-ink">
              Availability
            </span>
            <input
              id="improve-availability"
              type="text"
              value={form.availability}
              onChange={setField('availability')}
              placeholder="e.g. Ready in 2 weeks"
              aria-label="Availability"
              className="w-full rounded-lg border bg-paper px-3 py-2.5 text-[13px] text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/40"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-farmer-primary text-sm font-semibold text-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed hover:bg-farmer-primary-hover"
          >
            <Search size={15} aria-hidden="true" />
            {submitting ? 'Improving…' : 'Improve listing'}
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
          {error || 'Could not improve listing.'}
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
        Improved listing
      </h2>
      <div className="grid gap-6 sm:grid-cols-2">
        <section className="rounded-xl border border-farmer-line bg-paper p-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-farmer-muted mb-3">
            Original listing
          </h3>
          <p className="text-sm text-farmer-ink">{form.existingTitle}</p>
          <p className="mt-2 text-xs text-farmer-muted">{form.description}</p>
        </section>
        <section className="rounded-xl border border-farmer-line bg-paper p-6">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-farmer-muted mb-3">
            Improved listing
          </h3>
          <p className="text-sm font-semibold text-farmer-ink">
            {result.improvedTitle || 'No improved title available.'}
          </p>
          <p className="mt-2 text-xs text-farmer-ink leading-relaxed">
            {result.improvedDescription || 'No improved description available.'}
          </p>
        </section>
      </div>
    </section>
    {claimAudit && (
      <section className={`rounded-xl border p-4 ${claimAudit.warnings.length ? 'border-amber-300 bg-amber-50' : 'border-farmer-line bg-farmer-page/60'}`} role={claimAudit.warnings.length ? 'alert' : 'status'}>
        <div className="flex items-start gap-2.5">
          {claimAudit.warnings.length > 0 && <ShieldAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-amber-800" />}
          <div>
            <h3 className="text-xs font-bold text-farmer-ink">Review factual claims before reusing this text</h3>
            {claimAudit.warnings.length ? <ul className="mt-1 list-disc space-y-1 pl-4 text-xs leading-relaxed text-amber-900">{claimAudit.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul> : <p className="mt-1 text-xs text-farmer-muted">No new quantity or restricted quality claim was detected. Review the final wording yourself before publishing.</p>}
          </div>
        </div>
      </section>
    )}
    {result.suggestions && result.suggestions.length > 0 && (
      <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
        <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
          Improvement suggestions
        </h2>
        <ul className="space-y-2">
          {result.suggestions.map((s, i) => (
            <li key={i} className="flex items-start gap-3 rounded-lg border border-farmer-line px-4 py-3">
              <span className="mt-0.5 shrink-0 font-semibold text-farmer-ink">
                {s.title}
              </span>
              <p className="min-w-0 text-sm text-farmer-muted">{s.description}</p>
            </li>
          ))}
        </ul>
      </section>
    )}
    <div className="flex gap-3">
      <button
        type="button"
        onClick={() => {
          setForm((current) => ({
            ...current,
            existingTitle: result.improvedTitle || current.existingTitle,
            description: result.improvedDescription || current.description,
          }))
          setResult(null)
          setCopyMessage('Suggestion copied into the editable fields. It has not been saved to a listing.')
        }}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-farmer-line bg-paper px-4 text-[13px] font-semibold text-farmer-ink transition-colors hover:border-farmer-brand/40 hover:text-farmer-brand"
      >
        <Check size={14} aria-hidden="true" />
        Apply to listing form
      </button>
      <button
        type="button"
        onClick={copySuggestion}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-paper px-4 text-[13px] font-semibold text-farmer-ink transition-colors hover:bg-farmer-page"
      >
        <Copy size={14} aria-hidden="true" />
        Copy suggestion
      </button>
    </div>
    {copyMessage && <p className="text-xs text-farmer-muted" role="status">{copyMessage}</p>}
  </div>
)
}
