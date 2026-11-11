import { RotateCw, AlertTriangle, Inbox } from 'lucide-react'

export const CHART_COLORS = ['#2EB877', '#f59e0b', '#0ea5e9', '#ef4444', '#8b5cf6', '#14b8a6']

export function Panel({ title, subtitle, action, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-farmer-line bg-paper p-5 shadow-sm ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-base font-semibold text-farmer-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-farmer-muted">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  )
}

export function KPI({ icon: Icon, label, value, hint, tone = 'brand' }) {
  const tones = { brand: 'from-farmer-brand/15 text-farmer-brand', amber: 'from-amber-500/15 text-amber-600', sky: 'from-sky-500/15 text-sky-600', rose: 'from-rose-500/15 text-rose-600' }
  return (
    <div className="relative overflow-hidden rounded-2xl border border-farmer-line bg-paper p-5 shadow-sm">
      <div className={`pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-gradient-to-br to-transparent ${tones[tone]}`} />
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-farmer-muted">{label}</p>
        {Icon && <Icon size={18} className={tones[tone].split(' ')[1]} aria-hidden="true" />}
      </div>
      <p className="mt-2 font-display text-3xl font-semibold tabular-nums text-farmer-ink">{value ?? 'N/A'}</p>
      {hint && <p className="mt-1 text-xs text-farmer-muted">{hint}</p>}
    </div>
  )
}

export function LoadState({ loading, error, empty, onRetry, children }) {
  if (loading) return <div className="grid h-40 place-items-center"><RotateCw className="animate-spin text-farmer-brand" size={20} /></div>
  if (error)
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-farmer-muted">
        <AlertTriangle className="text-amber-500" size={20} />
        <p>{error}</p>
        {onRetry && <button onClick={onRetry} className="rounded-lg border border-farmer-line px-3 py-1.5 text-xs font-semibold hover:text-farmer-brand">Try again</button>}
      </div>
    )
  if (empty) return <div className="flex flex-col items-center gap-2 py-10 text-sm text-farmer-muted"><Inbox size={20} /><p>No records yet.</p></div>
  return children
}

export function Badge({ children, tone = 'muted' }) {
  const t = { green: 'bg-emerald-500/15 text-emerald-600', red: 'bg-rose-500/15 text-rose-600', amber: 'bg-amber-500/15 text-amber-600', muted: 'bg-farmer-surface text-farmer-muted' }
  return <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${t[tone]}`}>{children}</span>
}

export function Table({ cols, rows, rowKey = (r) => r._id ?? r.id }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead><tr className="border-b border-farmer-line text-xs uppercase tracking-wide text-farmer-muted">{cols.map((c) => <th key={c.h} className="px-3 py-2 font-semibold">{c.h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={rowKey(r) ?? i} className="border-b border-farmer-line/60 last:border-0 hover:bg-farmer-surface/50">
              {cols.map((c) => <td key={c.h} className="px-3 py-2.5 align-middle text-farmer-ink">{c.r(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export const Btn = ({ tone = 'ghost', ...p }) => (
  <button {...p} className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors disabled:opacity-50 ${tone === 'danger' ? 'bg-rose-500/10 text-rose-600 hover:bg-rose-500/20' : tone === 'primary' ? 'bg-farmer-primary text-white hover:bg-farmer-primary-hover' : 'border border-farmer-line text-farmer-muted hover:text-farmer-brand'}`} />
)

export const SearchBox = ({ value, onChange, placeholder }) => (
  <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
    className="h-9 w-56 rounded-lg border border-farmer-line bg-paper px-3 text-sm text-farmer-ink outline-none focus:border-farmer-brand" />
)
