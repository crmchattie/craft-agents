import * as React from 'react'
import { useCallback } from 'react'
import { Mail } from 'lucide-react'
import { MessageDetail } from '@/components/inbox/MessageDetail'
import { useInbox } from '@/hooks/useInbox'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { useNavigationState, isInboxNavigation } from '@/contexts/NavigationContext'
import { navigate, routes } from '@/lib/navigate'

export default function InboxPage() {
  const activeWorkspace = useActiveWorkspace()
  const workspaceId = activeWorkspace?.id ?? null
  const { messages } = useInbox(workspaceId)
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
    if (!selectedMessage || !openNewChat) return
    const prompt = selectedMessage.triage?.suggestedPrompt
      ?? `Help me draft a response to this email:\n\nFrom: ${selectedMessage.from.name}\nSubject: ${selectedMessage.subject ?? '(no subject)'}\n\n${selectedMessage.body.slice(0, 500)}\n\nUse any of your connected sources if they would help provide better context.`
    const name = selectedMessage.triage?.summary
      ?? `Re: ${selectedMessage.subject ?? selectedMessage.from.name}`
    await openNewChat({
      input: prompt,
      name,
      inboxMessageId: selectedMessage.id,
    })
  }, [selectedMessage, openNewChat])

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
        onStartSession={handleStartSession}
      />
    )
  }

  // Empty state — no message selected
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-foreground/40 gap-3">
      <Mail className="h-10 w-10" />
      <p className="text-sm">Select a message to view details</p>
    </div>
  )
}
