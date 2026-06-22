import { useEffect, useRef } from 'react'
import type { Message } from '@copilotkit/react-core/v2'

import { convertAgnoHistory, getSession } from '@/lib/api'

interface HistoryAgent {
  threadId: string
  setMessages: (messages: Message[]) => void
}

export function useSessionHistory(agent: HistoryAgent, sessionId: string) {
  const latestSessionIdRef = useRef(sessionId)

  /* eslint-disable react-hooks/immutability --
     CopilotKit intentionally exposes the agent instance so callers can set
     threadId and messages (e.g., restoring a session from the backend). */
  useEffect(() => {
    latestSessionIdRef.current = sessionId

    // Make sure subsequent runs are tied to this Agno session. This effect
    // runs after CopilotChat's internal effect, so it overwrites the random
    // UUID CopilotChat assigns when no explicit threadId prop is provided.
    agent.threadId = sessionId

    let cancelled = false

    const loadHistory = async () => {
      try {
        const session = await getSession(sessionId)
        if (cancelled) return
        if (latestSessionIdRef.current !== sessionId) return
        const messages = convertAgnoHistory(session.chat_history || [])
        agent.setMessages(messages)
      } catch (error) {
        console.error('Failed to load session history:', error)
      }
    }

    loadHistory()

    return () => {
      cancelled = true
    }
  }, [sessionId, agent])
  /* eslint-enable react-hooks/immutability */
}
