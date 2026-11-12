import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, RotateCw, Save, Sprout } from 'lucide-react'
import { farmerFarmProfile, farmerSaveFarmProfile } from '../services/farmerService'

const emptyProfile = { farmName: '', county: '', subCounty: '', town: '', farmSize: '', farmSizeUnit: 'acres', farmingExperienceYears: '', mainCrops: [], about: '' }
const inputClass = 'w-full rounded-xl border border-farmer-line bg-paper px-3.5 py-2.5 text-sm text-farmer-ink placeholder:text-farmer-muted/60 focus:border-farmer-brand/50 focus:outline-none focus:ring-2 focus:ring-farmer-brand/20'

export default function FarmProfile() {
  const [state, setState] = useState({ status: 'loading', exists: false, profile: emptyProfile, error: '', field: '' })
  const [draft, setDraft] = useState(emptyProfile)
  const [snapshot, setSnapshot] = useState(emptyProfile)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [tick, setTick] = useState(0)
  const dirty = JSON.stringify(draft) !== JSON.stringify(snapshot)

  useEffect(() => {
    let active = true
    setState((current) => ({ ...current, status: 'loading', error: '' }))
    farmerFarmProfile().then(({ exists, profile }) => {
      if (!active) return
      const next = { ...emptyProfile, ...profile, farmSize: profile.farmSize == null ? '' : String(profile.farmSize), farmingExperienceYears: profile.farmingExperienceYears == null ? '' : String(profile.farmingExperienceYears), mainCrops: Array.isArray(profile.mainCrops) ? profile.mainCrops : [] }
      setDraft(next); setSnapshot(next); setState({ status: 'ready', exists, profile: next, error: '', field: '' })
    }).catch((error) => active && setState({ status: 'error', exists: false, profile: emptyProfile, error: error?.error || 'Your farm profile could not be loaded.', field: '' }))
    return () => { active = false }
  }, [tick])

  const set = (key) => (event) => {
    const value = event.target.value
    setDraft((current) => ({ ...current, [key]: key === 'mainCrops' ? value.split(',').map((crop) => crop.trim()).filter(Boolean) : value }))
    setSaved(false)
    setState((current) => ({ ...current, error: '', field: '' }))
  }

  const submit = async (event) => {
    event.preventDefault()
    const farmName = draft.farmName.trim(), county = draft.county.trim()
    const crops = draft.mainCrops.map((crop) => crop.trim()).filter(Boolean)
    if (!farmName) return setState((current) => ({ ...current, error: 'Enter your farm name.', field: 'farmName' }))
    if (!county) return setState((current) => ({ ...current, error: 'Enter your county.', field: 'county' }))
    if (!crops.length) return setState((current) => ({ ...current, error: 'Add at least one main crop.', field: 'mainCrops' }))
    if (draft.farmSize !== '' && (!Number.isFinite(Number(draft.farmSize)) || Number(draft.farmSize) < 0)) return setState((current) => ({ ...current, error: 'Enter a non-negative farm size.', field: 'farmSize' }))
    if (draft.farmingExperienceYears !== '' && (!Number.isInteger(Number(draft.farmingExperienceYears)) || Number(draft.farmingExperienceYears) < 0)) return setState((current) => ({ ...current, error: 'Enter a whole number of years.', field: 'farmingExperienceYears' }))
    setSaving(true); setSaved(false); setState((current) => ({ ...current, error: '', field: '' }))
    const payload = { farmName, county, subCounty: draft.subCounty.trim(), town: draft.town.trim(), farmSize: draft.farmSize === '' ? null : Number(draft.farmSize), farmSizeUnit: draft.farmSizeUnit, farmingExperienceYears: draft.farmingExperienceYears === '' ? null : Number(draft.farmingExperienceYears), mainCrops: crops, about: draft.about.trim() }
    try {
      const persisted = await farmerSaveFarmProfile(payload, state.exists)
      const next = { ...emptyProfile, ...persisted, farmSize: persisted.farmSize == null ? '' : String(persisted.farmSize), farmingExperienceYears: persisted.farmingExperienceYears == null ? '' : String(persisted.farmingExperienceYears), mainCrops: Array.isArray(persisted.mainCrops) ? persisted.mainCrops : [] }
      setDraft(next); setSnapshot(next); setState({ status: 'ready', exists: true, profile: next, error: '', field: '' }); setSaved(true)
    } catch (error) {
      setState((current) => ({ ...current, error: error?.error || 'The farm profile was not saved.', field: error?.field || '' }))
    } finally { setSaving(false) }
  }

  if (state.status === 'loading') return <div className="h-64 animate-pulse rounded-xl border border-farmer-line bg-paper/70" aria-busy="true" aria-label="Loading farm profile" />
  if (state.status === 'error') return <section className="rounded-xl border border-farmer-line bg-paper p-6 text-center"><AlertCircle size={20} className="mx-auto text-farmer-danger" aria-hidden="true" /><p role="alert" className="mt-3 text-sm font-semibold text-farmer-ink">{state.error}</p><button type="button" onClick={() => setTick((value) => value + 1)} className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-farmer-primary px-4 text-sm font-semibold text-white"><RotateCw size={14} aria-hidden="true" />Try again</button></section>

  return <section className="max-w-3xl rounded-xl border border-farmer-line bg-paper p-5 sm:p-6">
    <div className="mb-5"><h2 className="flex items-center gap-2 font-display text-lg font-semibold text-farmer-ink"><Sprout size={18} className="text-farmer-brand" aria-hidden="true" />Farm profile</h2><p className="mt-1 text-sm text-farmer-muted">Manage the farm details connected to your authenticated farmer account.</p></div>
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">Farm name <span aria-hidden="true">*</span></span><input className={inputClass} value={draft.farmName} onChange={set('farmName')} maxLength={120} aria-invalid={state.field === 'farmName'} /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">County <span aria-hidden="true">*</span></span><input className={inputClass} value={draft.county} onChange={set('county')} maxLength={80} aria-invalid={state.field === 'county'} /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">Sub-county</span><input className={inputClass} value={draft.subCounty} onChange={set('subCounty')} maxLength={80} /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">Town</span><input className={inputClass} value={draft.town} onChange={set('town')} maxLength={80} /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">Farm size</span><input className={inputClass} type="number" min="0" step="any" value={draft.farmSize} onChange={set('farmSize')} /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">Farm size unit</span><select className={inputClass} value={draft.farmSizeUnit} onChange={set('farmSizeUnit')}><option value="acres">Acres</option><option value="hectares">Hectares</option></select></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">Farming experience (years)</span><input className={inputClass} type="number" min="0" step="1" value={draft.farmingExperienceYears} onChange={set('farmingExperienceYears')} /></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">Main crops <span aria-hidden="true">*</span></span><input className={inputClass} value={draft.mainCrops.join(', ')} onChange={set('mainCrops')} placeholder="Separate crops with commas" aria-invalid={state.field === 'mainCrops'} /></label>
        <label className="block sm:col-span-2"><span className="mb-1.5 block text-xs font-semibold text-farmer-ink">About your farm</span><textarea className={`${inputClass} resize-y`} rows={4} maxLength={3000} value={draft.about} onChange={set('about')} /></label>
      </div>
      {state.error && <p role="alert" className="rounded-lg bg-danger-wash px-3 py-2 text-sm text-farmer-danger">{state.error}</p>}
      {saved && <p role="status" className="flex items-center gap-2 text-sm text-farmer-success"><CheckCircle2 size={16} aria-hidden="true" />Farm profile saved and reloaded from your account.</p>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-farmer-line pt-4"><p className="text-xs text-farmer-muted">{state.exists ? 'Changes are saved to your farmer profile.' : 'A farm profile will be created when required details are saved.'}</p><button type="submit" disabled={saving || !dirty} className="inline-flex h-10 items-center gap-2 rounded-lg bg-farmer-primary px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><Save size={15} aria-hidden="true" />{saving ? 'Saving…' : 'Save farm profile'}</button></div>
    </form>
  </section>
}
