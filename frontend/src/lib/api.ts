import type { Message } from '@copilotkit/react-core/v2'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000'

export interface Session {
  session_id: string
  session_name: string
  created_at?: string
  updated_at?: string
}

export interface SessionDetail {
  session_id: string
  session_name: string
  chat_history: Record<string, unknown>[]
  created_at?: string
  updated_at?: string
}

export interface PaginatedSessions {
  data: Session[]
  meta: {
    page: number
    limit: number
    total_pages: number
    total_count: number
  }
}

export async function listSessions(): Promise<Session[]> {
  const res = await fetch(`${API_BASE_URL}/sessions?type=agent`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Failed to list sessions: ${res.status}`)
  }
  const json: PaginatedSessions = await res.json()
  return json.data
}

export async function getSession(sessionId: string): Promise<SessionDetail> {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}?type=agent`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Failed to get session: ${res.status}`)
  }
  return res.json()
}

export async function createSession(name?: string): Promise<Session> {
  const res = await fetch(`${API_BASE_URL}/sessions?type=agent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_name: name || '新会话',
    }),
  })
  if (!res.ok) {
    throw new Error(`Failed to create session: ${res.status}`)
  }
  return res.json()
}

function generateMessageId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function extractTextContent(content: unknown): string {
  if (content === null || content === undefined) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object') {
          if ('text' in part && typeof part.text === 'string') return part.text
        }
        return ''
      })
      .filter(Boolean)
      .join('')
  }
  return String(content)
}

export function convertAgnoHistory(history: Record<string, unknown>[]): Message[] {
  return history
    .map((msg) => {
      const role = msg.role as string
      const id = (msg.id as string) || generateMessageId()
      const content = extractTextContent(msg.content)

      if (role === 'user') {
        return { id, role: 'user' as const, content } as Message
      }
      if (role === 'assistant') {
        const toolCalls = Array.isArray(msg.tool_calls)
          ? msg.tool_calls.map((tc: Record<string, unknown>) => {
              const fn = (tc.function as Record<string, unknown>) || {}
              return {
                id: (tc.id as string) || generateMessageId(),
                type: 'function' as const,
                function: {
                  name: String(fn.name ?? tc.tool_name ?? ''),
                  arguments:
                    typeof fn.arguments === 'string'
                      ? fn.arguments
                      : JSON.stringify(fn.arguments ?? tc.tool_args ?? {}),
                },
              }
            })
          : undefined
        return { id, role: 'assistant' as const, content, toolCalls } as Message
      }
      if (role === 'tool') {
        return {
          id,
          role: 'tool' as const,
          content,
          toolCallId: String(msg.tool_call_id ?? ''),
        } as Message
      }
      if (role === 'system') {
        return { id, role: 'system' as const, content } as Message
      }
      return null
    })
    .filter((m): m is Message => m !== null)
}

export async function deleteSession(sessionId: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/sessions/${sessionId}?type=agent`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    throw new Error(`Failed to delete session: ${res.status}`)
  }
}
