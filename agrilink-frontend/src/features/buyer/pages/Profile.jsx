/**
 * Buyer Profile — authenticated account data and favorites from the existing
 * self-profile and favorites endpoints. Account edits live in Buyer Settings.
 */
import { useEffect, useState } from 'react'
import { UserRound, Mail, Heart, ShieldCheck, AlertCircle, RotateCw } from 'lucide-react'
import { buyerProfile } from '../services/buyerService'
import { useBuyerSaved } from '../hooks/useBuyerData'
import EmptyState from '../../../components/feedback/EmptyState'
import { fmtDate } from '../../../utils/format'
import { getUserDisplayName, getUserInitials } from '../../../utils/userDisplay'

export default function Profile({ onNavigate }) {
  const [profileState, setProfileState] = useState({ status: 'loading', user: null, error: null })
  const savedQ = useBuyerSaved()
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setProfileState((s) => ({ ...s, status: 'loading' }))
    buyerProfile()
      .then((p) => {
        if (!alive) return
        /* call() unwraps `.user` already (auth-style shape); accept both
           shapes defensively so the page only renders a real account */
        const u = p && (p.user ?? p)
        setProfileState({ status: 'ok', user: u && typeof u === 'object' ? u : null, error: null })
      })
      .catch((e) =>
        alive && setProfileState({ status: 'error', user: null, error: e?.error || 'Could not load your profile.' }),
      )
    return () => {
      alive = false
    }
  }, [tick])

  if (profileState.status === 'error' || (profileState.status === 'ok' && !profileState.user))
    return (
      <div className="rounded-xl border border-farmer-line bg-paper p-6 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-danger-wash text-farmer-danger">
          <AlertCircle size={20} aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-semibold text-farmer-ink">
          {profileState.error || 'Your profile could not be loaded right now.'}
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

  if (profileState.status === 'loading' || savedQ.status === 'loading')
    return (
      <div className="max-w-xl space-y-4" aria-busy="true" aria-label="Loading profile">
        <div className="h-40 animate-pulse rounded-xl border border-farmer-line bg-paper/70" />
        <div className="h-16 animate-pulse rounded-xl border border-farmer-line bg-paper/70" />
      </div>
    )

  const u = profileState.user
  const displayName = getUserDisplayName(u)
  const initials = getUserInitials(u)

  return (
    <div className="max-w-xl space-y-5">
      {/* verified account card — the session the server attests to */}
      <section className="rounded-xl border border-farmer-line bg-paper p-6">
        <div className="flex items-start gap-4">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-farmer-primary font-display text-base font-bold text-white" aria-hidden="true">
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-bold text-farmer-ink">{displayName}</h2>
            <dl className="mt-2 grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
              <div className="flex items-center gap-2 text-farmer-muted">
                <dt className="sr-only">Email</dt>
                <Mail size={14} aria-hidden="true" />
                <dd className="truncate font-medium text-farmer-ink">{u.email}</dd>
              </div>
              <div className="flex items-center gap-2 text-farmer-muted">
                <dt className="sr-only">Role</dt>
                <dd className="rounded-full bg-farmer-surface px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-farmer-brand">
                  {u.role} account
                </dd>
              </div>
              <div className="flex items-center gap-2 text-farmer-muted">
                <dt className="sr-only">Member since</dt>
                <dd className="font-medium text-farmer-ink">Member since {fmtDate(u.memberSince)}</dd>
              </div>
              <div className="flex items-center gap-2 text-farmer-muted">
                <dt className="sr-only">Verification</dt>
                <dd className="inline-flex items-center gap-1.5 font-medium text-farmer-ink">
                  <ShieldCheck size={14} aria-hidden="true" className="text-farmer-success" /> Session verified by the server
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>

      {/* saved produce remains sourced from the authenticated favorites API */}
      <div className="flex items-center gap-3 rounded-xl border border-farmer-line bg-paper p-5">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-farmer-surface text-farmer-brand">
          <Heart size={16} aria-hidden="true" />
        </span>
        <p className="text-[13px] text-farmer-muted">
          <span className="block font-display text-xl font-bold text-farmer-ink">{savedQ.saved.length}</span>
          saved produce
        </p>
      </div>

      <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
        <EmptyState icon={UserRound} title="Manage your account profile" className="border-none bg-transparent py-4">
          Edit your account name, change your password, or review the profile fields supported for your account.
        </EmptyState>
        <div className="mt-3 flex justify-center">
          <button type="button" onClick={() => onNavigate?.('buyer/settings')} className="inline-flex h-10 items-center rounded-xl bg-farmer-primary px-4 text-sm font-semibold text-white hover:bg-farmer-primary-hover">
            Profile & security settings
          </button>
        </div>
      </section>
    </div>
  )
}
