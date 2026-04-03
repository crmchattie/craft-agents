import * as React from 'react'
import { useCallback, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { MessageList } from '@/components/inbox/MessageList'
import { MessageDetail } from '@/components/inbox/MessageDetail'
import { useInbox } from '@/hooks/useInbox'
import { useTasks } from '@/hooks/useTasks'
import { selectedMessageIdAtom } from '@/atoms/inbox-atoms'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { routes, navigate } from '@/lib/navigate'

export default function InboxPage() {
  const activeWorkspace = useActiveWorkspace()
  const workspaceId = activeWorkspace?.id ?? null
  const { messages, isLoading, isSyncing, refresh } = useInbox(workspaceId)
  const { startSession, updateTask } = useTasks(workspaceId)
  const { openNewChat } = useAppShellContext()

  const selectedId = useAtomValue(selectedMessageIdAtom)
  const setSelectedId = useSetAtom(selectedMessageIdAtom)

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

  const handleSelect = useCallback((messageId: string) => {
    setSelectedId(messageId)
    // Mark as read
    if (workspaceId) {
      window.electronAPI.markInboxRead(workspaceId, messageId).catch(() => {})
    }
  }, [setSelectedId, workspaceId])

  const handleBack = useCallback(() => {
    setSelectedId(null)
  }, [setSelectedId])

  const handleStartSession = useCallback(async () => {
    if (!selectedMessage?.triage?.suggestedPrompt || !openNewChat) return
    await openNewChat({
      input: selectedMessage.triage.suggestedPrompt,
      name: selectedMessage.triage.summary,
      taskId: `task:msg:${selectedMessage.id}`,
    })
  }, [selectedMessage, openNewChat])

  const handleDismiss = useCallback(async () => {
    if (!selectedMessage || !workspaceId) return
    await updateTask(`task:msg:${selectedMessage.id}`, { state: 'cancelled' })
    setSelectedId(null)
  }, [selectedMessage, workspaceId, updateTask, setSelectedId])

  if (selectedMessage) {
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

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Inbox"
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={refresh}
            disabled={isSyncing}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-foreground/40">
          Loading messages...
        </div>
      ) : (
        <MessageList messages={messages} onSelect={handleSelect} />
      )}
    </div>
  )
}
