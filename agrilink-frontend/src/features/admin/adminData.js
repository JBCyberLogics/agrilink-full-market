/* Defensive helpers that turn backend admin payloads into chart-ready series. */
import { useCallback, useEffect, useState } from 'react'

export function useLoad(fn, deps = []) {
  const [state, setState] = useState({ loading: true, error: null, data: null })
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }))
    return Promise.resolve()
      .then(fn)
      .then((data) => setState({ loading: false, error: null, data }))
      .catch((e) => setState({ loading: false, error: e?.error || e?.message || 'Could not reach the server', data: null }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => { run() }, [run])
  return { ...state, reload: run }
}

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0)
const LABEL_KEYS = ['day', 'date', 'month', 'label', 'name', '_id', 'week']
const VALUE_KEYS = ['income', 'totalIncome', 'total', 'amount', 'revenue', 'value', 'count', 'earning']

/** Accepts arrays or {key: value} objects and returns [{label, value}] */
export function toSeries(raw) {
  if (!raw) return []
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw?.data) ? raw.data : Array.isArray(raw?.result) ? raw.result
    : typeof raw === 'object' ? Object.entries(raw).filter(([, v]) => typeof v === 'number' || !isNaN(Number(v))).map(([k, v]) => ({ label: k, value: v })) : []
  return arr.map((r, i) => {
    if (typeof r !== 'object' || r === null) return { label: String(i + 1), value: num(r) }
    const lk = LABEL_KEYS.find((k) => r[k] !== undefined && typeof r[k] !== 'object')
    const vk = VALUE_KEYS.find((k) => r[k] !== undefined)
    return { label: String(lk ? r[lk] : i + 1), value: num(vk ? r[vk] : 0) }
  })
}

export function countBy(list, pick) {
  const m = new Map()
  for (const x of list || []) { const k = pick(x) || 'Other'; m.set(k, (m.get(k) || 0) + 1) }
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)
}

export function signupsByMonth(users) {
  const m = new Map()
  for (const u of users || []) {
    if (!u.createdAt) continue
    const d = new Date(u.createdAt); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const row = m.get(k) || { label: k, Farmers: 0, Buyers: 0 }
    if (u.role === 'seller') row.Farmers++; else if (u.role === 'customer') row.Buyers++
    m.set(k, row)
  }
  return [...m.values()].sort((a, b) => a.label.localeCompare(b.label)).slice(-12)
}

export const money = (v) => `KES ${Math.round(num(v)).toLocaleString()}`
export const roleLabel = (r) => (r === 'seller' ? 'Farmer' : r === 'customer' ? 'Buyer' : r ? r.replace(/_/g, ' ').toLowerCase() : 'N/A')
