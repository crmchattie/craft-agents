import { describe, it, expect, beforeEach, afterEach, jest } from 'bun:test';
import { mkdirSync, rmSync, existsSync, writeFileSync } from 'fs';
import { join } from 'path';
import { InboxSyncService, type InboxSyncServiceOptions } from '../sync-service.ts';
import { WorkspaceEventBus } from '../../automations/event-bus.ts';
import { getInboxConfigPath } from '../config.ts';
import { readMessages, readEvents, readSyncState } from '../storage.ts';

const TEST_DIR = join(import.meta.dir, '.test-sync-workspace');

function makeMockPool(responses: Record<string, { content: string; isError: boolean }> = {}) {
  return {
    callTool: jest.fn(async (proxyName: string, _args: Record<string, unknown>) => {
      return responses[proxyName] ?? { content: '[]', isError: false };
    }),
    hasProxyTool: (name: string) => name in responses,
  } as any;
}

function writeConfig(sources: any[]) {
  writeFileSync(
    getInboxConfigPath(TEST_DIR),
    JSON.stringify({
      backgroundSyncEnabled: true,
      syncIntervalMinutes: 1,
      sources,
    }),
  );
}

describe('InboxSyncService', () => {
  let eventBus: WorkspaceEventBus;

  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
    eventBus = new WorkspaceEventBus('test-workspace');
  });

  afterEach(() => {
    eventBus.dispose();
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  function createService(pool: any): InboxSyncService {
    return new InboxSyncService({
      workspaceRootPath: TEST_DIR,
      workspaceId: 'test-workspace',
      eventBus,
      mcpPool: pool,
    });
  }

  it('returns early when no sources configured', async () => {
    const pool = makeMockPool();
    const service = createService(pool);
    const result = await service.sync(true);
    expect(result.newMessageCount).toBe(0);
    expect(pool.callTool).not.toHaveBeenCalled();
  });

  it('fetches and stores messages from MCP', async () => {
    writeConfig([
      { sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' },
    ]);

    const pool = makeMockPool({
      'mcp__slack__list_messages': {
        content: JSON.stringify([
          { id: 'msg1', from: 'Alice', text: 'Hello', timestamp: '2026-04-02T10:00:00Z' },
          { id: 'msg2', from: 'Bob', text: 'Hi', timestamp: '2026-04-02T10:01:00Z' },
        ]),
        isError: false,
      },
    });

    const service = createService(pool);
    const result = await service.sync(true);

    expect(result.newMessageCount).toBe(2);
    expect(pool.callTool).toHaveBeenCalledTimes(1);

    const messages = readMessages(TEST_DIR);
    expect(messages).toHaveLength(2);
    expect(messages[0]!.sourceSlug).toBe('slack');
    expect(messages[0]!.sourceType).toBe('slack');
  });

  it('deduplicates messages on subsequent syncs', async () => {
    writeConfig([
      { sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' },
    ]);

    const pool = makeMockPool({
      'mcp__slack__list_messages': {
        content: JSON.stringify([
          { id: 'msg1', from: 'Alice', text: 'Hello', timestamp: '2026-04-02T10:00:00Z' },
        ]),
        isError: false,
      },
    });

    const service = createService(pool);
    await service.sync(true);
    await service.sync(true);

    expect(readMessages(TEST_DIR)).toHaveLength(1);
  });

  it('fetches and stores calendar events', async () => {
    writeConfig([
      { sourceSlug: 'gcal', sourceType: 'calendar', enabled: true, fetchToolName: 'list_events' },
    ]);

    const pool = makeMockPool({
      'mcp__gcal__list_events': {
        content: JSON.stringify([
          { id: 'evt1', title: 'Standup', start: '2026-04-02T09:00:00Z', end: '2026-04-02T09:15:00Z' },
        ]),
        isError: false,
      },
    });

    const service = createService(pool);
    const result = await service.sync(true);

    expect(result.newEventCount).toBe(1);
    const events = readEvents(TEST_DIR);
    expect(events).toHaveLength(1);
    expect(events[0]!.title).toBe('Standup');
  });

  it('emits InboxNewMessages event', async () => {
    writeConfig([
      { sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' },
    ]);

    const pool = makeMockPool({
      'mcp__slack__list_messages': {
        content: JSON.stringify([{ id: 'msg1', from: 'Alice', text: 'Hi' }]),
        isError: false,
      },
    });

    const handler = jest.fn();
    eventBus.on('InboxNewMessages', handler);

    const service = createService(pool);
    await service.sync(true);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      sourceSlug: 'slack',
      count: 1,
    }));
  });

  it('emits InboxSyncError on MCP failure', async () => {
    writeConfig([
      { sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' },
    ]);

    const pool = makeMockPool({
      'mcp__slack__list_messages': { content: 'Connection refused', isError: true },
    });

    const handler = jest.fn();
    eventBus.on('InboxSyncError', handler);

    const service = createService(pool);
    const result = await service.sync(true);

    expect(result.errors).toHaveLength(1);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      sourceSlug: 'slack',
    }));
  });

  it('skips disabled sources', async () => {
    writeConfig([
      { sourceSlug: 'slack', sourceType: 'slack', enabled: false, fetchToolName: 'list_messages' },
    ]);

    const pool = makeMockPool();
    const service = createService(pool);
    await service.sync(true);

    expect(pool.callTool).not.toHaveBeenCalled();
  });

  it('respects interval when not forced', async () => {
    writeConfig([
      { sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' },
    ]);

    const pool = makeMockPool({
      'mcp__slack__list_messages': { content: '[]', isError: false },
    });

    const service = createService(pool);
    await service.sync(true); // first sync
    await service.sync(false); // should skip — interval not elapsed

    expect(pool.callTool).toHaveBeenCalledTimes(1);
  });

  it('updates sync state after sync', async () => {
    writeConfig([
      { sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' },
    ]);

    const pool = makeMockPool({
      'mcp__slack__list_messages': { content: '[]', isError: false },
    });

    const service = createService(pool);
    await service.sync(true);

    const state = readSyncState(TEST_DIR);
    expect(state.cursors.slack).toBeDefined();
    expect(state.cursors.slack!.lastSyncAt).toBeTruthy();
  });

  it('prevents concurrent syncs', async () => {
    writeConfig([
      { sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' },
    ]);

    let resolveCall: () => void;
    const pool = {
      callTool: jest.fn(() => new Promise<any>((resolve) => {
        resolveCall = () => resolve({ content: '[]', isError: false });
      })),
      hasProxyTool: () => true,
    } as any;

    const service = createService(pool);
    const p1 = service.sync(true);
    const p2 = service.sync(true); // should skip

    resolveCall!();
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(pool.callTool).toHaveBeenCalledTimes(1);
    expect(r2.errors[0]).toContain('already in progress');
  });

  it('calls triageService.triageAll after sync when provided', async () => {
    writeConfig([
      { sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' },
    ]);

    const pool = makeMockPool({
      'mcp__slack__list_messages': { content: '[]', isError: false },
    });

    const triageAll = jest.fn(async () => ({ messagesTriaged: 0, eventsTriaged: 0, tasksCreated: 0 }));
    const mockTriageService = { triageAll } as any;

    const service = new InboxSyncService({
      workspaceRootPath: TEST_DIR,
      workspaceId: 'test-workspace',
      eventBus,
      mcpPool: pool,
      triageService: mockTriageService,
    });

    await service.sync(true);

    expect(triageAll).toHaveBeenCalledTimes(1);
  });

  it('does not call triage when triageEnabled is false in config', async () => {
    writeFileSync(
      getInboxConfigPath(TEST_DIR),
      JSON.stringify({
        backgroundSyncEnabled: true,
        syncIntervalMinutes: 1,
        triageEnabled: false,
        sources: [{ sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' }],
      }),
    );

    const pool = makeMockPool({
      'mcp__slack__list_messages': { content: '[]', isError: false },
    });

    const triageAll = jest.fn(async () => ({ messagesTriaged: 0, eventsTriaged: 0, tasksCreated: 0 }));
    const mockTriageService = { triageAll } as any;

    const service = new InboxSyncService({
      workspaceRootPath: TEST_DIR,
      workspaceId: 'test-workspace',
      eventBus,
      mcpPool: pool,
      triageService: mockTriageService,
    });

    await service.sync(true);

    expect(triageAll).not.toHaveBeenCalled();
  });

  describe('resolveProxyName', () => {
    it('uses configured tool name when it exists in pool', async () => {
      writeConfig([
        { sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' },
      ]);

      const pool = makeMockPool({
        'mcp__slack__list_messages': { content: '[]', isError: false },
      });

      const service = createService(pool);
      await service.sync(true);

      expect(pool.callTool).toHaveBeenCalledWith(
        'mcp__slack__list_messages',
        expect.any(Object),
      );
    });

    it('falls back to api_{slug} naming for API sources', async () => {
      writeConfig([
        { sourceSlug: 'gmail', sourceType: 'email', enabled: true, fetchToolName: 'list_messages' },
      ]);

      // Pool only has the API-style tool name
      const pool = makeMockPool({
        'mcp__gmail__api_gmail': { content: '[]', isError: false },
      });

      const service = createService(pool);
      await service.sync(true);

      expect(pool.callTool).toHaveBeenCalledWith(
        'mcp__gmail__api_gmail',
        expect.any(Object),
      );
    });

    it('uses configured name when neither exists (error deferred to callTool)', async () => {
      writeConfig([
        { sourceSlug: 'custom', sourceType: 'email', enabled: true, fetchToolName: 'fetch_mail' },
      ]);

      // Pool has no matching tools at all
      const pool = makeMockPool({});
      // callTool will return error for unknown tool
      pool.callTool = jest.fn(async () => ({ content: 'Unknown tool', isError: true }));

      const service = createService(pool);
      const result = await service.sync(true);

      expect(pool.callTool).toHaveBeenCalledWith(
        'mcp__custom__fetch_mail',
        expect.any(Object),
      );
      expect(result.errors).toHaveLength(1);
    });
  });

  describe('syncPool callback', () => {
    it('calls syncPool before each sync', async () => {
      writeConfig([
        { sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' },
      ]);

      const pool = makeMockPool({
        'mcp__slack__list_messages': { content: '[]', isError: false },
      });
      const syncPool = jest.fn(async () => {});

      const service = new InboxSyncService({
        workspaceRootPath: TEST_DIR,
        workspaceId: 'test-workspace',
        eventBus,
        mcpPool: pool,
        syncPool,
      });

      await service.sync(true);
      expect(syncPool).toHaveBeenCalledTimes(1);
    });

    it('continues sync even if syncPool throws', async () => {
      writeConfig([
        { sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' },
      ]);

      const pool = makeMockPool({
        'mcp__slack__list_messages': { content: '[]', isError: false },
      });
      const syncPool = jest.fn(async () => { throw new Error('pool sync failed'); });

      const service = new InboxSyncService({
        workspaceRootPath: TEST_DIR,
        workspaceId: 'test-workspace',
        eventBus,
        mcpPool: pool,
        syncPool,
      });

      const result = await service.sync(true);
      // Sync should proceed despite syncPool error
      expect(result.errors).toHaveLength(0);
      expect(pool.callTool).toHaveBeenCalled();
    });
  });

  describe('retention cleanup', () => {
    it('prunes old data when retentionDays > 0', async () => {
      const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const { appendMessages } = await import('../storage.ts');
      appendMessages(TEST_DIR, [{
        id: 'old-msg', sourceSlug: 'slack', sourceType: 'slack' as const,
        externalId: 'old-msg', from: { name: 'Alice' }, body: 'old',
        receivedAt: oldDate, isRead: false,
      }]);

      writeFileSync(
        getInboxConfigPath(TEST_DIR),
        JSON.stringify({
          backgroundSyncEnabled: true,
          syncIntervalMinutes: 1,
          retentionDays: 30,
          sources: [],
        }),
      );

      const pool = makeMockPool();
      const service = createService(pool);
      await service.sync(true);

      const { readMessages } = await import('../storage.ts');
      expect(readMessages(TEST_DIR)).toHaveLength(0);
    });

    it('skips cleanup when retentionDays is 0', async () => {
      const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
      const { appendMessages } = await import('../storage.ts');
      appendMessages(TEST_DIR, [{
        id: 'old-msg', sourceSlug: 'slack', sourceType: 'slack' as const,
        externalId: 'old-msg', from: { name: 'Alice' }, body: 'old',
        receivedAt: oldDate, isRead: false,
      }]);

      writeFileSync(
        getInboxConfigPath(TEST_DIR),
        JSON.stringify({
          backgroundSyncEnabled: true,
          syncIntervalMinutes: 1,
          retentionDays: 0,
          sources: [],
        }),
      );

      const pool = makeMockPool();
      const service = createService(pool);
      await service.sync(true);

      const { readMessages } = await import('../storage.ts');
      expect(readMessages(TEST_DIR)).toHaveLength(1);
    });
  });

  describe('calendar merge behavior', () => {
    it('preserves existing events when syncing new ones', async () => {
      const { replaceEvents, readEvents } = await import('../storage.ts');
      replaceEvents(TEST_DIR, [{
        id: 'past-event', sourceSlug: 'gcal', externalId: 'past-event',
        title: 'Yesterday Meeting', startTime: '2026-04-01T09:00:00Z',
        endTime: '2026-04-01T10:00:00Z', allDay: false, calendarName: 'Work',
      }]);

      writeConfig([
        { sourceSlug: 'gcal', sourceType: 'calendar', enabled: true, fetchToolName: 'list_events' },
      ]);

      const pool = makeMockPool({
        'mcp__gcal__list_events': {
          content: JSON.stringify([
            { id: 'new-event', title: 'Today Meeting', start: '2026-04-02T09:00:00Z', end: '2026-04-02T10:00:00Z' },
          ]),
          isError: false,
        },
      });

      const service = createService(pool);
      await service.sync(true);

      const events = readEvents(TEST_DIR);
      expect(events).toHaveLength(2);
      expect(events.find(e => e.id === 'past-event')).toBeDefined();
      expect(events.find(e => e.id.includes('new-event'))).toBeDefined();
    });
  });
});
