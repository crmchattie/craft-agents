import { useState, useCallback, useEffect } from 'react'
import { useSetAtom } from 'jotai'
import type { InboxMessage } from '@craft-agent/core/types'
import { inboxMessagesAtom, inboxSyncingAtom } from '@/atoms/inbox-atoms'

export interface UseInboxResult {
  messages: InboxMessage[]
  isLoading: boolean
  isSyncing: boolean
  refresh: () => Promise<void>
}

export function useInbox(workspaceId: string | null): UseInboxResult {
  const [messages, setMessages] = useState<InboxMessage[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const setMessagesAtom = useSetAtom(inboxMessagesAtom)
  const setSyncingAtom = useSetAtom(inboxSyncingAtom)

  const load = useCallback(async () => {
    if (!workspaceId) {
      setMessages([])
      setIsLoading(false)
      return
    }
    try {
      setIsLoading(true)
      const msgs = await window.electronAPI.getInboxMessages(workspaceId)
      setMessages(msgs)
    } catch {
      setMessages([])
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  // Sync to Jotai atom
  useEffect(() => {
    setMessagesAtom(messages)
  }, [messages, setMessagesAtom])

  // Load on workspace change
  useEffect(() => {
    load()
  }, [load])

  // Subscribe to live changes
  useEffect(() => {
    if (!workspaceId) return
    const cleanup = window.electronAPI.onInboxChanged(() => {
      load()
    })
    return cleanup
  }, [workspaceId, load])

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    setIsSyncing(true)
    setSyncingAtom(true)
    try {
      await window.electronAPI.syncInbox(workspaceId)
      await load()
    } finally {
      setIsSyncing(false)
      setSyncingAtom(false)
    }
  }, [workspaceId, load, setSyncingAtom])

  return { messages, isLoading, isSyncing, refresh }
}
