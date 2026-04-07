import * as React from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { EventCard, getEventPosition } from './EventCard'
import type { CalendarEvent } from '@scrunchy/core/types'
import { isSameDay, isToday, format, getHours, getMinutes } from 'date-fns'
import { cn } from '@/lib/utils'

interface DayViewProps {
  date: Date
  events: CalendarEvent[]
  onSelectEvent: (event: CalendarEvent) => void
}

const START_HOUR = 6
const END_HOUR = 22
const HOUR_HEIGHT = 60
const HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)

export function DayView({ date, events, onSelectEvent }: DayViewProps) {
  const dayEvents = events.filter(e => isSameDay(new Date(e.startTime), date))

  const now = new Date()
  const currentMinutes = getHours(now) * 60 + getMinutes(now)
  const showTimeLine = isToday(date) && currentMinutes >= START_HOUR * 60 && currentMinutes <= END_HOUR * 60
  const currentTimeTop = ((currentMinutes - START_HOUR * 60) / 60) * HOUR_HEIGHT

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Day header */}
      <div className="flex border-b border-border/40 shrink-0">
        <div className="w-16 shrink-0" />
        <div className={cn('flex-1 text-center py-2', isToday(date) && 'bg-info/5')}>
          <div className="text-xs text-foreground/45">{format(date, 'EEEE')}</div>
          <div className={cn('text-lg font-semibold', isToday(date) && 'text-info')}>
            {format(date, 'MMMM d, yyyy')}
          </div>
        </div>
      </div>

      {/* Scrollable time grid */}
      <ScrollArea className="flex-1">
        <div className="flex" style={{ height: HOURS.length * HOUR_HEIGHT }}>
          {/* Time gutter */}
          <div className="w-16 shrink-0 relative">
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute right-2 text-[10px] text-foreground/35 -translate-y-1/2"
                style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }}
              >
                {format(new Date(2000, 0, 1, hour), 'h a')}
              </div>
            ))}
          </div>

          {/* Single day column */}
          <div className={cn('flex-1 relative', isToday(date) && 'bg-info/[0.02]')}>
            {/* Hour grid lines */}
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="absolute w-full border-t border-border/15"
                style={{ top: (hour - START_HOUR) * HOUR_HEIGHT }}
              />
            ))}

            {/* Events */}
            {dayEvents.filter(e => !e.allDay).map((event) => {
              const pos = getEventPosition(event, START_HOUR, HOUR_HEIGHT)
              return (
                <div
                  key={event.id}
                  className="absolute left-1 right-1 z-10"
                  style={{ top: pos.top, height: pos.height }}
                >
                  <EventCard event={event} onClick={() => onSelectEvent(event)} />
                </div>
              )
            })}

            {/* Current time line */}
            {showTimeLine && (
              <div
                className="absolute left-0 right-0 z-20 border-t-2 border-destructive"
                style={{ top: currentTimeTop }}
              >
                <div className="absolute -left-1 -top-1.5 w-3 h-3 rounded-full bg-destructive" />
              </div>
            )}
          </div>
        </div>
      </ScrollArea>
    </div>
  )
}
