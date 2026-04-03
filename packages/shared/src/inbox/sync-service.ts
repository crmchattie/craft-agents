/**
 * InboxSyncService — orchestrates fetching messages and events from MCP sources,
 * normalizing responses, writing to JSONL, and emitting events on the bus.
 */

import { createLogger } from '../utils/debug.ts';
import type { EventBus } from '../automations/event-bus.ts';
import type { InboxMessage, CalendarEvent, InboxSourceType } from '@craft-agent/core/types';
import type { McpClientPool, McpToolResult } from '../mcp/mcp-pool.ts';
import { loadInboxConfig, type InboxConfig, type InboxSourceConfig } from './config.ts';
import {
  readMessages,
  appendMessages,
  replaceEvents,
  readSyncState,
  writeSyncState,
  type SyncState,
  type SyncCursor,
} from './storage.ts';

const log = createLogger('inbox-sync');

// ============================================================================
// Types
// ============================================================================

export interface InboxSyncServiceOptions {
  workspaceRootPath: string;
  workspaceId: string;
  eventBus: EventBus;
  mcpPool: McpClientPool;
}

export interface SyncResult {
  newMessageCount: number;
  newEventCount: number;
  errors: string[];
}

// ============================================================================
// Service
// ============================================================================

export class InboxSyncService {
  private readonly workspaceRootPath: string;
  private readonly workspaceId: string;
  private readonly eventBus: EventBus;
  private readonly mcpPool: McpClientPool;
  private lastSyncTime = 0;
  private syncing = false;

  constructor(options: InboxSyncServiceOptions) {
    this.workspaceRootPath = options.workspaceRootPath;
    this.workspaceId = options.workspaceId;
    this.eventBus = options.eventBus;
    this.mcpPool = options.mcpPool;
  }

  /**
   * Run a sync cycle.
   * @param force - bypass interval check (for manual refresh button)
   */
  async sync(force = false): Promise<SyncResult> {
    if (this.syncing) {
      log.debug('Sync already in progress, skipping');
      return { newMessageCount: 0, newEventCount: 0, errors: ['Sync already in progress'] };
    }

    const config = loadInboxConfig(this.workspaceRootPath);
    if (!config.backgroundSyncEnabled && !force) {
      return { newMessageCount: 0, newEventCount: 0, errors: [] };
    }

    if (!force) {
      const intervalMs = config.syncIntervalMinutes * 60_000;
      if (Date.now() - this.lastSyncTime < intervalMs) {
        return { newMessageCount: 0, newEventCount: 0, errors: [] };
      }
    }

    this.syncing = true;
    try {
      const result = await this.runSync(config);
      this.lastSyncTime = Date.now();
      return result;
    } finally {
      this.syncing = false;
    }
  }

  get isSyncing(): boolean {
    return this.syncing;
  }

  // ============================================================================
  // Internal sync logic
  // ============================================================================

  private async runSync(config: InboxConfig): Promise<SyncResult> {
    const syncState = readSyncState(this.workspaceRootPath);
    const existingIds = new Set(readMessages(this.workspaceRootPath).map(m => m.id));

    let totalNewMessages = 0;
    let totalNewEvents = 0;
    const errors: string[] = [];

    for (const source of config.sources) {
      if (!source.enabled) continue;

      try {
        if (source.sourceType === 'calendar') {
          const count = await this.syncCalendarSource(source, syncState, config);
          totalNewEvents += count;
        } else {
          const count = await this.syncMessageSource(source, syncState, existingIds);
          totalNewMessages += count;
        }
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        log.error(`Sync failed for ${source.sourceSlug}:`, errMsg);
        errors.push(`${source.sourceSlug}: ${errMsg}`);
        await this.eventBus.emit('InboxSyncError', {
          workspaceId: this.workspaceId,
          timestamp: Date.now(),
          sourceSlug: source.sourceSlug,
          error: errMsg,
        });
      }
    }

    writeSyncState(this.workspaceRootPath, syncState);
    return { newMessageCount: totalNewMessages, newEventCount: totalNewEvents, errors };
  }

