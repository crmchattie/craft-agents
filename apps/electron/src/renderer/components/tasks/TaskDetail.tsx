import * as React from 'react'
import {
  ArrowLeft,
  Circle,
  CheckCircle2,
  Clock,
  XCircle,
  Play,
  Check,
  Trash2,
  ExternalLink,
  MessageSquare,
  Mail,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Info_Badge } from '@/components/info'
import type { Task, TaskState, InboxMessage } from '@scrunchy/core/types'
import { cn } from '@/lib/utils'
import { navigate, routes } from '@/lib/navigate'

interface TaskDetailProps {
  task: Task
  sourceMessage?: InboxMessage | null
  onBack: () => void
  onStartSession: () => void
  onUpdateState: (state: TaskState) => void
  onDelete: () => void
}

const STATE_CONFIG: Record<TaskState, { label: string; icon: React.ComponentType<{ className?: string }>; color: string }> = {
  todo: { label: 'Todo', icon: Circle, color: 'text-foreground/45' },
  in_progress: { label: 'In Progress', icon: Clock, color: 'text-info' },
  done: { label: 'Done', icon: CheckCircle2, color: 'text-success' },
  cancelled: { label: 'Cancelled', icon: XCircle, color: 'text-foreground/30' },
}

const PRIORITY_VARIANTS: Record<string, 'destructive' | 'warning' | 'default'> = {
  high: 'destructive',
  medium: 'warning',
  low: 'default',
}

function formatDateTime(isoDate: string): string {
  return new Date(isoDate).toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function TaskDetail({
  task,
  sourceMessage,
  onBack,
  onStartSession,
  onUpdateState,
  onDelete,
}: TaskDetailProps) {
  const stateConfig = STATE_CONFIG[task.state]
  const StateIcon = stateConfig.icon

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
        <div className="max-w-[720px] mx-auto px-6 py-6 space-y-6">
          {/* Title */}
          <h1 className="text-xl font-bold leading-snug">{task.title}</h1>

          {/* Metadata */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium', stateConfig.color, 'bg-foreground/[0.04]')}>
              <StateIcon className="h-3.5 w-3.5" />
              {stateConfig.label}
            </div>
            <Info_Badge variant={PRIORITY_VARIANTS[task.priority] ?? 'default'}>
              {task.priority} priority
            </Info_Badge>
            <Info_Badge variant="muted">
              {task.source === 'inbox_triage' ? 'From inbox' : task.source === 'calendar_triage' ? 'From calendar' : 'Manual'}
            </Info_Badge>
            <span className="text-xs text-foreground/40">
              Created {formatDateTime(task.createdAt)}
            </span>
          </div>

          {/* Source message */}
          {sourceMessage && (
            <div className="rounded-[8px] border border-border/50 p-4 space-y-2">
              <div className="flex items-center gap-2 text-xs text-foreground/50">
                {sourceMessage.sourceType === 'slack' ? (
                  <MessageSquare className="h-3.5 w-3.5 text-[#4A154B]" />
                ) : (
                  <Mail className="h-3.5 w-3.5 text-blue-500" />
                )}
                <span className="font-medium">{sourceMessage.from.name}</span>
                {sourceMessage.channel && <span>· {sourceMessage.channel}</span>}
                <span>· {formatDateTime(sourceMessage.receivedAt)}</span>
              </div>
              <p className="text-sm text-foreground/70 whitespace-pre-wrap line-clamp-4">
                {sourceMessage.body}
              </p>
              <button
                type="button"
                onClick={() => navigate(routes.view.inbox({ messageId: sourceMessage.id }))}
                className="text-xs text-info hover:underline flex items-center gap-1"
              >
                <ExternalLink className="h-3 w-3" />
                View in Inbox
              </button>
            </div>
          )}

          {/* Notes */}
          {task.notes && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-foreground/50">Notes</div>
              <p className="text-sm text-foreground/70 whitespace-pre-wrap">{task.notes}</p>
            </div>
          )}

          {/* Draft prompt */}
          {task.preparedPrompt && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-foreground/50">Draft prompt</div>
              <div className="rounded-[6px] bg-foreground/[0.04] border border-border/40 p-3">
                <p className="text-sm text-foreground/80 whitespace-pre-wrap">{task.preparedPrompt}</p>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2">
            {task.state !== 'done' && task.state !== 'cancelled' && (
              <Button size="sm" onClick={onStartSession} className="gap-1.5">
                <Play className="h-3 w-3" />
                Start Session
              </Button>
            )}
            {task.state === 'todo' && (
              <Button size="sm" variant="outline" onClick={() => onUpdateState('in_progress')} className="gap-1.5">
                <Clock className="h-3 w-3" />
                Start
              </Button>
            )}
            {(task.state === 'todo' || task.state === 'in_progress') && (
              <Button size="sm" variant="outline" onClick={() => onUpdateState('done')} className="gap-1.5">
                <Check className="h-3 w-3" />
                Mark Done
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onDelete} className="gap-1.5 text-foreground/50 ml-auto">
              <Trash2 className="h-3 w-3" />
              Delete
            </Button>
          </div>

          {/* Linked session */}
          {task.sessionId && (
            <>
              <div className="border-t border-border/40" />
              <div className="space-y-2">
                <div className="text-xs font-medium text-foreground/50">Linked Session</div>
                <button
                  type="button"
                  onClick={() => navigate(routes.view.allSessions(task.sessionId!))}
                  className="w-full text-left rounded-[8px] border border-border/50 p-3 hover:bg-foreground/[0.02] transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <ExternalLink className="h-3.5 w-3.5 text-info" />
                    <span className="text-sm font-medium">{task.sessionId}</span>
                  </div>
                </button>
              </div>
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
