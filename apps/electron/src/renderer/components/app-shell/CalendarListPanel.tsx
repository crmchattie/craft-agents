import * as React from 'react'
import { Calendar, Bot } from 'lucide-react'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListBadge } from '@/components/ui/entity-list-badge'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { calendarSelection } from '@/hooks/useEntitySelection'
import type { CalendarEvent } from '@craft-agent/core/types'
import { format } from 'date-fns'

export interface CalendarListPanelProps {
  events: CalendarEvent[]
  selectedEventId?: string | null
  onEventClick: (event: CalendarEvent) => void
  className?: string
}

export function CalendarListPanel({
  events,
  selectedEventId,
  onEventClick,
  className,
}: CalendarListPanelProps) {
  const sortedEvents = React.useMemo(() => {
    return [...events].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  }, [events])

  return (
    <EntityPanel<CalendarEvent>
      items={sortedEvents}
      getId={(e) => e.id}
      selection={calendarSelection}
      selectedId={selectedEventId}
      onItemClick={onEventClick}
      className={className}
      emptyState={
        <EntityListEmptyScreen
          icon={<Calendar />}
          title="No events."
          description="Connect a calendar source and hit refresh to pull in events."
        />
      }
      mapItem={(event) => {
        const startDate = new Date(event.startTime)
        const color = event.calendarColor ?? '#3b82f6'
        const timeLabel = event.allDay
          ? 'All day'
          : format(startDate, 'h:mm a')

        return {
          icon: (
            <div className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
          ),
          title: event.title,
          badges: (
            <>
              {event.triage?.needsPrep && (
                <EntityListBadge colorClass="bg-warning/10 text-warning">
                  <Bot className="h-2.5 w-2.5" />
                </EntityListBadge>
              )}
              {event.location && (
                <span className="truncate text-foreground/40">{event.location}</span>
              )}
            </>
          ),
          trailing: (
            <span className="text-xs text-foreground/35 shrink-0">{timeLabel}</span>
          ),
        }
      }}
    />
  )
}
