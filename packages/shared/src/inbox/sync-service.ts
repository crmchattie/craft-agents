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
  mergeEvents,
  readSyncState,
  writeSyncState,
  pruneOldMessages,
  pruneOldEvents,
  type SyncState,
  type SyncCursor,
} from './storage.ts';
import type { TriageService } from './triage-service.ts';

const log = createLogger('inbox-sync');

// ============================================================================
// Types
// ============================================================================

export interface InboxSyncServiceOptions {
  workspaceRootPath: string;
  workspaceId: string;
  eventBus: EventBus;
  mcpPool: McpClientPool;
  triageService?: TriageService;
  /** Called before each sync to ensure the pool has the right source connections.
   *  The caller should load inbox-configured sources and call pool.sync(). */
  syncPool?: () => Promise<void>;
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
  private readonly triageService?: TriageService;
  private readonly syncPool?: () => Promise<void>;
  private lastSyncTime = 0;
  private syncing = false;

  constructor(options: InboxSyncServiceOptions) {
    this.workspaceRootPath = options.workspaceRootPath;
    this.workspaceId = options.workspaceId;
    this.eventBus = options.eventBus;
    this.mcpPool = options.mcpPool;
    this.triageService = options.triageService;
    this.syncPool = options.syncPool;
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

    const enabledSources = config.sources.filter(s => s.enabled);
    const disabledSources = config.sources.filter(s => !s.enabled);
    log.info(`Sync starting: ${enabledSources.length} enabled sources, ${disabledSources.length} disabled, force=${force}`);
    if (disabledSources.length > 0) {
      log.debug(`Disabled sources skipped: ${disabledSources.map(s => s.sourceSlug).join(', ')}`);
    }

    const syncStartTime = Date.now();
    this.syncing = true;
    try {
      // Ensure pool has the right source connections before fetching
      if (this.syncPool) {
        try {
          await this.syncPool();
        } catch (error) {
          log.error('Failed to sync inbox pool:', error);
        }
      }

      const result = await this.runSync(config);
      this.lastSyncTime = Date.now();

      // Run triage on new data if service is available
      if (this.triageService && config.triageEnabled) {
        try {
          const triageResult = await this.triageService.triageAll();
          log.debug(`Triage complete: ${triageResult.messagesTriaged} messages, ${triageResult.eventsTriaged} events, ${triageResult.tasksCreated} tasks`);
        } catch (error) {
          log.error('Post-sync triage failed:', error);
        }
      }

      // Retention cleanup — prune data older than configured days
      if (config.retentionDays > 0) {
        try {
          const prunedMsgs = pruneOldMessages(this.workspaceRootPath, config.retentionDays);
          const prunedEvts = pruneOldEvents(this.workspaceRootPath, config.retentionDays);
          if (prunedMsgs > 0 || prunedEvts > 0) {
            log.debug(`Retention cleanup: pruned ${prunedMsgs} messages, ${prunedEvts} events (older than ${config.retentionDays} days)`);
          }
        } catch (error) {
          log.error('Retention cleanup failed:', error);
        }
      }

      const syncDuration = Date.now() - syncStartTime;
      log.info(`Sync complete in ${syncDuration}ms: ${result.newMessageCount} new messages, ${result.newEventCount} new events, ${result.errors.length} errors`);
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
    const existingMessages = readMessages(this.workspaceRootPath);
    const existingIds = new Set(existingMessages.map(m => m.id));
    log.debug(`Existing messages: ${existingIds.size}, sync state cursors: ${Object.keys(syncState).length}`);

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

  /**
   * Resolve the MCP proxy tool name for a source.
   * For MCP sources, uses the configured fetchToolName directly.
   * For API sources, the tool is always named `api_{sourceSlug}`.
   */
  private resolveProxyName(source: InboxSourceConfig): string {
    const configured = `mcp__${source.sourceSlug}__${source.fetchToolName}`;
    // Check if the configured tool exists in the pool
    if (this.mcpPool.hasProxyTool(configured)) {
      return configured;
    }
    // Fall back to API tool naming convention (api_{slug})
    const apiName = `mcp__${source.sourceSlug}__api_${source.sourceSlug}`;
    if (this.mcpPool.hasProxyTool(apiName)) {
      return apiName;
    }
    // Return configured name — callTool will report the error
    return configured;
  }

  private async syncMessageSource(
    source: InboxSourceConfig,
    syncState: SyncState,
    existingIds: Set<string>,
  ): Promise<number> {
    const cursor = syncState.cursors[source.sourceSlug];
    const proxyName = this.resolveProxyName(source);
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
    const proxyName = this.resolveProxyName(source);
    const args = {
      ...source.fetchToolArgs,
      startTime: now.toISOString(),
      endTime: lookaheadEnd.toISOString(),
      // Also set timeMin/timeMax for Google Calendar hosted MCPs (which use RFC3339 field names)
      timeMin: now.toISOString(),
      timeMax: lookaheadEnd.toISOString(),
    };

    log.debug(`Fetching calendar events from ${source.sourceSlug} via ${proxyName}`);
    const result = await this.mcpPool.callTool(proxyName, args);

    if (result.isError) {
      throw new Error(`MCP tool error: ${result.content}`);
    }

    const events = this.normalizeEvents(result, source);
    mergeEvents(this.workspaceRootPath, events);

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
      // Handle nested response formats (e.g., Gmail: { messages: [...] }, Microsoft Graph: { value: [...] })
      const items = this.extractArray(data, ['messages', 'value', 'results', 'items', 'data']);
      if (items) {
        return items
          .map((item: Record<string, unknown>) => this.toInboxMessage(item, source))
          .filter((m): m is InboxMessage => m !== null);
      }
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
      // Handle nested response formats (e.g., Google: { events: [...] }, Microsoft Graph: { value: [...] })
      const items = this.extractArray(data, ['events', 'value', 'items', 'results', 'data']);
      if (items) {
        return items
          .map((item: Record<string, unknown>) => this.toCalendarEvent(item, source))
          .filter((e): e is CalendarEvent => e !== null);
      }
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

  /** Extract an array from a nested response object by checking common wrapper keys. */
  private extractArray(data: unknown, keys: string[]): Record<string, unknown>[] | null {
    if (Array.isArray(data)) return null; // Already an array, skip extraction
    if (!data || typeof data !== 'object') return null;
    for (const key of keys) {
      const val = (data as Record<string, unknown>)[key];
      if (Array.isArray(val)) return val;
    }
    return null;
  }

  private toInboxMessage(raw: Record<string, unknown>, source: InboxSourceConfig): InboxMessage | null {
    try {
      const externalId = String(raw.id ?? raw.messageId ?? raw.externalId ?? raw.ts ?? '');
      if (!externalId) return null;

      // Extract fields from nested headers (Gmail hosted MCP format)
      const headers = raw.headers as Record<string, string> | undefined;

      // From field — handle Gmail headers, Slack user objects, Microsoft Graph emailAddress objects
      const fromRaw = raw.from ?? headers?.From ?? raw.sender ?? raw.user ?? 'Unknown';
      let fromName: string;
      let fromEmail: string | undefined;
      if (typeof fromRaw === 'object' && fromRaw !== null) {
        // Microsoft Graph: { emailAddress: { name: "...", address: "..." } }
        const emailAddr = (fromRaw as Record<string, unknown>).emailAddress as Record<string, string> | undefined;
        if (emailAddr) {
          fromName = emailAddr.name || emailAddr.address || 'Unknown';
          fromEmail = emailAddr.address;
        } else {
          // Slack: { real_name: "...", display_name: "...", email: "..." } or generic { name, email }
          const obj = fromRaw as Record<string, unknown>;
          fromName = String(obj.real_name ?? obj.display_name ?? obj.name ?? 'Unknown');
          fromEmail = obj.email as string | undefined;
        }
      } else {
        // String format — parse "Name <email>" from Gmail headers
        const fromMatch = String(fromRaw).match(/^(.+?)\s*<([^>]+)>$/);
        fromName = fromMatch ? fromMatch[1]!.trim() : String(fromRaw);
        fromEmail = fromMatch ? fromMatch[2]! : (raw.email as string | undefined ?? raw.from_email as string | undefined);
      }

      // Subject — Gmail headers, Microsoft Graph, Slack (no subject, use channel)
      const subjectRaw = raw.subject ?? headers?.Subject;

      // To — Gmail headers string, Microsoft Graph toRecipients array
      const toRaw = raw.to ?? raw.toRecipients ?? headers?.To;

      // Parse receivedAt from various formats
      let receivedAt: string;
      if (raw.receivedAt) {
        receivedAt = String(raw.receivedAt);
      } else if (raw.receivedDateTime) {
        // Microsoft Graph format
        receivedAt = String(raw.receivedDateTime);
      } else if (raw.internalDate) {
        // Gmail hosted MCP returns Unix timestamp in milliseconds
        receivedAt = new Date(Number(raw.internalDate)).toISOString();
      } else if (raw.ts) {
        // Slack timestamp (Unix seconds with decimal microseconds, e.g., "1775440851.123456")
        receivedAt = new Date(Number(String(raw.ts).split('.')[0]) * 1000).toISOString();
      } else if (raw.timestamp || raw.date || headers?.Date) {
        receivedAt = String(raw.timestamp ?? raw.date ?? headers?.Date);
      } else {
        receivedAt = new Date().toISOString();
      }

      // Normalize toRecipients (Microsoft Graph format: [{ emailAddress: { name, address } }])
      let to: Array<{ name: string; email?: string }> | undefined;
      if (Array.isArray(toRaw)) {
        to = toRaw.map((r: Record<string, unknown>) => {
          const emailAddr = r.emailAddress as Record<string, string> | undefined;
          if (emailAddr) {
            return { name: String(emailAddr.name ?? ''), email: emailAddr.address };
          }
          return { name: String(r.name ?? ''), email: r.email as string | undefined };
        });
      }

      return {
        id: `${source.sourceSlug}:${externalId}`,
        sourceSlug: source.sourceSlug,
        sourceType: source.sourceType as InboxSourceType,
        externalId,
        threadId: raw.threadId as string | undefined ?? raw.thread_ts as string | undefined,
        channel: raw.channel as string | undefined ?? raw.folder as string | undefined ?? raw.folderName as string | undefined,
        from: {
          name: fromName,
          handle: raw.handle as string | undefined ?? raw.username as string | undefined,
          email: fromEmail,
        },
        to,
        subject: subjectRaw as string | undefined,
        body: String(raw.body ?? raw.bodyPreview ?? raw.snippet ?? raw.text ?? raw.content ?? raw.message ?? ''),
        bodyHtml: raw.bodyHtml as string | undefined ?? raw.html as string | undefined,
        receivedAt,
        isRead: Boolean(raw.isRead ?? false),
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

      // Extract start/end times — handle multiple formats:
      // Google Calendar: { date: "2026-04-05" } or { dateTime: "2026-04-05T14:00:00-04:00" }
      // Microsoft Graph: { dateTime: "2026-04-05T14:00:00", timeZone: "Eastern Standard Time" }
      const startObj = raw.start as Record<string, string> | string | undefined;
      const endObj = raw.end as Record<string, string> | string | undefined;
      const startTime = typeof startObj === 'object' && startObj !== null
        ? (startObj.dateTime ?? startObj.date ?? '')
        : String(raw.startTime ?? raw.startDateTime ?? startObj ?? '');
      const endTime = typeof endObj === 'object' && endObj !== null
        ? (endObj.dateTime ?? endObj.date ?? '')
        : String(raw.endTime ?? raw.endDateTime ?? endObj ?? '');

      // Detect all-day: explicit flag, or start has date but no dateTime
      const allDay = Boolean(raw.allDay ?? raw.isAllDay
        ?? (typeof startObj === 'object' && startObj !== null && startObj.date && !startObj.dateTime));

      // Organizer — Google uses { email, self }, Microsoft uses { emailAddress: { name, address } }
      let organizer: { name: string; email: string } | undefined;
      if (raw.organizer && typeof raw.organizer === 'object') {
        const org = raw.organizer as Record<string, unknown>;
        const emailAddr = org.emailAddress as Record<string, string> | undefined;
        if (emailAddr) {
          // Microsoft Graph format
          organizer = { name: emailAddr.name || '', email: emailAddr.address || '' };
        } else {
          organizer = {
            name: String(org.displayName ?? org.name ?? ''),
            email: String(org.email ?? ''),
          };
        }
      }

      // Attendees — Google uses { email, responseStatus, displayName }
      // Microsoft uses { emailAddress: { name, address }, status: { response } }
      let attendees: Array<{ name: string; email: string; status: string }> | undefined;
      if (Array.isArray(raw.attendees)) {
        attendees = raw.attendees.map((a: Record<string, unknown>) => {
          const emailAddr = a.emailAddress as Record<string, string> | undefined;
          const msStatus = a.status as Record<string, string> | undefined;
          if (emailAddr) {
            // Microsoft Graph format
            return {
              name: emailAddr.name || '',
              email: emailAddr.address || '',
              status: (msStatus?.response ?? 'none') as string,
            };
          }
          return {
            name: String(a.displayName ?? a.name ?? ''),
            email: String(a.email ?? ''),
            status: String(a.responseStatus ?? a.status ?? 'tentative'),
          };
        });
      }

      // Location — Google uses string, Microsoft uses { displayName: "..." }
      let location: string | undefined;
      if (typeof raw.location === 'string') {
        location = raw.location;
      } else if (raw.location && typeof raw.location === 'object') {
        location = (raw.location as Record<string, unknown>).displayName as string | undefined;
      }

      return {
        id: `${source.sourceSlug}:${externalId}`,
        sourceSlug: source.sourceSlug,
        externalId,
        title: String(raw.title ?? raw.summary ?? raw.subject ?? 'Untitled'),
        description: raw.description as string | undefined ?? raw.body as string | undefined
          ?? raw.bodyPreview as string | undefined,
        location,
        startTime,
        endTime,
        allDay,
        organizer,
        attendees: attendees as Array<{ name: string; email: string; status: 'accepted' | 'tentative' | 'declined' }> | undefined,
        calendarName: String(raw.calendarName ?? raw.calendar ?? source.sourceSlug),
        calendarColor: raw.calendarColor as string | undefined ?? raw.color as string | undefined,
        meetingUrl: raw.meetingUrl as string | undefined
          ?? raw.hangoutLink as string | undefined
          ?? raw.htmlLink as string | undefined
          ?? raw.onlineMeetingUrl as string | undefined
          ?? (raw.onlineMeeting as Record<string, unknown> | undefined)?.joinUrl as string | undefined,
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