  private async syncMessageSource(
    source: InboxSourceConfig,
    syncState: SyncState,
    existingIds: Set<string>,
  ): Promise<number> {
    const cursor = syncState.cursors[source.sourceSlug];
    const proxyName = `mcp__${source.sourceSlug}__${source.fetchToolName}`;
    const args = this.buildFetchArgs(source, cursor);

    log.debug(`Fetching messages from ${source.sourceSlug} via ${proxyName}`);
    const result = await this.mcpPool.callTool(proxyName, args);

    if (result.isError) {
      throw new Error(`MCP tool error: ${result.content}`);
    }

    const normalized = this.normalizeMessages(result, source);
    const newMessages = normalized.filter(m => !existingIds.has(m.id));

    if (newMessages.length > 0) {
      appendMessages(this.workspaceRootPath, newMessages);
      for (const m of newMessages) existingIds.add(m.id);

      await this.eventBus.emit('InboxNewMessages', {
        workspaceId: this.workspaceId,
        timestamp: Date.now(),
        sourceSlug: source.sourceSlug,
        messageIds: newMessages.map(m => m.id),
        count: newMessages.length,
      });
    }

    syncState.cursors[source.sourceSlug] = {
      lastSyncAt: new Date().toISOString(),
      cursor: this.extractCursor(result),
      lastFetchCount: normalized.length,
    };

    log.debug(`Synced ${newMessages.length} new messages from ${source.sourceSlug}`);
    return newMessages.length;
  }

  private async syncCalendarSource(
    source: InboxSourceConfig,
    syncState: SyncState,
    config: InboxConfig,
  ): Promise<number> {
    const now = new Date();
    const lookaheadEnd = new Date(now.getTime() + config.calendarLookaheadHours * 3600_000);
    const proxyName = `mcp__${source.sourceSlug}__${source.fetchToolName}`;
    const args = {
      ...source.fetchToolArgs,
      startTime: now.toISOString(),
      endTime: lookaheadEnd.toISOString(),
    };

    log.debug(`Fetching calendar events from ${source.sourceSlug} via ${proxyName}`);
    const result = await this.mcpPool.callTool(proxyName, args);

    if (result.isError) {
      throw new Error(`MCP tool error: ${result.content}`);
    }

    const events = this.normalizeEvents(result, source);
    replaceEvents(this.workspaceRootPath, events);

    if (events.length > 0) {
      await this.eventBus.emit('CalendarEventsPrepared', {
        workspaceId: this.workspaceId,
        timestamp: Date.now(),
        eventIds: events.map(e => e.id),
        sourceSlug: source.sourceSlug,
      });
    }

    syncState.cursors[source.sourceSlug] = {
      lastSyncAt: new Date().toISOString(),
      lastFetchCount: events.length,
    };

    log.debug(`Synced ${events.length} calendar events from ${source.sourceSlug}`);
    return events.length;
  }

  // ============================================================================
  // Normalization — MCP tool responses → domain types
  // ============================================================================

  private normalizeMessages(result: McpToolResult, source: InboxSourceConfig): InboxMessage[] {
    try {
      const data = this.parseToolContent(result);
      if (!Array.isArray(data)) {
        log.debug('MCP tool returned non-array, wrapping:', typeof data);
        return data ? [this.toInboxMessage(data as Record<string, unknown>, source)].filter((m): m is InboxMessage => m !== null) : [];
      }
      return data
        .map((item: Record<string, unknown>) => this.toInboxMessage(item, source))
        .filter((m): m is InboxMessage => m !== null);
    } catch (error) {
      log.error('Failed to normalize messages:', error);
      return [];
    }
  }

  private normalizeEvents(result: McpToolResult, source: InboxSourceConfig): CalendarEvent[] {
    try {
      const data = this.parseToolContent(result);
      if (!Array.isArray(data)) {
        log.debug('MCP tool returned non-array for calendar, wrapping:', typeof data);
        return data ? [this.toCalendarEvent(data as Record<string, unknown>, source)].filter((e): e is CalendarEvent => e !== null) : [];
      }
      return data
        .map((item: Record<string, unknown>) => this.toCalendarEvent(item, source))
        .filter((e): e is CalendarEvent => e !== null);
    } catch (error) {
      log.error('Failed to normalize events:', error);
      return [];
    }
  }

