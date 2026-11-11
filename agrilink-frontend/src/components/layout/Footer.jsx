import { ArrowUp, Globe } from 'lucide-react'
import { LANGUAGES, currentLanguage, setLanguage } from '../../services/translate'

const NAVIGATION_LINKS = [
  { label: 'Find produce', href: '#/' },
  { label: 'How it works', href: '#/how-it-works' },
  { label: 'Start selling', href: '#/start-selling' },
  { label: 'About AgriLink', href: '#/about' },
  { label: 'Contact', href: '#/contact' },
]

const LEGAL_LINKS = [
  { label: 'Privacy policy', href: '#/privacy' },
  { label: 'Terms of service', href: '#/terms' },
  { label: 'Cookie policy', href: '#/cookies' },
  { label: 'Acceptable use', href: '#/acceptable-use' },
  { label: 'Accessibility', href: '#/accessibility' },
]

export default function Footer({ onLogin }) {
  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <footer className="agri-site-footer mt-16 border-t border-line bg-paper text-ink">
      <div className="mx-auto grid max-w-screen-2xl grid-cols-2 gap-x-8 gap-y-10 px-4 py-10 sm:px-6 sm:py-12 md:grid-cols-[1.5fr_1fr_1fr] md:gap-x-12 2xl:px-10">
        <div className="col-span-2 md:col-span-1">
          <a href="#/" aria-label="AgriLink home" className="inline-flex rounded-md">
            <img
              src="/images/logo.png"
              alt="AgriLink"
              className="h-10 w-36 object-cover object-center dark:brightness-0 dark:invert"
            />
          </a>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted">
            A Kenyan marketplace to discover fresh produce and connect with the people who grow it.
          </p>
        </div>

        <nav aria-label="Footer navigation">
          <h2 className="text-[11px] font-bold uppercase tracking-[.15em] text-muted-2">Explore AgriLink</h2>
          <ul className="mt-4 space-y-2.5">
            {NAVIGATION_LINKS.map(({ label, href }) => (
              <li key={label}>
                <a href={href} className="inline-flex py-0.5 text-[13px] leading-5 text-ink-3 transition-colors hover:text-brand-deep hover:underline hover:underline-offset-4">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <nav aria-label="Legal information">
          <h2 className="text-[11px] font-bold uppercase tracking-[.15em] text-muted-2">Legal & accessibility</h2>
          <ul className="mt-4 space-y-2.5">
            {LEGAL_LINKS.map(({ label, href }) => (
              <li key={label}>
                <a href={href} className="inline-flex py-0.5 text-[13px] leading-5 text-ink-3 transition-colors hover:text-brand-deep hover:underline hover:underline-offset-4">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="border-t border-line bg-paper-soft/70">
        <div className="mx-auto flex max-w-screen-2xl flex-col gap-4 px-4 py-5 text-xs text-muted sm:px-6 md:flex-row md:flex-wrap md:items-center md:justify-between 2xl:px-10">
          <p>© {new Date().getFullYear()} AgriLink Ltd. All rights reserved.</p>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <label htmlFor="footer-lang" className="sr-only">Language</label>
            <span className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-line bg-paper px-2.5">
              <Globe size={14} aria-hidden="true" className="text-muted" />
              <select
                id="footer-lang"
                defaultValue={currentLanguage()}
                onChange={(event) => setLanguage(event.target.value)}
                className="notranslate max-w-32 bg-transparent text-xs font-medium text-ink-3 focus:outline-none [&>option]:text-emerald-950"
              >
                {LANGUAGES.map((language) => (
                  <option key={language.code} value={language.code}>{language.label}</option>
                ))}
              </select>
            </span>

            {onLogin && (
              <button type="button" onClick={onLogin} className="min-h-9 font-semibold text-ink-3 transition-colors hover:text-brand-deep">
                Log in
              </button>
            )}
            <button
              type="button"
              onClick={scrollToTop}
              aria-label="Back to top"
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-paper px-3 font-semibold text-ink-3 transition-colors hover:border-brand/30 hover:text-brand-deep"
            >
              <ArrowUp size={14} aria-hidden="true" /> Top
            </button>
          </div>
        </div>
      </div>
    </footer>
  )
}
