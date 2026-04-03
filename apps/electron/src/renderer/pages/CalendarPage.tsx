import * as React from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { Calendar } from 'lucide-react'

export default function CalendarPage() {
  return (
    <div className="flex flex-col h-full">
      <PanelHeader title="Calendar" />
      <div className="flex-1 flex flex-col items-center justify-center text-foreground/40 gap-3">
        <Calendar className="h-10 w-10" />
        <p className="text-sm">Calendar view coming in Milestone 6</p>
      </div>
    </div>
  )
}
