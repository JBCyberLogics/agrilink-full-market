import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Activity, AlertCircle, ArrowRight, FileSearch, SlidersHorizontal } from 'lucide-react';
import type { PageDefinition } from '../../config/navigation';
import { PageTitle } from '../../components/layout/PageTitle';
import { SectionHeading, StatusPill } from '../../components/ui/StatusPill';
import { calculateMatchScore, calculateNetProfit, type MatchFactors, type ProfitInputs } from '../../lib/algorithms';
import { loadMatchingConfiguration, saveMatchingConfiguration, scoreMatchingCandidate } from '../../services/adminService';

type MatchingWeights = { price: number; quality: number; distance: number; availability: number };
const weightFields: { key: keyof MatchingWeights; label: string }[] = [
  { key: 'price', label: 'Price' }, { key: 'quality', label: 'Quality' },
  { key: 'distance', label: 'Distance' }, { key: 'availability', label: 'Availability' },
];

function MetricResult({ label, value, emphasis = false }: { label: string; value: string; emphasis?: boolean }) {
  return <div className={`result-metric${emphasis ? ' result-metric--emphasis' : ''}`}><span>{label}</span><strong>{value}</strong></div>;
}

function parseNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function numberLabel(value: number | null): string {
  if (value === null) return 'Unavailable';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

export default function AlgorithmPage({ page }: { page: PageDefinition }) {
  const [tab, setTab] = useState<'profit' | 'matching'>('profit');
  const [profitValues, setProfitValues] = useState<Record<keyof ProfitInputs, string>>({
    expectedSellingPrice: '', sellableQuantity: '', productionCost: '', harvestCost: '',
    packagingCost: '', transportAndSellingCost: '', otherCost: '', targetProfit: '',
  });
  const [matchValues, setMatchValues] = useState<Record<keyof MatchFactors, string>>({ priceFit: '', qualityFit: '', distanceFit: '', availabilityFit: '' });
  const [profitResult, setProfitResult] = useState<ReturnType<typeof calculateNetProfit> | null>(null);
  const [matchResult, setMatchResult] = useState<ReturnType<typeof calculateMatchScore> | null>(null);
  const [weights, setWeights] = useState<MatchingWeights | null>(null);
  const [weightDraft, setWeightDraft] = useState<Record<keyof MatchingWeights, string>>({ price: '', quality: '', distance: '', availability: '' });
  const [weightsLoading, setWeightsLoading] = useState(true);
  const [weightsSaving, setWeightsSaving] = useState(false);
  const [weightsError, setWeightsError] = useState('');
  const [weightsNotice, setWeightsNotice] = useState('');
  const [matchError, setMatchError] = useState('');
  const [matchBusy, setMatchBusy] = useState(false);
  const [algorithmVersion, setAlgorithmVersion] = useState<number | null>(null);

  useEffect(() => {
    let active = true;
    setWeightsLoading(true);
    void loadMatchingConfiguration().then((result) => {
      if (!active) return;
      const saved = result.weights as MatchingWeights;
      setWeights(saved);
      setWeightDraft({ price: String(saved.price), quality: String(saved.quality), distance: String(saved.distance), availability: String(saved.availability) });
      setAlgorithmVersion(Number(result.version));
      setWeightsError('');
    }).catch((error) => {
      if (active) setWeightsError(error instanceof Error ? error.message : 'Published matching weights are unavailable.');
    }).finally(() => { if (active) setWeightsLoading(false); });
    return () => { active = false; };
  }, []);

  function updateProfit(key: keyof ProfitInputs, value: string) { setProfitValues((current) => ({ ...current, [key]: value })); setProfitResult(null); }
  function updateMatch(key: keyof MatchFactors, value: string) { setMatchValues((current) => ({ ...current, [key]: value })); setMatchResult(null); }
  function submitProfit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfitResult(calculateNetProfit({
      expectedSellingPrice: parseNumber(profitValues.expectedSellingPrice),
      sellableQuantity: parseNumber(profitValues.sellableQuantity),
      productionCost: parseNumber(profitValues.productionCost),
      harvestCost: parseNumber(profitValues.harvestCost),
      packagingCost: parseNumber(profitValues.packagingCost),
      transportAndSellingCost: parseNumber(profitValues.transportAndSellingCost),
      otherCost: parseNumber(profitValues.otherCost),
      targetProfit: parseNumber(profitValues.targetProfit),
    }));
  }
  async function saveWeights(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWeightsError(''); setWeightsNotice('');
    const next = Object.fromEntries(weightFields.map(({ key }) => [key, Number(weightDraft[key])])) as MatchingWeights;
    const values = Object.values(next);
    if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 1) || Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) > 0.000001) {
      setWeightsError('Enter four weights between 0 and 1 that sum to exactly 1.');
      return;
    }
    setWeightsSaving(true);
    try {
      const saved = await saveMatchingConfiguration(next);
      const published = saved.weights as MatchingWeights;
      setWeights(published);
      setWeightDraft({ price: String(published.price), quality: String(published.quality), distance: String(published.distance), availability: String(published.availability) });
      setAlgorithmVersion(Number(saved.version));
      setWeightsNotice('Matching weights were saved and published to the live ranking service.');
    } catch (error) {
      setWeightsError(error instanceof Error ? error.message : 'Matching weights could not be saved.');
    } finally { setWeightsSaving(false); }
  }

  async function submitMatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMatchError('');
    const factors = {
      priceFit: parseNumber(matchValues.priceFit), qualityFit: parseNumber(matchValues.qualityFit),
      distanceFit: parseNumber(matchValues.distanceFit), availabilityFit: parseNumber(matchValues.availabilityFit),
    };
    const validation = calculateMatchScore(factors);
    if (!validation.valid) { setMatchResult(validation); return; }
    if (!weights) { setMatchError('Published matching weights are unavailable.'); return; }
    setMatchBusy(true);
    try {
      const result = await scoreMatchingCandidate({ price: factors.priceFit, quality: factors.qualityFit, distance: factors.distanceFit, availability: factors.availabilityFit });
      const applied = result.weights as MatchingWeights;
      setMatchResult({ valid: true, score: Number(result.score), contributions: {
        priceFit: factors.priceFit! * applied.price,
        qualityFit: factors.qualityFit! * applied.quality,
        distanceFit: factors.distanceFit! * applied.distance,
        availabilityFit: factors.availabilityFit! * applied.availability,
      } });
      setAlgorithmVersion(Number(result.version ?? algorithmVersion));
    } catch (error) {
      setMatchResult(null);
      setMatchError(error instanceof Error ? error.message : 'The matching service could not score these inputs.');
    } finally { setMatchBusy(false); }
  }

  return (
    <div className="page-stack">
      <PageTitle page={page} />
      <section className="algorithm-note"><span className="algorithm-note__icon"><SlidersHorizontal size={17} aria-hidden="true" /></span><p><strong>Explainable calculations</strong> Net-profit estimates use only the values you enter. Matching weights are saved by the backend, and candidate scores use the published configuration without inventing marketplace data.</p><StatusPill>{weights ? `Version ${algorithmVersion ?? '—'}` : weightsLoading ? 'Loading' : 'Unavailable'}</StatusPill></section>
      <div className="algorithm-tabs" role="tablist" aria-label="Algorithm tools">
        <button role="tab" aria-selected={tab === 'profit'} className={tab === 'profit' ? 'is-active' : ''} onClick={() => setTab('profit')}>Net profit estimate</button>
        <button role="tab" aria-selected={tab === 'matching'} className={tab === 'matching' ? 'is-active' : ''} onClick={() => setTab('matching')}>Matching score</button>
      </div>
      {tab === 'profit' ? (
        <div className="algorithm-layout">
          <form className="panel algorithm-form" onSubmit={submitProfit}>
            <SectionHeading eyebrow="DETERMINISTIC CALCULATOR" title="Net profit estimate" detail="Enter every cost. Explicitly enter 0 when a cost does not apply." />
            <p className="form-unit-note">All values must use the same currency and quantity unit. The result is an estimate based on your inputs.</p>
            <div className="form-grid">
              <NumericField label="Expected selling price per unit" value={profitValues.expectedSellingPrice} onChange={(value) => updateProfit('expectedSellingPrice', value)} />
              <NumericField label="Sellable quantity" value={profitValues.sellableQuantity} onChange={(value) => updateProfit('sellableQuantity', value)} />
              <NumericField label="Production costs" value={profitValues.productionCost} onChange={(value) => updateProfit('productionCost', value)} />
              <NumericField label="Harvest & post-harvest costs" value={profitValues.harvestCost} onChange={(value) => updateProfit('harvestCost', value)} />
              <NumericField label="Packaging costs" value={profitValues.packagingCost} onChange={(value) => updateProfit('packagingCost', value)} />
              <NumericField label="Transport & selling costs" value={profitValues.transportAndSellingCost} onChange={(value) => updateProfit('transportAndSellingCost', value)} />
              <NumericField label="Other costs" value={profitValues.otherCost} onChange={(value) => updateProfit('otherCost', value)} />
              <NumericField label="Target profit (optional)" value={profitValues.targetProfit} onChange={(value) => updateProfit('targetProfit', value)} />
            </div>
            <div className="form-actions"><button className="button button--primary" type="submit">Calculate estimate <ArrowRight size={16} aria-hidden="true" /></button><span>Nothing is stored by this tool.</span></div>
          </form>
          <section className="panel result-panel" aria-live="polite">
            <div className="result-panel__head"><span className="eyebrow">YOUR ESTIMATE</span><span className="result-panel__icon"><Activity size={17} aria-hidden="true" /></span></div>
            {!profitResult && <div className="result-placeholder"><span className="result-placeholder__icon"><FileSearch size={19} aria-hidden="true" /></span><strong>Results appear here</strong><p>Complete the fields and run the calculation. Missing inputs are never treated as zero.</p></div>}
            {profitResult && !profitResult.valid && <div className="validation-panel" role="alert"><strong>Check the inputs</strong><ul>{profitResult.errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
            {profitResult?.valid && <div className="result-metrics"><MetricResult label="Gross revenue" value={numberLabel(profitResult.grossRevenue)} /><MetricResult label="Total costs" value={numberLabel(profitResult.totalCosts)} /><MetricResult label="Net profit" value={numberLabel(profitResult.netProfit)} emphasis /><MetricResult label="Profit margin" value={profitResult.profitMargin === null ? 'Unavailable' : `${numberLabel(profitResult.profitMargin)}%`} /><MetricResult label="Break-even unit price" value={numberLabel(profitResult.breakEvenUnitPrice)} />{profitResult.targetProfitUnitPrice !== null && <MetricResult label="Unit price for target profit" value={numberLabel(profitResult.targetProfitUnitPrice)} />}</div>}
            <p className="result-footnote">Estimate only. This is not a verified financial outcome.</p>
          </section>
        </div>
      ) : (
        <div className="algorithm-layout">
          <section className="panel algorithm-form">
            <SectionHeading eyebrow="BACKEND-PUBLISHED WEIGHTS" title="Matching configuration" detail={weights ? `Current ranking version ${algorithmVersion ?? '—'}. The four weights must sum to 100%.` : 'Published configuration is loading or unavailable.'} />
            {weightsLoading ? <p role="status">Loading published matching weights…</p> : weights && <form className="form-grid" onSubmit={(event) => void saveWeights(event)}>{weightFields.map(({ key, label }) => <NumericField key={key} label={`${label} weight (0–1)`} value={weightDraft[key]} onChange={(value) => setWeightDraft((current) => ({ ...current, [key]: value }))} min="0" max="1" step="0.01" />)}<div className="form-actions"><button className="button button--primary" type="submit" disabled={weightsSaving}>{weightsSaving ? 'Publishing…' : 'Save matching weights'}</button><span>Current total: {(weightFields.reduce((sum, field) => sum + (Number(weightDraft[field.key]) || 0), 0) * 100).toFixed(1)}%</span></div></form>}
            {weightsError && <p role="alert">{weightsError}</p>}{weightsNotice && <p role="status">{weightsNotice}</p>}
            {weights && <div className="weight-list">{weightFields.map(({ key, label }) => <span key={key}>{label} fit <strong>{(weights[key] * 100).toFixed(0)}%</strong></span>)}</div>}
            <form onSubmit={(event) => void submitMatch(event)}>
              <SectionHeading eyebrow="DETERMINISTIC TEST INPUTS" title="Score one candidate" detail="Provide normalized factor values from 0 to 1. This score uses your inputs and the published weights; it does not retrieve or rank marketplace listings." />
              <div className="form-grid"><NumericField label="Price fit (0–1)" value={matchValues.priceFit} onChange={(value) => updateMatch('priceFit', value)} min="0" max="1" step="0.01" /><NumericField label="Quality fit (0–1)" value={matchValues.qualityFit} onChange={(value) => updateMatch('qualityFit', value)} min="0" max="1" step="0.01" /><NumericField label="Distance fit (0–1)" value={matchValues.distanceFit} onChange={(value) => updateMatch('distanceFit', value)} min="0" max="1" step="0.01" /><NumericField label="Availability fit (0–1)" value={matchValues.availabilityFit} onChange={(value) => updateMatch('availabilityFit', value)} min="0" max="1" step="0.01" /></div>
              <div className="form-actions"><button className="button button--primary" type="submit" disabled={!weights || matchBusy || weightsLoading}>{matchBusy ? 'Scoring…' : 'Score candidate'} <ArrowRight size={16} aria-hidden="true" /></button><span>Score calculated by the shared backend.</span></div>
              {matchError && <p role="alert">{matchError}</p>}
            </form>
          </section>
          <section className="panel result-panel" aria-live="polite">
            <div className="result-panel__head"><span className="eyebrow">CANDIDATE SCORE</span><span className="result-panel__icon"><SlidersHorizontal size={17} aria-hidden="true" /></span></div>
            {!matchResult && <div className="result-placeholder"><span className="result-placeholder__icon"><FileSearch size={19} aria-hidden="true" /></span><strong>Score appears here</strong><p>Enter all four normalized factors. This tool does not retrieve or rank marketplace candidates.</p></div>}
            {matchResult && !matchResult.valid && <div className="validation-panel" role="alert"><strong>Check the inputs</strong><ul>{matchResult.errors.map((error) => <li key={error}>{error}</li>)}</ul></div>}
            {matchResult?.valid && <><div className="score-display"><strong>{numberLabel(matchResult.score * 100)}<small>%</small></strong><span>Weighted fit score</span></div><div className="contribution-list"><Contribution label="Price fit" value={matchResult.contributions.priceFit} /><Contribution label="Quality fit" value={matchResult.contributions.qualityFit} /><Contribution label="Distance fit" value={matchResult.contributions.distanceFit} /><Contribution label="Availability fit" value={matchResult.contributions.availabilityFit} /></div></>}
            <p className="result-footnote">Score and contributions use the currently published weights returned by the backend.</p>
          </section>
        </div>
      )}
      <section className="panel algorithm-disclaimer"><AlertCircle size={16} aria-hidden="true" /><p>Published weights affect the marketplace ranking service. The single-candidate score is only as accurate as the factor values entered above; it does not represent a verified buyer, seller, price, or distance.</p></section>
    </div>
  );
}

function NumericField({ label, value, onChange, min = '0', max, step = 'any' }: { label: string; value: string; onChange: (value: string) => void; min?: string; max?: string; step?: string }) {
  const id = label.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-');
  return <label className="field" htmlFor={id}><span>{label}</span><input id={id} type="number" inputMode="decimal" min={min} max={max} step={step} value={value} onChange={(event) => onChange(event.target.value)} placeholder="Enter value" /></label>;
}

function Contribution({ label, value }: { label: string; value: number }) {
  return <div className="contribution-row"><span>{label}</span><div className="contribution-row__track"><i style={{ width: `${Math.max(0, Math.min(value * 100 / 0.35, 100))}%` }} /></div><strong>{numberLabel(value * 100)}%</strong></div>;
}

