/**
 * SessionViewer - Read-only session transcript viewer
 *
 * Platform-agnostic component for viewing session transcripts.
 * Used by the web viewer app. For interactive chat, Electron uses ChatDisplay.
 *
 * Renders a session's messages as turn cards with gradient fade at top/bottom.
 */

import type { ReactNode } from 'react'
import { useMemo, useState, useCallback } from 'react'
import type { StoredSession } from '@scrunchy/core'
import { cn } from '../../lib/utils'
import { CHAT_LAYOUT, CHAT_CLASSES } from '../../lib/layout'
import { PlatformProvider, type PlatformActions } from '../../context'
import { TurnCard } from './TurnCard'
import { UserMessageBubble } from './UserMessageBubble'
import { SystemMessage } from './SystemMessage'
import {
  groupMessagesByTurn,
  storedToMessage,
  getAssistantTurnUiKey,
  type ActivityItem,
} from './turn-utils'

export type SessionViewerMode = 'interactive' | 'readonly'

export interface SessionViewerProps {
  /** Session data to display */
  session: StoredSession
  /** View mode - 'readonly' for web viewer, 'interactive' for Electron */
  mode?: SessionViewerMode
  /** Platform-specific actions (file opening, URL handling, etc.) */
  platformActions?: PlatformActions
  /** Additional className for the container */
  className?: string
  /** Callback when a turn is clicked */
  onTurnClick?: (turnId: string) => void
  /** Callback when an activity is clicked */
  onActivityClick?: (activity: ActivityItem) => void
  /** Default expanded state for turns (true for readonly, false for interactive) */
  defaultExpanded?: boolean
  /** Custom header content */
  header?: ReactNode
  /** Custom footer content (input area for interactive mode) */
  footer?: ReactNode
  /** Optional session folder path for stripping from file paths in tool display */
  sessionFolderPath?: string
}

/**
 * ScrunchyLogo - The Scrunchy ring logo for branding
 */
function ScrunchyLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        d="M 20.30,12.00 C 20.30,13.38 18.90,12.44 18.37,14.07 C 17.84,15.70 19.53,15.76 18.71,16.88 C 17.90,18.00 17.32,16.42 15.94,17.42 C 14.55,18.43 15.88,19.47 14.56,19.89 C 13.25,20.32 13.71,18.70 12.00,18.70 C 10.29,18.70 10.75,20.32 9.44,19.89 C 8.12,19.47 9.45,18.43 8.06,17.42 C 6.68,16.42 6.10,18.00 5.29,16.88 C 4.47,15.76 6.16,15.70 5.63,14.07 C 5.10,12.44 3.70,13.38 3.70,12.00 C 3.70,10.62 5.10,11.56 5.63,9.93 C 6.16,8.30 4.47,8.24 5.29,7.12 C 6.10,6.00 6.68,7.58 8.06,6.58 C 9.45,5.57 8.12,4.53 9.44,4.11 C 10.75,3.68 10.29,5.30 12.00,5.30 C 13.71,5.30 13.25,3.68 14.56,4.11 C 15.88,4.53 14.55,5.57 15.94,6.58 C 17.32,7.58 17.90,6.00 18.71,7.12 C 19.53,8.24 17.84,8.30 18.37,9.93 C 18.90,11.56 20.30,10.62 20.30,12.00 Z M 16.10,12.00 L 16.05,11.36 L 15.90,10.73 L 15.65,10.14 L 15.32,9.59 L 14.90,9.10 L 14.41,8.68 L 13.86,8.35 L 13.27,8.10 L 12.64,7.95 L 12.00,7.90 L 11.36,7.95 L 10.73,8.10 L 10.14,8.35 L 9.59,8.68 L 9.10,9.10 L 8.68,9.59 L 8.35,10.14 L 8.10,10.73 L 7.95,11.36 L 7.90,12.00 L 7.95,12.64 L 8.10,13.27 L 8.35,13.86 L 8.68,14.41 L 9.10,14.90 L 9.59,15.32 L 10.14,15.65 L 10.73,15.90 L 11.36,16.05 L 12.00,16.10 L 12.64,16.05 L 13.27,15.90 L 13.86,15.65 L 14.41,15.32 L 14.90,14.90 L 15.32,14.41 L 15.65,13.86 L 15.90,13.27 L 16.05,12.64 Z"
        fill="currentColor"
      />
    </svg>
  )
}

/**
 * SessionViewer - Read-only session transcript viewer component
 */
