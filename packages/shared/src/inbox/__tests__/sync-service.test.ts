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
    getConnectedSlugs: () => {
      // Derive slugs from registered proxy tool names: "mcp__{slug}__{tool}"
      const slugs = new Set<string>();
      for (const key of Object.keys(responses)) {
        const m = key.match(/^mcp__([^_]+(?:_[^_]+)*?)__/);
        if (m) slugs.add(m[1]!);
      }
      return Array.from(slugs);
    },
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
      getConnectedSlugs: () => [],
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

  describe('resolveProxyName with serverSlug', () => {
    it('uses serverSlug for pool lookup when set (multi-capability server)', async () => {
      writeConfig([
        {
          sourceSlug: 'claude_ai_Microsoft_365_email',
          sourceType: 'email',
          enabled: true,
          fetchToolName: 'outlook_email_search',
          serverSlug: 'claude_ai_Microsoft_365',
        },
      ]);

      // Pool registers under the base server slug, not the suffixed config slug
      const pool = makeMockPool({
        'mcp__claude_ai_Microsoft_365__outlook_email_search': {
          content: JSON.stringify([{ id: 'msg1', from: 'Alice', subject: 'Test', receivedDateTime: '2026-04-02T10:00:00Z' }]),
          isError: false,
        },
      });

      const service = createService(pool);
      const result = await service.sync(true);

      expect(pool.callTool).toHaveBeenCalledWith(
        'mcp__claude_ai_Microsoft_365__outlook_email_search',
        expect.any(Object),
      );
      expect(result.newMessageCount).toBe(1);
    });

    it('falls back to sourceSlug when serverSlug is not set (single-capability server)', async () => {
      writeConfig([
        { sourceSlug: 'claude_ai_Gmail', sourceType: 'email', enabled: true, fetchToolName: 'gmail_search_messages' },
      ]);

      const pool = makeMockPool({
        'mcp__claude_ai_Gmail__gmail_search_messages': { content: '[]', isError: false },
      });

      const service = createService(pool);
      await service.sync(true);

      expect(pool.callTool).toHaveBeenCalledWith(
        'mcp__claude_ai_Gmail__gmail_search_messages',
        expect.any(Object),
      );
    });
  });

  describe('parseToolContent truncation handling', () => {
    it('returns empty array for SDK truncation errors instead of raw string', async () => {
      writeConfig([
        { sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'slack_search' },
      ]);

      const pool = makeMockPool({
        'mcp__slack__slack_search': {
          content: 'Error: content length 128000 exceeds maximum allowed length of 65536',
          isError: false,
        },
      });

      const service = createService(pool);
      const result = await service.sync(true);

      // Should produce 0 messages but not throw an error
      expect(result.newMessageCount).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('config migration', () => {
    it('backfills serverSlug for suffixed sourceSlug configs', async () => {
      // Write a legacy config without serverSlug
      writeFileSync(
        getInboxConfigPath(TEST_DIR),
        JSON.stringify({
          backgroundSyncEnabled: true,
          syncIntervalMinutes: 1,
          sources: [
            {
              sourceSlug: 'claude_ai_Microsoft_365_email',
              sourceType: 'email',
              enabled: true,
              fetchToolName: 'outlook_email_search',
            },
            {
              sourceSlug: 'claude_ai_Microsoft_365_calendar',
              sourceType: 'calendar',
              enabled: true,
              fetchToolName: 'outlook_calendar_search',
            },
          ],
        }),
      );

      // Pool registers under the base slug
      const pool = makeMockPool({
        'mcp__claude_ai_Microsoft_365__outlook_email_search': {
          content: JSON.stringify([{ id: 'msg1', from: 'Alice', subject: 'Test', receivedDateTime: '2026-04-02T10:00:00Z' }]),
          isError: false,
        },
        'mcp__claude_ai_Microsoft_365__outlook_calendar_search': {
          content: JSON.stringify([{ id: 'evt1', title: 'Meeting', start: '2026-04-02T09:00:00Z', end: '2026-04-02T10:00:00Z' }]),
          isError: false,
        },
      });

      const service = createService(pool);
      const result = await service.sync(true);

      // Migration should have inferred serverSlug and tools should resolve correctly
      expect(result.newMessageCount).toBe(1);
      expect(result.newEventCount).toBe(1);
      expect(result.errors).toHaveLength(0);

      // Verify config was persisted with serverSlug
      const { loadInboxConfig } = await import('../config.ts');
      const savedConfig = loadInboxConfig(TEST_DIR);
      expect(savedConfig.sources[0]!.serverSlug).toBe('claude_ai_Microsoft_365');
      expect(savedConfig.sources[1]!.serverSlug).toBe('claude_ai_Microsoft_365');
    });

    it('caps Slack fetch count to 5 during migration', async () => {
      writeFileSync(
        getInboxConfigPath(TEST_DIR),
        JSON.stringify({
          backgroundSyncEnabled: true,
          syncIntervalMinutes: 1,
          sources: [
            {
              sourceSlug: 'claude_ai_Slack',
              sourceType: 'slack',
              enabled: true,
              fetchToolName: 'slack_search_public_and_private',
              fetchToolArgs: { query: '*', sort: 'timestamp', count: 20 },
            },
          ],
        }),
      );

      const pool = makeMockPool({
        'mcp__claude_ai_Slack__slack_search_public_and_private': { content: '[]', isError: false },
      });

      const service = createService(pool);
      await service.sync(true);

      // Verify config was updated with reduced count and migrated query
      const { loadInboxConfig } = await import('../config.ts');
      const savedConfig = loadInboxConfig(TEST_DIR);
      const args = savedConfig.sources[0]!.fetchToolArgs!;
      expect(args.count).toBe(5);
      expect(args.query).toBe('to:me');
      expect(args.sort).toBe('timestamp');
      expect(args.response_format).toBe('detailed');
    });

    it('replaces M365 email query "*" with folderName "inbox" during migration', async () => {
      writeFileSync(
        getInboxConfigPath(TEST_DIR),
        JSON.stringify({
          backgroundSyncEnabled: true,
          syncIntervalMinutes: 1,
          sources: [
            {
              sourceSlug: 'claude_ai_Microsoft_365_email',
              sourceType: 'email',
              enabled: true,
              fetchToolName: 'outlook_email_search',
              fetchToolArgs: { query: '*', count: 20 },
              serverSlug: 'claude_ai_Microsoft_365',
            },
          ],
        }),
      );

      const pool = makeMockPool({
        'mcp__claude_ai_Microsoft_365__outlook_email_search': {
          content: JSON.stringify([{ id: 'msg1', from: 'Alice', subject: 'Test', receivedDateTime: '2026-04-02T10:00:00Z' }]),
          isError: false,
        },
      });

      const service = createService(pool);
      await service.sync(true);

      // Verify config was updated: query removed, folderName added, count migrated to limit
      const { loadInboxConfig } = await import('../config.ts');
      const savedConfig = loadInboxConfig(TEST_DIR);
      const args = savedConfig.sources[0]!.fetchToolArgs!;
      expect(args.query).toBeUndefined();
      expect(args.folderName).toBe('inbox');
      expect(args.count).toBeUndefined();
      expect(args.limit).toBe(10);
      expect((args.limit as number)).toBeLessThanOrEqual(25);
    });

    it('does not modify configs that do not need migration', async () => {
      writeConfig([
        { sourceSlug: 'claude_ai_Gmail', sourceType: 'email', enabled: true, fetchToolName: 'gmail_search_messages' },
      ]);

      const pool = makeMockPool({
        'mcp__claude_ai_Gmail__gmail_search_messages': { content: '[]', isError: false },
      });

      const service = createService(pool);
      await service.sync(true);

      // Config should not have serverSlug added for non-suffixed slugs
      const { loadInboxConfig } = await import('../config.ts');
      const savedConfig = loadInboxConfig(TEST_DIR);
      expect(savedConfig.sources[0]!.serverSlug).toBeUndefined();
    });
  });

  describe('Slack detailed markdown parsing', () => {
    const SLACK_MARKDOWN_FIXTURE = `# Search Results for "to:me"

## Messages (2 results)

### Result 1 of 2
Channel: Group DM (ID: C0ACJDP09CK)
Participants: Alice, Bob
From: Arthur Oliveira Da Silva (ID: U0A3VTPGVQ9)
Time: 2026-04-15 16:49:55 EDT
Message_ts: 1776286195.218429
Permalink: [link](https://daloopa.slack.com/archives/C0ACJDP09CK/p1776286195218429)
Text:
Hey, can you review this PR?
Context before:
  - From: Bob (ID: U1234)
  - Message_ts: 1776286190.000000
---
### Result 2 of 2
Channel: #engineering (ID: C099999)
From: Carol Davis (ID: U0000003)
Time: 2026-04-15 17:00:00 EDT
Message_ts: 1776286800.000001
Permalink: [link](https://daloopa.slack.com/archives/C099999/p1776286800000001)
Text:
Deployment is complete!
---`;

    it('parses Slack detailed markdown response into InboxMessages', async () => {
      writeConfig([
        {
          sourceSlug: 'claude_ai_Slack',
          sourceType: 'slack',
          enabled: true,
          fetchToolName: 'slack_search_public_and_private',
          fetchToolArgs: { query: 'to:me', sort: 'timestamp', response_format: 'detailed', count: 5 },
        },
      ]);

      const pool = makeMockPool({
        'mcp__claude_ai_Slack__slack_search_public_and_private': {
          content: JSON.stringify({
            results: SLACK_MARKDOWN_FIXTURE,
            pagination_info: 'Page 1 of 1',
          }),
          isError: false,
        },
      });

      const service = createService(pool);
      const result = await service.sync(true);

      expect(result.newMessageCount).toBe(2);
      expect(result.errors).toHaveLength(0);

      const messages = readMessages(TEST_DIR);
      expect(messages).toHaveLength(2);

      // First message
      expect(messages[0]!.externalId).toBe('1776286195.218429');
      expect(messages[0]!.from.name).toBe('Arthur Oliveira Da Silva');
      expect(messages[0]!.body).toBe('Hey, can you review this PR?');
      expect(messages[0]!.channel).toBe('Group DM');
      expect(messages[0]!.sourceType).toBe('slack');
      // receivedAt should be derived from ts (integer seconds part)
      expect(messages[0]!.receivedAt).toBe(new Date(1776286195 * 1000).toISOString());

      // Second message
      expect(messages[1]!.externalId).toBe('1776286800.000001');
      expect(messages[1]!.from.name).toBe('Carol Davis');
      expect(messages[1]!.body).toBe('Deployment is complete!');
    });

    it('Slack incremental sync uses Message_ts as cursor', async () => {
      writeConfig([
        {
          sourceSlug: 'claude_ai_Slack',
          sourceType: 'slack',
          enabled: true,
          fetchToolName: 'slack_search_public_and_private',
          fetchToolArgs: { query: 'to:me', sort: 'timestamp', response_format: 'detailed', count: 5 },
        },
      ]);

      const pool = makeMockPool({
        'mcp__claude_ai_Slack__slack_search_public_and_private': {
          content: JSON.stringify({
            results: SLACK_MARKDOWN_FIXTURE,
            pagination_info: 'Page 1 of 1',
          }),
          isError: false,
        },
      });

      const service = createService(pool);

      // First sync — should store max ts as cursor
      await service.sync(true);

      const state = readSyncState(TEST_DIR);
      expect(state.cursors.claude_ai_Slack).toBeDefined();
      // Max ts from fixture is 1776286800.000001
      expect(state.cursors.claude_ai_Slack!.cursor).toBe('1776286800.000001');

      // Second sync — should pass cursor as `after` arg
      await service.sync(true);

      expect(pool.callTool).toHaveBeenCalledTimes(2);
      const secondCallArgs = pool.callTool.mock.calls[1]![1] as Record<string, unknown>;
      expect(secondCallArgs.after).toBe('1776286800.000001');
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

  describe('parallel fetch behavior', () => {
    it('fetches all sources in parallel, not sequentially', async () => {
      writeConfig([
        { sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' },
        { sourceSlug: 'gmail', sourceType: 'email', enabled: true, fetchToolName: 'list_messages' },
        { sourceSlug: 'gcal', sourceType: 'calendar', enabled: true, fetchToolName: 'list_events' },
      ]);

      const DELAY_MS = 100;
      const callTimes: number[] = [];

      const pool = {
        callTool: jest.fn(async (proxyName: string) => {
          callTimes.push(Date.now());
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
          if (proxyName.includes('list_events')) {
            return {
              content: JSON.stringify([{ id: 'evt1', title: 'Meeting', start: '2026-04-02T09:00:00Z', end: '2026-04-02T10:00:00Z' }]),
              isError: false,
            };
          }
          return {
            content: JSON.stringify([{ id: `msg-${proxyName}`, from: 'Alice', text: 'Hi' }]),
            isError: false,
          };
        }),
        hasProxyTool: () => true,
        getConnectedSlugs: () => [],
      } as any;

      const service = createService(pool);
      const start = Date.now();
      const result = await service.sync(true);
      const elapsed = Date.now() - start;

      // All 3 sources should have been called
      expect(pool.callTool).toHaveBeenCalledTimes(3);
      expect(result.newMessageCount).toBe(2);
      expect(result.newEventCount).toBe(1);
      expect(result.errors).toHaveLength(0);

      // If parallel, total time should be ~DELAY_MS, not ~3*DELAY_MS
      // Use generous threshold: sequential would be >= 3*DELAY_MS = 300ms
      expect(elapsed).toBeLessThan(DELAY_MS * 2.5);

      // All callTool invocations should have started within a tight window
      const maxStartSpread = Math.max(...callTimes) - Math.min(...callTimes);
      expect(maxStartSpread).toBeLessThan(DELAY_MS);
    });

    it('errors in one source do not block other sources', async () => {
      writeConfig([
        { sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' },
        { sourceSlug: 'gmail', sourceType: 'email', enabled: true, fetchToolName: 'search_messages' },
        { sourceSlug: 'gcal', sourceType: 'calendar', enabled: true, fetchToolName: 'list_events' },
      ]);

      const pool = {
        callTool: jest.fn(async (proxyName: string) => {
          if (proxyName.includes('slack')) {
            throw new Error('Slack connection timed out');
          }
          if (proxyName.includes('list_events')) {
            return {
              content: JSON.stringify([{ id: 'evt1', title: 'Meeting', start: '2026-04-02T09:00:00Z', end: '2026-04-02T10:00:00Z' }]),
              isError: false,
            };
          }
          return {
            content: JSON.stringify([{ id: 'msg1', from: 'Bob', text: 'Hello' }]),
            isError: false,
          };
        }),
        hasProxyTool: () => true,
        getConnectedSlugs: () => [],
      } as any;

      const errorHandler = jest.fn();
      eventBus.on('InboxSyncError', errorHandler);

      const service = createService(pool);
      const result = await service.sync(true);

      // All 3 sources were attempted
      expect(pool.callTool).toHaveBeenCalledTimes(3);
      // Gmail and gcal succeeded despite Slack failure
      expect(result.newMessageCount).toBe(1);
      expect(result.newEventCount).toBe(1);
      // Only Slack errored
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('slack');
      expect(result.errors[0]).toContain('Slack connection timed out');
      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(expect.objectContaining({
        sourceSlug: 'slack',
      }));
    });
  });

  describe('M365 email sync', () => {
    it('uses afterDateTime cursor on incremental syncs', async () => {
      writeConfig([
        {
          sourceSlug: 'claude_ai_Microsoft_365_email',
          sourceType: 'email',
          enabled: true,
          fetchToolName: 'outlook_email_search',
          fetchToolArgs: { folderName: 'inbox', limit: 10 },
          serverSlug: 'claude_ai_Microsoft_365',
        },
      ]);

      const pool = makeMockPool({
        'mcp__claude_ai_Microsoft_365__outlook_email_search': {
          content: JSON.stringify([
            { id: 'msg1', sender: 'alice@example.com', subject: 'Hello', receivedDateTime: '2026-04-02T09:00:00Z' },
            { id: 'msg2', sender: 'bob@example.com', subject: 'Hi', receivedDateTime: '2026-04-02T10:00:00Z' },
          ]),
          isError: false,
        },
      });

      const service = createService(pool);

      // First sync
      await service.sync(true);

      const state = readSyncState(TEST_DIR);
      expect(state.cursors.claude_ai_Microsoft_365_email).toBeDefined();
      expect(state.cursors.claude_ai_Microsoft_365_email!.cursor).toBe('2026-04-02T10:00:00Z');

      // Second sync — should pass afterDateTime
      await service.sync(true);

      expect(pool.callTool).toHaveBeenCalledTimes(2);
      const secondCallArgs = pool.callTool.mock.calls[1]![1] as Record<string, unknown>;
      expect(secondCallArgs.afterDateTime).toBe('2026-04-02T10:00:00Z');
      expect(secondCallArgs.after).toBeUndefined();
      expect(secondCallArgs.since).toBeUndefined();
    });

    it('body pulls from summary when no other body fields present', async () => {
      writeConfig([
        {
          sourceSlug: 'claude_ai_Microsoft_365_email',
          sourceType: 'email',
          enabled: true,
          fetchToolName: 'outlook_email_search',
          fetchToolArgs: { folderName: 'inbox', limit: 10 },
          serverSlug: 'claude_ai_Microsoft_365',
        },
      ]);

      const pool = makeMockPool({
        'mcp__claude_ai_Microsoft_365__outlook_email_search': {
          content: JSON.stringify([
            { id: 'msg1', sender: 'alice@example.com', subject: 'Test', receivedDateTime: '2026-04-02T10:00:00Z', summary: 'Hello world' },
          ]),
          isError: false,
        },
      });

      const service = createService(pool);
      await service.sync(true);

      const messages = readMessages(TEST_DIR);
      expect(messages).toHaveLength(1);
      expect(messages[0]!.body).toBe('Hello world');
    });

    it('sender string parses to name + email', async () => {
      writeConfig([
        {
          sourceSlug: 'claude_ai_Microsoft_365_email',
          sourceType: 'email',
          enabled: true,
          fetchToolName: 'outlook_email_search',
          fetchToolArgs: { folderName: 'inbox', limit: 10 },
          serverSlug: 'claude_ai_Microsoft_365',
        },
      ]);

      const pool = makeMockPool({
        'mcp__claude_ai_Microsoft_365__outlook_email_search': {
          content: JSON.stringify([
            { id: 'msg1', sender: 'metabase@daloopa.com', subject: 'Report', receivedDateTime: '2026-04-02T10:00:00Z', summary: 'Daily report' },
          ]),
          isError: false,
        },
      });

      const service = createService(pool);
      await service.sync(true);

      const messages = readMessages(TEST_DIR);
      expect(messages).toHaveLength(1);
      expect(messages[0]!.from.email).toBe('metabase@daloopa.com');
      expect(messages[0]!.from.name).toBe('metabase');
    });

    it('migrates legacy count to limit and caps at 25', async () => {
      writeFileSync(
        getInboxConfigPath(TEST_DIR),
        JSON.stringify({
          backgroundSyncEnabled: true,
          syncIntervalMinutes: 1,
          sources: [
            {
              sourceSlug: 'claude_ai_Microsoft_365_email',
              sourceType: 'email',
              enabled: true,
              fetchToolName: 'outlook_email_search',
              fetchToolArgs: { folderName: 'inbox', count: 50 },
              serverSlug: 'claude_ai_Microsoft_365',
            },
          ],
        }),
      );

      const pool = makeMockPool({
        'mcp__claude_ai_Microsoft_365__outlook_email_search': {
          content: JSON.stringify([{ id: 'msg1', sender: 'a@b.com', subject: 'Test', receivedDateTime: '2026-04-02T10:00:00Z' }]),
          isError: false,
        },
      });

      const service = createService(pool);
      await service.sync(true);

      const { loadInboxConfig } = await import('../config.ts');
      const savedConfig = loadInboxConfig(TEST_DIR);
      const args = savedConfig.sources[0]!.fetchToolArgs!;
      expect(args.count).toBeUndefined();
      expect(args.limit).toBe(25);
    });
  });

  describe('M365 calendar sync', () => {
    it('normalizer picks subject for title and expands flat attendees/organizer', async () => {
      writeConfig([
        {
          sourceSlug: 'claude_ai_Microsoft_365_calendar',
          sourceType: 'calendar',
          enabled: true,
          fetchToolName: 'outlook_calendar_search',
          serverSlug: 'claude_ai_Microsoft_365',
        },
      ]);

      const pool = makeMockPool({
        'mcp__claude_ai_Microsoft_365__outlook_calendar_search': {
          content: JSON.stringify([
            {
              id: 'evt1',
              subject: 'Team Standup',
              summary: 'Daily sync',
              organizer: 'alice@example.com',
              attendees: ['bob@x.com', 'carol@x.com'],
              start: '2026-04-16T19:00:00Z',
              end: '2026-04-16T19:30:00Z',
              isAllDay: false,
            },
          ]),
          isError: false,
        },
      });

      const service = createService(pool);
      await service.sync(true);

      const events = readEvents(TEST_DIR);
      expect(events).toHaveLength(1);
      expect(events[0]!.title).toBe('Team Standup');
      expect(events[0]!.description).toBe('Daily sync');
      expect(events[0]!.organizer).toEqual({ name: 'alice', email: 'alice@example.com' });
      expect(events[0]!.attendees).toHaveLength(2);
      expect(events[0]!.attendees![0]).toEqual({ name: 'bob', email: 'bob@x.com', status: 'tentative' });
      expect(events[0]!.attendees![1]).toEqual({ name: 'carol', email: 'carol@x.com', status: 'tentative' });
    });

    it('uses afterDateTime/beforeDateTime instead of startTime/endTime', async () => {
      writeConfig([
        {
          sourceSlug: 'claude_ai_Microsoft_365_calendar',
          sourceType: 'calendar',
          enabled: true,
          fetchToolName: 'outlook_calendar_search',
          fetchToolArgs: {},
          serverSlug: 'claude_ai_Microsoft_365',
        },
      ]);

      const pool = makeMockPool({
        'mcp__claude_ai_Microsoft_365__outlook_calendar_search': {
          content: JSON.stringify([]),
          isError: false,
        },
      });

      const service = createService(pool);
      await service.sync(true);

      expect(pool.callTool).toHaveBeenCalledTimes(1);
      const callArgs = pool.callTool.mock.calls[0]![1] as Record<string, unknown>;
      expect(callArgs.query).toBe('*');
      expect(callArgs.afterDateTime).toBeDefined();
      expect(callArgs.beforeDateTime).toBeDefined();
      expect(callArgs.startTime).toBeUndefined();
      expect(callArgs.endTime).toBeUndefined();
      expect(callArgs.timeMin).toBeUndefined();
      expect(callArgs.timeMax).toBeUndefined();
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
