/* Management tables: users, farms, produce, payouts, support. All data from the backend. */
import { useState } from 'react'
import { users, shops, products, withdrawals, contactMessages, reports } from '../../../services/api/endpoints'
import { useLoad, money, roleLabel } from '../adminData'
import { Panel, LoadState, Table, Badge, Btn, SearchBox } from '../ui'

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString() : 'N/A')
const match = (q, ...f) => !q || f.some((x) => String(x ?? '').toLowerCase().includes(q.toLowerCase()))

function useAction(reload) {
  const [busy, setBusy] = useState(null); const [msg, setMsg] = useState(null)
  const act = async (id, fn, ok) => {
    setBusy(id); setMsg(null)
    try {
      const result = await fn()
      const outcome = typeof ok === 'function' ? ok(result) : { ok: true, text: ok }
      setMsg({ ok: outcome?.ok !== false, t: outcome?.text || 'Action completed' })
      await reload()
    } catch (e) { setMsg({ ok: false, t: e?.error || 'Action failed' }) } finally { setBusy(null) }
  }
  const banner = msg && <p className={`mb-3 rounded-lg px-3 py-2 text-xs font-medium ${msg.ok ? 'bg-emerald-500/10 text-emerald-600' : 'bg-rose-500/10 text-rose-600'}`}>{msg.t}</p>
  return { busy, act, banner }
}

export function AdminUsers() {
  const [q, setQ] = useState(''); const [role, setRole] = useState('all')
  const l = useLoad(() => users.allUsers({ limit: 500 }).then((r) => r.data))
  const { busy, act, banner } = useAction(l.reload)
  const rows = (l.data || []).filter((u) => (role === 'all' || u.role === role) && match(q, u.fullName, u.email))
  return (
    <Panel title={`Users (${rows.length})`} action={<div className="flex gap-2">
      <select value={role} onChange={(e) => setRole(e.target.value)} className="h-9 rounded-lg border border-farmer-line bg-paper px-2 text-sm text-farmer-ink"><option value="all">All roles</option><option value="seller">Farmers</option><option value="customer">Buyers</option></select>
      <SearchBox value={q} onChange={setQ} placeholder="Search name or email" /></div>}>
      {banner}
      <LoadState {...l} onRetry={l.reload} empty={!rows.length}>
        <Table rows={rows} cols={[
          { h: 'Name', r: (u) => <div><p className="font-medium">{u.fullName || 'N/A'}</p><p className="text-xs text-farmer-muted">{u.email}</p></div> },
          { h: 'Role', r: (u) => <Badge tone={u.role === 'seller' ? 'green' : 'muted'}>{roleLabel(u.role)}</Badge> },
          { h: 'Status', r: (u) => (u.isBlocked || u.status === 'blocked' ? <Badge tone="red">Blocked</Badge> : <Badge tone="green">Active</Badge>) },
          { h: 'Joined', r: (u) => fmtDate(u.createdAt) },
          { h: '', r: (u) => { const blocked = u.isBlocked || u.status === 'blocked'; return (
            <Btn tone={blocked ? 'primary' : 'danger'} disabled={busy === u._id} onClick={() => act(u._id, () => users.toggleBlock(u._id), blocked ? 'User unblocked' : 'User blocked')}>{blocked ? 'Unblock' : 'Block'}</Btn>) } },
        ]} />
      </LoadState>
    </Panel>
  )
}

export function AdminFarms() {
  const [q, setQ] = useState('')
  const l = useLoad(() => shops.list({ limit: 500 }).then((r) => r.data))
  const { busy, act, banner } = useAction(l.reload)
  const rows = (l.data || []).filter((s) => match(q, s.name, s.shopName, s.county))
  return (
    <Panel title={`Farms & shops (${rows.length})`} action={<SearchBox value={q} onChange={setQ} placeholder="Search farms" />}>
      {banner}
      <LoadState {...l} onRetry={l.reload} empty={!rows.length}>
        <Table rows={rows} cols={[
          { h: 'Farm', r: (s) => <div><p className="font-medium">{s.name || s.shopName || 'N/A'}</p><p className="text-xs text-farmer-muted">{s.owner?.email || s.email || s.address || ''}</p></div> },
          { h: 'Status', r: (s) => { const st = s.status || (s.isVerified ? 'verified' : 'pending'); return <Badge tone={st === 'verified' || st === 'approved' ? 'green' : st === 'rejected' ? 'red' : 'amber'}>{st}</Badge> } },
          { h: 'Created', r: (s) => fmtDate(s.createdAt) },
          { h: '', r: (s) => <div className="flex gap-2">
            <Btn tone="primary" disabled={busy === s._id} onClick={() => act(s._id, () => shops.verify(s._id), 'Farm verified')}>Verify</Btn>
            <Btn tone="danger" disabled={busy === s._id} onClick={() => { const reason = window.prompt('Reason for rejection?'); if (reason) act(s._id, () => shops.reject(s._id, { reason }), 'Farm rejected') }}>Reject</Btn></div> },
        ]} />
      </LoadState>
    </Panel>
  )
}

