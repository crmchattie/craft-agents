import * as React from 'react'
import { useCallback } from 'react'
import { useAtom } from 'jotai'
import { CalendarHeader } from '@/components/calendar/CalendarHeader'
import { WeekView } from '@/components/calendar/WeekView'
import { DayView } from '@/components/calendar/DayView'
import { MonthView } from '@/components/calendar/MonthView'
import { EventDetail } from '@/components/calendar/EventDetail'
import { useCalendar } from '@/hooks/useCalendar'
import { calendarViewAtom, calendarSelectedDateAtom } from '@/atoms/calendar-atoms'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { useNavigationState, isCalendarNavigation } from '@/contexts/NavigationContext'
import { navigate, routes } from '@/lib/navigate'
import type { CalendarEvent } from '@craft-agent/core/types'

export default function CalendarPage() {
  const activeWorkspace = useActiveWorkspace()
  const workspaceId = activeWorkspace?.id ?? null
  const { events, isLoading, isSyncing, refresh } = useCalendar(workspaceId)
  const { openNewChat } = useAppShellContext()
  const navState = useNavigationState()

  const [view] = useAtom(calendarViewAtom)
  const [selectedDate, setSelectedDate] = useAtom(calendarSelectedDateAtom)

  // Selected event from navigation state (list panel click) or calendar view click
  const selectedEventId = isCalendarNavigation(navState) ? navState.details?.eventId ?? null : null
  const selectedEvent = React.useMemo(
    () => events.find(e => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  )

  // Reset to today when calendar page mounts (prevents showing stale date from previous session)
  React.useEffect(() => {
    const d = new Date()
    setSelectedDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }, [setSelectedDate])

  // Parse as local midnight (not UTC) — `new Date("2026-04-06")` is UTC which shifts the day in negative-offset timezones
  const date = React.useMemo(() => new Date(selectedDate + 'T00:00:00'), [selectedDate])

  const handleSelectEvent = useCallback((event: CalendarEvent) => {
    navigate(routes.view.calendar({ eventId: event.id }))
  }, [])

  const handleBack = useCallback(() => {
    navigate(routes.view.calendar())
  }, [])

  const handleSelectDay = useCallback((day: Date) => {
    setSelectedDate(day.toISOString().slice(0, 10))
    // Switch to day view when clicking a day in month view
    // (calendarViewAtom is read-only here; the header controls it)
  }, [setSelectedDate])

  const handleStartSession = useCallback(async () => {
    if (!selectedEvent || !openNewChat) return
    const startDate = new Date(selectedEvent.startTime)
    const dateStr = startDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    const prompt = selectedEvent.triage?.suggestedPrepPrompt
      ?? `Help me prepare for this meeting:\n\nTitle: ${selectedEvent.title}\nWhen: ${dateStr}\n${selectedEvent.description ? `Description: ${selectedEvent.description.slice(0, 500)}` : ''}\n${selectedEvent.attendees?.length ? `Attendees: ${selectedEvent.attendees.map(a => a.name || a.email).join(', ')}` : ''}\n\nUse any of your connected sources if they would help provide better context.`
    await openNewChat({
      input: prompt,
      name: `Prep: ${selectedEvent.title}`,
      calendarEventId: selectedEvent.id,
    })
  }, [selectedEvent, openNewChat])

  if (selectedEvent) {
    return (
      <EventDetail
        event={selectedEvent}
        onBack={handleBack}
        onStartSession={handleStartSession}
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