  private toInboxMessage(raw: Record<string, unknown>, source: InboxSourceConfig): InboxMessage | null {
    try {
      const externalId = String(raw.id ?? raw.externalId ?? raw.ts ?? '');
      if (!externalId) return null;

      return {
        id: `${source.sourceSlug}:${externalId}`,
        sourceSlug: source.sourceSlug,
        sourceType: source.sourceType as InboxSourceType,
        externalId,
        threadId: raw.threadId as string | undefined ?? raw.thread_ts as string | undefined,
        channel: raw.channel as string | undefined ?? raw.folder as string | undefined,
        from: {
          name: String(raw.from ?? raw.sender ?? raw.user ?? 'Unknown'),
          handle: raw.handle as string | undefined ?? raw.username as string | undefined,
          email: raw.email as string | undefined ?? raw.from_email as string | undefined,
        },
        to: raw.to ? (Array.isArray(raw.to) ? raw.to.map((r: Record<string, unknown>) => ({
          name: String(r.name ?? ''),
          email: r.email as string | undefined,
        })) : undefined) : undefined,
        subject: raw.subject as string | undefined,
        body: String(raw.body ?? raw.text ?? raw.content ?? raw.message ?? ''),
        bodyHtml: raw.bodyHtml as string | undefined ?? raw.html as string | undefined,
        receivedAt: String(raw.receivedAt ?? raw.timestamp ?? raw.date ?? new Date().toISOString()),
        isRead: false,
      };
    } catch (error) {
      log.debug('Failed to normalize message:', error);
      return null;
    }
  }

  private toCalendarEvent(raw: Record<string, unknown>, source: InboxSourceConfig): CalendarEvent | null {
    try {
      const externalId = String(raw.id ?? raw.eventId ?? '');
      if (!externalId) return null;

      return {
        id: `${source.sourceSlug}:${externalId}`,
        sourceSlug: source.sourceSlug,
        externalId,
        title: String(raw.title ?? raw.summary ?? raw.subject ?? 'Untitled'),
        description: raw.description as string | undefined ?? raw.body as string | undefined,
        location: raw.location as string | undefined,
        startTime: String(raw.startTime ?? raw.start ?? raw.startDateTime ?? ''),
        endTime: String(raw.endTime ?? raw.end ?? raw.endDateTime ?? ''),
        allDay: Boolean(raw.allDay ?? raw.isAllDay ?? false),
        organizer: raw.organizer ? {
          name: String((raw.organizer as Record<string, unknown>).name ?? ''),
          email: String((raw.organizer as Record<string, unknown>).email ?? ''),
        } : undefined,
        attendees: Array.isArray(raw.attendees) ? raw.attendees.map((a: Record<string, unknown>) => ({
          name: String(a.name ?? ''),
          email: String(a.email ?? ''),
          status: (a.status as 'accepted' | 'tentative' | 'declined') ?? 'tentative',
        })) : undefined,
        calendarName: String(raw.calendarName ?? raw.calendar ?? source.sourceSlug),
        calendarColor: raw.calendarColor as string | undefined ?? raw.color as string | undefined,
        meetingUrl: raw.meetingUrl as string | undefined
          ?? raw.hangoutLink as string | undefined
          ?? raw.onlineMeetingUrl as string | undefined,
      };
    } catch (error) {
      log.debug('Failed to normalize calendar event:', error);
      return null;
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private parseToolContent(result: McpToolResult): unknown {
    try {
      return JSON.parse(result.content);
    } catch {
      // Content might already be parsed or be plain text
      return result.content;
    }
  }

  private buildFetchArgs(source: InboxSourceConfig, cursor?: SyncCursor): Record<string, unknown> {
    const args = { ...source.fetchToolArgs };
    if (cursor?.cursor) {
      args.after = cursor.cursor;
      args.since = cursor.lastSyncAt;
    }
    return args;
  }

  private extractCursor(result: McpToolResult): string | undefined {
    try {
      const data = JSON.parse(result.content);
      return data?.cursor ?? data?.nextPageToken ?? data?.next_cursor ?? undefined;
    } catch {
      return undefined;
    }
  }
}
