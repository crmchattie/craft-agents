import * as React from 'react'
import { Bot, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Info_Badge } from '@/components/info'
import type { MessageTriage } from '@scrunchy/core/types'

interface TriageCardProps {
  triage: MessageTriage
  onStartSession?: () => void
}

const PRIORITY_COLORS: Record<string, 'success' | 'warning' | 'destructive' | 'default'> = {
  high: 'destructive',
  medium: 'warning',
  low: 'default',
}

const CATEGORY_COLORS: Record<string, 'success' | 'warning' | 'destructive' | 'default' | 'muted'> = {
  request: 'warning',
  question: 'success',
  approval: 'destructive',
  fyi: 'muted',
  social: 'muted',
  automated: 'muted',
}

export function TriageCard({ triage, onStartSession }: TriageCardProps) {
  return (
    <div className="rounded-[8px] border border-border/60 bg-foreground/[0.02] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Bot className="h-4 w-4 text-foreground/50" />
        <span className="text-sm font-medium">
          {triage.isActionable ? 'Actionable request' : 'Triage'}
        </span>
        <Info_Badge variant={CATEGORY_COLORS[triage.category] ?? 'default'}>
          {triage.category}
        </Info_Badge>
        <Info_Badge variant={PRIORITY_COLORS[triage.priority] ?? 'default'}>
          {triage.priority}
        </Info_Badge>
      </div>

      <p className="text-sm text-foreground/70">{triage.summary}</p>

      {triage.suggestedPrompt && (
        <div className="rounded-[6px] bg-foreground/[0.04] border border-border/40 p-3">
          <div className="text-xs text-foreground/45 mb-1">Draft prompt</div>
          <p className="text-sm text-foreground/80 whitespace-pre-wrap">{triage.suggestedPrompt}</p>
        </div>
      )}

      {triage.isActionable && onStartSession && (
        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" onClick={onStartSession} className="gap-1.5">
            <Play className="h-3 w-3" />
            Start Session
          </Button>
        </div>
      )}
    </div>
  )
}
