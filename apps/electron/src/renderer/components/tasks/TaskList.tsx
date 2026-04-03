import * as React from 'react'
import { Circle, CheckCircle2, Clock, XCircle, Star, ExternalLink } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Info_Badge } from '@/components/info'
import type { Task, TaskState } from '@craft-agent/core/types'
import { cn } from '@/lib/utils'

interface TaskListProps {
  tasks: Task[]
  selectedTaskId: string | null
  onSelect: (taskId: string) => void
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

const SOURCE_LABELS: Record<string, string> = {
  inbox_triage: 'From inbox',
  calendar_triage: 'From calendar',
  manual: 'Manual',
}

function formatRelativeTime(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffHours = Math.floor(diffMs / 3_600_000)
  if (diffHours < 1) return 'Just now'
  if (diffHours < 24) return `${diffHours}h ago`
  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'Yesterday'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const VISIBLE_STATES: TaskState[] = ['todo', 'in_progress', 'done', 'cancelled']

export function TaskList({ tasks, selectedTaskId, onSelect }: TaskListProps) {
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<TaskState>>(new Set())

  const toggleGroup = React.useCallback((state: TaskState) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev)
      if (next.has(state)) next.delete(state)
      else next.add(state)
      return next
    })
  }, [])

  const groupedTasks = React.useMemo(() => {
    const groups: Record<TaskState, Task[]> = { todo: [], in_progress: [], done: [], cancelled: [] }
    for (const task of tasks) {
      groups[task.state].push(task)
    }
    return groups
  }, [tasks])

  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-foreground/40 p-8">
        No tasks yet. Actionable messages will create tasks automatically, or add one manually.
      </div>
    )
  }

  return (
    <ScrollArea className="flex-1">
      <div className="py-2 px-2">
        {VISIBLE_STATES.map(state => {
          const stateTasks = groupedTasks[state]
          if (stateTasks.length === 0 && state === 'cancelled') return null
          const config = STATE_CONFIG[state]
          const isCollapsed = collapsedGroups.has(state)
          const Icon = config.icon

          return (
            <div key={state} className="mb-2">
              {/* Group header */}
              <button
                type="button"
                onClick={() => toggleGroup(state)}
                className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-foreground/60 hover:text-foreground/80 transition-colors"
              >
                <Icon className={cn('h-3.5 w-3.5', config.color)} />
                <span>{config.label}</span>
                <span className="text-foreground/35">({stateTasks.length})</span>
                <span className="ml-auto text-foreground/30">{isCollapsed ? '>' : 'v'}</span>
              </button>

              {/* Task rows */}
              {!isCollapsed && stateTasks.map(task => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isSelected={selectedTaskId === task.id}
                  onSelect={() => onSelect(task.id)}
                />
              ))}
            </div>
          )
        })}
      </div>
    </ScrollArea>
  )
}

function TaskRow({ task, isSelected, onSelect }: { task: Task; isSelected: boolean; onSelect: () => void }) {
  const config = STATE_CONFIG[task.state]
  const Icon = config.icon

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'w-full text-left rounded-[8px] px-3 py-2.5 transition-colors',
        isSelected ? 'bg-foreground/5' : 'hover:bg-foreground/[0.02]',
      )}
    >
      <div className="flex items-center gap-2.5">
        <Icon className={cn('h-4 w-4 shrink-0', config.color)} />
        <span className={cn(
          'text-sm flex-1 min-w-0 truncate',
          task.state === 'done' && 'line-through text-foreground/45',
          task.state === 'cancelled' && 'line-through text-foreground/30',
        )}>
          {task.title}
        </span>
        <Info_Badge variant={PRIORITY_VARIANTS[task.priority] ?? 'default'}>
          {task.priority}
        </Info_Badge>
      </div>
      <div className="flex items-center gap-2 mt-1 ml-6.5 text-xs text-foreground/40">
        <span>{SOURCE_LABELS[task.source] ?? task.source}</span>
        {task.sessionId && (
          <>
            <span>·</span>
            <span className="flex items-center gap-1">
              <ExternalLink className="h-2.5 w-2.5" />
              Session linked
            </span>
          </>
        )}
        <span className="ml-auto">{formatRelativeTime(task.createdAt)}</span>
      </div>
    </button>
  )
}
