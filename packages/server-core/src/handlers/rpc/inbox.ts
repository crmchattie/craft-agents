/**
 * RPC handlers for Inbox, Tasks, and Calendar.
 */

import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getWorkspaceByNameOrId } from '@craft-agent/shared/config'
import { pushTyped, type RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from '../handler-deps'
import type { InboxMessage, CalendarEvent, Task, TaskState } from '@craft-agent/core/types'

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.inbox.GET_MESSAGES,
  RPC_CHANNELS.inbox.GET_MESSAGE,
  RPC_CHANNELS.inbox.GET_THREAD,
  RPC_CHANNELS.inbox.MARK_READ,
  RPC_CHANNELS.inbox.SYNC,
  RPC_CHANNELS.inbox.GET_SYNC_STATUS,
  RPC_CHANNELS.inbox.GET_CONFIG,
  RPC_CHANNELS.inbox.UPDATE_CONFIG,
  RPC_CHANNELS.inboxTasks.GET_ALL,
  RPC_CHANNELS.inboxTasks.GET,
  RPC_CHANNELS.inboxTasks.CREATE,
  RPC_CHANNELS.inboxTasks.UPDATE,
  RPC_CHANNELS.inboxTasks.DELETE,
  RPC_CHANNELS.inboxTasks.START_SESSION,
  RPC_CHANNELS.calendar.GET_EVENTS,
  RPC_CHANNELS.calendar.GET_EVENT,
  RPC_CHANNELS.calendar.SYNC,
  RPC_CHANNELS.calendar.GET_SYNC_STATUS,
] as const

function resolveWorkspace(workspaceId: string) {
  const workspace = getWorkspaceByNameOrId(workspaceId)
  if (!workspace) throw new Error('Workspace not found')
  return workspace
}

