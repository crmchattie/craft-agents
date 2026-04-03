/**
 * Inbox, Tasks & Calendar — data layer.
 *
 * Provides JSONL storage for messages, calendar events, and tasks,
 * configuration management, and a sync service that fetches data
 * from MCP sources on a schedule.
 */

// Config
export type { InboxConfig, InboxSourceConfig } from './config.ts';
export {
  DEFAULT_INBOX_CONFIG,
  getInboxConfigPath,
  loadInboxConfig,
  saveInboxConfig,
  validateInboxConfig,
} from './config.ts';

// Storage
export type { SyncCursor, SyncState } from './storage.ts';
export {
  getInboxDir,
  ensureInboxDir,
  getMessagesPath,
  getEventsPath,
  getTasksPath,
  getSyncStatePath,
  readMessages,
  appendMessages,
  rewriteMessages,
  getMessageById,
  readEvents,
  replaceEvents,
  readTasks,
  writeTasks,
  createTask,
  updateTask,
  deleteTask,
  readSyncState,
  writeSyncState,
} from './storage.ts';

// Sync service
export type { InboxSyncServiceOptions, SyncResult } from './sync-service.ts';
export { InboxSyncService } from './sync-service.ts';

// Sync handler (SchedulerTick integration)
export { InboxSyncHandler } from './sync-handler.ts';
