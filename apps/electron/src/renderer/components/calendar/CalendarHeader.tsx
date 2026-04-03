import * as React from 'react'
import { useAtom } from 'jotai'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { calendarViewAtom, calendarSelectedDateAtom } from '@/atoms/calendar-atoms'
import {
  format,
  addDays,
  addWeeks,
  addMonths,
  subDays,
  subWeeks,
  subMonths,
  startOfWeek,
  endOfWeek,
} from 'date-fns'
import { cn } from '@/lib/utils'

interface CalendarHeaderProps {
  isSyncing: boolean
  onRefresh: () => void
}

type CalendarView = 'day' | 'week' | 'month'

export function CalendarHeader({ isSyncing, onRefresh }: CalendarHeaderProps) {
  const [view, setView] = useAtom(calendarViewAtom)
  const [selectedDate, setSelectedDate] = useAtom(calendarSelectedDateAtom)

  const date = React.useMemo(() => new Date(selectedDate), [selectedDate])

  const dateLabel = React.useMemo(() => {
    if (view === 'day') return format(date, 'EEEE, MMM d, yyyy')
    if (view === 'week') {
      const weekStart = startOfWeek(date, { weekStartsOn: 1 })
      const weekEnd = endOfWeek(date, { weekStartsOn: 1 })
      if (weekStart.getMonth() === weekEnd.getMonth()) {
        return `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'd, yyyy')}`
      }
      return `${format(weekStart, 'MMM d')} – ${format(weekEnd, 'MMM d, yyyy')}`
    }
    return format(date, 'MMMM yyyy')
  }, [date, view])

  const navigate = React.useCallback((direction: 'prev' | 'next') => {
    const fn = direction === 'prev'
      ? (view === 'day' ? subDays : view === 'week' ? subWeeks : subMonths)
      : (view === 'day' ? addDays : view === 'week' ? addWeeks : addMonths)
    setSelectedDate(fn(date, 1).toISOString().slice(0, 10))
  }, [date, view, setSelectedDate])

  const goToToday = React.useCallback(() => {
    setSelectedDate(new Date().toISOString().slice(0, 10))
  }, [setSelectedDate])

  return (
    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border/40">
      {/* View switcher */}
      <div className="flex items-center rounded-[6px] bg-foreground/[0.04] p-0.5">
        {(['day', 'week', 'month'] as CalendarView[]).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-[4px] transition-colors capitalize',
              view === v
                ? 'bg-background shadow-sm text-foreground'
                : 'text-foreground/50 hover:text-foreground/70',
            )}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => navigate('prev')}
          className="h-7 w-7 inline-flex items-center justify-center rounded-[4px] hover:bg-foreground/5 text-foreground/50"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => navigate('next')}
          className="h-7 w-7 inline-flex items-center justify-center rounded-[4px] hover:bg-foreground/5 text-foreground/50"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {/* Date label */}
      <span className="text-sm font-semibold">{dateLabel}</span>

      {/* Today button */}
      <Button variant="ghost" size="sm" onClick={goToToday} className="text-xs h-7">
        Today
      </Button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Refresh */}
      <Button variant="ghost" size="sm" onClick={onRefresh} disabled={isSyncing} className="gap-1.5 h-7">
        <RefreshCw className={cn('h-3 w-3', isSyncing && 'animate-spin')} />
        Refresh
      </Button>
    </div>
  )
}
