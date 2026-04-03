import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { MessageSquare, Mail, Star, Circle } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { inboxFilterAtom, selectedMessageIdAtom } from '@/atoms/inbox-atoms'
import type { InboxMessage } from '@craft-agent/core/types'
import { cn } from '@/lib/utils'

interface MessageListProps {
  messages: InboxMessage[]
  onSelect: (messageId: string) => void
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60_000)

  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'Yesterday'
  if (diffDays < 7) return date.toLocaleDateString([], { weekday: 'short' })
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const SourceIcon = ({ type }: { type: string }) => {
  if (type === 'slack') return <MessageSquare className="h-3.5 w-3.5 text-[#4A154B]" />
  return <Mail className="h-3.5 w-3.5 text-blue-500" />
}

export function MessageList({ messages, onSelect }: MessageListProps) {
  const filter = useAtomValue(inboxFilterAtom)
  const selectedId = useAtomValue(selectedMessageIdAtom)

  const filtered = React.useMemo(() => {
    let result = messages
    if (filter.view === 'actionable') {
      result = result.filter(m => m.triage?.isActionable)
    }
    if (filter.source) {
      result = result.filter(m => m.sourceSlug === filter.source)
    }
    if (filter.channel) {
      result = result.filter(m => m.channel === filter.channel)
    }
    return result.sort((a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime())
  }, [messages, filter])

  if (filtered.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-foreground/40 p-8">
        {messages.length === 0
          ? 'No messages yet. Connect an inbox source and hit refresh.'
          : 'No messages match this filter.'}
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="py-1">
        {filtered.map((message) => (
          <MessageRow
            key={message.id}
            message={message}
            isSelected={selectedId === message.id}
            onSelect={() => onSelect(message.id)}
          />
        ))}
      </div>
    </ScrollArea>
  )
}

function MessageRow({
  message,
  isSelected,
  onSelect,
}: {
  message: InboxMessage
  isSelected: boolean
  onSelect: () => void
}) {
  const title = message.from.name + (message.channel ? ` \u00b7 ${message.channel}` : '')
  const subtitle = message.subject ?? message.body.slice(0, 80)

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full text-left px-4 py-3 transition-colors border-b border-border/30',
        isSelected ? 'bg-foreground/5' : 'hover:bg-foreground/[0.02]',
      )}
    >
      <div className="flex items-start gap-3">
        {/* Unread indicator */}
        <div className="mt-1.5 shrink-0">
          {!message.isRead ? (
            <Circle className="h-2.5 w-2.5 fill-info text-info" />
          ) : (
            <div className="h-2.5 w-2.5" />
          )}
        </div>

        {/* Source icon */}
        <div className="mt-0.5 shrink-0">
          <SourceIcon type={message.sourceType} />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className={cn('text-sm truncate', !message.isRead && 'font-semibold')}>
              {title}
            </span>
            <span className="text-xs text-foreground/40 shrink-0">
              {formatRelativeTime(message.receivedAt)}
            </span>
          </div>
          <p className="text-xs text-foreground/55 truncate mt-0.5">{subtitle}</p>
          {message.triage?.isActionable && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <Star className="h-3 w-3 text-warning fill-warning" />
              <span className="text-xs text-warning">{message.triage.summary}</span>
            </div>
          )}
        </div>
      </div>
    </button>
  )
}
