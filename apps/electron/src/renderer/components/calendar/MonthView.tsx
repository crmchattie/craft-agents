import * as React from 'react'
import { EventCard } from './EventCard'
import type { CalendarEvent } from '@craft-agent/core/types'
import {
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  isSameDay,
  isSameMonth,
  isToday,
  format,
} from 'date-fns'
import { cn } from '@/lib/utils'

interface MonthViewProps {
  date: Date
  events: CalendarEvent[]
  onSelectEvent: (event: CalendarEvent) => void
  onSelectDay: (date: Date) => void
}

const MAX_EVENTS_PER_CELL = 3
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getCalendarDays(date: Date): Date[] {
  const monthStart = startOfMonth(date)
  const monthEnd = endOfMonth(date)
  const calStart = startOfWeek(monthStart, { weekStartsOn: 1 })
  const calEnd = endOfWeek(monthEnd, { weekStartsOn: 1 })

  const days: Date[] = []
  let current = calStart
  while (current <= calEnd) {
    days.push(current)
    current = addDays(current, 1)
  }
  return days
}

export function MonthView({ date, events, onSelectEvent, onSelectDay }: MonthViewProps) {
  const calendarDays = React.useMemo(() => getCalendarDays(date), [date])
  const weeks = React.useMemo(() => {
    const result: Date[][] = []
    for (let i = 0; i < calendarDays.length; i += 7) {
      result.push(calendarDays.slice(i, i + 7))
    }
    return result
  }, [calendarDays])

  const eventsByDay = React.useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const event of events) {
      const key = format(new Date(event.startTime), 'yyyy-MM-dd')
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(event)
    }
    return map
  }, [events])

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Day name header */}
      <div className="grid grid-cols-7 border-b border-border/40 shrink-0">
        {DAY_NAMES.map((name) => (
          <div key={name} className="text-center py-2 text-xs font-medium text-foreground/45">
            {name}
          </div>
        ))}
      </div>

      {/* Week rows */}
      <div className="flex-1 grid auto-rows-fr">
        {weeks.map((week, weekIdx) => (
          <div key={weekIdx} className="grid grid-cols-7 border-b border-border/15">
            {week.map((day) => {
              const dayKey = format(day, 'yyyy-MM-dd')
              const dayEvents = eventsByDay.get(dayKey) ?? []
              const visibleEvents = dayEvents.slice(0, MAX_EVENTS_PER_CELL)
              const overflowCount = dayEvents.length - MAX_EVENTS_PER_CELL
              const inMonth = isSameMonth(day, date)

              return (
                <button
                  key={dayKey}
                  type="button"
                  onClick={() => onSelectDay(day)}
                  className={cn(
                    'text-left p-1.5 border-l border-border/15 transition-colors hover:bg-foreground/[0.02] min-h-[80px]',
                    !inMonth && 'opacity-40',
                  )}
                >
                  {/* Day number */}
                  <div className={cn(
                    'text-xs font-medium mb-1',
                    isToday(day) && 'text-info',
                    isToday(day) && 'inline-flex items-center justify-center w-6 h-6 rounded-full bg-info text-white',
                  )}>
                    {format(day, 'd')}
                  </div>

                  {/* Event pills */}
                  <div className="space-y-0.5">
                    {visibleEvents.map((event) => (
                      <EventCard
                        key={event.id}
                        event={event}
                        variant="pill"
                        onClick={() => onSelectEvent(event)}
                      />
                    ))}
                    {overflowCount > 0 && (
                      <div className="text-[10px] text-foreground/40 px-1">
                        +{overflowCount} more
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
