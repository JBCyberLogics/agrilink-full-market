/**
 * AgriLink API transport — the single HTTP layer for the /api/v1 backend.
 *
 * - Base URL: VITE_API_BASE_URL (backend origin, hosted separately) + /api/v1
 * - Auth: server-issued HttpOnly cookie; no authentication token is stored in JS
 * - Mutations use a CSRF cookie/header pair and credentialed requests
 * - 401 → one silent cookie-session refresh, then the original request retries once
 * - Envelope `{ statusCode, success, message, meta, data }` is unwrapped to `data`
 *   (use `requestRaw` when `meta`/`message` are needed)
 * - Errors are thrown as `{ status, error, field?, details? }`
 */
const ORIGIN = (import.meta.env?.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '')
export const API_BASE = ORIGIN
  ? (/\/api\/v\d+$/.test(ORIGIN) ? ORIGIN : `${ORIGIN}/api/v1`)
  : ''
export const API_BASE_CONFIGURED = Boolean(API_BASE)

const apiUnavailableError = () => ({
  status: 0,
  code: 'API_BASE_NOT_CONFIGURED',
  error: 'The AgriLink backend is not configured. Set VITE_API_BASE_URL to the backend URL in .env, then restart Vite.',
})

const ACCESS_KEY = 'agrilink.accessToken'
const REFRESH_KEY = 'agrilink.refreshToken'
const SESSION_EVENT_KEY = 'agrilink.session-event'
export const AUTH_STORAGE_KEYS = { access: ACCESS_KEY, refresh: REFRESH_KEY, event: SESSION_EVENT_KEY }

export const tokens = {
  get access() {
    return null
  },
  get refresh() {
    return null
  },
  set() {
    // Kept as a compatibility seam for existing service imports; cookies stay HttpOnly.
  },
  clear() {
    localStorage.removeItem(ACCESS_KEY)
    localStorage.removeItem(REFRESH_KEY)
  },
}

// Remove tokens issued by the retired bearer-token flow.
try { tokens.clear() } catch { /* storage may be disabled by the browser */ }
const readCsrfCookie = () => document.cookie.split('; ').find((entry) => entry.startsWith('agrilink.csrf='))?.slice('agrilink.csrf='.length) ?? ''
let csrfLoading
async function csrfToken() {
  const existing = readCsrfCookie()
  if (existing) return decodeURIComponent(existing)
  if (!csrfLoading) {
    csrfLoading = fetch(`${API_BASE}/auth/csrf`, { credentials: 'include', headers: { Accept: 'application/json' } })
      .then((response) => response.ok ? response.json() : null)
      .then(() => readCsrfCookie() ? decodeURIComponent(readCsrfCookie()) : '')
      .finally(() => { csrfLoading = null })
  }
  return csrfLoading
}

export function announceSessionEnded() {
  try { localStorage.setItem(SESSION_EVENT_KEY, String(Date.now())) } catch { /* cross-tab signaling is best-effort */ }
  try { new BroadcastChannel('agrilink.session').postMessage({ type: 'signed-out' }) } catch { /* unsupported browser */ }
}

/* listeners notified when the session can no longer be refreshed */
const expiredListeners = new Set()
export const onSessionExpired = (fn) => {
  expiredListeners.add(fn)
  return () => expiredListeners.delete(fn)
}

const buildQuery = (query) => {
  if (!query) return ''
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    if (Array.isArray(v)) v.forEach((item) => qs.append(k, item))
    else qs.append(k, String(v))
  }
  const s = qs.toString()
  return s ? `?${s}` : ''
}

let refreshing = null
async function refreshAccessToken() {
  if (!API_BASE_CONFIGURED) return false
  if (!refreshing) {
    refreshing = csrfToken().then((csrf) => fetch(`${API_BASE}/auth/refresh-token`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'X-CSRF-Token': csrf, 'Content-Type': 'application/json' },
    }))
      .then(async (res) => {
        const body = await res.json().catch(() => null)
        return Boolean(res.ok && body?.success && body?.data?.user)
      })
      .catch(() => false)
      .finally(() => {
        setTimeout(() => (refreshing = null), 0)
      })
  }
  return refreshing
}

/**
 * @param {string} path e.g. '/product'
 * @param {{ method?: string, body?: any, query?: object, headers?: object, auth?: boolean }} opts
 */
export async function requestRaw(path, opts = {}) {
  const { method = 'GET', body, query, headers = {}, auth = true, signal } = opts
  if (!API_BASE_CONFIGURED) throw apiUnavailableError()
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData
  const url = `${API_BASE}${path}${buildQuery(query)}`

  const send = () => {
    const h = { ...headers }
    if (body !== undefined && !isForm) h['Content-Type'] = 'application/json'
    if (!['GET', 'HEAD', 'OPTIONS'].includes(String(method).toUpperCase())) {
      return csrfToken().then((csrf) => fetch(url, {
        method, headers: { ...h, ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        credentials: 'include', body: body === undefined ? undefined : isForm ? body : JSON.stringify(body), signal,
      }))
    }
    return fetch(url, {
      method,
      headers: h,
      credentials: 'include',
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      signal,
    })
  }

  let res
  try {
    res = await send()
    if (res.status === 401 && auth && !path.startsWith('/auth/refresh-token')) {
      if (await refreshAccessToken()) res = await send()
      else {
        tokens.clear()
        expiredListeners.forEach((fn) => fn())
      }
    }
  } catch (error) {
    throw { status: 0, error: error?.name === 'AbortError' ? 'The AgriLink request timed out.' : 'Could not reach the AgriLink server. Check your connection.' }
  }

  const payload = await res.json().catch(() => null)
  if (!res.ok || payload?.success === false) {
    const firstDetail = payload?.errorSources?.[0] ?? payload?.errorMessages?.[0]
    throw {
      status: res.status,
      error: payload?.message || firstDetail?.message || `Request failed (${res.status})`,
      field: firstDetail?.path || undefined,
      details: payload,
      retryAfter: res.headers.get('Retry-After') || undefined,
    }
  }
  return payload ?? {}
}

export const request = (path, opts) => requestRaw(path, opts).then((p) => (p && 'data' in p ? p.data : p))

export const api = {
  get: (path, query, opts) => request(path, { ...opts, method: 'GET', query }),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body }),
  del: (path, opts) => request(path, { ...opts, method: 'DELETE' }),
  list: (path, query, opts) =>
    requestRaw(path, { ...opts, method: 'GET', query }).then((p) => ({ data: p.data ?? [], meta: p.meta ?? null })),
}
