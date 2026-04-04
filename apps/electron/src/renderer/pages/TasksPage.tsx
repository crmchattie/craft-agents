import * as React from 'react'
import { useCallback } from 'react'
import { ListTodo } from 'lucide-react'
import { TaskDetail } from '@/components/tasks/TaskDetail'
import { useInbox } from '@/hooks/useInbox'
import { useTasks } from '@/hooks/useTasks'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import { useNavigationState, isTasksNavigation } from '@/contexts/NavigationContext'
import { navigate, routes } from '@/lib/navigate'
import type { TaskState } from '@craft-agent/core/types'

export default function TasksPage() {
  const activeWorkspace = useActiveWorkspace()
  const workspaceId = activeWorkspace?.id ?? null
  const { tasks, updateTask, deleteTask, startSession } = useTasks(workspaceId)
  const { messages } = useInbox(workspaceId)
  const { openNewChat } = useAppShellContext()
  const navState = useNavigationState()

  const selectedId = isTasksNavigation(navState) ? navState.details?.taskId ?? null : null

  const selectedTask = React.useMemo(
    () => tasks.find(t => t.id === selectedId) ?? null,
    [tasks, selectedId],
  )

  const sourceMessage = React.useMemo(() => {
    if (!selectedTask?.inboxMessageId) return null
    return messages.find(m => m.id === selectedTask.inboxMessageId) ?? null
  }, [selectedTask, messages])

  const handleBack = useCallback(() => {
    navigate(routes.view.tasks())
  }, [])

  const handleStartSession = useCallback(async () => {
    if (!selectedTask || !openNewChat) return
    try {
      const sessionInfo = await startSession(selectedTask.id)
      await openNewChat({
        input: sessionInfo.prompt,
        name: sessionInfo.name,
        sessionOptions: {
          enabledSourceSlugs: sessionInfo.sources,
        },
      })
    } catch (err) {
      console.warn('[TasksPage] Failed to start session:', err)
    }
  }, [selectedTask, startSession, openNewChat])

  const handleUpdateState = useCallback(async (state: TaskState) => {
    if (!selectedTask) return
    await updateTask(selectedTask.id, {
      state,
      ...(state === 'done' ? { completedAt: new Date().toISOString() } : {}),
    })
  }, [selectedTask, updateTask])

  const handleDelete = useCallback(async () => {
    if (!selectedTask) return
    await deleteTask(selectedTask.id)
    navigate(routes.view.tasks())
  }, [selectedTask, deleteTask])

  if (selectedTask) {
    return (
      <TaskDetail
        task={selectedTask}
        sourceMessage={sourceMessage}
        onBack={handleBack}
        onStartSession={handleStartSession}
        onUpdateState={handleUpdateState}
        onDelete={handleDelete}
      />
    )
  }

  // Empty state — no task selected
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-foreground/40 gap-3">
      <ListTodo className="h-10 w-10" />
      <p className="text-sm">Select a task to view details</p>
    </div>
  )
}
