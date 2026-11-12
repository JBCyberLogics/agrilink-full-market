/**
 * Buyer inquiries — inquiries about the authenticated farmer's own listings,
 * from /api/farmer/inquiries. The farmer can reply to or update the status
 * of open inquiries. Nothing is simulated: every row is server-backed.
 */
import { useEffect, useState } from 'react'
import { MessageSquare, AlertCircle, RotateCw, Truck } from 'lucide-react'
import EmptyState from '../../../components/feedback/EmptyState'
import { farmerInquiries, farmerRespondInquiry } from '../services/inquiryService'
import { fmtDate } from '../../../utils/format'

export default function Inquiries() {
  const [status, setStatus] = useState('loading') // loading | ok | error
  const [inquiries, setInquiries] = useState([])
  const [error, setError] = useState('')
  const [replying, setReplying] = useState(null) // inquiry id being replied to
  const [replyDrafts, setReplyDrafts] = useState({})

  useEffect(() => {
    let alive = true
    farmerInquiries()
      .then((d) => alive && setInquiries(d.inquiries ?? []))
      .then(() => alive && setStatus('ok'))
      .catch(() => alive && setStatus('error'))
    return () => {
      alive = false
    }
  }, [])

  const refresh = () => {
    setStatus('loading')
    farmerInquiries()
      .then((d) => setInquiries(d.inquiries ?? []))
      .then(() => setStatus('ok'))
      .catch(() => setStatus('error'))
  }

  const respond = async (id, newStatus) => {
    setReplying(id)
    setError('')
    try {
      const d = await farmerRespondInquiry(id, newStatus, replyDrafts[id] ?? '')
      setInquiries((prev) => prev.map((item) => item.id === id ? { ...item, ...d.inquiry } : item))
      if (String(newStatus).toLowerCase() === 'replied') setReplyDrafts((current) => ({ ...current, [id]: '' }))
    } catch (err) {
      setError((err?.error || err?.message) || 'Could not update this inquiry. Please try again.')
    } finally {
      setReplying(null)
    }
  }

  if (status === 'loading')
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading inquiries">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl border border-farmer-line bg-paper/70" />
        ))}
      </div>
    )

  if (status === 'error')
    return (
      <div className="rounded-xl border border-farmer-line bg-paper p-6 text-center">
        <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-danger-wash text-farmer-danger">
          <AlertCircle size={20} aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-semibold text-farmer-ink">{error || 'Could not load your inquiries.'}</p>
        <button
          type="button"
          onClick={refresh}
          className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-farmer-primary px-4 text-[13px] font-semibold text-white hover:bg-farmer-primary-hover"
        >
          <RotateCw size={14} aria-hidden="true" /> Try again
        </button>
      </div>
    )

  if (inquiries.length === 0)
    return (
      <div className="space-y-4">
        <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
          <EmptyState icon={MessageSquare} title="No inquiries yet.">
            When buyers send inquiries about your produce, they will appear here for you to reply to.
          </EmptyState>
        </section>
      </div>
    )

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-farmer-line bg-paper p-6 sm:p-8">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="font-display text-[15px] font-semibold text-farmer-ink">
            <Truck size={16} aria-hidden="true" className="mr-2 text-farmer-brand" />
            Buyer inquiries
          </h2>
          <button
            type="button"
            onClick={refresh}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-farmer-line bg-paper px-4 text-[13px] font-semibold text-farmer-ink hover:border-farmer-brand/40 hover:text-farmer-brand"
          >
            <RotateCw size={14} aria-hidden="true" /> Refresh
          </button>
        </div>
        <ul className="divide-y divide-farmer-line">
          {inquiries.map((i) => (
            <li key={i.id} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-farmer-ink">
                    About <span className="font-medium">{i.listingName}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-farmer-muted">{i.buyerName} &middot; {i.message}</p>
                  {i.messages?.length > 0 && <ol aria-label="Conversation history" className="mt-2 space-y-1.5">{i.messages.map((message) => <li key={message.id} className="rounded-lg bg-farmer-page px-3 py-2 text-xs text-farmer-muted"><span className="font-semibold text-farmer-ink">{message.fromCurrentUser ? 'You' : i.buyerName}:</span> {message.text}<span className="ml-2 text-[10px]">{message.createdAt ? fmtDate(message.createdAt) : ''}</span></li>)}</ol>}
                </div>
                <div className="flex flex-col sm:flex-row items-end sm:items-start gap-2">
                  <span className="inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold">
                    {i.status === 'Open' ? 'Open' : i.status === 'Replied' ? 'Replied' : 'Closed'}
                  </span>
                </div>
              </div>
              <p className="mt-2 text-xs text-farmer-muted">Sent {fmtDate(i.createdAt)}</p>
              {i.status === 'Open' && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <label className="basis-full"><span className="mb-1 block text-xs font-semibold text-farmer-ink">Reply to buyer</span><textarea value={replyDrafts[i.id] ?? ''} onChange={(event) => setReplyDrafts((current) => ({ ...current, [i.id]: event.target.value }))} maxLength={5000} rows={3} className="w-full rounded-lg border border-farmer-line bg-paper px-3 py-2 text-sm text-farmer-ink" placeholder="Write a reply" /></label>
                  <button
                    type="button"
                    onClick={() => respond(i.id, 'Replied')}
                    disabled={replying === i.id || !(replyDrafts[i.id] ?? '').trim()}
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-farmer-line bg-paper px-3 text-[12px] font-semibold text-farmer-ink hover:border-farmer-brand/40 hover:text-farmer-brand disabled:opacity-50"
                  >
                    {replying === i.id ? 'Sending…' : 'Send reply'}
                  </button>
                  <button
                    type="button"
                    onClick={() => respond(i.id, 'Closed')}
                    disabled={replying === i.id}
                    className="inline-flex h-9 items-center gap-1 rounded-lg border border-farmer-line bg-paper px-3 text-[12px] font-semibold text-farmer-ink hover:border-farmer-brand/40 hover:text-farmer-brand disabled:opacity-50"
                  >
                    Close
                  </button>
                </div>
              )}
              {error && replying === null && <p role="alert" className="mt-2 text-xs text-farmer-danger">{error}</p>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
