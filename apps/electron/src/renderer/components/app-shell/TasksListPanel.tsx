import * as React from 'react'
import { ListTodo } from 'lucide-react'
import { EntityPanel } from '@/components/ui/entity-panel'
import { EntityListBadge } from '@/components/ui/entity-list-badge'
import { EntityListEmptyScreen } from '@/components/ui/entity-list-empty'
import { taskSelection } from '@/hooks/useEntitySelection'
import type { Task, TaskState } from '@craft-agent/core/types'
import type { SessionStatus } from '@/config/session-status-config'

const PRIORITY_COLORS: Record<string, string> = {
  high: 'bg-destructive/10 text-destructive',
  medium: 'bg-warning/10 text-warning',
  low: 'bg-foreground/10 text-foreground/50',
}

const SOURCE_LABELS: Record<string, string> = {
  inbox_triage: 'From inbox',
  calendar_triage: 'From calendar',
  manual: 'Manual',
}

export interface TasksListPanelProps {
  tasks: Task[]
  filter?: string
  selectedTaskId?: string | null
  onTaskClick: (task: Task) => void
  onAddTask?: () => void
  sessionStatuses?: SessionStatus[]
  className?: string
}

export function TasksListPanel({
  tasks,
  filter,
  selectedTaskId,
  onTaskClick,
  onAddTask,
  sessionStatuses,
  className,
}: TasksListPanelProps) {
  const filteredTasks = React.useMemo(() => {
    if (!filter || filter === 'all') return tasks
    return tasks.filter(t => t.state === filter)
  }, [tasks, filter])

  const getStatusIcon = React.useCallback((state: TaskState) => {
    const statusMap: Record<TaskState, string> = { todo: 'todo', in_progress: 'needs-review', done: 'done', cancelled: 'cancelled' }
    const status = sessionStatuses?.find(s => s.id === statusMap[state])
    if (status) {
      return <span style={{ color: status.resolvedColor }}>{status.icon}</span>
    }
    return null
  }, [sessionStatuses])

  return (
    <EntityPanel<Task>
      items={filteredTasks}
      getId={(t) => t.id}
      selection={taskSelection}
      selectedId={selectedTaskId}
      onItemClick={onTaskClick}
      className={className}
      emptyState={
        <EntityListEmptyScreen
          icon={<ListTodo />}
          title={filter && filter !== 'all' ? `No ${filter.replace('_', ' ')} tasks.` : 'No tasks yet.'}
          description="Actionable messages will create tasks automatically, or add one manually."
        >
          {onAddTask && (
            <button
              onClick={onAddTask}
              className="inline-flex items-center h-7 px-3 text-xs font-medium rounded-[8px] bg-background shadow-minimal hover:bg-foreground/[0.03] transition-colors"
            >
              New Task
            </button>
          )}
        </EntityListEmptyScreen>
      }
      mapItem={(task) => ({
        icon: getStatusIcon(task.state),
        title: task.title,
        badges: (
          <>
            <EntityListBadge colorClass={PRIORITY_COLORS[task.priority] ?? ''}>{task.priority}</EntityListBadge>
            <span className="truncate text-foreground/40">{SOURCE_LABELS[task.source] ?? task.source}</span>
          </>
        ),
      })}
    />
  )
}
