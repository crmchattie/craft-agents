import * as React from 'react'
import {
  ArrowLeft,
  MapPin,
  Clock,
  Users,
  Bot,
  Video,
  Play,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Info_Badge } from '@/components/info'
import type { CalendarEvent } from '@craft-agent/core/types'
import { format } from 'date-fns'

interface EventDetailProps {
  event: CalendarEvent
  onBack: () => void
  onStartSession?: () => void
}

const STATUS_VARIANTS: Record<string, 'success' | 'warning' | 'muted'> = {
  accepted: 'success',
  tentative: 'warning',
  declined: 'muted',
}

export function EventDetail({ event, onBack, onStartSession }: EventDetailProps) {
  const startDate = new Date(event.startTime)
  const endDate = new Date(event.endTime)
  const color = event.calendarColor ?? '#3b82f6'

  const timeLabel = event.allDay
    ? 'All day'
    : `${format(startDate, 'h:mm a')} – ${format(endDate, 'h:mm a')}`
  const dateLabel = format(startDate, 'EEEE, MMMM d, yyyy')

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border/40">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 -ml-2">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="max-w-[720px] mx-auto px-6 py-6 space-y-5">
          {/* Title + calendar */}
          <div>
            <h1 className="text-xl font-bold leading-snug">{event.title}</h1>
            <div className="flex items-center gap-2 mt-1.5">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-sm text-foreground/50">{event.calendarName}</span>
            </div>
          </div>

          {/* Date & time */}
          <div className="flex items-center gap-2 text-sm text-foreground/70">
            <Clock className="h-4 w-4 text-foreground/40" />
            <span>{dateLabel}</span>
            <span className="text-foreground/35">·</span>
            <span>{timeLabel}</span>
          </div>

          {/* Location */}
          {event.location && (
            <div className="flex items-center gap-2 text-sm text-foreground/70">
              <MapPin className="h-4 w-4 text-foreground/40" />
              <span>{event.location}</span>
            </div>
          )}

          {/* Meeting link */}
          {event.meetingUrl && (
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => window.electronAPI.openUrl(event.meetingUrl!)}
                className="gap-1.5"
              >
                <Video className="h-3.5 w-3.5" />
                Join Meeting
              </Button>
            </div>
          )}

          {/* Attendees */}
          {event.attendees && event.attendees.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-foreground/50">
                <Users className="h-3.5 w-3.5" />
                Attendees ({event.attendees.length})
              </div>
              <div className="space-y-1.5">
                {event.organizer && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-foreground/70">{event.organizer.name}</span>
                    <Info_Badge variant="muted">organizer</Info_Badge>
                  </div>
                )}
                {event.attendees.map((attendee, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm">
                    <span className="text-foreground/70">{attendee.name || attendee.email}</span>
                    <Info_Badge variant={STATUS_VARIANTS[attendee.status] ?? 'muted'}>
                      {attendee.status}
                    </Info_Badge>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {event.description && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-foreground/50">Description</div>
              <p className="text-sm text-foreground/70 whitespace-pre-wrap">{event.description}</p>
            </div>
          )}

          {/* Triage prep */}
          {event.triage?.needsPrep && (
            <div className="rounded-[8px] border border-border/60 bg-foreground/[0.02] p-4 space-y-2">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-warning" />
                <span className="text-sm font-medium">Meeting Prep</span>
              </div>
              <p className="text-sm text-foreground/70">{event.triage.summary}</p>
              {event.triage.suggestedPrepPrompt && (
                <div className="rounded-[6px] bg-foreground/[0.04] border border-border/40 p-3">
                  <div className="text-xs text-foreground/45 mb-1">Prep prompt</div>
                  <p className="text-sm text-foreground/80 whitespace-pre-wrap">
                    {event.triage.suggestedPrepPrompt}
                  </p>
                </div>
              )}
              {onStartSession && (
                <Button size="sm" onClick={onStartSession} className="gap-1.5">
                  <Play className="h-3 w-3" />
                  Start Session
                </Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
