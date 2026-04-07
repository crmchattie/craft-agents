import * as React from 'react'
import { ArrowLeft, MessageSquare, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Info_Badge } from '@/components/info'
import { TriageCard } from './TriageCard'
import type { InboxMessage } from '@scrunchy/core/types'
import { cn } from '@/lib/utils'

interface MessageDetailProps {
  message: InboxMessage
  threadMessages?: InboxMessage[]
  onBack: () => void
  onStartSession?: () => void
}

function formatDateTime(isoDate: string): string {
  const date = new Date(isoDate)
  return date.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const SourceIcon = ({ type }: { type: string }) => {
  if (type === 'slack') return <MessageSquare className="h-4 w-4 text-[#4A154B]" />
  return <Mail className="h-4 w-4 text-blue-500" />
}

export function MessageDetail({
  message,
  threadMessages,
  onBack,
  onStartSession,
}: MessageDetailProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 -ml-2">
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Button>
        {onStartSession && (
          <Button size="sm" onClick={onStartSession} className="gap-1.5">
            <Mail className="h-3 w-3" />
            Reply with Agent
          </Button>
        )}
      </div>

      <ScrollArea className="flex-1">
        <div className="max-w-[720px] mx-auto px-6 py-6 space-y-6">
          {/* Message header */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <SourceIcon type={message.sourceType} />
              <span className="text-base font-semibold">{message.from.name}</span>
              {message.channel && (
                <span className="text-sm text-foreground/50">{message.channel}</span>
              )}
            </div>
            {message.subject && (
              <h2 className="text-lg font-semibold">{message.subject}</h2>
            )}
            <div className="flex items-center gap-2 text-xs text-foreground/45">
              <span>{formatDateTime(message.receivedAt)}</span>
              <Info_Badge variant="muted">{message.sourceType}</Info_Badge>
            </div>
          </div>

          {/* Message body */}
          <div className="text-sm text-foreground/80 leading-relaxed whitespace-pre-wrap">
            {message.body}
          </div>

          {/* Attachments */}
          {message.attachments && message.attachments.length > 0 && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-foreground/50">Attachments</div>
              {message.attachments.map((att, i) => (
                <div key={i} className="text-xs text-foreground/60 px-2 py-1 bg-foreground/[0.03] rounded">
                  {att.name} {att.size ? `(${Math.round(att.size / 1024)}KB)` : ''}
                </div>
              ))}
            </div>
          )}

          {/* Thread replies */}
          {threadMessages && threadMessages.length > 0 && (
            <div className="space-y-3">
              <div className="text-xs font-medium text-foreground/50">
                Thread ({threadMessages.length} replies)
              </div>
              {threadMessages.map((reply) => (
                <div
                  key={reply.id}
                  className="rounded-[8px] border border-border/40 p-3 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{reply.from.name}</span>
                    <span className="text-xs text-foreground/40">
                      {formatDateTime(reply.receivedAt)}
                    </span>
                  </div>
                  <p className="text-sm text-foreground/70 whitespace-pre-wrap">{reply.body}</p>
                </div>
              ))}
            </div>
          )}

          {/* Triage card (shown when auto-triage has run) */}
          {message.triage && (
            <TriageCard
              triage={message.triage}
              onStartSession={onStartSession}
            />
          )}

        </div>
      </ScrollArea>
    </div>
  )
}
