import { useState, useCallback, useEffect } from 'react'
import { useSetAtom } from 'jotai'
import type { Task, TaskState } from '@craft-agent/core/types'
import { tasksAtom } from '@/atoms/task-atoms'

export interface UseTasksResult {
  tasks: Task[]
  isLoading: boolean
  refresh: () => Promise<void>
  createTask: (task: Task) => Promise<Task>
  updateTask: (taskId: string, patch: Partial<Task>) => Promise<Task | null>
  deleteTask: (taskId: string) => Promise<boolean>
  startSession: (taskId: string) => Promise<{ prompt: string; sources: string[]; permissionMode: string; taskId: string; name: string }>
}

export function useTasks(workspaceId: string | null): UseTasksResult {
  const [tasks, setTasks] = useState<Task[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const setTasksAtom = useSetAtom(tasksAtom)

  const load = useCallback(async () => {
    if (!workspaceId) {
      setTasks([])
      setIsLoading(false)
      return
    }
    try {
      setIsLoading(true)
      const loaded = await window.electronAPI.getInboxTasks(workspaceId)
      setTasks(loaded)
    } catch {
      setTasks([])
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  // Sync to Jotai atom
  useEffect(() => {
    setTasksAtom(tasks)
  }, [tasks, setTasksAtom])

  // Load on workspace change
  useEffect(() => {
    load()
  }, [load])

  // Subscribe to live changes
  useEffect(() => {
    if (!workspaceId) return
    const cleanup = window.electronAPI.onInboxTasksChanged(() => {
      load()
    })
    return cleanup
  }, [workspaceId, load])

  const createTaskFn = useCallback(async (task: Task): Promise<Task> => {
    if (!workspaceId) throw new Error('No workspace')
    const created = await window.electronAPI.createInboxTask(workspaceId, task)
    return created
  }, [workspaceId])

  const updateTaskFn = useCallback(async (taskId: string, patch: Partial<Task>): Promise<Task | null> => {
    if (!workspaceId) return null
    return window.electronAPI.updateInboxTask(workspaceId, taskId, patch)
  }, [workspaceId])

  const deleteTaskFn = useCallback(async (taskId: string): Promise<boolean> => {
    if (!workspaceId) return false
    return window.electronAPI.deleteInboxTask(workspaceId, taskId)
  }, [workspaceId])

  const startSessionFn = useCallback(async (taskId: string) => {
    if (!workspaceId) throw new Error('No workspace')
    return window.electronAPI.startInboxTaskSession(workspaceId, taskId)
  }, [workspaceId])

  return {
    tasks,
    isLoading,
    refresh: load,
    createTask: createTaskFn,
    updateTask: updateTaskFn,
    deleteTask: deleteTaskFn,
    startSession: startSessionFn,
  }
}
