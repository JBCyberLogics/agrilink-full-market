import { useCallback, useEffect, useRef, useState } from 'react'
import { requestAI } from '../client.js'

/** State wrapper for a single AI capability. Results are only set on valid proxy responses. */
export function useAIRequest(capability) {
  const [state, setState] = useState({ status: 'idle', data: null, error: null, meta: null })
  const controllerRef = useRef(null)

  const reset = useCallback(() => {
    controllerRef.current?.abort()
    controllerRef.current = null
    setState({ status: 'idle', data: null, error: null, meta: null })
  }, [])

  const run = useCallback(async (payload) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ status: 'loading', data: null, error: null, meta: null })
    const response = await requestAI(capability, payload, { signal: controller.signal })
    if (controllerRef.current === controller) {
      setState(response.ok
        ? { status: 'success', data: response.data, error: null, meta: response.meta }
        : { status: 'error', data: null, error: response.error, meta: null })
    }
    return response
  }, [capability])

  useEffect(() => () => controllerRef.current?.abort(), [])

  return { ...state, run, reset, isLoading: state.status === 'loading' }
}
