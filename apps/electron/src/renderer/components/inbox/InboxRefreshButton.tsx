import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

interface InboxRefreshButtonProps {
  onClick: () => void
  syncing?: boolean
}

export function InboxRefreshButton({ onClick, syncing }: InboxRefreshButtonProps) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className="h-5 w-5 inline-flex items-center justify-center rounded-[4px] hover:bg-foreground/8 text-foreground/45 hover:text-foreground/70 transition-colors"
      aria-label="Refresh"
    >
      <RefreshCw className={cn('h-3 w-3', syncing && 'animate-spin')} />
    </button>
  )
}
