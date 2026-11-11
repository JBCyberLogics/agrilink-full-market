/* Whole-page translation via Google Translate (English, Kiswahili, Gĩkũyũ). */
export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'sw', label: 'Kiswahili' },
  { code: 'ki', label: 'Gĩkũyũ' },
]

export function currentLanguage() {
  const m = document.cookie.match(/googtrans=\/en\/(\w+)/)
  return m ? m[1] : 'en'
}

function setCookie(value) {
  const host = window.location.hostname
  const exp = value ? '' : ';expires=Thu, 01 Jan 1970 00:00:00 GMT'
  document.cookie = `googtrans=${value}${exp};path=/`
  if (host.includes('.')) document.cookie = `googtrans=${value}${exp};path=/;domain=.${host}`
}

let loading
export function initTranslate() {
  if (loading) return loading
  loading = new Promise((resolve) => {
    window.googleTranslateElementInit = () => {
      new window.google.translate.TranslateElement(
        { pageLanguage: 'en', includedLanguages: 'en,sw,ki', autoDisplay: false },
        'google_translate_element',
      )
      resolve()
    }
    if (!document.getElementById('google_translate_element')) {
      const el = document.createElement('div')
      el.id = 'google_translate_element'
      el.style.display = 'none'
      document.body.appendChild(el)
    }
    const s = document.createElement('script')
    s.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
    s.async = true
    document.body.appendChild(s)
  })
  return loading
}

export async function setLanguage(code) {
  if (code === 'en') {
    setCookie('')
    window.location.reload()
    return
  }
  setCookie(`/en/${code}`)
  await initTranslate()
  const apply = (tries = 0) => {
    const combo = document.querySelector('select.goog-te-combo')
    if (combo) {
      combo.value = code
      combo.dispatchEvent(new Event('change'))
    } else if (tries < 40) setTimeout(() => apply(tries + 1), 150)
  }
  apply()
}
