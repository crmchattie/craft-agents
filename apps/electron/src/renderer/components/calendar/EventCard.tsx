import * as React from 'react'
import { Bot } from 'lucide-react'
import type { CalendarEvent } from '@scrunchy/core/types'
import { format } from 'date-fns'
import { cn } from '@/lib/utils'

interface EventCardProps {
  event: CalendarEvent
  onClick: () => void
  variant?: 'block' | 'pill'
}

export function EventCard({ event, onClick, variant = 'block' }: EventCardProps) {
  const startDate = new Date(event.startTime)
  const endDate = new Date(event.endTime)
  const timeLabel = `${format(startDate, 'h:mm a')} – ${format(endDate, 'h:mm a')}`
  const color = event.calendarColor ?? '#3b82f6'

  if (variant === 'pill') {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClick() }}
        className="w-full text-left truncate rounded-[3px] px-1.5 py-0.5 text-[10px] font-medium leading-tight hover:opacity-80 transition-opacity"
        style={{ backgroundColor: `${color}20`, color }}
        title={`${event.title} (${timeLabel})`}
      >
        {event.title}
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left rounded-[4px] px-2 py-1.5 hover:opacity-90 transition-opacity overflow-hidden"
      style={{ backgroundColor: `${color}18`, borderLeft: `3px solid ${color}` }}
    >
      <div className="flex items-center gap-1">
        <span className="text-xs font-medium truncate flex-1" style={{ color }}>
          {event.title}
        </span>
        {event.triage?.needsPrep && (
          <Bot className="h-3 w-3 text-warning shrink-0" />
        )}
      </div>
      <div className="text-[10px] text-foreground/45 mt-0.5">
        {event.allDay ? 'All day' : timeLabel}
      </div>
    </button>
  )
}

/** Calculate position and height for an event in a time grid */
export function getEventPosition(event: CalendarEvent, startHour: number, hourHeight: number) {
  const start = new Date(event.startTime)
  const end = new Date(event.endTime)
  const startMinutes = start.getHours() * 60 + start.getMinutes()
  const endMinutes = end.getHours() * 60 + end.getMinutes()
  const durationMinutes = Math.max(endMinutes - startMinutes, 15)

  const top = ((startMinutes - startHour * 60) / 60) * hourHeight
  const height = (durationMinutes / 60) * hourHeight

  return { top: Math.max(top, 0), height: Math.max(height, hourHeight * 0.25) }
}
