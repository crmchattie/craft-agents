import * as React from 'react'
import { useCallback, useState } from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { TaskList } from '@/components/tasks/TaskList'
import { TaskDetail } from '@/components/tasks/TaskDetail'
import { AddTaskDialog } from '@/components/tasks/AddTaskDialog'
import { useTasks } from '@/hooks/useTasks'
import { useInbox } from '@/hooks/useInbox'
import { selectedTaskIdAtom } from '@/atoms/task-atoms'
import { useActiveWorkspace, useAppShellContext } from '@/context/AppShellContext'
import type { Task, TaskState } from '@craft-agent/core/types'

export default function TasksPage() {
  const activeWorkspace = useActiveWorkspace()
  const workspaceId = activeWorkspace?.id ?? null
  const { tasks, isLoading, createTask, updateTask, deleteTask, startSession } = useTasks(workspaceId)
  const { messages } = useInbox(workspaceId)
  const { openNewChat } = useAppShellContext()

  const selectedId = useAtomValue(selectedTaskIdAtom)
  const setSelectedId = useSetAtom(selectedTaskIdAtom)
  const [showAddForm, setShowAddForm] = useState(false)

  const selectedTask = React.useMemo(
    () => tasks.find(t => t.id === selectedId) ?? null,
    [tasks, selectedId],
  )

  const sourceMessage = React.useMemo(() => {
    if (!selectedTask?.inboxMessageId) return null
    return messages.find(m => m.id === selectedTask.inboxMessageId) ?? null
  }, [selectedTask, messages])

  const handleSelect = useCallback((taskId: string) => {
    setSelectedId(taskId)
  }, [setSelectedId])

  const handleBack = useCallback(() => {
    setSelectedId(null)
  }, [setSelectedId])

  const handleAdd = useCallback(async (task: Task) => {
    await createTask(task)
    setShowAddForm(false)
  }, [createTask])

  const handleStartSession = useCallback(async () => {
    if (!selectedTask || !openNewChat) return
    try {
      const sessionInfo = await startSession(selectedTask.id)
      await openNewChat({
        input: sessionInfo.prompt,
        name: sessionInfo.name,
        taskId: selectedTask.id,
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
    setSelectedId(null)
  }, [selectedTask, deleteTask, setSelectedId])

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

  return (
    <div className="flex flex-col h-full">
      <PanelHeader
        title="Tasks"
        actions={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowAddForm(true)}
            className="gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Task
          </Button>
        }
      />

      {showAddForm && (
        <AddTaskDialog
          onAdd={handleAdd}
          onCancel={() => setShowAddForm(false)}
        />
      )}

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-foreground/40">
          Loading tasks...
        </div>
      ) : (
        <TaskList
          tasks={tasks}
          selectedTaskId={selectedId}
          onSelect={handleSelect}
        />
      )}
    </div>
  )
}
