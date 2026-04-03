import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { InboxMessage, CalendarEvent, Task } from '@craft-agent/core/types';
import {
  ensureInboxDir,
  getInboxDir,
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
} from '../storage.ts';

const TEST_DIR = join(import.meta.dir, '.test-storage-workspace');

function makeMessage(id: string, overrides?: Partial<InboxMessage>): InboxMessage {
  return {
    id,
    sourceSlug: 'slack',
    sourceType: 'slack',
    externalId: id,
    from: { name: 'Alice' },
    body: `Message ${id}`,
    receivedAt: '2026-04-02T10:00:00Z',
    isRead: false,
    ...overrides,
  };
}

function makeTask(id: string, overrides?: Partial<Task>): Task {
  return {
    id,
    title: `Task ${id}`,
    state: 'todo',
    priority: 'medium',
    source: 'manual',
    createdAt: '2026-04-02T10:00:00Z',
    updatedAt: '2026-04-02T10:00:00Z',
    ...overrides,
  };
}

function makeEvent(id: string, overrides?: Partial<CalendarEvent>): CalendarEvent {
  return {
    id,
    sourceSlug: 'gcal',
    externalId: id,
    title: `Event ${id}`,
    startTime: '2026-04-02T09:00:00Z',
    endTime: '2026-04-02T10:00:00Z',
    allDay: false,
    calendarName: 'Work',
    ...overrides,
  };
}

describe('inbox storage', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  describe('ensureInboxDir', () => {
    it('creates inbox directory', () => {
      ensureInboxDir(TEST_DIR);
      expect(existsSync(getInboxDir(TEST_DIR))).toBe(true);
    });

    it('is idempotent', () => {
      ensureInboxDir(TEST_DIR);
      ensureInboxDir(TEST_DIR);
      expect(existsSync(getInboxDir(TEST_DIR))).toBe(true);
    });
  });

  describe('messages', () => {
    it('returns empty array when no file exists', () => {
      expect(readMessages(TEST_DIR)).toEqual([]);
    });

    it('appends and reads messages', () => {
      appendMessages(TEST_DIR, [makeMessage('1'), makeMessage('2')]);
      const msgs = readMessages(TEST_DIR);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].id).toBe('1');
      expect(msgs[1].id).toBe('2');
    });

    it('appends incrementally', () => {
      appendMessages(TEST_DIR, [makeMessage('1')]);
      appendMessages(TEST_DIR, [makeMessage('2')]);
      expect(readMessages(TEST_DIR)).toHaveLength(2);
    });

    it('rewrites messages atomically', () => {
      appendMessages(TEST_DIR, [makeMessage('1'), makeMessage('2'), makeMessage('3')]);
      rewriteMessages(TEST_DIR, [makeMessage('1', { isRead: true }), makeMessage('3')]);
      const msgs = readMessages(TEST_DIR);
      expect(msgs).toHaveLength(2);
      expect(msgs[0].isRead).toBe(true);
      expect(msgs[1].id).toBe('3');
    });

    it('skips corrupted lines', () => {
      ensureInboxDir(TEST_DIR);
      const path = join(getInboxDir(TEST_DIR), 'messages.jsonl');
      const content = [
        JSON.stringify(makeMessage('1')),
        'this is not json',
        JSON.stringify(makeMessage('2')),
      ].join('\n') + '\n';
      require('fs').writeFileSync(path, content);
      const msgs = readMessages(TEST_DIR);
      expect(msgs).toHaveLength(2);
    });

    it('finds message by id', () => {
      appendMessages(TEST_DIR, [makeMessage('1'), makeMessage('2')]);
      expect(getMessageById(TEST_DIR, '2')?.id).toBe('2');
      expect(getMessageById(TEST_DIR, 'nonexistent')).toBeUndefined();
    });
  });

  describe('calendar events', () => {
    it('returns empty array when no file exists', () => {
      expect(readEvents(TEST_DIR)).toEqual([]);
    });

    it('replaces events', () => {
      replaceEvents(TEST_DIR, [makeEvent('e1'), makeEvent('e2')]);
      expect(readEvents(TEST_DIR)).toHaveLength(2);

      replaceEvents(TEST_DIR, [makeEvent('e3')]);
      const events = readEvents(TEST_DIR);
      expect(events).toHaveLength(1);
      expect(events[0].id).toBe('e3');
    });
  });

  describe('tasks', () => {
    it('returns empty array when no file exists', () => {
      expect(readTasks(TEST_DIR)).toEqual([]);
    });

    it('creates a task', () => {
      const task = createTask(TEST_DIR, makeTask('t1'));
      expect(task.id).toBe('t1');
      expect(readTasks(TEST_DIR)).toHaveLength(1);
    });

    it('updates a task', () => {
      createTask(TEST_DIR, makeTask('t1'));
      const updated = updateTask(TEST_DIR, 't1', { state: 'in_progress', title: 'Updated' });
      expect(updated?.state).toBe('in_progress');
      expect(updated?.title).toBe('Updated');
      expect(readTasks(TEST_DIR)[0].state).toBe('in_progress');
    });

    it('returns null when updating nonexistent task', () => {
      expect(updateTask(TEST_DIR, 'nope', { state: 'done' })).toBeNull();
    });

    it('deletes a task', () => {
      createTask(TEST_DIR, makeTask('t1'));
      createTask(TEST_DIR, makeTask('t2'));
      expect(deleteTask(TEST_DIR, 't1')).toBe(true);
      expect(readTasks(TEST_DIR)).toHaveLength(1);
      expect(readTasks(TEST_DIR)[0].id).toBe('t2');
    });

    it('returns false when deleting nonexistent task', () => {
      expect(deleteTask(TEST_DIR, 'nope')).toBe(false);
    });
  });

  describe('sync state', () => {
    it('returns empty cursors when no file exists', () => {
      expect(readSyncState(TEST_DIR)).toEqual({ cursors: {} });
    });

    it('writes and reads sync state', () => {
      const state = {
        cursors: {
          slack: { lastSyncAt: '2026-04-02T10:00:00Z', cursor: 'abc', lastFetchCount: 5 },
        },
      };
      writeSyncState(TEST_DIR, state);
      const loaded = readSyncState(TEST_DIR);
      expect(loaded.cursors.slack.lastSyncAt).toBe('2026-04-02T10:00:00Z');
      expect(loaded.cursors.slack.cursor).toBe('abc');
      expect(loaded.cursors.slack.lastFetchCount).toBe(5);
    });
  });
});
