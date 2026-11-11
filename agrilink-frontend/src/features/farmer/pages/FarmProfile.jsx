/**
 * FarmProfile — real account data from the authenticated self-profile endpoint.
 * Account name and security edits are available in Farmer Settings.
 */
import { useEffect, useState } from 'react'
import { UserRound, Mail, CalendarPlus, ShieldCheck, AlertCircle, RotateCw } from 'lucide-react'
import { farmerProfile } from '../services/farmerService'
import { fmtDate } from '../../../utils/format'

export default function FarmProfile({ onNavigate }) {
  const [state, setState] = useState({ status: 'loading', user: null, error: null })
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, status: 'loading' }))
    farmerProfile()
      .then((d) => alive && setState({ status: 'ok', user: d?.user ?? d, error: null }))
      .catch((e) =>
        alive && setState({ status: 'error', user: null, error: e?.error || 'Could not load your profile.' }),
      )
    return () => {
      alive = false
    }
  }, [tick])

  /* loading / error / ok states; an invalid response is an error, never a crash */
  const broken = state.status === 'ok' && !state.user
  if (broken || state.status === 'error')
    return (
      <div className="rounded-xl border border-farmer-line bg-paper p-6 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-danger-wash text-farmer-danger">
          <AlertCircle size={20} aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-semibold text-farmer-ink">
          {state.error || 'Your profile could not be loaded right now.'}
        </p>
        <button
          type="button"
          onClick={() => setTick((t) => t + 1)}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-farmer-primary px-4 text-[13px] font-semibold text-white hover:bg-farmer-primary-hover"
        >
          <RotateCw size={14} aria-hidden="true" /> Try again
        </button>
      </div>
    )

  if (state.status === 'loading')
    return (
      <div className="h-64 animate-pulse rounded-xl border border-farmer-line bg-paper/70" aria-busy="true" aria-label="Loading profile" />
    )

  const { user } = state
  const rows = [
    { icon: UserRound, label: 'Name', value: user.name },
    { icon: Mail, label: 'Email', value: user.email },
    { icon: ShieldCheck, label: 'Account role', value: user.role },
    { icon: CalendarPlus, label: 'Member since', value: fmtDate(user.memberSince) },
  ]

  return (
    <section className="max-w-xl rounded-xl border border-farmer-line bg-paper p-5 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-farmer-surface text-farmer-brand">
          <UserRound size={22} aria-hidden="true" />
        </span>
        <div>
          <h2 className="font-display text-[15px] font-semibold text-farmer-ink">{user.name}</h2>
          <p className="text-xs text-farmer-muted">Verified farmer account</p>
        </div>
      </div>

      <dl className="divide-y divide-farmer-line">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <r.icon size={15} aria-hidden="true" className="shrink-0 text-farmer-muted" />
            <dt className="w-28 shrink-0 text-xs font-medium text-farmer-muted">{r.label}</dt>
            <dd className="min-w-0 truncate text-[13px] font-semibold text-farmer-ink">{r.value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-farmer-page px-3 py-3">
        <p className="text-xs leading-relaxed text-farmer-muted">Manage your account name and security settings.</p>
        <button type="button" onClick={() => onNavigate?.('farmer/settings')} className="inline-flex h-9 items-center rounded-lg bg-farmer-primary px-3.5 text-xs font-semibold text-white hover:bg-farmer-primary-hover">
          Profile & settings
        </button>
      </div>
    </section>
  )
}
