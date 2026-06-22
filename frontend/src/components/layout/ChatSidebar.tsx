import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { createSession, deleteSession, listSessions, type Session } from '@/lib/api'

interface ChatSidebarProps {
  activeSessionId: string | undefined
}

export function ChatSidebar({ activeSessionId }: ChatSidebarProps) {
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(false)
  const loadedRef = useRef(false)

  useEffect(() => {
    if (loadedRef.current) return
    loadedRef.current = true

    const loadSessions = async () => {
      setLoading(true)
      try {
        const data = await listSessions()
        setSessions(data)
      } catch (err) {
        console.error('Failed to load sessions:', err)
      } finally {
        setLoading(false)
      }
    }

    void loadSessions()
  }, [])

  const handleNewSession = async () => {
    try {
      const session = await createSession()
      setSessions((prev) => [session, ...prev])
      navigate(`/chat/${session.session_id}`)
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }

  const handleSelectSession = (sessionId: string) => {
    navigate(`/chat/${sessionId}`)
  }

  const handleDelete = async (
    e: React.MouseEvent<HTMLButtonElement>,
    sessionId: string,
  ) => {
    e.stopPropagation()
    try {
      await deleteSession(sessionId)
      const remaining = sessions.filter((s) => s.session_id !== sessionId)
      setSessions(remaining)
      if (activeSessionId === sessionId) {
        if (remaining.length > 0) {
          navigate(`/chat/${remaining[0].session_id}`)
        } else {
          navigate('/')
        }
      }
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" onClick={handleNewSession}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Plus className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">新建会话</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>历史会话</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {loading && sessions.length === 0 ? (
                <SidebarMenuItem>
                  <SidebarMenuButton disabled>
                    <span>加载中...</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ) : (
                sessions.map((session) => (
                  <SidebarMenuItem key={session.session_id}>
                    <SidebarMenuButton
                      isActive={session.session_id === activeSessionId}
                      onClick={() => handleSelectSession(session.session_id)}
                      className="group"
                    >
                      <span className="flex-1 truncate">
                        {session.session_name}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 opacity-0 group-hover:opacity-100"
                        onClick={(e) => handleDelete(e, session.session_id)}
                      >
                        <Trash2 className="size-3" />
                      </Button>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="sm" disabled>
              <span className="truncate text-xs text-muted-foreground">
                Novae Coding Assistant
              </span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
