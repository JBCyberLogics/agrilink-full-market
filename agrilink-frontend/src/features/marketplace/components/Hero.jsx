import { useEffect, useState } from 'react'
import { ArrowRight, MessageCircle, Sprout, Tractor, X } from 'lucide-react'
import {
  getAvailableHeroImageIndex,
  getNextHeroImageIndex,
  HERO_IMAGES,
  HERO_SLIDE_INTERVAL_MS,
} from './heroImages.js'

const CROSSFADE_MS = 1200

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const updatePreference = (event) => setReducedMotion(event.matches)
    if (mediaQuery.addEventListener) mediaQuery.addEventListener('change', updatePreference)
    else mediaQuery.addListener?.(updatePreference)

    return () => {
      if (mediaQuery.removeEventListener) mediaQuery.removeEventListener('change', updatePreference)
      else mediaQuery.removeListener?.(updatePreference)
    }
  }, [])

  return reducedMotion
}

export default function Hero({ onJoin }) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [failedSources, setFailedSources] = useState(() => new Set())
  const [preloadedIndex, setPreloadedIndex] = useState(-1)
  const [transitioning, setTransitioning] = useState(false)
  const [showChatTeaser, setShowChatTeaser] = useState(false)
  const [botpressReady, setBotpressReady] = useState(() => Boolean(window.__AGRILINK_BOTPRESS_READY__))
  const prefersReducedMotion = usePrefersReducedMotion()

  useEffect(() => {
    const markReady = () => setBotpressReady(true)
    window.addEventListener('agrilink-botpress-ready', markReady)
    if (window.__AGRILINK_BOTPRESS_READY__) markReady()
    return () => window.removeEventListener('agrilink-botpress-ready', markReady)
  }, [])

  useEffect(() => {
    if (!botpressReady) return
    try {
      if (window.sessionStorage.getItem('agrilink-botpress-teaser-shown') === 'true') return
      window.sessionStorage.setItem('agrilink-botpress-teaser-shown', 'true')
    } catch {
      // The teaser is optional; storage restrictions must not affect the hero.
    }
    setShowChatTeaser(true)
  }, [botpressReady])

  useEffect(() => {
    if (!showChatTeaser) return undefined
    const timer = window.setTimeout(() => setShowChatTeaser(false), 6200)
    return () => window.clearTimeout(timer)
  }, [showChatTeaser])

  const currentIndex = getAvailableHeroImageIndex(HERO_IMAGES, activeIndex, failedSources)
  const nextIndex = prefersReducedMotion
    ? -1
    : getNextHeroImageIndex(HERO_IMAGES, currentIndex, failedSources)

  useEffect(() => {
    if (currentIndex < 0 || currentIndex === activeIndex) return
    setActiveIndex(currentIndex)
    setPreloadedIndex(-1)
    setTransitioning(false)
  }, [activeIndex, currentIndex])

  useEffect(() => {
    setPreloadedIndex(-1)
    setTransitioning(false)
    if (prefersReducedMotion || nextIndex < 0) return undefined

    let cancelled = false
    const preload = new Image()
    const markFailed = () => {
      if (cancelled) return
      setFailedSources((previous) => {
        const source = HERO_IMAGES[nextIndex]
        return previous.has(source) ? previous : new Set(previous).add(source)
      })
    }
    const markReady = () => {
      if (!cancelled) setPreloadedIndex(nextIndex)
    }

    preload.onload = markReady
    preload.onerror = markFailed
    preload.src = HERO_IMAGES[nextIndex]
    if (preload.complete) {
      if (preload.naturalWidth > 0) markReady()
      else markFailed()
    }

    return () => {
      cancelled = true
      preload.onload = null
      preload.onerror = null
    }
  }, [nextIndex, prefersReducedMotion])

  useEffect(() => {
    if (prefersReducedMotion || nextIndex < 0 || preloadedIndex !== nextIndex) return undefined

    let transitionTimer
    const intervalTimer = window.setTimeout(() => {
      setTransitioning(true)
      transitionTimer = window.setTimeout(() => {
        setActiveIndex(nextIndex)
        setPreloadedIndex(-1)
        setTransitioning(false)
      }, CROSSFADE_MS)
    }, HERO_SLIDE_INTERVAL_MS)

    return () => {
      window.clearTimeout(intervalTimer)
      window.clearTimeout(transitionTimer)
    }
  }, [nextIndex, preloadedIndex, prefersReducedMotion])

  const markImageFailed = (source) => {
    setFailedSources((previous) => previous.has(source) ? previous : new Set(previous).add(source))
  }

  const slideIndexes = [...new Set([currentIndex, nextIndex].filter((index) => index >= 0))]

  return (
    <section
      aria-labelledby="marketplace-hero-title"
      className="agri-hero mx-auto max-w-7xl px-4 pt-5 sm:px-6 lg:px-8"
    >
      <div className="agri-hero__frame relative isolate min-h-[34rem] overflow-hidden rounded-[1.65rem] bg-[#193d2b] shadow-[0_28px_70px_-38px_rgba(18,49,29,.68)] sm:min-h-[38rem] lg:min-h-[40rem]">
        <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
          {slideIndexes.map((index) => {
            const source = HERO_IMAGES[index]
            const isVisible = transitioning ? index === nextIndex : index === currentIndex

            return (
              <img
                key={source}
                src={source}
                alt=""
                aria-hidden="true"
                fetchpriority={index === currentIndex ? 'high' : 'auto'}
                decoding="async"
                onError={() => markImageFailed(source)}
                className={`agri-hero__slide absolute inset-0 h-full w-full object-cover ${isVisible ? 'is-visible' : ''}`}
              />
            )
          })}
          <div className="agri-hero__scrim absolute inset-0" />
        </div>

        <div className="relative z-10 flex min-h-[34rem] items-center px-6 py-12 sm:min-h-[38rem] sm:px-10 sm:py-16 lg:min-h-[40rem] lg:px-14 lg:py-20">
          <div className="max-w-[47rem] text-white">
            <p className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/[.08] px-3.5 py-2 text-[10px] font-bold uppercase tracking-[.18em] text-emerald-50 backdrop-blur-sm sm:text-[11px]">
              <Sprout size={14} aria-hidden="true" className="text-[#e8bd72]" />
              Agriculture, connected
            </p>

            <h1
              id="marketplace-hero-title"
              className="mt-6 max-w-[13ch] font-display text-[2.65rem] font-extrabold leading-[1.04] tracking-[-.05em] sm:text-6xl lg:text-[4.6rem]"
            >
              From the farm gate,
              <span className="mt-1 block text-[#e8bd72]">straight to your table.</span>
            </h1>

            <p className="mt-5 max-w-[43ch] text-sm leading-7 text-white/85 sm:text-base">
              Discover available produce and connect buyers with farmers through one straightforward marketplace.
            </p>

            <div className="mt-7 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
              <a
                href="#marketplace"
                onClick={(event) => {
                  event.preventDefault()
                  document.getElementById('marketplace')?.scrollIntoView({
                    behavior: prefersReducedMotion ? 'auto' : 'smooth',
                  })
                }}
                className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#e2ad58] px-5 text-sm font-bold text-[#233323] transition-colors hover:bg-[#efc577] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white active:scale-[.98]"
              >
                Explore produce
                <ArrowRight size={16} aria-hidden="true" className="transition-transform group-hover:translate-x-1" />
              </a>
              <button
                type="button"
                onClick={onJoin}
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-white/30 bg-white/[.08] px-5 text-sm font-semibold text-white transition-colors hover:bg-white/[.15] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              >
                <Tractor size={16} aria-hidden="true" />
                Join as a farmer
              </button>
            </div>

            <div className="mt-9 flex flex-wrap gap-x-6 gap-y-3 border-t border-white/20 pt-5 text-xs font-medium text-white/80">
              <span className="inline-flex items-center gap-2"><Sprout size={15} aria-hidden="true" className="text-[#e8bd72]" /> For farmers</span>
              <span className="inline-flex items-center gap-2"><ArrowRight size={14} aria-hidden="true" className="text-[#e8bd72]" /> For buyers</span>
            </div>
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-8 right-10 z-10 hidden max-w-[17rem] rounded-xl border border-white/20 bg-[#183a29]/65 p-4 text-white shadow-lg backdrop-blur-md xl:block">
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[#e8bd72]">AgriLink marketplace</p>
          <p className="mt-1.5 font-display text-lg font-bold tracking-tight">A clearer path from harvest to market</p>
        </div>
      </div>

      {showChatTeaser && (
        <aside className="agri-chat-teaser" role="status" aria-live="polite">
          <span className="agri-chat-teaser__icon" aria-hidden="true"><MessageCircle size={17} /></span>
          <span className="agri-chat-teaser__copy">
            <strong>AgriLink Assistant</strong>
            <span>Need a hand? Open the chat.</span>
          </span>
          <button
            type="button"
            className="agri-chat-teaser__dismiss"
            aria-label="Dismiss chat invitation"
            onClick={() => setShowChatTeaser(false)}
          >
            <X size={15} aria-hidden="true" />
          </button>
        </aside>
      )}
    </section>
  )
}
