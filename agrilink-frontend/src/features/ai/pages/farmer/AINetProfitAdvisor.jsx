import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Calculator, CircleDollarSign, Info, LoaderCircle, Sparkles } from 'lucide-react'
import { calculateNetProfit } from '../../../../ai/algorithms/index.js'
import { useAIRequest } from '../../../../ai/hooks/useAIRequest.js'
import { AI_CAPABILITIES } from '../../../../ai/config.js'

const COSTS = [
  ['seed', 'Seeds or seedlings'],
  ['fertilizer', 'Fertilizer and crop care'],
  ['labor', 'Labor'],
  ['harvesting', 'Harvesting'],
  ['transport', 'Transport'],
  ['packaging', 'Packaging'],
  ['selling', 'Selling fees'],
  ['other', 'Other costs'],
]

const money = (amount) => new Intl.NumberFormat('en-KE', {
  style: 'currency', currency: 'KES', maximumFractionDigits: 2,
}).format(amount)

export default function AINetProfitAdvisor() {
  const [quantity, setQuantity] = useState('')
  const [unitSalePrice, setUnitSalePrice] = useState('')
  const [targetProfit, setTargetProfit] = useState('')
  const [costInputs, setCostInputs] = useState(Object.fromEntries(COSTS.map(([key]) => [key, ''])))
  const [costsComplete, setCostsComplete] = useState(false)
  const [question, setQuestion] = useState('')
  const [validationError, setValidationError] = useState('')
  const ai = useAIRequest(AI_CAPABILITIES.NET_PROFIT_ADVISOR)

  useEffect(() => {
    ai.reset()
  }, [quantity, unitSalePrice, targetProfit, costInputs, costsComplete, ai.reset])

  const parsedCosts = COSTS
    .filter(([key]) => costInputs[key] !== '')
    .map(([key, label]) => ({ label, amount: Number(costInputs[key]) }))
  const calculationError = useMemo(() => {
    if (quantity !== '' && (!Number.isFinite(Number(quantity)) || Number(quantity) <= 0)) return 'Sellable quantity must be a valid number greater than zero.'
    if (unitSalePrice !== '' && (!Number.isFinite(Number(unitSalePrice)) || Number(unitSalePrice) < 0)) return 'Sale price must be a valid non-negative amount.'
    if (targetProfit !== '' && (!Number.isFinite(Number(targetProfit)) || Number(targetProfit) < 0)) return 'Target profit must be a valid non-negative amount.'
    for (const [key, label] of COSTS) {
      const value = costInputs[key]
      if (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)) return `${label} must be a valid non-negative amount.`
    }
    return ''
  }, [quantity, unitSalePrice, targetProfit, costInputs])
  const result = useMemo(() => {
    if (quantity === '' || unitSalePrice === '' || calculationError) return null
    try {
      return calculateNetProfit({
        quantity: Number(quantity),
        sellableQuantity: Number(quantity),
        unitSalePrice: Number(unitSalePrice),
        costs: parsedCosts,
        costsComplete,
        targetProfit: targetProfit === '' ? undefined : Number(targetProfit),
      })
    } catch {
      return null
    }
  }, [quantity, unitSalePrice, costsComplete, costInputs, targetProfit, calculationError])

  const requestInsight = async (event) => {
    event.preventDefault()
    setValidationError('')
    if (!result || !result.costsComplete) {
      setValidationError('Enter a valid quantity and price, then confirm that every cost is included before requesting an analysis.')
      return
    }
    await ai.run({
      calculation: {
        currency: 'KES',
        quantity: Number(quantity),
        unitSalePrice: Number(unitSalePrice),
        costs: parsedCosts,
        ...result,
      },
      question: question.trim() || undefined,
    })
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <section className="overflow-hidden rounded-2xl border border-farmer-line bg-paper shadow-sm">
        <div className="flex items-start gap-4 bg-farmer-surface/65 p-5 sm:p-7">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-paper text-farmer-brand"><Calculator size={20} aria-hidden="true" /></span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[.16em] text-farmer-brand">Farmer finance</p>
            <h2 className="mt-1 font-display text-xl font-bold tracking-tight text-farmer-ink">Net Profit Advisor</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-farmer-muted">Calculate an estimate from your own harvest and cost figures. The arithmetic runs in this browser; an AI explanation needs the AgriLink proxy.</p>
          </div>
        </div>

        {calculationError && <p className="border-t border-danger-line bg-danger-wash px-5 py-3 text-sm text-farmer-danger" role="alert">{calculationError}</p>}

        <div className="grid gap-0 lg:grid-cols-[1.2fr_.8fr]">
          <div className="space-y-5 p-5 sm:p-7">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-farmer-ink">Sellable harvest quantity</span>
                <input type="number" min="0.01" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} className="w-full rounded-xl border border-farmer-line bg-paper px-3.5 py-3 text-sm text-farmer-ink focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/20" placeholder="e.g. 250" aria-label="Sellable harvest quantity" />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold text-farmer-ink">Expected sale price per unit (KSh)</span>
                <input type="number" min="0" step="any" value={unitSalePrice} onChange={(event) => setUnitSalePrice(event.target.value)} className="w-full rounded-xl border border-farmer-line bg-paper px-3.5 py-3 text-sm text-farmer-ink focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/20" placeholder="Enter your estimate" aria-label="Expected sale price per unit" />
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-farmer-ink">Target net profit (optional, KSh)</span>
              <input type="number" min="0" step="any" value={targetProfit} onChange={(event) => setTargetProfit(event.target.value)} className="w-full rounded-xl border border-farmer-line bg-paper px-3.5 py-2.5 text-sm text-farmer-ink focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/20" placeholder="Optional target" aria-label="Target net profit" />
            </label>

            <div>
              <div className="mb-3 flex items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-farmer-ink">Costs for this harvest</h3>
                  <p className="mt-0.5 text-xs text-farmer-muted">Use one unit and currency consistently. Blank values count as zero only after confirmation.</p>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-wider text-farmer-muted">KSh</span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {COSTS.map(([key, label]) => (
                  <label key={key} className="block">
                    <span className="mb-1 block text-xs font-medium text-farmer-ink">{label}</span>
                    <input type="number" min="0" step="any" value={costInputs[key]} onChange={(event) => { setCostInputs((current) => ({ ...current, [key]: event.target.value })); setCostsComplete(false) }} className="w-full rounded-xl border border-farmer-line bg-paper px-3.5 py-2.5 text-sm text-farmer-ink focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/20" placeholder="Amount" aria-label={label} />
                  </label>
                ))}
              </div>
              <label className="mt-4 flex items-start gap-2.5 rounded-xl border border-farmer-line bg-farmer-page/65 p-3.5 text-xs leading-relaxed text-farmer-muted">
                <input type="checkbox" checked={costsComplete} onChange={(event) => setCostsComplete(event.target.checked)} className="mt-0.5 accent-farmer-primary" />
                <span>I have included all costs for this calculation. Any blank cost field is intentionally zero.</span>
              </label>
            </div>
          </div>

          <aside className="border-t border-farmer-line bg-farmer-page/55 p-5 sm:p-7 lg:border-l lg:border-t-0">
            <div className="flex items-center gap-2 text-farmer-brand"><CircleDollarSign size={17} aria-hidden="true" /><h3 className="text-sm font-bold text-farmer-ink">Your estimate</h3></div>
            <dl className="mt-4 space-y-3">
              <div className="flex justify-between gap-4 text-sm"><dt className="text-farmer-muted">Estimated revenue</dt><dd className="font-semibold tabular-nums text-farmer-ink">{result ? money(result.revenue) : '—'}</dd></div>
              <div className="flex justify-between gap-4 text-sm"><dt className="text-farmer-muted">Entered costs</dt><dd className="font-semibold tabular-nums text-farmer-ink">{result ? money(result.knownCosts) : '—'}</dd></div>
              <div className="border-t border-farmer-line pt-3">
                <dt className="text-xs font-semibold text-farmer-muted">Net profit</dt>
                <dd className="mt-1 font-display text-2xl font-bold tracking-tight text-farmer-ink">{result?.netProfit === null || !result ? 'Add all costs' : money(result.netProfit)}</dd>
              </div>
              {result?.costsComplete && <>
                <div className="flex justify-between gap-4 text-sm"><dt className="text-farmer-muted">Profit margin</dt><dd className="font-semibold tabular-nums text-farmer-ink">{result.profitMarginPercent === null ? 'Not available' : `${result.profitMarginPercent.toFixed(1)}%`}</dd></div>
                <div className="flex justify-between gap-4 text-sm"><dt className="text-farmer-muted">Break-even price / unit</dt><dd className="font-semibold tabular-nums text-farmer-ink">{money(result.breakEvenUnitPrice)}</dd></div>
                {result.requiredSellingPriceForTargetProfit !== null && <div className="flex justify-between gap-4 text-sm"><dt className="text-farmer-muted">Price / unit for target profit</dt><dd className="font-semibold tabular-nums text-farmer-ink">{money(result.requiredSellingPriceForTargetProfit)}</dd></div>}
              </>}
            </dl>
            <p className="mt-5 flex items-start gap-2 rounded-xl border border-farmer-line bg-paper p-3 text-xs leading-relaxed text-farmer-muted"><Info size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-farmer-brand" />This estimate uses only the values you entered. It does not include unlisted costs, market data, or tax advice.</p>
          </aside>
        </div>
      </section>

      <section className="rounded-2xl border border-farmer-line bg-paper p-5 shadow-sm sm:p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-farmer-surface text-farmer-brand"><Sparkles size={18} aria-hidden="true" /></span>
          <div>
            <h3 className="font-display text-sm font-bold text-farmer-ink">AI cost review</h3>
            <p className="mt-1 text-sm leading-relaxed text-farmer-muted">Optional explanation based on your calculation. The AI service must be connected before it can return advice.</p>
          </div>
        </div>
        <form onSubmit={requestInsight} className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-farmer-ink">Question for the advisor (optional)</span>
            <input value={question} onChange={(event) => setQuestion(event.target.value)} className="w-full rounded-xl border border-farmer-line bg-paper px-3.5 py-2.5 text-sm text-farmer-ink focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/20" placeholder="What costs should I review?" />
          </label>
          {(validationError || ai.error) && <p className="flex items-start gap-2 rounded-xl bg-danger-wash px-3.5 py-3 text-sm text-farmer-danger" role="alert"><AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />{validationError || ai.error}</p>}
          {ai.data?.summary && <p className="rounded-xl bg-farmer-surface p-4 text-sm leading-relaxed text-farmer-ink" role="status">{ai.data.summary}</p>}
          {ai.data?.actions?.length > 0 && <ul className="list-disc space-y-1 pl-5 text-sm text-farmer-ink">{ai.data.actions.map((action, index) => <li key={index}>{action}</li>)}</ul>}
          <button type="submit" disabled={ai.isLoading || !result?.costsComplete} className="inline-flex h-10 items-center gap-2 rounded-xl bg-farmer-primary px-4 text-sm font-semibold text-white hover:bg-farmer-primary-hover disabled:cursor-not-allowed disabled:opacity-50">
            {ai.isLoading ? <LoaderCircle size={15} className="animate-spin" aria-hidden="true" /> : <Sparkles size={15} aria-hidden="true" />}
            {ai.isLoading ? 'Requesting review…' : 'Ask AI to review these figures'}
          </button>
          {!result?.costsComplete && <p className="text-xs text-farmer-muted">Complete the local calculation before sending figures for an AI review.</p>}
        </form>
      </section>
    </div>
  )
}
