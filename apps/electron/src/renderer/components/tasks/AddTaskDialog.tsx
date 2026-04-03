import * as React from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { Task, TriagePriority } from '@craft-agent/core/types'

interface AddTaskDialogProps {
  onAdd: (task: Task) => void
  onCancel: () => void
}

export function AddTaskDialog({ onAdd, onCancel }: AddTaskDialogProps) {
  const [title, setTitle] = React.useState('')
  const [priority, setPriority] = React.useState<TriagePriority>('medium')
  const inputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = React.useCallback(() => {
    const trimmed = title.trim()
    if (!trimmed) return

    const task: Task = {
      id: `task:manual:${Date.now()}`,
      title: trimmed,
      state: 'todo',
      priority,
      source: 'manual',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    onAdd(task)
    setTitle('')
  }, [title, priority, onAdd])

  const handleKeyDown = React.useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onCancel()
    }
  }, [handleSubmit, onCancel])

  return (
    <div className="px-4 py-3 border-b border-border/40 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Task title..."
          className="h-8 text-sm flex-1"
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value as TriagePriority)}
          className="h-8 text-xs rounded-[6px] border border-border bg-background px-2 text-foreground/70"
        >
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
        <Button size="sm" onClick={handleSubmit} disabled={!title.trim()} className="h-8 gap-1">
          <Plus className="h-3 w-3" />
          Add
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} className="h-8">
          Cancel
        </Button>
      </div>
    </div>
  )
}
