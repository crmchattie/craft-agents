import { atom } from 'jotai'
import type { Task, TaskState } from '@craft-agent/core/types'

export const tasksAtom = atom<Task[]>([])
export const taskFilterAtom = atom<TaskState | 'all'>('all')
export const selectedTaskIdAtom = atom<string | null>(null)

export const taskCountsByStateAtom = atom<Record<TaskState, number>>((get) => {
  const tasks = get(tasksAtom)
  const counts: Record<TaskState, number> = { todo: 0, in_progress: 0, done: 0, cancelled: 0 }
  for (const t of tasks) {
    counts[t.state]++
  }
  return counts
})
