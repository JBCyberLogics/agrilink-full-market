import { useCallback, useEffect, useState } from 'react'
import { AI_CAPABILITIES } from '../config.js'
import { requestAI } from '../client.js'
import { requestRaw } from '../../services/api/client.js'

function restoredContent(value, role) {
  if (typeof value !== 'string') return ''
  try {
    const parsed = JSON.parse(value)
    if (role === 'user') return String(parsed.message ?? parsed.produceType ?? parsed.produceRequirements ?? parsed.produce ?? value)
    return String(parsed.content ?? parsed.summary ?? parsed.aiExplanation ?? parsed.explanation ?? value)
  } catch { return value }
}

/** Chat state is scoped to the server-owned conversation returned by this account. */
export function useAIChat() {
  const [messages, setMessages] = useState([])
  const [status, setStatus] = useState('idle')
  const [error, setError] = useState(null)
  const [conversationId, setConversationId] = useState(null)

  useEffect(() => {
    let active = true
    async function restore() {
      try {
        const listing = await requestRaw('/ai/conversations')
        const conversations = Array.isArray(listing?.data?.conversations) ? listing.data.conversations : []
        const latest = conversations.find((item) => item.capability === AI_CAPABILITIES.AGRICULTURAL_ASSISTANT)
        if (!latest?.id) return
        const detail = await requestRaw(`/ai/conversations/${encodeURIComponent(latest.id)}`)
        if (!active || !Array.isArray(detail?.data?.messages)) return
        setConversationId(latest.id)
        setMessages(detail.data.messages.map((item, index) => ({
          role: item.role === 'assistant' ? 'assistant' : 'user',
          content: restoredContent(item.content, item.role),
          id: `${latest.id}-${index}`,
        })))
      } catch {
        // A failed history fetch does not replace the backend-authenticated session.
      }
    }
    void restore()
    return () => { active = false }
  }, [])

  const send = useCallback(async (message) => {
    const clean = String(message ?? '').trim()
    if (!clean) return { ok: false, error: 'Write a message first.', code: 'AI_INVALID_REQUEST' }
    const pendingUserMessage = { role: 'user', content: clean, id: `${Date.now()}-user` }
    setMessages((current) => [...current, pendingUserMessage])
    setStatus('loading')
    setError(null)
    const response = await requestAI(AI_CAPABILITIES.AGRICULTURAL_ASSISTANT, { message: clean, ...(conversationId ? { conversationId } : {}) })
    if (response.ok) {
      if (response.conversationId) setConversationId(response.conversationId)
      const content = response.data.content ?? response.data.message ?? response.data.reply
      setMessages((current) => [...current, { role: 'assistant', content, id: `${Date.now()}-assistant` }])
      setStatus('success')
    } else {
      setError(response.error)
      setStatus('error')
    }
    return response
  }, [conversationId])

  return { messages, status, error, conversationId, send, clear: () => { setMessages([]); setError(null); setStatus('idle'); setConversationId(null) } }
}
