import { useMemo, useState } from 'react'
import { Activity, AlertCircle, ArrowUpRight, CheckCircle2, CircleHelp, Clock3, KeyRound, Play, RotateCw, ShieldCheck, TerminalSquare, Wifi, WifiOff } from 'lucide-react'
import {
  agriculturalAssistant, cropAdvisor, harvestAdvisor, listingAssistant, marketAdvisor,
  matchingAssistant, netProfitAdvisor, priceAdvisor, produceFinder, purchaseAssistant,
  recommendationsCenter, supplierAdvisor,
} from '../../../ai/services/index.js'
import { AI_CONFIG, aiProxyIsConfigured } from '../../../ai/config.js'
import { AI_DIAGNOSTIC_FEATURES, checkProviderConnection } from '../../../ai/diagnostics.js'
import { runAlgorithmSmokeTest } from '../../../ai/algorithmDiagnostics.js'
import { validateAIRequest } from '../../../ai/schemas.js'

const services = {
  'shared/agricultural-assistant': (payload) => agriculturalAssistant(payload.message, payload.history ?? []),
  'shared/market-advisor': marketAdvisor,
  'shared/recommendations-center': recommendationsCenter,
  'farmer/crop-advisor': cropAdvisor,
  'farmer/price-advisor': priceAdvisor,
  'farmer/listing-assistant': listingAssistant,
  'farmer/matching-assistant': matchingAssistant,
  'farmer/harvest-advisor': harvestAdvisor,
  'farmer/net-profit-advisor': netProfitAdvisor,
  'buyer/produce-finder': produceFinder,
  'buyer/supplier-advisor': supplierAdvisor,
  'buyer/purchase-assistant': purchaseAssistant,
}

const statusStyle = {
  PASS: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  FAIL: 'border-rose-200 bg-rose-50 text-rose-800',
  BLOCKED: 'border-amber-200 bg-amber-50 text-amber-900',
  'NOT TESTED': 'border-farmer-line bg-farmer-page text-farmer-muted',
  'NOT APPLICABLE': 'border-farmer-line bg-farmer-page text-farmer-muted',
}

