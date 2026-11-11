import { useCallback, useState } from 'react'
import { AI_CAPABILITIES } from '../config.js'
import { requestAI } from '../client.js'

/** Chat state that only appends provider replies returned by a configured proxy. */
export function useAIChat({ maxTurns = 12 } = {}) {
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)

  const send = useCallback(async (message) => {
    const clean = String(message ?? '').trim()
    if (!clean) return { ok: false, error: 'Write a message first.', code: 'AI_INVALID_REQUEST' }
    const nextHistory = messages.slice(-(maxTurns * 2)).map(({ role, content }) => ({ role, content }))
    const pendingUserMessage = { role: 'user', content: clean, id: `${Date.now()}-user` }
    setMessages((current) => [...current, pendingUserMessage])
    setStatus('loading')
    setError(null)
    const response = await requestAI(AI_CAPABILITIES.AGRICULTURAL_ASSISTANT, { message: clean, history: nextHistory })
    if (response.ok) {
      const content = response.data.content ?? response.data.message ?? response.data.reply
      setMessages((current) => [...current, { role: 'assistant', content, id: `${Date.now()}-assistant` }])
      setStatus('success')
    } else {
      setError(response.error)
      setStatus('error')
    }
    return response
  }, [maxTurns, messages])

  return { messages, status, error, send, clear: () => { setMessages([]); setError(null); setStatus('idle') } }
}
