import * as React from 'react'
import { CalendarDays, Bot } from 'lucide-react'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListBadge } from '@/components/ui/entity-list-badge'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { calendarSelection } from '@/hooks/useEntitySelection'
import type { CalendarEvent } from '@scrunchy/core/types'
import { format, isToday, isTomorrow, isYesterday } from 'date-fns'

export interface CalendarListPanelProps {
  events: CalendarEvent[]
  selectedEventId?: string | null
  onEventClick: (event: CalendarEvent) => void
  onRefresh?: () => void
  onAddSource?: () => void
  hasConfiguredSources?: boolean
  className?: string
}

export function CalendarListPanel({
  events,
  selectedEventId,
  onEventClick,
  onRefresh,
  onAddSource,
  hasConfiguredSources,
  className,
}: CalendarListPanelProps) {
  const sortedEvents = React.useMemo(() => {
    return [...events].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
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
          icon={<CalendarDays />}
          title="No events."
          description="Add a calendar source to start pulling in events."
        >
          {onAddSource && (
            <button
              onClick={onAddSource}
              className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
            >
              Add Calendar
            </button>
          )}
          {hasConfiguredSources && onRefresh && (
            <button
              onClick={onRefresh}
              className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
            >
              Refresh Calendar
            </button>
          )}
        </EntityListEmptyScreen>
      }
      mapItem={(event) => {
        const startDate = new Date(event.startTime)
        const color = event.calendarColor ?? '#3b82f6'

        // Date prefix: "Today", "Tomorrow", "Mon, Apr 7", etc.
        let datePrefix: string
        if (isToday(startDate)) datePrefix = 'Today'
        else if (isTomorrow(startDate)) datePrefix = 'Tomorrow'
        else if (isYesterday(startDate)) datePrefix = 'Yesterday'
        else datePrefix = format(startDate, 'EEE, MMM d')

        // Time label with date context
        let timeLabel: string
        if (event.allDay) {
          timeLabel = `${datePrefix} · All day`
        } else {
          timeLabel = `${datePrefix} · ${format(startDate, 'h:mm a')}`
        }

        return {
          icon: (
            <CalendarDays className="h-3.5 w-3.5" style={{ color }} />
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
