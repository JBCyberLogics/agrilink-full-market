import { useState } from 'react'
import { ShieldCheck, Eye, EyeOff, Loader2, AlertCircle, ArrowLeft, Lock } from 'lucide-react'
import { login } from '../auth/services/authService'
import { tokens } from '../../services/api/client.js'
import ThemeToggle from '../../components/ui/ThemeToggle'

/* Private admin sign-in — reachable at #/admin, never linked publicly.
   Email + password only; non-admin accounts are rejected and signed out. */
export default function AdminLogin({ onAuth, onBackToShop, notice }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(notice || '')

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setError('Enter a valid email address.')
    if (password.length < 6) return setError('Enter your password.')
    setBusy(true)
    setError('')
    try {
      const user = await login({ email: email.trim(), password })
      if (user?.role !== 'Admin') {
        tokens.clear()
        setError('Unable to sign in with those credentials. Please check your details and try again.')
        return
      }
      onAuth(user)
    } catch (err) {
      setError(err?.status === 401 || err?.code === 'INVALID_CREDENTIALS'
        ? 'Unable to sign in with those credentials. Please check your details and try again.'
        : err?.error || err?.message || 'Unable to sign in right now. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const input =
    'w-full rounded-xl border border-farmer-line bg-paper px-3.5 py-2.5 text-sm text-farmer-ink placeholder:text-farmer-muted outline-none focus:border-farmer-brand focus:ring-2 focus:ring-farmer-brand/30 transition'

  return (
    <div className="min-h-[calc(100vh-72px)] bg-farmer-page px-4 py-16 flex items-center justify-center transition-colors">
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-farmer-line bg-paper p-8 shadow-xl transition-colors">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-12 w-12 place-items-center rounded-xl bg-farmer-surface text-farmer-brand">
                <ShieldCheck size={24} />
              </span>
              <div>
                <h1 className="font-display text-lg font-bold text-farmer-ink">AgriLink Control Center</h1>
                <p className="text-xs text-farmer-muted">Restricted administrator access</p>
              </div>
            </div>
            <ThemeToggle className="h-8 w-8" size={17} />
          </div>

          <form onSubmit={submit} noValidate className="mt-7 space-y-4">
            <div>
              <label htmlFor="admin-email" className="mb-1.5 block text-xs font-semibold text-farmer-ink">Admin email</label>
              <input id="admin-email" type="email" autoComplete="username" className={input}
                value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@agrilink.co.ke" />
            </div>
            <div>
              <label htmlFor="admin-password" className="mb-1.5 block text-xs font-semibold text-farmer-ink">Password</label>
              <div className="relative">
                <input id="admin-password" type={show ? 'text' : 'password'} autoComplete="current-password"
                  className={`${input} pr-10`} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
                <button type="button" onClick={() => setShow((v) => !v)} aria-label={show ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 grid h-7 w-7 place-items-center rounded-lg text-farmer-muted hover:text-farmer-ink">
                  {show ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </div>
            </div>

            {error && (
              <p role="alert" className="flex items-start gap-1.5 rounded-xl border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-500">
                <AlertCircle size={14} className="mt-px shrink-0" /> {error}
              </p>
            )}

            <button type="submit" disabled={busy}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-farmer-primary text-sm font-semibold text-white hover:bg-farmer-primary-hover disabled:opacity-70 transition">
              {busy ? <><Loader2 size={16} className="animate-spin" /> Verifying…</> : <><Lock size={15} /> Enter Console</>}
            </button>
          </form>
        </div>

        <button onClick={onBackToShop} className="mx-auto mt-5 flex items-center gap-1.5 text-xs text-farmer-muted hover:text-farmer-ink transition">
          <ArrowLeft size={13} /> Return to marketplace
        </button>
      </div>
    </div>
  )
}
