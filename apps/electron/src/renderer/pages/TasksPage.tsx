import * as React from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ListTodo } from 'lucide-react'

export default function TasksPage() {
  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Tasks" />
      <div className="flex-1 flex flex-col items-center justify-center text-foreground/40 gap-3">
        <ListTodo className="h-10 w-10" />
        <p className="text-sm">Tasks view coming in Milestone 5</p>
      </div>
    </div>
  )
}