function Status({ value }) {
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${statusStyle[value] ?? statusStyle['NOT TESTED']}`}>{value || 'NOT TESTED'}</span>
}

function classifyFailure(response) {
  if (['AI_PROXY_NOT_CONFIGURED', 'AI_NETWORK_ERROR', 'AI_REQUEST_TIMEOUT'].includes(response.code)
    || [0, 401, 403, 404, 429, 503].includes(response.status)) return 'BLOCKED'
  return 'FAIL'
}

const initialFeatureState = () => Object.fromEntries(AI_DIAGNOSTIC_FEATURES.map(({ id }) => [id, {
  validation: 'NOT TESTED', live: aiProxyIsConfigured() ? 'NOT TESTED' : 'BLOCKED',
  algorithm: 'NOT TESTED', endpoint: 'Not checked', durationMs: null, error: '', result: null,
  modelId: null, provider: null,
}]))

function ResultLine({ label, value, status }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-farmer-line py-2 last:border-0"><span className="text-xs text-farmer-muted">{label}</span><span className="flex items-center gap-2 text-right text-xs font-semibold text-farmer-ink">{value ?? '—'}{status && <Status value={status} />}</span></div>
}

export default function AIDiagnostics() {
  const [payloads, setPayloads] = useState(() => Object.fromEntries(AI_DIAGNOSTIC_FEATURES.map(({ id }) => [id, ''])))
  const [featureState, setFeatureState] = useState(initialFeatureState)
  const [providerState, setProviderState] = useState({ status: 'NOT TESTED', error: '', models: null, durationMs: null })
  const [runningAll, setRunningAll] = useState(false)
  const [suiteMessage, setSuiteMessage] = useState('')
  const [providerBusy, setProviderBusy] = useState(false)

  const counts = useMemo(() => Object.values(featureState).reduce((all, result) => {
    all[result.live] = (all[result.live] ?? 0) + 1
    return all
  }, {}), [featureState])

  const parsedPayload = (capability) => {
    if (!payloads[capability]?.trim()) {
      const error = new Error('Enter a request body to test this feature.')
      error.code = 'DIAGNOSTIC_INPUT_REQUIRED'
      throw error
    }
    const parsed = JSON.parse(payloads[capability])
    validateAIRequest(capability, parsed)
    return parsed
  }

  const runAlgorithm = (capability) => {
    const result = runAlgorithmSmokeTest(capability)
    setFeatureState((current) => ({ ...current, [capability]: { ...current[capability], algorithm: result.status.replaceAll('_', ' '), algorithmMessage: result.label } }))
    return result
  }

  const validatePayload = (capability) => {
    try {
      parsedPayload(capability)
      setFeatureState((current) => ({ ...current, [capability]: { ...current[capability], validation: 'PASS', live: aiProxyIsConfigured() ? current[capability].live : 'BLOCKED', error: '' } }))
      return true
    } catch (error) {
      const inputMissing = error?.code === 'DIAGNOSTIC_INPUT_REQUIRED'
      setFeatureState((current) => ({ ...current, [capability]: { ...current[capability], validation: inputMissing ? 'BLOCKED' : 'PASS', live: 'BLOCKED', endpoint: 'No network request sent', error: inputMissing ? error.message : `Rejected locally; no request was sent. ${error?.message || 'Enter a valid request.'}` } }))
      return false
    }
  }

  const runFeature = async (capability) => {
    let payload
    try {
      payload = parsedPayload(capability)
      setFeatureState((current) => ({ ...current, [capability]: { ...current[capability], validation: 'PASS', live: 'NOT TESTED', error: '', result: null } }))
    } catch (error) {
      const inputMissing = error?.code === 'DIAGNOSTIC_INPUT_REQUIRED'
      setFeatureState((current) => ({ ...current, [capability]: {
        ...current[capability], validation: inputMissing ? 'BLOCKED' : 'PASS', live: 'BLOCKED',
        endpoint: 'No network request sent', error: inputMissing ? error.message : `Rejected locally; no request was sent. ${error?.message || 'Enter a valid request.'}`, result: null,
      } }))
      return
    }

    const algorithm = runAlgorithm(capability)
    if (!aiProxyIsConfigured()) {
      setFeatureState((current) => ({ ...current, [capability]: {
        ...current[capability], validation: 'PASS', live: 'BLOCKED', endpoint: 'Proxy URL not configured', error: 'No request was sent. Configure the authenticated AgriLink AI proxy first.', result: null,
      } }))
      return
    }

    const endpoint = `${AI_CONFIG.proxyUrl}/${capability}`
    const started = performance.now()
    setFeatureState((current) => ({ ...current, [capability]: { ...current[capability], live: 'NOT TESTED', endpoint: 'Request in progress…', error: '', result: null } }))
    const response = await services[capability](payload)
    const durationMs = Math.round(performance.now() - started)

    if (response.ok) {
      const modelId = typeof response.meta?.model === 'string' ? response.meta.model : null
      const provider = typeof response.meta?.provider === 'string' ? response.meta.provider : null
      setFeatureState((current) => ({ ...current, [capability]: {
        ...current[capability], live: 'PASS', endpoint, durationMs, result: response.data,
        error: '', modelId, provider,
        providerVerification: provider && modelId ? 'PASS' : 'BLOCKED',
      } }))
      return
    }
    setFeatureState((current) => ({ ...current, [capability]: {
      ...current[capability], live: classifyFailure(response), endpoint, durationMs,
      error: `${response.code || 'AI_REQUEST_FAILED'}: ${response.error}`, result: null,
    } }))
    // The smoke check status is independent of whether an external AI call succeeds.
    if (algorithm.status === 'FAIL') runAlgorithm(capability)
  }

  const runProviderCheck = async () => {
    setProviderBusy(true)
    setProviderState({ status: 'NOT TESTED', error: '', models: null, durationMs: null })
    const response = await checkProviderConnection()
    setProviderState({ ...response, error: response.error || '' })
    setProviderBusy(false)
  }

  const runAllAlgorithms = () => {
    for (const { id } of AI_DIAGNOSTIC_FEATURES) runAlgorithm(id)
  }

  const runSuite = async () => {
    if (!window.confirm('This sends each valid request body below to the configured AgriLink AI proxy. Provider calls may incur usage charges. Continue?')) return
    setRunningAll(true)
    setSuiteMessage('Running feature requests sequentially. Empty or invalid payloads are recorded without being sent.')
    for (const { id } of AI_DIAGNOSTIC_FEATURES) {
      // Each individual live request remains isolated and uses the feature service above.
      // eslint-disable-next-line no-await-in-loop
      await runFeature(id)
    }
    setSuiteMessage('Suite run complete. Review each feature result, model report, and algorithm status below.')
    setRunningAll(false)
  }

  const providerConfigured = Boolean(AI_CONFIG.proxyUrl && AI_CONFIG.statusEndpoint)

  return (
    <div className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-[10px] font-bold uppercase tracking-[.18em] text-farmer-brand">Developer tools · DEV only</p><h1 className="mt-1 font-display text-2xl font-bold text-farmer-ink">AI integration diagnostics</h1><p className="mt-1 max-w-3xl text-sm leading-relaxed text-farmer-muted">Run local contract checks and explicitly initiated requests through AgriLink&apos;s authenticated proxy. The browser never receives provider credentials.</p></div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={runAllAlgorithms} className="inline-flex h-10 items-center gap-2 rounded-xl border border-farmer-line bg-paper px-3.5 text-xs font-semibold text-farmer-ink hover:bg-farmer-page"><RotateCw size={14} aria-hidden="true" />Run all algorithm checks</button><button type="button" onClick={runSuite} disabled={runningAll} className="inline-flex h-10 items-center gap-2 rounded-xl bg-farmer-primary px-3.5 text-xs font-semibold text-white hover:bg-farmer-primary-hover disabled:opacity-50"><Play size={14} aria-hidden="true" />{runningAll ? 'Testing…' : 'Run complete AI suite'}</button></div>
      </header>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-950"><strong>Diagnostic data notice.</strong> Feature requests use the JSON payload you enter here. Only test data you are authorized to send. Requests are sent to the configured authenticated backend proxy; never enter API keys, passwords, or private tokens.</div>

      <section className="grid gap-4 lg:grid-cols-[1.05fr_.95fr]" aria-label="Provider and dependency status">
        <article className="rounded-2xl border border-farmer-line bg-paper p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-farmer-muted">Provider connection</p><h2 className="mt-1 font-display text-lg font-bold text-farmer-ink">Provider calls are managed by AgriLink Control</h2></div><Status value={providerState.status} /></div>
          <p className="mt-2 text-xs leading-relaxed text-farmer-muted">Provider connectivity and inference diagnostics are restricted to AgriLink Control. This page can test capability requests only after explicit user input.</p>
          <div className="mt-4 space-y-1"><ResultLine label="AI proxy" value={aiProxyIsConfigured() ? 'Configured' : 'Not configured'} status={aiProxyIsConfigured() ? 'NOT TESTED' : 'BLOCKED'} /><ResultLine label="Provider status endpoint" value={AI_CONFIG.statusEndpoint || 'Not configured'} status={providerConfigured ? 'NOT TESTED' : 'BLOCKED'} /><ResultLine label="Authenticated session" value="HttpOnly session cookie; verified by backend on request" status="NOT TESTED" /><ResultLine label="Browser API key access" value="Never available by design" status="PASS" />{providerState.durationMs != null && <ResultLine label="Status request time" value={`${providerState.durationMs} ms`} />}{providerState.defaultModelId && <ResultLine label="Default model reported by backend" value={providerState.defaultModelId} />}</div>
          {providerState.error && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900" role="status">{providerState.error}</p>}
          <button type="button" onClick={runProviderCheck} disabled={!providerConfigured || providerBusy} className="mt-4 inline-flex h-9 items-center gap-2 rounded-lg border border-farmer-line px-3 text-xs font-semibold text-farmer-ink hover:bg-farmer-page disabled:cursor-not-allowed disabled:opacity-50">{providerBusy ? <RotateCw size={14} className="animate-spin" aria-hidden="true" /> : <Wifi size={14} aria-hidden="true" />}Test provider and default model</button>
          {!providerConfigured && <p className="mt-2 text-[11px] text-farmer-muted">Provider diagnostics are available only to administrators in AgriLink Control.</p>}
        </article>

        <article className="rounded-2xl border border-farmer-line bg-paper p-5 sm:p-6"><div className="flex items-start gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-farmer-surface text-farmer-brand"><KeyRound size={16} aria-hidden="true" /></span><div><h2 className="font-display text-sm font-bold text-farmer-ink">Model inventory</h2><p className="mt-1 text-xs leading-relaxed text-farmer-muted">Model names and accessibility are read only from a backend status response. No model is assumed accessible from its configured name.</p></div></div>{providerState.models ? <div className="mt-4 max-h-52 space-y-1 overflow-auto">{AI_DIAGNOSTIC_FEATURES.map(({ id, name }) => { const model = providerState.models[id]; return <ResultLine key={id} label={name} value={model?.modelId || providerState.defaultModelId || 'Not reported'} status={model?.available === true ? 'PASS' : model?.available === false ? 'FAIL' : 'BLOCKED'} /> })}</div> : <div className="mt-4 rounded-xl border border-dashed border-farmer-line bg-farmer-page/50 px-4 py-5 text-center text-xs text-farmer-muted">No model inventory has been returned by a backend provider check.</div>}</article>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="AI feature test totals">
        {['PASS', 'FAIL', 'BLOCKED', 'NOT TESTED'].map((value) => <article key={value} className="flex items-center justify-between rounded-xl border border-farmer-line bg-paper px-4 py-3"><span className="text-[10px] font-bold uppercase tracking-wider text-farmer-muted">Feature tests · {value}</span><span className="font-display text-xl font-bold text-farmer-ink">{counts[value] ?? 0}</span></article>)}
      </section>
      {suiteMessage && <p className="rounded-xl border border-farmer-line bg-paper px-4 py-3 text-xs text-farmer-muted" role="status" aria-live="polite">{suiteMessage}</p>}

      <section className="space-y-3" aria-label="Individual AI capability tests">
        {AI_DIAGNOSTIC_FEATURES.map(({ id, name, role }) => {
          const result = featureState[id]
          return <article key={id} className="overflow-hidden rounded-2xl border border-farmer-line bg-paper">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-farmer-line px-4 py-4 sm:px-5"><div><p className="text-[10px] font-bold uppercase tracking-wider text-farmer-muted">{role} · {id}</p><h2 className="mt-1 font-display text-sm font-bold text-farmer-ink">{name}</h2></div><Status value={result.live} /></div>
            <div className="grid gap-4 p-4 sm:p-5 lg:grid-cols-[minmax(0,1fr)_minmax(260px,.72fr)]">
              <div><label htmlFor={`payload-${id}`} className="mb-1.5 block text-xs font-semibold text-farmer-ink">Request JSON</label><textarea id={`payload-${id}`} value={payloads[id]} onChange={(event) => setPayloads((current) => ({ ...current, [id]: event.target.value }))} rows={5} spellCheck="false" placeholder={`Enter a valid ${id} JSON request. No sample payload is prefilled.`} className="w-full rounded-xl border border-farmer-line bg-[#fbfcfa] p-3 font-mono text-[11px] leading-relaxed text-farmer-ink outline-none focus:border-farmer-brand focus:ring-2 focus:ring-farmer-brand/15" /><div className="mt-2 flex flex-wrap gap-2"><button type="button" onClick={() => validatePayload(id)} className="inline-flex h-9 items-center gap-2 rounded-lg border border-farmer-line px-3 text-xs font-semibold text-farmer-ink hover:bg-farmer-page"><CheckCircle2 size={14} aria-hidden="true" />Validate request</button><button type="button" onClick={() => { runAlgorithm(id) }} className="inline-flex h-9 items-center gap-2 rounded-lg border border-farmer-line px-3 text-xs font-semibold text-farmer-ink hover:bg-farmer-page"><Activity size={14} aria-hidden="true" />Run algorithm check</button><button type="button" disabled={runningAll} onClick={() => runFeature(id)} className="inline-flex h-9 items-center gap-2 rounded-lg bg-farmer-primary px-3 text-xs font-semibold text-white hover:bg-farmer-primary-hover disabled:opacity-50"><Play size={14} aria-hidden="true" />Run live request</button></div></div>
              <div className="rounded-xl bg-farmer-page/60 p-3.5"><ResultLine label="Input schema" value={result.validation} status={result.validation} /><ResultLine label="AI request / response" value={result.durationMs != null ? `${result.durationMs} ms` : result.endpoint} status={result.live} /><ResultLine label="Local algorithm" value={result.algorithmMessage || result.algorithm} status={result.algorithm} />{result.providerVerification && <ResultLine label="Provider/model attestation" value={result.provider ? `${result.provider}${result.modelId ? ` · ${result.modelId}` : ''}` : 'Provider/model not reported in response metadata'} status={result.providerVerification} />}
                {result.error && <p className="mt-3 break-words rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-950" role="alert"><AlertCircle size={13} className="mr-1 inline" aria-hidden="true" />{result.error}</p>}
                {result.result && <details className="mt-3"><summary className="cursor-pointer text-xs font-semibold text-farmer-brand">View actual validated response</summary><pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-[10px] leading-relaxed text-emerald-100">{JSON.stringify(result.result, null, 2)}</pre></details>}
                {!result.endpoint?.includes('Not checked') && result.endpoint && <p className="mt-3 break-all text-[10px] text-farmer-muted">Endpoint: {result.endpoint}</p>}
              </div>
            </div>
          </article>
        })}
      </section>

      <footer className="rounded-xl border border-farmer-line bg-farmer-page/50 p-4 text-xs leading-relaxed text-farmer-muted"><div className="flex gap-2"><CircleHelp size={15} className="mt-0.5 shrink-0" aria-hidden="true" /><p><strong className="text-farmer-ink">PASS means</strong> a real proxied response was received and passed the feature response validator. Provider verification requires the backend to report the provider and selected model ID. Algorithm smoke checks use synthetic diagnostic-only inputs and do not verify market truth or model output. <span className="inline-flex items-center gap-1"><WifiOff size={12} aria-hidden="true" />BLOCKED means a required endpoint, session, credential, or external service is unavailable.</span></p></div></footer>
    </div>
  )
}
