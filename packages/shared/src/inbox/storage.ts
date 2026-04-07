/**
 * Inbox JSONL storage — read/write helpers for messages, events, tasks, and sync state.
 *
 * Follows the same resilient JSONL patterns as session storage:
 * - Atomic writes via .tmp + rename
 * - Resilient reads that skip corrupted lines
 * - Append-safe for messages (partial appends tolerated by resilient reader)
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, renameSync, unlinkSync } from 'fs';
import { join, dirname } from 'path';
import { readJsonFileSync, atomicWriteFileSync } from '../utils/files.ts';
import { createLogger } from '../utils/debug.ts';
import type { InboxMessage, CalendarEvent, Task } from '@scrunchy/core/types';

const log = createLogger('inbox-storage');

// ============================================================================
// Path helpers
// ============================================================================

export function getInboxDir(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'inbox');
}

export function ensureInboxDir(workspaceRootPath: string): string {
  const dir = getInboxDir(workspaceRootPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function getMessagesPath(workspaceRootPath: string): string {
  return join(getInboxDir(workspaceRootPath), 'messages.jsonl');
}

export function getEventsPath(workspaceRootPath: string): string {
  return join(getInboxDir(workspaceRootPath), 'events.jsonl');
}

export function getTasksPath(workspaceRootPath: string): string {
  return join(getInboxDir(workspaceRootPath), 'tasks.jsonl');
}

export function getSyncStatePath(workspaceRootPath: string): string {
  return join(getInboxDir(workspaceRootPath), 'sync-state.json');
}

// ============================================================================
// Generic JSONL helpers (private)
// ============================================================================

function readJsonlFile<T>(filePath: string): T[] {
  if (!existsSync(filePath)) return [];
  try {
    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    const items: T[] = [];
    for (const line of lines) {
      try {
        items.push(JSON.parse(line) as T);
      } catch {
        log.debug('Skipping corrupted JSONL line:', line.substring(0, 100));
      }
    }
    return items;
  } catch (error) {
    log.error('Failed to read JSONL file:', filePath, error);
    return [];
  }
}

function writeJsonlFile<T>(filePath: string, items: T[]): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const content = items.length > 0
    ? items.map(item => JSON.stringify(item)).join('\n') + '\n'
    : '';
  const tmpFile = filePath + '.tmp';
  writeFileSync(tmpFile, content);
  try { unlinkSync(filePath); } catch { /* ok if missing */ }
  renameSync(tmpFile, filePath);
}

function appendJsonlLines<T>(filePath: string, items: T[]): void {
  if (items.length === 0) return;
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const lines = items.map(item => JSON.stringify(item)).join('\n') + '\n';
  appendFileSync(filePath, lines);
}

// ============================================================================
// Messages
// ============================================================================

export function readMessages(workspaceRootPath: string): InboxMessage[] {
  return readJsonlFile<InboxMessage>(getMessagesPath(workspaceRootPath));
}

export function appendMessages(workspaceRootPath: string, messages: InboxMessage[]): void {
  appendJsonlLines(getMessagesPath(workspaceRootPath), messages);
}

export function rewriteMessages(workspaceRootPath: string, messages: InboxMessage[]): void {
  writeJsonlFile(getMessagesPath(workspaceRootPath), messages);
}

export function getMessageById(workspaceRootPath: string, id: string): InboxMessage | undefined {
  return readMessages(workspaceRootPath).find(m => m.id === id);
}

// ============================================================================
// Calendar Events
// ============================================================================

export function readEvents(workspaceRootPath: string): CalendarEvent[] {
  return readJsonlFile<CalendarEvent>(getEventsPath(workspaceRootPath));
}

export function replaceEvents(workspaceRootPath: string, events: CalendarEvent[]): void {
  writeJsonlFile(getEventsPath(workspaceRootPath), events);
}

/**
 * Merge new calendar events with existing ones.
 * - Existing events with the same ID get updated (times, attendees may change)
 * - New events (unknown ID) get appended
 * - Past events that aren't in the new set are preserved (not deleted)
 */
export function mergeEvents(workspaceRootPath: string, newEvents: CalendarEvent[]): void {
  const existing = readEvents(workspaceRootPath);
  const existingById = new Map(existing.map(e => [e.id, e]));

  // Update existing + add new
  for (const evt of newEvents) {
    existingById.set(evt.id, evt);
  }

  writeJsonlFile(getEventsPath(workspaceRootPath), Array.from(existingById.values()));
}

// ============================================================================
// Retention cleanup
// ============================================================================

/**
 * Remove messages older than `maxAgeDays`. Returns count of pruned messages.
 */
export function pruneOldMessages(workspaceRootPath: string, maxAgeDays: number): number {
  const messages = readMessages(workspaceRootPath);
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const kept = messages.filter(m => new Date(m.receivedAt).getTime() >= cutoff);
  const pruned = messages.length - kept.length;
  if (pruned > 0) {
    writeJsonlFile(getMessagesPath(workspaceRootPath), kept);
  }
  return pruned;
}

/**
 * Remove calendar events that ended more than `maxAgeDays` ago. Returns count of pruned events.
 */
export function pruneOldEvents(workspaceRootPath: string, maxAgeDays: number): number {
  const events = readEvents(workspaceRootPath);
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const kept = events.filter(e => new Date(e.endTime).getTime() >= cutoff);
  const pruned = events.length - kept.length;
  if (pruned > 0) {
    writeJsonlFile(getEventsPath(workspaceRootPath), kept);
  }
  return pruned;
}

// ============================================================================
// Tasks
// ============================================================================

export function readTasks(workspaceRootPath: string): Task[] {
  return readJsonlFile<Task>(getTasksPath(workspaceRootPath));
}

export function writeTasks(workspaceRootPath: string, tasks: Task[]): void {
  writeJsonlFile(getTasksPath(workspaceRootPath), tasks);
}

export function createTask(workspaceRootPath: string, task: Task): Task {
  appendJsonlLines(getTasksPath(workspaceRootPath), [task]);
  return task;
}

export function updateTask(
  workspaceRootPath: string,
  taskId: string,
  patch: Partial<Task>,
): Task | null {
  const tasks = readTasks(workspaceRootPath);
  const index = tasks.findIndex(t => t.id === taskId);
  if (index === -1) return null;
  const updated: Task = { ...tasks[index], ...patch, updatedAt: new Date().toISOString() } as Task;
  tasks[index] = updated;
  writeTasks(workspaceRootPath, tasks);
  return updated;
}

export function deleteTask(workspaceRootPath: string, taskId: string): boolean {
  const tasks = readTasks(workspaceRootPath);
  const filtered = tasks.filter(t => t.id !== taskId);
  if (filtered.length === tasks.length) return false;
  writeTasks(workspaceRootPath, filtered);
  return true;
}

// ============================================================================
// Sync State
// ============================================================================

export interface SyncCursor {
  lastSyncAt: string;
  cursor?: string;
  lastFetchCount?: number;
}

export interface SyncState {
  cursors: Record<string, SyncCursor>;
}

export function readSyncState(workspaceRootPath: string): SyncState {
  const path = getSyncStatePath(workspaceRootPath);
  if (!existsSync(path)) return { cursors: {} };
  try {
    return readJsonFileSync<SyncState>(path);
  } catch {
    return { cursors: {} };
  }
}

export function writeSyncState(workspaceRootPath: string, state: SyncState): void {
  ensureInboxDir(workspaceRootPath);
  atomicWriteFileSync(getSyncStatePath(workspaceRootPath), JSON.stringify(state, null, 2));
}
