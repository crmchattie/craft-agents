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

// Triage service
export type { TriageServiceOptions, TriageResult } from './triage-service.ts';
export { TriageService } from './triage-service.ts';

// Provider registry & auto-wire
export type { InboxCapability } from './provider-registry.ts';
export {
  PROVIDER_REGISTRY,
  detectCapabilities,
  discoverCapabilitiesFromTools,
  buildInboxSourceConfig,
} from './provider-registry.ts';
export type { AutoWireResult } from './auto-wire.ts';
export { autoWireSource, unwireSource } from './auto-wire.ts';
