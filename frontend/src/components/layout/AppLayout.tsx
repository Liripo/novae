import { useParams } from 'react-router-dom'

import { CopilotChat, useAgent } from '@copilotkit/react-core/v2'

import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useSessionHistory } from '@/hooks/useSessionHistory'
import { ChatSidebar } from './ChatSidebar'

interface SessionChatProps {
  sessionId: string
}

function SessionChat({ sessionId }: SessionChatProps) {
  const { agent } = useAgent({ agentId: 'default' })
  useSessionHistory(agent, sessionId)

  return (
    <CopilotChat
      className="h-full"
      labels={{
        welcomeMessageText:
          'Hi! I am Novae, your coding assistant. Ask me to write, explain, or refactor code.',
      }}
    />
  )
}

export function AppLayout() {
  const { sessionId } = useParams<{ sessionId?: string }>()

  return (
    <SidebarProvider>
      <ChatSidebar activeSessionId={sessionId} />
      <SidebarInset className="flex flex-col">
        <header className="flex h-14 shrink-0 items-center border-b px-6">
          <h1 className="text-lg font-semibold">Novae</h1>
        </header>
        <div className="min-h-0 flex-1 p-4">
          <div className="flex h-full flex-col overflow-hidden rounded-lg border bg-card shadow-sm">
            {sessionId ? (
              <SessionChat sessionId={sessionId} />
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-muted-foreground">
                <p className="text-lg font-medium">Select or create a session</p>
                <p className="text-sm">Choose a conversation from the sidebar to get started.</p>
              </div>
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}
