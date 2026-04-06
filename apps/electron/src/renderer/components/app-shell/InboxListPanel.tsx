import * as React from 'react'
import { Mail, MessageSquare, Star, Circle } from 'lucide-react'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListBadge } from '@/components/ui/entity-list-badge'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { inboxSelection } from '@/hooks/useEntitySelection'
import type { InboxMessage } from '@craft-agent/core/types'

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)
  if (diffMins < 1) return 'Now'
  if (diffMins < 60) return `${diffMins}m`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' })
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export interface InboxListPanelProps {
  messages: InboxMessage[]
  filter?: string
  selectedMessageId?: string | null
  onMessageClick: (message: InboxMessage) => void
  onRefresh?: () => void
  onAddSource?: () => void
  hasConfiguredSources?: boolean
  className?: string
}

export function InboxListPanel({
  messages,
  filter,
  selectedMessageId,
  onMessageClick,
  onRefresh,
  onAddSource,
  hasConfiguredSources,
  className,
}: InboxListPanelProps) {
  const filteredMessages = React.useMemo(() => {
    let result = messages
    if (filter === 'actionable') {
      result = result.filter(m => m.triage?.isActionable)
    }
    return result.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
  }, [messages, filter])

  return (
    <EntityPanel<InboxMessage>
      items={filteredMessages}
      getId={(m) => m.id}
      selection={inboxSelection}
      selectedId={selectedMessageId}
      onItemClick={onMessageClick}
      className={className}
      emptyState={
        <EntityListEmptyScreen
          icon={<Mail />}
          title={filter === 'actionable' ? 'No actionable messages.' : 'No messages yet.'}
          description="Add an inbox source to start pulling in messages."
        >
          {onAddSource && (
            <button
              onClick={onAddSource}
              className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
            >
              Add Inbox
            </button>
          )}
          {hasConfiguredSources && onRefresh && (
            <button
              onClick={onRefresh}
              className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
            >
              Refresh Inbox
            </button>
          )}
        </EntityListEmptyScreen>
      }
      mapItem={(message) => ({
        icon: (
          <div className="relative">
            {message.sourceType === 'slack'
              ? <MessageSquare className="h-3.5 w-3.5 text-[#4A154B]" />
              : <Mail className="h-3.5 w-3.5 text-blue-500" />}
            {!message.isRead && (
              <Circle className="absolute -bottom-4 left-1/2 -translate-x-1/2 h-[5px] w-[5px] fill-blue-500 text-blue-500" />
            )}
          </div>
        ),
        title: (
          <span className={!message.isRead ? 'font-semibold' : ''}>
            {message.from.name}
            {message.channel ? ` · ${message.channel}` : ''}
          </span>
        ),
        subtitle: message.subject ?? message.body.slice(0, 80),
        badges: message.triage?.isActionable ? (
          <EntityListBadge colorClass="bg-warning/10 text-warning">
            <Star className="h-2.5 w-2.5 fill-current" />
          </EntityListBadge>
        ) : undefined,
        trailing: (
          <span className="text-xs text-foreground/35 shrink-0">
            {formatRelativeTime(message.receivedAt)}
          </span>
        ),
      })}
    />
  )
}
