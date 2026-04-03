import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { TriageService } from '../triage-service.ts';
import { WorkspaceEventBus } from '../../automations/event-bus.ts';
import { appendMessages, readMessages, replaceEvents, readEvents } from '../storage.ts';
import { saveInboxConfig, DEFAULT_INBOX_CONFIG } from '../config.ts';
import type { InboxMessage, CalendarEvent } from '@craft-agent/core/types';
import type { SimpleLlmCallFn } from '../../agent/simple-llm-call.ts';

const TEST_DIR = join(import.meta.dir, '.test-triage-workspace');

// Mock LLM call that returns configurable responses
let mockLlmResponse = '[]';
const mockCallLlm: SimpleLlmCallFn = async () => mockLlmResponse;

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

describe('TriageService', () => {
  let eventBus: WorkspaceEventBus;
  let service: TriageService;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    eventBus = new WorkspaceEventBus('test-workspace');

    saveInboxConfig(TEST_DIR, {
      ...DEFAULT_INBOX_CONFIG,
      triageEnabled: true,
      triageCalendar: true,
      triageModel: 'test-model',
    });

    service = new TriageService({
      workspaceRootPath: TEST_DIR,
      workspaceId: 'test-workspace',
      eventBus,
      callLlm: mockCallLlm,
    });
  });

  afterEach(() => {
    eventBus.dispose();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mockLlmResponse = '[]';
  });

  describe('message triage', () => {
    it('triages un-triaged messages', async () => {
      appendMessages(TEST_DIR, [makeMessage('m1'), makeMessage('m2')]);
      mockLlmResponse = JSON.stringify([
        { isActionable: true, category: 'request', priority: 'high', summary: 'Fix the bug', suggestedPrompt: 'Fix the auth bug in login.ts' },
        { isActionable: false, category: 'fyi', priority: 'low', summary: 'Deploy notice', suggestedPrompt: null },
      ]);

      const result = await service.triageAll();

      expect(result.messagesTriaged).toBe(2);
      const messages = readMessages(TEST_DIR);
      expect(messages[0]!.triage).toBeDefined();
      expect(messages[0]!.triage!.isActionable).toBe(true);
      expect(messages[0]!.triage!.category).toBe('request');
      expect(messages[0]!.triage!.priority).toBe('high');
      expect(messages[1]!.triage!.isActionable).toBe(false);
      expect(messages[1]!.triage!.category).toBe('fyi');
    });

    it('does not create tasks (tasks are disabled)', async () => {
      appendMessages(TEST_DIR, [makeMessage('m1')]);
      mockLlmResponse = JSON.stringify([
        { isActionable: true, category: 'request', priority: 'high', summary: 'Fix bug', suggestedPrompt: 'Fix the bug' },
      ]);

      const result = await service.triageAll();

      expect(result.tasksCreated).toBe(0);
    });

    it('skips already-triaged messages', async () => {
      appendMessages(TEST_DIR, [
        makeMessage('m1', { triage: { isActionable: false, summary: 'Already done', category: 'fyi', priority: 'low', triagedAt: '2026-04-02T10:00:00Z', model: 'haiku' } }),
      ]);
      mockLlmResponse = '[]';

      const result = await service.triageAll();

      expect(result.messagesTriaged).toBe(0);
    });

    it('emits InboxActionableMessage for actionable messages', async () => {
      appendMessages(TEST_DIR, [makeMessage('m1')]);
      mockLlmResponse = JSON.stringify([
        { isActionable: true, category: 'request', priority: 'high', summary: 'Do thing', suggestedPrompt: 'Do the thing' },
      ]);

      const actionableHandler = jest.fn();
      eventBus.on('InboxActionableMessage', actionableHandler);

      await service.triageAll();

      expect(actionableHandler).toHaveBeenCalledTimes(1);
      expect(actionableHandler).toHaveBeenCalledWith(expect.objectContaining({ messageId: 'm1' }));
    });

    it('validates category and priority values', async () => {
      appendMessages(TEST_DIR, [makeMessage('m1')]);
      mockLlmResponse = JSON.stringify([
        { isActionable: false, category: 'invalid_category', priority: 'invalid_priority', summary: 'Test', suggestedPrompt: null },
      ]);

      await service.triageAll();

      const messages = readMessages(TEST_DIR);
      expect(messages[0]!.triage!.category).toBe('fyi'); // fallback
      expect(messages[0]!.triage!.priority).toBe('medium'); // fallback
    });

    it('handles malformed LLM response gracefully', async () => {
      appendMessages(TEST_DIR, [makeMessage('m1')]);
      mockLlmResponse = 'this is not json at all';

      const result = await service.triageAll();

      // Should not crash — messages remain un-triaged
      expect(result.messagesTriaged).toBe(1);
      const messages = readMessages(TEST_DIR);
      // Triage field will be set to null results from parseJsonArray
      expect(messages[0]!.triage).toBeUndefined();
    });
  });

  describe('calendar triage', () => {
    it('triages upcoming events', async () => {
      replaceEvents(TEST_DIR, [makeEvent('e1')]);
      mockLlmResponse = JSON.stringify([
        { needsPrep: true, summary: 'Review PR before meeting', suggestedPrepPrompt: 'Review PR #456' },
      ]);

      const result = await service.triageAll();

      expect(result.eventsTriaged).toBe(1);
      const events = readEvents(TEST_DIR);
      expect(events[0]!.triage).toBeDefined();
      expect(events[0]!.triage!.needsPrep).toBe(true);
      expect(events[0]!.triage!.suggestedPrepPrompt).toBe('Review PR #456');
    });

    it('does not create tasks (tasks are disabled)', async () => {
      replaceEvents(TEST_DIR, [makeEvent('e1', { title: 'Standup' })]);
      mockLlmResponse = JSON.stringify([
        { needsPrep: true, summary: 'Review blockers', suggestedPrepPrompt: 'Check JIRA for blockers' },
      ]);

      const result = await service.triageAll();

      expect(result.tasksCreated).toBe(0);
    });
  });

  describe('config', () => {
    it('skips triage when disabled', async () => {
      saveInboxConfig(TEST_DIR, { ...DEFAULT_INBOX_CONFIG, triageEnabled: false });
      appendMessages(TEST_DIR, [makeMessage('m1')]);

      const result = await service.triageAll();

      expect(result.messagesTriaged).toBe(0);
      expect(result.eventsTriaged).toBe(0);
    });

    it('skips calendar triage when triageCalendar is false', async () => {
      saveInboxConfig(TEST_DIR, { ...DEFAULT_INBOX_CONFIG, triageEnabled: true, triageCalendar: false });
      replaceEvents(TEST_DIR, [makeEvent('e1')]);
      mockLlmResponse = JSON.stringify([]);

      const result = await service.triageAll();

      expect(result.eventsTriaged).toBe(0);
    });
  });
});
