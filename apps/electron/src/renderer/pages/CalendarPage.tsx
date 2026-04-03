import * as React from 'react'
import { useCallback, useState } from 'react'
import { useAtom } from 'jotai'
import { CalendarHeader } from '@/components/calendar/CalendarHeader'
import { WeekView } from '@/components/calendar/WeekView'
import { DayView } from '@/components/calendar/DayView'
import { MonthView } from '@/components/calendar/MonthView'
import { EventDetail } from '@/components/calendar/EventDetail'
import { useCalendar } from '@/hooks/useCalendar'
import { calendarViewAtom, calendarSelectedDateAtom } from '@/atoms/calendar-atoms'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import type { CalendarEvent } from '@craft-agent/core/types'

export default function CalendarPage() {
  const activeWorkspace = useActiveWorkspace()
  const workspaceId = activeWorkspace?.id ?? null
  const { events, isLoading, isSyncing, refresh } = useCalendar(workspaceId)
  const { openNewChat } = useAppShellContext()

  const [view] = useAtom(calendarViewAtom)
  const [selectedDate, setSelectedDate] = useAtom(calendarSelectedDateAtom)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)

  const date = React.useMemo(() => new Date(selectedDate), [selectedDate])

  const handleSelectEvent = useCallback((event: CalendarEvent) => {
    setSelectedEvent(event)
  }, [])

  const handleBack = useCallback(() => {
    setSelectedEvent(null)
  }, [])

  const handleSelectDay = useCallback((day: Date) => {
    setSelectedDate(day.toISOString().slice(0, 10))
    // Switch to day view when clicking a day in month view
    // (calendarViewAtom is read-only here; the header controls it)
  }, [setSelectedDate])

  const handleStartSession = useCallback(async () => {
    if (!selectedEvent?.triage?.suggestedPrepPrompt || !openNewChat) return
    await openNewChat({
      input: selectedEvent.triage.suggestedPrepPrompt,
      name: `Prep: ${selectedEvent.title}`,
      calendarEventId: selectedEvent.id,
    })
  }, [selectedEvent, openNewChat])

  if (selectedEvent) {
    return (
      <EventDetail
        event={selectedEvent}
        onBack={handleBack}
        onStartSession={selectedEvent.triage?.needsPrep ? handleStartSession : undefined}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      <CalendarHeader isSyncing={isSyncing} onRefresh={refresh} />

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-foreground/40">
          Loading calendar...
        </div>
      ) : (
        <>
          {view === 'week' && (
            <WeekView date={date} events={events} onSelectEvent={handleSelectEvent} />
          )}
          {view === 'day' && (
            <DayView date={date} events={events} onSelectEvent={handleSelectEvent} />
          )}
          {view === 'month' && (
            <MonthView
              date={date}
              events={events}
              onSelectEvent={handleSelectEvent}
              onSelectDay={handleSelectDay}
            />
          )}
        </>
      )}
    </div>
  )
}
