import * as React from 'react'
import { useCallback } from 'react'
import { Inbox } from 'lucide-react'
import { MessageDetail } from '@/components/inbox/MessageDetail'
import { useInbox } from '@/hooks/useInbox'
import { useTasks } from '@/hooks/useTasks'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { useNavigationState, isInboxNavigation } from '@/contexts/NavigationContext'
import { navigate, routes } from '@/lib/navigate'

export default function InboxPage() {
  const activeWorkspace = useActiveWorkspace()
  const workspaceId = activeWorkspace?.id ?? null
  const { messages } = useInbox(workspaceId)
  const { updateTask } = useTasks(workspaceId)
  const { openNewChat } = useAppShellContext()
  const navState = useNavigationState()

  const selectedId = isInboxNavigation(navState) ? navState.details?.messageId ?? null : null

  const selectedMessage = React.useMemo(
    () => messages.find(m => m.id === selectedId) ?? null,
    [messages, selectedId],
  )

  const threadMessages = React.useMemo(() => {
    if (!selectedMessage?.threadId) return []
    return messages
      .filter(m => m.threadId === selectedMessage.threadId && m.id !== selectedMessage.id)
      .sort((a, b) => new Date(a.receivedAt).getTime() - new Date(b.receivedAt).getTime())
  }, [messages, selectedMessage])

  const handleBack = useCallback(() => {
    navigate(routes.view.inbox())
  }, [])

  const handleStartSession = useCallback(async () => {
    if (!selectedMessage?.triage?.suggestedPrompt || !openNewChat) return
    await openNewChat({
      input: selectedMessage.triage.suggestedPrompt,
      name: selectedMessage.triage.summary,
      taskId: `task:msg:${selectedMessage.id}`,
    })
  }, [selectedMessage, openNewChat])

  const handleDismiss = useCallback(async () => {
    if (!selectedMessage) return
    await updateTask(`task:msg:${selectedMessage.id}`, { state: 'cancelled' })
    navigate(routes.view.inbox())
  }, [selectedMessage, updateTask])

  if (selectedMessage) {
    // Mark as read
    if (workspaceId && !selectedMessage.isRead) {
      window.electronAPI.markInboxRead(workspaceId, selectedMessage.id).catch(() => {})
    }

    return (
      <MessageDetail
        message={selectedMessage}
        threadMessages={threadMessages}
        onBack={handleBack}
        onStartSession={selectedMessage.triage?.isActionable ? handleStartSession : undefined}
        onDismiss={selectedMessage.triage?.isActionable ? handleDismiss : undefined}
        onViewTask={selectedMessage.triage?.isActionable ? () => navigate(routes.view.tasks({ taskId: `task:msg:${selectedMessage.id}` })) : undefined}
      />
    )
  }

  // Empty state — no message selected
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-foreground/40 gap-3">
      <Inbox className="h-10 w-10" />
      <p className="text-sm">Select a message to view details</p>
    </div>
  )
}
