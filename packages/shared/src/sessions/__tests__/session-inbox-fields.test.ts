import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { createSession, loadSession } from '../storage.ts';

const TEST_DIR = join(import.meta.dir, '.test-session-inbox-fields');

describe('session inbox/calendar fields', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('persists inboxMessageId through create and reload', async () => {
    const session = await createSession(TEST_DIR, { inboxMessageId: 'slack:msg123' });
    expect(session.inboxMessageId).toBe('slack:msg123');

    const reloaded = loadSession(TEST_DIR, session.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.inboxMessageId).toBe('slack:msg123');
  });

  it('persists calendarEventId through create and reload', async () => {
    const session = await createSession(TEST_DIR, { calendarEventId: 'gcal:evt456' });
    expect(session.calendarEventId).toBe('gcal:evt456');

    const reloaded = loadSession(TEST_DIR, session.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.calendarEventId).toBe('gcal:evt456');
  });

  it('persists both fields together', async () => {
    const session = await createSession(TEST_DIR, {
      inboxMessageId: 'slack:msg123',
      calendarEventId: 'gcal:evt456',
    });
    expect(session.inboxMessageId).toBe('slack:msg123');
    expect(session.calendarEventId).toBe('gcal:evt456');

    const reloaded = loadSession(TEST_DIR, session.id);
    expect(reloaded!.inboxMessageId).toBe('slack:msg123');
    expect(reloaded!.calendarEventId).toBe('gcal:evt456');
  });

  it('fields are undefined when not provided (backward compat)', async () => {
    const session = await createSession(TEST_DIR);
    expect(session.inboxMessageId).toBeUndefined();
    expect(session.calendarEventId).toBeUndefined();

    const reloaded = loadSession(TEST_DIR, session.id);
    expect(reloaded!.inboxMessageId).toBeUndefined();
    expect(reloaded!.calendarEventId).toBeUndefined();
  });
});
