import { useEffect, useMemo, useState } from 'react'
import {
  X, MapPin, BadgeCheck, ShoppingCart, MessageCircle, Minus, Plus, Leaf, Wheat, Tractor, Star,
} from 'lucide-react'
import { kes } from '../../../utils/format'
import { reviews } from '../../../services/api/endpoints.js'

const CATEGORY_ART = { Grains: Wheat, 'Fruits & Veg': Leaf, Livestock: Tractor }

export default function ProductDetailModal({ product, open, onClose, onAddToCart, onInquire }) {
  const [qty, setQty] = useState(1)
  const [reviewSummary, setReviewSummary] = useState(null)
  const [reviewRows, setReviewRows] = useState([])
  const [reviewLoading, setReviewLoading] = useState(false)
  const [reviewError, setReviewError] = useState('')
  const [reviewEligibility, setReviewEligibility] = useState(null)
  const [reviewEligibilityChecked, setReviewEligibilityChecked] = useState(false)
  const [reviewRating, setReviewRating] = useState('5')
  const [reviewComment, setReviewComment] = useState('')
  const [reviewSaving, setReviewSaving] = useState(false)

  useEffect(() => {
    if (open) setQty(product?.minOrderQuantity ?? 1)
  }, [open, product?.id, product?.minOrderQuantity])

  useEffect(() => {
    if (!open) return
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  useEffect(() => {
    if (!open || !product?.id) return undefined
    let alive = true
    setReviewLoading(true); setReviewError(''); setReviewSummary(null); setReviewRows([])
    setReviewEligibility(null); setReviewEligibilityChecked(false); setReviewComment(''); setReviewRating('5')
    Promise.all([reviews.summary(product.id), reviews.forProduct(product.id, { limit: 5 })])
      .then(([summary, list]) => {
        if (!alive) return
        setReviewSummary(summary)
        setReviewRows(list?.data ?? [])
      })
      .catch((error) => { if (alive) setReviewError(error?.error || error?.message || 'Reviews are unavailable.') })
      .finally(() => { if (alive) setReviewLoading(false) })
    reviews.canReview({ productId: product.id })
      .then((result) => { if (alive) setReviewEligibility(result) })
      .catch(() => { if (alive) setReviewEligibility(null) })
      .finally(() => { if (alive) setReviewEligibilityChecked(true) })
    return () => { alive = false }
  }, [open, product?.id])

  const priceAvailable = Number.isFinite(product?.price) && product.price > 0
  const stockAvailable = Number.isFinite(product?.stock) && product.stock > 0
  const listingAvailable = priceAvailable && stockAvailable && typeof product?.unit === 'string' && Boolean(product.unit.trim())
  const total = useMemo(() => (priceAvailable ? product.price * qty : null), [product, qty, priceAvailable])
  const out = !product || product.stock === 0
  const unavailable = !listingAvailable && !out
  const min = product?.minOrderQuantity ?? 1
  const max = product?.stock ?? Infinity

  if (!open || !product) return null
  const Icon = CATEGORY_ART[product.category] ?? Wheat
  const clamp = (n) => Math.max(min, Math.min(max, Number.isFinite(n) ? n : min))
  const submitReview = async (event) => {
    event.preventDefault()
    setReviewSaving(true); setReviewError('')
    try {
      await reviews.create({ productId: product.id, rating: Number(reviewRating), comment: reviewComment.trim() })
      setReviewComment('')
      const [summary, list, eligibility] = await Promise.all([
        reviews.summary(product.id), reviews.forProduct(product.id, { limit: 5 }), reviews.canReview({ productId: product.id }),
      ])
      setReviewSummary(summary); setReviewRows(list?.data ?? []); setReviewEligibility(eligibility)
    } catch (error) { setReviewError(error?.error || error?.message || 'Your review could not be saved.') }
    finally { setReviewSaving(false) }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-neutral-900/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="pdm-title"
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[92vh] w-full max-w-3xl animate-fade-up flex-col overflow-hidden rounded-t-3xl border border-line bg-paper shadow-lift sm:rounded-3xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-paper/90 text-ink shadow-glass backdrop-blur hover:bg-soft"
        >
          <X size={18} />
        </button>

        <div className="grid flex-1 overflow-y-auto md:grid-cols-2">
          {/* Gallery / art */}
          <div className="relative h-56 overflow-hidden bg-primary-soft/60 md:h-full">
            {product.image ? (
              <img src={product.image} alt={product.name} className="h-full w-full object-cover" />
            ) : (
              <span className="grid h-full w-full place-items-center text-brand/60">
                <Icon size={64} aria-hidden="true" />
              </span>
            )}
            <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
              {product.qualityGrade && (
                <span className="rounded-full bg-secondary/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-neutral-900">
                  Grade {product.qualityGrade}
                </span>
              )}
              {product.variety && (
                <span className="rounded-full bg-paper/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-deep">
                  {product.variety}
                </span>
              )}
            </div>
          </div>

          {/* Details */}
          <div className="flex flex-col gap-4 p-5 md:p-6">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-brand">
                {product.category}
              </p>
              <h2 id="pdm-title" className="mt-1 font-display text-2xl font-bold leading-tight text-ink">
                {product.name}
              </h2>
              <p className="mt-1 flex items-center gap-1 text-xs font-medium text-muted">
                {product.farmer}
                {product.sellerVerified && <BadgeCheck size={14} className="text-brand" aria-label="Verified farmer" />}
                {product.location && (
                  <>
                    <span className="text-faint">•</span>
                    <MapPin size={12} className="text-brand-amber" />
                    {product.location}
                  </>
                )}
              </p>
            </div>

            <dl className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-soft/40 p-3 text-xs">
              <div>
                <dt className="text-muted-2">Farming</dt>
                <dd className="font-semibold text-ink">{product.farmingMethod ?? 'N/A'}</dd>
              </div>
              <div>
                <dt className="text-muted-2">Crop type</dt>
                <dd className="font-semibold text-ink">{product.cropType ?? 'N/A'}</dd>
              </div>
              <div>
                <dt className="text-muted-2">Min order</dt>
                <dd className="font-semibold text-ink">
                  {product.minOrderQuantity ?? 'Not supplied'} {product.unit ?? ''}
                </dd>
              </div>
              <div>
                <dt className="text-muted-2">Stock</dt>
                <dd className={`font-semibold ${out ? 'text-danger' : 'text-ink'}`}>
                  {out ? 'Sold out' : stockAvailable ? `${product.stock} ${product.unit}` : 'Unavailable'}
                </dd>
              </div>
            </dl>

            {product.description && (
              <p className="text-sm leading-relaxed text-muted">{product.description}</p>
            )}

            <section aria-label="Buyer reviews" className="space-y-3 rounded-xl border border-line bg-soft/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-ink">Buyer reviews</h3>
                {reviewSummary?.count > 0 ? <p className="flex items-center gap-1 text-xs font-semibold text-ink"><Star size={13} className="fill-brand-amber text-brand-amber" aria-hidden="true" />{reviewSummary.averageRating?.toFixed(1) ?? '—'} · {reviewSummary.count} {reviewSummary.count === 1 ? 'review' : 'reviews'}</p> : <span className="text-xs text-muted">No reviews yet</span>}
              </div>
              {reviewLoading ? <p className="text-xs text-muted" role="status">Loading saved reviews…</p> : reviewRows.length ? <ul className="space-y-2">{reviewRows.map((review) => <li key={review.id} className="border-t border-line pt-2 first:border-0 first:pt-0"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold text-ink">{review.reviewerName || 'Buyer'}{review.verifiedPurchase && <span className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-[10px] font-semibold text-brand-deep">Verified purchase</span>}</p><span className="text-xs text-muted" aria-label={`${review.rating} out of 5 stars`}>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</span></div>{review.comment && <p className="mt-1 text-xs leading-relaxed text-muted">{review.comment}</p>}</li>)}</ul> : null}
              {reviewEligibility?.eligible ? <form onSubmit={submitReview} className="space-y-2 border-t border-line pt-3"><label className="block text-xs font-semibold text-ink">Your rating<select aria-label="Your rating" value={reviewRating} onChange={(event) => setReviewRating(event.target.value)} className="ml-2 rounded-lg border border-line bg-paper px-2 py-1 text-xs"><option value="5">5 stars</option><option value="4">4 stars</option><option value="3">3 stars</option><option value="2">2 stars</option><option value="1">1 star</option></select></label><label className="block text-xs font-semibold text-ink">Comment<textarea aria-label="Review comment" value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} rows={2} maxLength={2000} className="mt-1 w-full resize-y rounded-lg border border-line bg-paper px-2.5 py-2 text-xs font-normal text-ink" /></label><button type="submit" disabled={reviewSaving} className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary px-3 text-xs font-semibold text-white disabled:opacity-50">{reviewSaving ? 'Saving…' : 'Submit verified review'}</button></form> : reviewEligibilityChecked && <p className="border-t border-line pt-2 text-xs text-muted">{reviewEligibility?.reason === 'already_reviewed' ? 'You have already reviewed this listing.' : reviewEligibility?.reason === 'no_delivered_order' ? 'A verified review is available after an order containing this listing is delivered.' : 'Sign in as a buyer with a delivered order to submit a verified review.'}</p>}
              {reviewError && <p className="text-xs text-danger" role="alert">{reviewError}</p>}
            </section>

            {/* Quantity + total */}
            <div className="mt-auto space-y-3 border-t border-line pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted">Quantity ({product.unit ?? 'unit unavailable'})</span>
                <div className="inline-flex items-center gap-2 rounded-xl border border-line bg-paper p-1">
                  <button
                    type="button"
                    onClick={() => setQty((q) => clamp(q - 1))}
                    disabled={out || unavailable || qty <= min}
                    className="grid h-8 w-8 place-items-center rounded-lg hover:bg-soft disabled:opacity-40"
                    aria-label="Decrease quantity"
                  >
                    <Minus size={14} />
                  </button>
                  <input
                    type="number"
                    value={qty}
                    min={min}
                    max={max}
                    onChange={(e) => setQty(clamp(e.target.value))}
                    className="w-14 border-0 bg-transparent text-center text-sm font-semibold text-ink focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setQty((q) => clamp(q + 1))}
                    disabled={out || unavailable || qty >= max}
                    className="grid h-8 w-8 place-items-center rounded-lg hover:bg-soft disabled:opacity-40"
                    aria-label="Increase quantity"
                  >
                    <Plus size={14} />
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-2">
                  {priceAvailable ? `${kes(product.price)} × ${qty}` : 'Price unavailable'}
                </span>
                <span className="font-display text-xl font-bold text-brand-deep">{kes(total)}</span>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  type="button"
                  disabled={out || unavailable}
                  onClick={() => onAddToCart({ ...product, quantity: qty })}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-white shadow-lift transition hover:bg-primary-dark active:scale-95 disabled:cursor-not-allowed disabled:bg-soft-strong"
                >
                  <ShoppingCart size={16} />
                  {out ? 'Sold out' : unavailable ? 'Unavailable' : 'Add to Cart'}
                </button>
                <button
                  type="button"
                  onClick={() => onInquire?.(product)}
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-line bg-paper text-sm font-semibold text-ink transition hover:bg-soft active:scale-95"
                >
                  <MessageCircle size={16} />
                  Ask Farmer
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
