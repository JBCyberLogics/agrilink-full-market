import { useState } from 'react'
import { MapPin, BadgeCheck, ShoppingCart, Check, Wheat, Leaf, Tractor } from 'lucide-react'
import { kes } from '../../../utils/format'

const LOW_STOCK = 50

/* honest placeholder art per category when a listing has no photo yet */
const CATEGORY_ART = {
  Grains: Wheat,
  'Fruits & Veg': Leaf,
  Livestock: Tractor,
}

export default function ProductCard({ product, onAddToCart, onSelectProduct }) {
  const [added, setAdded] = useState(false)
  const complete = Number.isFinite(product.stock) && product.stock > 0 && Number.isFinite(product.price) && product.price > 0 && typeof product.unit === 'string' && Boolean(product.unit.trim())
  const low = complete && product.stock <= LOW_STOCK
  const out = product.stock === 0
  const Icon = CATEGORY_ART[product.category] ?? Wheat

  const handleAdd = (e) => {
    e.stopPropagation()
    onAddToCart(product)
    setAdded(true)
  }

  const handleSelect = () => onSelectProduct?.(product)

  return (
    <article
      role="button"
      tabIndex={0}
      onClick={handleSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleSelect()
        }
      }}
      aria-label={`View ${product.name} details`}
      className="group relative flex cursor-pointer animate-fade-up flex-col overflow-hidden rounded-2xl border border-line bg-paper shadow-soft transition-all duration-300 hover:-translate-y-1 hover:shadow-lift focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
    >
      {/* ------------------------------ image ------------------------------ */}
      <div className="relative h-44 overflow-hidden bg-primary-soft/60">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 motion-safe:group-hover:scale-105"
          />
        ) : (
          <span className="grid h-full w-full place-items-center text-brand/60">
            <Icon size={44} aria-hidden="true" />
          </span>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-neutral-900/35 via-transparent to-neutral-900/5" />

        {!complete && !out && (
          <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-neutral-900/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-glass backdrop-blur">
            Listing details unavailable
          </span>
        )}
        {out && (
          <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-neutral-900/70 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-glass backdrop-blur">
            Sold out
          </span>
        )}
        {low && !out && (
          <span className="absolute left-3 top-3 inline-flex items-center rounded-full bg-secondary/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-neutral-900 shadow-glass backdrop-blur">
            Low stock
          </span>
        )}

        <span className="absolute right-3 top-3 inline-flex items-center rounded-full bg-paper/90 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-brand-deep shadow-glass backdrop-blur">
          {product.category}
        </span>

        {/* Produce badges — grade + variety */}
        {(product.qualityGrade || product.variety) && (
          <div className="absolute bottom-3 right-3 flex flex-col items-end gap-1">
            {product.qualityGrade && (
              <span className="rounded-full bg-secondary/90 px-2 py-0.5 text-[9px] font-bold uppercase text-neutral-900">
                Grade {product.qualityGrade}
              </span>
            )}
            {product.variety && (
              <span className="rounded-full bg-paper/90 px-2 py-0.5 text-[9px] font-bold text-brand-deep">
                {product.variety}
              </span>
            )}
          </div>
        )}

        {/* bottom chip: real farmer identity */}
        <span className="absolute bottom-3 left-3 inline-flex max-w-[70%] items-center gap-1.5 rounded-full bg-neutral-900/55 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
          <MapPin size={11} aria-hidden="true" className="shrink-0 text-brand-amber" />
          <span className="truncate">{product.farmer}</span>
        </span>
      </div>

      {/* ------------------------------ content ------------------------------ */}
      <div className="flex flex-1 flex-col p-4">
        <h3 className="font-display text-[15px] font-bold leading-tight text-ink">
          {product.name}
        </h3>

        <p className="mt-1.5 flex flex-wrap items-center gap-1 text-xs font-medium text-muted">
          {product.location || 'Location not specified'}
          {product.sellerVerified && <BadgeCheck size={14} aria-label="Verified farmer" className="shrink-0 text-brand" />}
          {product.minOrderQuantity != null && (
            <span className="rounded-full bg-soft px-2 py-0.5 text-[10px] font-semibold text-muted">
              Min {product.minOrderQuantity} {product.unit}
            </span>
          )}
          {low && (
            <span className="rounded-full bg-secondary-soft px-2 py-0.5 text-[10px] font-bold text-brand-amber-deep">
              {product.stock.toLocaleString('en-KE')} {product.unit} left
            </span>
          )}
        </p>

        <div className="mt-4 flex items-center justify-between gap-2 pt-1">
          <p className="font-display text-lg font-bold text-brand-deep">
            {kes(product.price)}
            <span className="ml-1 text-xs font-medium text-muted-2">/ {typeof product.unit === 'string' ? product.unit.split(' ')[0] : 'unit unavailable'}</span>
          </p>

          <button
            type="button"
            onClick={handleAdd}
            disabled={out || !complete}
            aria-label={`Add ${product.name} to cart`}
            className={`inline-flex h-10 shrink-0 items-center gap-1.5 rounded-xl px-3.5 text-sm font-semibold text-white transition-all duration-200 ${
              out || !complete
                ? 'cursor-not-allowed bg-soft-strong'
                : added
                  ? 'bg-primary-light shadow-soft active:scale-95'
                  : 'bg-primary shadow-lift hover:bg-primary-dark active:scale-95'
            }`}
          >
            {out ? (
              'Sold out'
            ) : !complete ? (
              'Unavailable'
            ) : added ? (
              <>
                <Check size={16} aria-hidden="true" className="animate-pop" />
                Added
              </>
            ) : (
              <>
                <ShoppingCart size={15} aria-hidden="true" />
                Add to Cart
              </>
            )}
          </button>
        </div>
      </div>

      {added && <span className="absolute inset-x-0 bottom-0 h-1 animate-pop bg-secondary" />}
    </article>
  )
}