export function SessionViewer({
  session,
  mode = 'readonly',
  platformActions = {},
  className,
  onTurnClick,
  onActivityClick,
  defaultExpanded = false,
  header,
  footer,
  sessionFolderPath,
}: SessionViewerProps) {
  // Convert StoredMessage[] to Message[] and group into turns
  const turns = useMemo(
    () => groupMessagesByTurn(session.messages.map(storedToMessage)),
    [session.messages]
  )

  // Track expanded turns (for controlled state)
  const [expandedTurns, setExpandedTurns] = useState<Set<string>>(() => {
    // Default: all turns collapsed, can override with defaultExpanded prop
    if (defaultExpanded) {
      return new Set(
        turns
          .map((turn, index) => turn.type === 'assistant' ? getAssistantTurnUiKey(turn, index) : null)
          .filter((key): key is string => !!key)
      )
    }
    return new Set()
  })

  // Track expanded activity groups
  const [expandedActivityGroups, setExpandedActivityGroups] = useState<Set<string>>(new Set())

  const handleExpandedChange = useCallback((turnId: string, expanded: boolean) => {
    setExpandedTurns(prev => {
      const next = new Set(prev)
      if (expanded) {
        next.add(turnId)
      } else {
        next.delete(turnId)
      }
      return next
    })
  }, [])

  const handleExpandedActivityGroupsChange = useCallback((groups: Set<string>) => {
    setExpandedActivityGroups(groups)
  }, [])

  const handleOpenActivityDetails = useCallback((activity: ActivityItem) => {
    if (onActivityClick) {
      onActivityClick(activity)
    } else if (platformActions.onOpenActivityDetails) {
      platformActions.onOpenActivityDetails(session.id, activity.id)
    }
  }, [onActivityClick, platformActions, session.id])

  const handleOpenTurnDetails = useCallback((turnId: string) => {
    if (onTurnClick) {
      onTurnClick(turnId)
    } else if (platformActions.onOpenTurnDetails) {
      platformActions.onOpenTurnDetails(session.id, turnId)
    }
  }, [onTurnClick, platformActions, session.id])

  return (
    <PlatformProvider actions={platformActions}>
      <div className={cn("flex flex-col h-full", className)}>
        {/* Header */}
        {header && (
          <div className="shrink-0 border-b">
            {header}
          </div>
        )}

        {/* Messages area with gradient fade mask at top/bottom */}
        <div
          className="flex-1 min-h-0"
          style={{
            maskImage: 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 32px, black calc(100% - 32px), transparent 100%)'
          }}
        >
          <div className="h-full overflow-y-auto">
            <div className={cn(CHAT_LAYOUT.maxWidth, "mx-auto", CHAT_LAYOUT.containerPadding, CHAT_LAYOUT.messageSpacing)}>
            {turns.map((turn, index) => {
              if (turn.type === 'user') {
                return (
                  <div key={turn.message.id} className={CHAT_LAYOUT.userMessagePadding}>
                    <UserMessageBubble
                      content={turn.message.content}
                      attachments={turn.message.attachments}
                      badges={turn.message.badges}
                      onUrlClick={platformActions.onOpenUrl}
                      onFileClick={platformActions.onOpenFile}
                    />
                  </div>
                )
              }

              if (turn.type === 'system') {
                const msgType = turn.message.role === 'error' ? 'error' :
                               turn.message.role === 'warning' ? 'warning' :
                               turn.message.role === 'info' ? 'info' : 'system'
                return (
                  <SystemMessage
                    key={turn.message.id}
                    content={turn.message.content}
                    type={msgType}
                  />
                )
              }

              if (turn.type === 'assistant') {
                const assistantUiKey = getAssistantTurnUiKey(turn, index)
                return (
                  <TurnCard
                    key={assistantUiKey}
                    turnId={turn.turnId}
                    activities={turn.activities}
                    response={turn.response}
                    intent={turn.intent}
                    isStreaming={turn.isStreaming}
                    isComplete={turn.isComplete}
                    isExpanded={expandedTurns.has(assistantUiKey)}
                    onExpandedChange={(expanded) => handleExpandedChange(assistantUiKey, expanded)}
                    onOpenFile={platformActions.onOpenFile}
                    onOpenUrl={platformActions.onOpenUrl}
                    onPopOut={platformActions.onOpenMarkdownPreview}
                    onOpenDetails={() => handleOpenTurnDetails(turn.turnId)}
                    onOpenActivityDetails={handleOpenActivityDetails}
                    todos={turn.todos}
                    expandedActivityGroups={expandedActivityGroups}
                    onExpandedActivityGroupsChange={handleExpandedActivityGroupsChange}
                    hasEditOrWriteActivities={turn.activities.some(a =>
                      a.toolName === 'Edit' || a.toolName === 'Write'
                    )}
                    onOpenMultiFileDiff={platformActions.onOpenMultiFileDiff
                      ? () => platformActions.onOpenMultiFileDiff!(session.id, turn.turnId)
                      : undefined
                    }
                    sessionFolderPath={sessionFolderPath}
                    annotationInteractionMode={mode === 'readonly' ? 'tooltip-only' : 'interactive'}
                  />
                )
              }

              return null
            })}

            {/* Bottom branding */}
            <div className={CHAT_CLASSES.brandingContainer}>
              <ScrunchyLogo className="w-8 h-8 text-[#3B82F6]/40" />
            </div>
            </div>
          </div>
        </div>

        {/* Footer (input area) */}
        {footer && (
          <div className="shrink-0 border-t">
            {footer}
          </div>
        )}
      </div>
    </PlatformProvider>
  )
}
