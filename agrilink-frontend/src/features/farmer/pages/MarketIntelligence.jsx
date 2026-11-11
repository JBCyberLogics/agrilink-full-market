import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, ArrowUpRight, Database, Filter, Info, MapPin, RotateCw, ShieldCheck, Timer } from 'lucide-react'
import { fetchMarketObservations, MARKET_OBSERVATION_MAX_AGE_MS } from '../services/marketIntelligenceService.js'

const formatDateTime = (value, dateOnly) => {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return 'Invalid date'
  return new Intl.DateTimeFormat('en-KE', dateOnly
    ? { dateStyle: 'medium', timeZone: 'Africa/Nairobi' }
    : { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Nairobi' }).format(date)
}

const money = (value, currency) => {
  try {
    return new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value)
  } catch {
    return `${currency} ${new Intl.NumberFormat('en-KE', { maximumFractionDigits: 2 }).format(value)}`
  }
}

function StatusPill({ children, tone = 'neutral' }) {
  const tones = {
    neutral: 'bg-farmer-page text-farmer-muted',
    fresh: 'bg-farmer-surface text-farmer-success',
    stale: 'bg-amber-50 text-amber-800',
    error: 'bg-danger-wash text-farmer-danger',
  }
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${tones[tone]}`}>{children}</span>
}

export default function MarketIntelligence() {
  const [state, setState] = useState({ status: 'loading', data: null, error: '' })
  const [selectedCommodity, setSelectedCommodity] = useState('all')
  const [selectedMarket, setSelectedMarket] = useState('all')
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let active = true
    setState({ status: 'loading', data: null, error: '' })
    fetchMarketObservations()
      .then((data) => active && setState({ status: 'ready', data, error: '' }))
      .catch((error) => active && setState({ status: 'error', data: null, error: error?.error || error?.message || 'Verified market observations could not be loaded.' }))
    return () => { active = false }
  }, [reload])

  const observations = state.data?.observations ?? []
  const commodities = useMemo(() => [...new Set(observations.map((row) => row.commodity))].sort(), [observations])
  const markets = useMemo(() => [...new Set(observations.map((row) => row.market))].sort(), [observations])
  const visibleRows = useMemo(() => observations.filter((row) =>
    (selectedCommodity === 'all' || row.commodity === selectedCommodity)
    && (selectedMarket === 'all' || row.market === selectedMarket)), [observations, selectedCommodity, selectedMarket])
  const freshCount = observations.filter((row) => row.freshness === 'fresh').length
  const staleCount = observations.length - freshCount

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-farmer-brand">Market data desk</p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-farmer-ink">Market Intelligence</h1>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-farmer-muted">Source-attributed market observations from the AgriLink market-data service. This page shows observed prices only; AI estimates and forecasts are not presented as market facts.</p>
        </div>
        <button type="button" onClick={() => setReload((value) => value + 1)} disabled={state.status === 'loading'} className="inline-flex h-10 items-center gap-2 rounded-xl border border-farmer-line bg-paper px-3.5 text-xs font-semibold text-farmer-ink hover:bg-farmer-page disabled:opacity-50">
          <RotateCw size={14} className={state.status === 'loading' ? 'animate-spin' : ''} aria-hidden="true" />Refresh observations
        </button>
      </header>

      <section className="grid gap-3 sm:grid-cols-3" aria-label="Market data status">
        <article className="rounded-2xl border border-farmer-line bg-paper p-4">
          <div className="flex items-center gap-2 text-farmer-muted"><Database size={15} aria-hidden="true" /><span className="text-[10px] font-bold uppercase tracking-wider">Data service</span></div>
          <p className="mt-2 text-sm font-semibold text-farmer-ink">{state.status === 'loading' ? 'Checking connection…' : state.status === 'error' ? 'Unavailable' : 'Response received'}</p>
          <p className="mt-1 text-xs text-farmer-muted">GET {state.data?.endpoint ?? '/market-intelligence/prices'}</p>
        </article>
        <article className="rounded-2xl border border-farmer-line bg-paper p-4">
          <div className="flex items-center gap-2 text-farmer-muted"><ShieldCheck size={15} aria-hidden="true" /><span className="text-[10px] font-bold uppercase tracking-wider">Verified observations</span></div>
          <p className="mt-2 text-sm font-semibold text-farmer-ink">{state.status === 'ready' ? `${freshCount} fresh · ${staleCount} stale` : 'Not available'}</p>
          <p className="mt-1 text-xs text-farmer-muted">Freshness window: 24 hours. Stale entries remain labeled.</p>
        </article>
        <article className="rounded-2xl border border-farmer-line bg-paper p-4">
          <div className="flex items-center gap-2 text-farmer-muted"><Timer size={15} aria-hidden="true" /><span className="text-[10px] font-bold uppercase tracking-wider">Last checked</span></div>
          <p className="mt-2 text-sm font-semibold text-farmer-ink">{state.data?.fetchedAt ? formatDateTime(state.data.fetchedAt, false) : '—'}</p>
          <p className="mt-1 text-xs text-farmer-muted">This is the fetch time; each row retains its own observation time.</p>
        </article>
      </section>

      {state.status === 'loading' && <section aria-busy="true" aria-label="Loading verified market observations" className="space-y-3 rounded-2xl border border-farmer-line bg-paper p-5"><div className="h-5 w-56 animate-pulse rounded bg-farmer-surface" /><div className="h-10 animate-pulse rounded-lg bg-farmer-page" /><div className="h-48 animate-pulse rounded-xl bg-farmer-page" /></section>}

      {state.status === 'error' && <section className="rounded-2xl border border-danger-line bg-paper p-6" role="alert"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-danger-wash text-farmer-danger"><AlertCircle size={17} aria-hidden="true" /></span><div><h2 className="text-sm font-bold text-farmer-ink">Verified market data is unavailable</h2><p className="mt-1 text-sm leading-relaxed text-farmer-muted">{state.error}</p><p className="mt-2 text-xs text-farmer-muted">No sample prices, charts, or trends are shown when the data service cannot be reached.</p></div></div><button type="button" onClick={() => setReload((value) => value + 1)} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-farmer-primary px-3 text-xs font-semibold text-white"><RotateCw size={14} aria-hidden="true" />Try again</button></section>}

      {state.status === 'ready' && <>
        {state.data.rejectedCount > 0 && <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900" role="status"><Info size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><span>{state.data.rejectedCount} observation{state.data.rejectedCount === 1 ? ' was' : 's were'} withheld because required source, verification, price, location, date, currency, or unit details were invalid or missing. {state.data.duplicateCount ? `${state.data.duplicateCount} duplicate record${state.data.duplicateCount === 1 ? ' was' : 's were'} also removed.` : ''}</span></div>}
        {state.data.duplicateCount > 0 && state.data.rejectedCount === 0 && <div className="rounded-xl border border-farmer-line bg-paper px-4 py-3 text-xs text-farmer-muted" role="status">{state.data.duplicateCount} duplicate observation{state.data.duplicateCount === 1 ? ' was' : 's were'} omitted.</div>}

        <section className="overflow-hidden rounded-2xl border border-farmer-line bg-paper">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-farmer-line px-4 py-4 sm:px-5">
            <div><h2 className="font-display text-base font-bold text-farmer-ink">Verified price observations</h2><p className="mt-1 text-xs text-farmer-muted">Prices are not combined across different currencies or units. Forecasts are not available on this screen.</p></div>
            <div className="flex flex-wrap items-center gap-2"><Filter size={14} className="text-farmer-muted" aria-hidden="true" /><label className="sr-only" htmlFor="market-commodity-filter">Commodity</label><select id="market-commodity-filter" value={selectedCommodity} onChange={(event) => setSelectedCommodity(event.target.value)} className="h-9 rounded-lg border border-farmer-line bg-paper px-2.5 text-xs text-farmer-ink"><option value="all">All commodities</option>{commodities.map((item) => <option key={item} value={item}>{item}</option>)}</select><label className="sr-only" htmlFor="market-location-filter">Market</label><select id="market-location-filter" value={selectedMarket} onChange={(event) => setSelectedMarket(event.target.value)} className="h-9 max-w-48 rounded-lg border border-farmer-line bg-paper px-2.5 text-xs text-farmer-ink"><option value="all">All markets</option>{markets.map((item) => <option key={item} value={item}>{item}</option>)}</select></div>
          </div>

          {observations.length === 0 ? <div className="px-5 py-12 text-center"><span className="mx-auto grid h-11 w-11 place-items-center rounded-2xl bg-farmer-surface text-farmer-brand"><Database size={19} aria-hidden="true" /></span><h3 className="mt-3 text-sm font-bold text-farmer-ink">No verified market observations available</h3><p className="mx-auto mt-1 max-w-lg text-xs leading-relaxed text-farmer-muted">The service returned no observations that include an explicitly verified source, supported unit, valid price, location, currency, and observation date. AgriLink is not displaying generated examples in their place.</p></div>
            : visibleRows.length === 0 ? <div className="px-5 py-10 text-center text-sm text-farmer-muted">No observations match these filters.</div>
              : <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><caption className="sr-only">Market observations returned by the market-data API and validated by AgriLink.</caption><thead className="bg-farmer-page text-[10px] uppercase tracking-wider text-farmer-muted"><tr><th scope="col" className="px-4 py-3 font-bold">Commodity</th><th scope="col" className="px-4 py-3 font-bold">Market</th><th scope="col" className="px-4 py-3 font-bold">Observed price</th><th scope="col" className="px-4 py-3 font-bold">Observation time</th><th scope="col" className="px-4 py-3 font-bold">Source</th><th scope="col" className="px-4 py-3 font-bold">Freshness</th></tr></thead><tbody className="divide-y divide-farmer-line">{visibleRows.map((row) => <tr key={row.id} className="align-top"><td className="px-4 py-3.5 font-semibold text-farmer-ink">{row.commodity}</td><td className="px-4 py-3.5 text-farmer-muted"><span className="inline-flex items-center gap-1.5"><MapPin size={13} aria-hidden="true" />{row.market}</span></td><td className="px-4 py-3.5 font-semibold tabular-nums text-farmer-ink">{money(row.price, row.currency)} <span className="font-normal text-farmer-muted">/ {row.unit}</span>{row.priceType && <span className="ml-1 rounded-full bg-farmer-page px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-farmer-muted">{row.priceType} quote</span>}</td><td className="px-4 py-3.5 text-farmer-muted">{formatDateTime(row.observedAt, row.dateOnly)}{row.dateOnly && <span className="mt-1 block text-[10px]">Time not supplied</span>}</td><td className="px-4 py-3.5 text-farmer-muted">{row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-farmer-brand hover:underline">{row.sourceName}<ArrowUpRight size={12} aria-hidden="true" /></a> : row.sourceName}<span className="mt-1 block text-[10px] text-farmer-success">Verified source metadata</span></td><td className="px-4 py-3.5"><StatusPill tone={row.freshness}><span className={`h-1.5 w-1.5 rounded-full ${row.freshness === 'fresh' ? 'bg-farmer-success' : 'bg-amber-600'}`} />{row.freshness === 'fresh' ? 'Fresh' : 'Stale'}</StatusPill>{row.freshness === 'stale' && <span className="mt-1 block text-[10px] text-farmer-muted">Older than {MARKET_OBSERVATION_MAX_AGE_MS / 3_600_000} hours</span>}</td></tr>)}</tbody></table></div>}
          <footer className="flex flex-wrap items-start gap-2 border-t border-farmer-line bg-farmer-page/60 px-4 py-3 text-[11px] leading-relaxed text-farmer-muted sm:px-5"><Info size={13} className="mt-0.5 shrink-0" aria-hidden="true" /><p>Source verification and provenance must be asserted by the authenticated AgriLink API from its trusted provider registry. The browser validates required fields and freshness, but cannot independently authenticate a provider’s underlying records.</p></footer>
        </section>

        <section className="rounded-2xl border border-dashed border-farmer-line bg-farmer-page/50 p-4"><p className="text-xs font-semibold text-farmer-ink">Trends and forecasts are withheld</p><p className="mt-1 text-xs leading-relaxed text-farmer-muted">A chart or percentage movement will appear only when the API supplies multiple valid, dated observations for the same commodity, market, unit, and currency. No forecast is currently displayed.</p></section>
      </>}
    </div>
  )
}