export function registerInboxHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // ============================================================================
  // Inbox Messages
  // ============================================================================

  server.handle(RPC_CHANNELS.inbox.GET_MESSAGES, async (_ctx, workspaceId: string, filter?: { source?: string; channel?: string; actionableOnly?: boolean }) => {
    const workspace = resolveWorkspace(workspaceId)
    const { readMessages } = await import('@craft-agent/shared/inbox')
    let messages = readMessages(workspace.rootPath)

    if (filter?.source) {
      messages = messages.filter(m => m.sourceSlug === filter.source)
    }
    if (filter?.channel) {
      messages = messages.filter(m => m.channel === filter.channel)
    }
    if (filter?.actionableOnly) {
      messages = messages.filter(m => m.triage?.isActionable)
    }

    log.debug(`[inbox-rpc] GET_MESSAGES: ${messages.length} messages returned`)
    return messages
  })

  server.handle(RPC_CHANNELS.inbox.GET_MESSAGE, async (_ctx, workspaceId: string, messageId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const { getMessageById } = await import('@craft-agent/shared/inbox')
    return getMessageById(workspace.rootPath, messageId) ?? null
  })

  server.handle(RPC_CHANNELS.inbox.GET_THREAD, async (_ctx, workspaceId: string, threadId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const { readMessages } = await import('@craft-agent/shared/inbox')
    return readMessages(workspace.rootPath).filter(m => m.threadId === threadId)
  })

  server.handle(RPC_CHANNELS.inbox.MARK_READ, async (_ctx, workspaceId: string, messageId: string) => {
    log.debug(`[inbox-rpc] MARK_READ: messageId=${messageId}`)
    const workspace = resolveWorkspace(workspaceId)
    const { readMessages, rewriteMessages } = await import('@craft-agent/shared/inbox')
    const messages = readMessages(workspace.rootPath)
    const msg = messages.find(m => m.id === messageId)
    if (msg) {
      msg.isRead = true
      rewriteMessages(workspace.rootPath, messages)
      pushTyped(server, RPC_CHANNELS.inbox.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    }
  })

  server.handle(RPC_CHANNELS.inbox.SYNC, async (_ctx, workspaceId: string) => {
    log.info(`[inbox-rpc] Manual inbox sync triggered for workspace ${workspaceId}`)
    const workspace = resolveWorkspace(workspaceId)
    const handler = deps.sessionManager.getInboxSyncHandler(workspace.rootPath)
    if (!handler) throw new Error('Inbox sync not initialized for this workspace')
    const result = await handler.triggerManualSync()
    // Notify renderer that inbox data changed
    pushTyped(server, RPC_CHANNELS.inbox.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    pushTyped(server, RPC_CHANNELS.calendar.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    return result
  })

  server.handle(RPC_CHANNELS.inbox.GET_SYNC_STATUS, async (_ctx, workspaceId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const { readSyncState } = await import('@craft-agent/shared/inbox')
    return readSyncState(workspace.rootPath)
  })

  server.handle(RPC_CHANNELS.inbox.GET_CONFIG, async (_ctx, workspaceId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const { loadInboxConfig } = await import('@craft-agent/shared/inbox')
    return loadInboxConfig(workspace.rootPath)
  })

  server.handle(RPC_CHANNELS.inbox.UPDATE_CONFIG, async (_ctx, workspaceId: string, config: import('@craft-agent/shared/inbox').InboxConfig) => {
    log.info(`[inbox-rpc] Inbox config updated for workspace ${workspaceId}`)
    const workspace = resolveWorkspace(workspaceId)
    const { saveInboxConfig } = await import('@craft-agent/shared/inbox')
    saveInboxConfig(workspace.rootPath, config)
  })

  // ============================================================================
  // Tasks
  // ============================================================================

  server.handle(RPC_CHANNELS.inboxTasks.GET_ALL, async (_ctx, workspaceId: string, filter?: { state?: TaskState }) => {
    const workspace = resolveWorkspace(workspaceId)
    const { readTasks } = await import('@craft-agent/shared/inbox')
    let tasks = readTasks(workspace.rootPath)
    if (filter?.state) {
      tasks = tasks.filter(t => t.state === filter.state)
    }
    return tasks
  })

  server.handle(RPC_CHANNELS.inboxTasks.GET, async (_ctx, workspaceId: string, taskId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const { readTasks } = await import('@craft-agent/shared/inbox')
    return readTasks(workspace.rootPath).find(t => t.id === taskId) ?? null
  })

  server.handle(RPC_CHANNELS.inboxTasks.CREATE, async (_ctx, workspaceId: string, task: Task) => {
    const workspace = resolveWorkspace(workspaceId)
    const { createTask } = await import('@craft-agent/shared/inbox')
    const created = createTask(workspace.rootPath, task)
    pushTyped(server, RPC_CHANNELS.inboxTasks.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    return created
  })

  server.handle(RPC_CHANNELS.inboxTasks.UPDATE, async (_ctx, workspaceId: string, taskId: string, patch: Partial<Task>) => {
    const workspace = resolveWorkspace(workspaceId)
    const { updateTask } = await import('@craft-agent/shared/inbox')
    const updated = updateTask(workspace.rootPath, taskId, patch)
    if (updated) {
      pushTyped(server, RPC_CHANNELS.inboxTasks.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    }
    return updated
  })

  server.handle(RPC_CHANNELS.inboxTasks.DELETE, async (_ctx, workspaceId: string, taskId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const { deleteTask } = await import('@craft-agent/shared/inbox')
    const deleted = deleteTask(workspace.rootPath, taskId)
    if (deleted) {
      pushTyped(server, RPC_CHANNELS.inboxTasks.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    }
    return deleted
  })

  server.handle(RPC_CHANNELS.inboxTasks.START_SESSION, async (_ctx, workspaceId: string, taskId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const { readTasks } = await import('@craft-agent/shared/inbox')
    const task = readTasks(workspace.rootPath).find(t => t.id === taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    return {
      prompt: task.preparedPrompt ?? task.title,
      sources: task.preparedSources ?? [],
      permissionMode: 'ask' as const,
      taskId: task.id,
      name: task.title,
    }
  })

  // ============================================================================
  // Calendar
  // ============================================================================

  server.handle(RPC_CHANNELS.calendar.GET_EVENTS, async (_ctx, workspaceId: string, range?: { start?: string; end?: string }) => {
    const workspace = resolveWorkspace(workspaceId)
    const { readEvents } = await import('@craft-agent/shared/inbox')
    let events = readEvents(workspace.rootPath)

    if (range?.start) {
      events = events.filter(e => e.startTime >= range.start!)
    }
    if (range?.end) {
      events = events.filter(e => e.startTime <= range.end!)
    }

    log.debug(`[inbox-rpc] GET_EVENTS: ${events.length} events returned${range?.start ? ` (range: ${range.start} - ${range.end})` : ''}`)
    return events
  })

  server.handle(RPC_CHANNELS.calendar.GET_EVENT, async (_ctx, workspaceId: string, eventId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const { readEvents } = await import('@craft-agent/shared/inbox')
    return readEvents(workspace.rootPath).find(e => e.id === eventId) ?? null
  })

  server.handle(RPC_CHANNELS.calendar.SYNC, async (_ctx, workspaceId: string) => {
    log.info(`[inbox-rpc] Manual calendar sync triggered for workspace ${workspaceId}`)
    const workspace = resolveWorkspace(workspaceId)
    const handler = deps.sessionManager.getInboxSyncHandler(workspace.rootPath)
    if (!handler) throw new Error('Calendar sync not initialized for this workspace')
    const result = await handler.triggerManualSync()
    pushTyped(server, RPC_CHANNELS.inbox.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    pushTyped(server, RPC_CHANNELS.calendar.CHANGED, { to: 'workspace', workspaceId }, workspaceId)
    return result
  })

  server.handle(RPC_CHANNELS.calendar.GET_SYNC_STATUS, async (_ctx, workspaceId: string) => {
    const workspace = resolveWorkspace(workspaceId)
    const { readSyncState } = await import('@craft-agent/shared/inbox')
    return readSyncState(workspace.rootPath)
  })
}