export function AdminProducts() {
  const [q, setQ] = useState('')
  const l = useLoad(() => products.list({ limit: 500 }).then((r) => r.data))
  const { busy, act, banner } = useAction(l.reload)
  const rows = (l.data || []).filter((p) => match(q, p.name, p.title, p.category?.name))
  return (
    <Panel title={`Produce listings (${rows.length})`} action={<SearchBox value={q} onChange={setQ} placeholder="Search produce" />}>
      {banner}
      <LoadState {...l} onRetry={l.reload} empty={!rows.length}>
        <Table rows={rows} cols={[
          { h: 'Produce', r: (p) => <div className="flex items-center gap-3">{(p.images?.[0] || p.image) && <img src={p.images?.[0] || p.image} alt="" className="h-9 w-9 rounded-lg object-cover" />}<span className="font-medium">{p.name || p.title}</span></div> },
          { h: 'Category', r: (p) => p.category?.name || p.cropType || 'N/A' },
          { h: 'Price', r: (p) => money(p.price) },
          { h: 'Stock', r: (p) => p.stock ?? p.quantity ?? 'N/A' },
          { h: '', r: (p) => <Btn tone="danger" disabled={busy === p._id} onClick={() => window.confirm('Remove this listing?') && act(p._id, () => products.remove(p._id), 'Listing removed')}>Remove</Btn> },
        ]} />
      </LoadState>
    </Panel>
  )
}

export function AdminPayouts() {
  const l = useLoad(() => withdrawals.list({ limit: 500 }).then((r) => r.data))
  const rows = l.data || []
  const amountLabel = (w) => {
    const amount = Number.isFinite(w.amountCents) ? w.amountCents / 100 : w.amount
    if (!Number.isFinite(amount) || !w.currency) return 'Amount or currency unavailable'
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: w.currency }).format(amount) }
    catch { return 'Unsupported currency' }
  }
  return (
    <Panel title={`Payout requests (${rows.length})`} subtitle="Stored requests; payout execution is not available in this dashboard.">
      <LoadState {...l} onRetry={l.reload} empty={!rows.length}>
        <Table rows={rows} cols={[
          { h: 'Farmer', r: (w) => w.farmer?.fullName || w.user?.fullName || w.userId?.fullName || 'N/A' },
          { h: 'Amount', r: amountLabel },
          { h: 'Method', r: (w) => w.method || 'N/A' },
          { h: 'Status', r: (w) => <Badge tone={w.status === 'completed' || w.status === 'paid' ? 'green' : w.status === 'rejected' ? 'red' : 'amber'}>{w.status || 'Unknown'}</Badge> },
          { h: 'Requested', r: (w) => fmtDate(w.createdAt) },
        ]} />
      </LoadState>
    </Panel>
  )
}

export function AdminSupport() {
  const l = useLoad(async () => {
    const [m, r] = await Promise.all([contactMessages.list({ limit: 200 }), reports.list({ limit: 200 }).catch(() => ({ data: [] }))])
    return { messages: m.data, reports: r.data }
  })
  const { busy, act, banner } = useAction(l.reload)
  return (
    <div className="space-y-5">
      <Panel title="Contact messages">
        {banner}
        <LoadState {...l} onRetry={l.reload} empty={!l.data?.messages.length}>
          <Table rows={l.data?.messages || []} cols={[
            { h: 'From', r: (m) => <div><p className="font-medium">{m.name || m.fullName || 'N/A'}</p><p className="text-xs text-farmer-muted">{m.email}</p></div> },
            { h: 'Message', r: (m) => <p className="max-w-md truncate">{m.message || m.subject}</p> },
            { h: 'Status', r: (m) => <Badge tone={m.status === 'replied' ? 'green' : 'amber'}>{m.status || 'open'}</Badge> },
            { h: 'Latest response', r: (m) => { const latest = m.replies?.[m.replies.length - 1]; return latest ? <div className="max-w-sm"><p className="truncate">{latest.body}</p><p className="text-xs text-farmer-muted">Email: {latest.deliveryStatus || 'unknown'}</p></div> : '—' } },
            { h: '', r: (m) => <Btn tone="primary" disabled={busy === m.id} onClick={() => { const reply = window.prompt(`Reply to ${m.email}`); if (reply) act(m.id, () => contactMessages.reply(m.id, { reply }), (result) => ({ ok: result?.deliveryStatus === 'sent', text: result?.message || 'Response saved; delivery status unavailable.' })) }}>Reply</Btn> },
          ]} />
        </LoadState>
      </Panel>
      <Panel title="Reports">
        <LoadState loading={l.loading} empty={!l.data?.reports.length}>
          <Table rows={l.data?.reports || []} cols={[
            { h: 'Reason', r: (r) => r.reason || r.message || 'N/A' },
            { h: 'Reported by', r: (r) => r.reporter?.fullName || r.reporter?.email || r.reporterId || 'N/A' },
            { h: 'Status', r: (r) => <Badge tone={r.status === 'resolved' ? 'green' : r.status === 'rejected' ? 'red' : 'amber'}>{r.status || 'submitted'}</Badge> },
            { h: 'Date', r: (r) => fmtDate(r.createdAt) },
            { h: 'Actions', r: (r) => <div className="flex gap-2">
              {['under_review', 'resolved', 'rejected'].map((status) => <Btn key={status} tone={status === 'rejected' ? 'danger' : 'primary'} disabled={busy === r.id || r.status === status} onClick={() => { const resolution = window.prompt(`Add an administrator note for ${status.replace('_', ' ')} (at least five characters).`); if (resolution?.trim().length >= 5) act(r.id, () => reports.update(r.id, status, resolution), `Report marked ${status.replace('_', ' ')}`) }}>{status === 'under_review' ? 'Review' : status === 'resolved' ? 'Resolve' : 'Reject'}</Btn>)}
            </div> },
          ]} />
        </LoadState>
      </Panel>
    </div>
  )
}
