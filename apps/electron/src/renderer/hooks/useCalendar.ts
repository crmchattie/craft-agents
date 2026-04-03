import { useState, useCallback, useEffect } from 'react'
import { useSetAtom } from 'jotai'
import type { CalendarEvent } from '@craft-agent/core/types'
import { calendarEventsAtom, calendarSyncingAtom } from '@/atoms/calendar-atoms'

export interface UseCalendarResult {
  events: CalendarEvent[]
  isLoading: boolean
  isSyncing: boolean
  refresh: () => Promise<void>
}

export function useCalendar(workspaceId: string | null): UseCalendarResult {
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isSyncing, setIsSyncing] = useState(false)
  const setEventsAtom = useSetAtom(calendarEventsAtom)
  const setSyncingAtom = useSetAtom(calendarSyncingAtom)

  const load = useCallback(async () => {
    if (!workspaceId) {
      setEvents([])
      setIsLoading(false)
      return
    }
    try {
      setIsLoading(true)
      const loaded = await window.electronAPI.getCalendarEvents(workspaceId)
      setEvents(loaded)
    } catch {
      setEvents([])
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  // Sync to Jotai atom
  useEffect(() => {
    setEventsAtom(events)
  }, [events, setEventsAtom])

  // Load on workspace change
  useEffect(() => {
    load()
  }, [load])

  // Subscribe to live changes
  useEffect(() => {
    if (!workspaceId) return
    const cleanup = window.electronAPI.onCalendarChanged(() => {
      load()
    })
    return cleanup
  }, [workspaceId, load])

  const refresh = useCallback(async () => {
    if (!workspaceId) return
    setIsSyncing(true)
    setSyncingAtom(true)
    try {
      await window.electronAPI.syncCalendar(workspaceId)
      await load()
    } finally {
      setIsSyncing(false)
      setSyncingAtom(false)
    }
  }, [workspaceId, load, setSyncingAtom])

  return { events, isLoading, isSyncing, refresh }
}
