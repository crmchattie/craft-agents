/**
 * InboxSyncService — orchestrates fetching messages and events from MCP sources,
 * normalizing responses, writing to JSONL, and emitting events on the bus.
 */

import { createLogger } from '../utils/debug.ts';
import type { EventBus } from '../automations/event-bus.ts';
import type { InboxMessage, CalendarEvent, InboxSourceType } from '@scrunchy/core/types';
import type { McpClientPool, McpToolResult } from '../mcp/mcp-pool.ts';
import { loadInboxConfig, saveInboxConfig, type InboxConfig, type InboxSourceConfig } from './config.ts';
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
import { parseSlackDetailedMarkdown } from './slack-parser.ts';

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

type FetchResult =
  | { type: 'messages'; messages: InboxMessage[]; cursor: SyncCursor }
  | { type: 'events'; events: CalendarEvent[]; cursor: SyncCursor };

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

    // One-time migration: backfill serverSlug for legacy configs and cap Slack count
    if (this.migrateConfig(config)) {
      saveInboxConfig(this.workspaceRootPath, config);
    }

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
    // Diagnostic: what clients are registered in the pool at the moment we start syncing?
    const connectedSlugs = this.mcpPool.getConnectedSlugs();
    log.info(`[pool] Connected slugs at sync start: [${connectedSlugs.join(', ')}] (${connectedSlugs.length} clients)`);

    let totalNewMessages = 0;
    let totalNewEvents = 0;
    const errors: string[] = [];

    const enabledSources = config.sources.filter(s => s.enabled);

    // Phase 1: Fetch all sources in parallel (network-bound, no file I/O)
    const fetchResults = await Promise.allSettled(
      enabledSources.map(source => this.fetchSource(source, syncState, config)),
    );

    // Phase 2: Apply results sequentially (file I/O, dedup, events)
    for (let i = 0; i < enabledSources.length; i++) {
      const source = enabledSources[i]!;
      const settled = fetchResults[i]!;

      if (settled.status === 'rejected') {
        const errMsg = settled.reason instanceof Error ? settled.reason.message : String(settled.reason);
        log.error(`Sync failed for ${source.sourceSlug}:`, errMsg);
        errors.push(`${source.sourceSlug}: ${errMsg}`);
        await this.eventBus.emit('InboxSyncError', {
          workspaceId: this.workspaceId,
          timestamp: Date.now(),
          sourceSlug: source.sourceSlug,
          error: errMsg,
        });
        continue;
      }

      const result = settled.value;
      if (result.type === 'messages') {
        const newMsgs = result.messages.filter(m => !existingIds.has(m.id));
        if (newMsgs.length > 0) {
          appendMessages(this.workspaceRootPath, newMsgs);
          for (const m of newMsgs) existingIds.add(m.id);
          await this.eventBus.emit('InboxNewMessages', {
            workspaceId: this.workspaceId,
            timestamp: Date.now(),
            sourceSlug: source.sourceSlug,
            messageIds: newMsgs.map(m => m.id),
            count: newMsgs.length,
          });
        }
        totalNewMessages += newMsgs.length;
      } else {
        mergeEvents(this.workspaceRootPath, result.events);
        if (result.events.length > 0) {
          await this.eventBus.emit('CalendarEventsPrepared', {
            workspaceId: this.workspaceId,
            timestamp: Date.now(),
            eventIds: result.events.map(e => e.id),
            sourceSlug: source.sourceSlug,
          });
        }
        totalNewEvents += result.events.length;
      }

      syncState.cursors[source.sourceSlug] = result.cursor;
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
    const poolSlug = source.serverSlug ?? source.sourceSlug;
    const configured = `mcp__${poolSlug}__${source.fetchToolName}`;
    // Check if the configured tool exists in the pool
    if (this.mcpPool.hasProxyTool(configured)) {
      return configured;
    }
    // Fall back to API tool naming convention (api_{slug})
    const apiName = `mcp__${poolSlug}__api_${poolSlug}`;
    if (this.mcpPool.hasProxyTool(apiName)) {
      log.info(`[pool] ${source.sourceSlug}: falling back from ${configured} to ${apiName}`);
      return apiName;
    }
    // Neither resolved — log for diagnostics so the user can see which tools WERE available
    const connectedSlugs = this.mcpPool.getConnectedSlugs();
    const poolConnected = connectedSlugs.includes(poolSlug);
    log.warn(`[pool] ${source.sourceSlug}: no proxy tool found for ${configured} or ${apiName}. poolSlug=${poolSlug} connected=${poolConnected} allSlugs=[${connectedSlugs.join(', ')}]`);
    // Return configured name — callTool will report the error
    return configured;
  }

  private async fetchSource(
    source: InboxSourceConfig,
    syncState: SyncState,
    config: InboxConfig,
  ): Promise<FetchResult> {
    if (source.sourceType === 'calendar') {
      return this.fetchCalendarSource(source, config);
    }
    return this.fetchMessageSource(source, syncState);
  }

  private async fetchMessageSource(
    source: InboxSourceConfig,
    syncState: SyncState,
  ): Promise<FetchResult> {
    const cursor = syncState.cursors[source.sourceSlug];
    const proxyName = this.resolveProxyName(source);
    const args = this.buildFetchArgs(source, cursor);

    log.debug(`Fetching messages from ${source.sourceSlug} via ${proxyName}`);
    const result = await this.mcpPool.callTool(proxyName, args);

    if (result.isError) {
      throw new Error(`MCP tool error: ${result.content}`);
    }

    const messages = this.normalizeMessages(result, source);
    log.debug(`Fetched ${messages.length} messages from ${source.sourceSlug}`);

    // Slack uses max Message_ts as cursor; M365 email uses max receivedDateTime;
    // other sources use response-level cursor fields
    let cursorValue: string | undefined;
    if (source.sourceType === 'slack') {
      cursorValue = this.extractSlackCursor(messages, cursor);
    } else if (source.serverSlug === 'claude_ai_Microsoft_365' && source.sourceType === 'email') {
      cursorValue = this.extractM365EmailCursor(messages, cursor);
    } else {
      cursorValue = this.extractCursor(result);
    }

    return {
      type: 'messages',
      messages,
      cursor: {
        lastSyncAt: new Date().toISOString(),
        cursor: cursorValue,
        lastFetchCount: messages.length,
      },
    };
  }

  private async fetchCalendarSource(
    source: InboxSourceConfig,
    config: InboxConfig,
  ): Promise<FetchResult> {
    const now = new Date();
    const lookaheadEnd = new Date(now.getTime() + config.calendarLookaheadHours * 3600_000);
    const proxyName = this.resolveProxyName(source);

    let args: Record<string, unknown>;
    if (source.serverSlug === 'claude_ai_Microsoft_365') {
      // M365 hosted MCP requires query (REQUIRED) + afterDateTime/beforeDateTime
      args = {
        query: '*',
        ...source.fetchToolArgs,           // user overrides win
        afterDateTime: now.toISOString(),
        beforeDateTime: lookaheadEnd.toISOString(),
      };
    } else {
      // Existing Google Calendar / generic path
      args = {
        ...source.fetchToolArgs,
        startTime: now.toISOString(),
        endTime: lookaheadEnd.toISOString(),
        // Also set timeMin/timeMax for Google Calendar hosted MCPs (which use RFC3339 field names)
        timeMin: now.toISOString(),
        timeMax: lookaheadEnd.toISOString(),
      };
    }

    log.debug(`Fetching calendar events from ${source.sourceSlug} via ${proxyName}`);
    const result = await this.mcpPool.callTool(proxyName, args);

    if (result.isError) {
      throw new Error(`MCP tool error: ${result.content}`);
    }

    const events = this.normalizeEvents(result, source);
    log.debug(`Fetched ${events.length} calendar events from ${source.sourceSlug}`);

    return {
      type: 'events',
      events,
      cursor: {
        lastSyncAt: new Date().toISOString(),
        lastFetchCount: events.length,
      },
    };
  }

  // ============================================================================
  // Normalization — MCP tool responses → domain types
  // ============================================================================

  private normalizeMessages(result: McpToolResult, source: InboxSourceConfig): InboxMessage[] {
    try {
      const data = this.parseToolContent(result);
      this.logResponseSchema(`${source.sourceSlug} messages`, data);

      // Slack "detailed" format: { results: "<markdown string>", pagination_info: "..." }
      if (
        source.sourceType === 'slack' &&
        data && typeof data === 'object' && !Array.isArray(data) &&
        typeof (data as Record<string, unknown>).results === 'string'
      ) {
        const parsed = parseSlackDetailedMarkdown((data as Record<string, unknown>).results as string);
        log.info(`[schema] ${source.sourceSlug} messages: Array(${parsed.length}) firstItem={ts, channel, from, text}`);
        const items = parsed.map(p => ({
          ts: p.ts,
          channel: p.channel,
          from: { name: p.user.name, id: p.user.id },
          text: p.text,
        }));
        return items
          .map((item: Record<string, unknown>) => this.toInboxMessage(item, source))
          .filter((m): m is InboxMessage => m !== null);
      }

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
      this.logResponseSchema(`${source.sourceSlug} events`, data);
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

  /** Log the shape of a parsed MCP tool response for debugging normalization. */
  private logResponseSchema(label: string, data: unknown): void {
    if (data === null || data === undefined) {
      log.info(`[schema] ${label}: ${data}`);
      return;
    }
    if (Array.isArray(data)) {
      const first = data[0];
      const firstKeys = first && typeof first === 'object' && first !== null
        ? Object.keys(first).join(', ')
        : typeof first;
      log.info(`[schema] ${label}: Array(${data.length}) firstItem={${firstKeys}}`);
      return;
    }
    if (typeof data === 'object') {
      const shape: Record<string, string> = {};
      for (const [key, val] of Object.entries(data as Record<string, unknown>)) {
        if (Array.isArray(val)) {
          const first = val[0];
          const firstKeys = first && typeof first === 'object' && first !== null
            ? Object.keys(first).join(', ')
            : typeof first;
          shape[key] = `Array(${val.length}) firstItem={${firstKeys}}`;
        } else if (val && typeof val === 'object') {
          shape[key] = `Object{${Object.keys(val as Record<string, unknown>).join(', ')}}`;
        } else {
          shape[key] = typeof val;
        }
      }
      log.info(`[schema] ${label}: ${JSON.stringify(shape)}`);
      return;
    }
    log.info(`[schema] ${label}: ${typeof data} (length=${String(data).length})`);
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
        // String format — parse "Name <email>" from Gmail headers, or bare email (M365 hosted)
        const s = String(fromRaw);
        const angle = s.match(/^(.+?)\s*<([^>]+)>$/);
        if (angle) {
          fromName = angle[1]!.trim();
          fromEmail = angle[2]!;
        } else if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
          // Bare email address (e.g. M365 hosted MCP returns sender as plain email)
          fromEmail = s;
          fromName = s.split('@')[0]!;
        } else {
          fromName = s;
          fromEmail = raw.email as string | undefined ?? raw.from_email as string | undefined;
        }
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
        body: String(raw.body ?? raw.bodyPreview ?? raw.summary ?? raw.snippet ?? raw.text ?? raw.content ?? raw.message ?? ''),
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

      // Organizer — Google uses { email, self }, Microsoft uses { emailAddress: { name, address } },
      // M365 hosted returns a flat email string
      let organizer: { name: string; email: string } | undefined;
      if (typeof raw.organizer === 'string') {
        const email = raw.organizer;
        organizer = { name: email.split('@')[0] ?? email, email };
      } else if (raw.organizer && typeof raw.organizer === 'object') {
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
        attendees = raw.attendees.map((a: Record<string, unknown> | string) => {
          // M365 hosted returns attendees as plain email strings
          if (typeof a === 'string') {
            return { name: a.split('@')[0] ?? a, email: a, status: 'tentative' };
          }
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
        title: String(raw.subject ?? raw.title ?? raw.summary ?? 'Untitled'),
        description: raw.description as string | undefined
          ?? (typeof raw.summary === 'string' && raw.summary !== raw.subject ? raw.summary as string : undefined)
          ?? raw.body as string | undefined
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
      // Detect SDK truncation error pattern
      if (typeof result.content === 'string' &&
          result.content.includes('exceeds maximum allowed')) {
        log.warn('MCP tool response was truncated by SDK — try reducing fetch count');
        return [];
      }
      // Content might already be parsed or be plain text
      return result.content;
    }
  }

  private buildFetchArgs(source: InboxSourceConfig, cursor?: SyncCursor): Record<string, unknown> {
    const args = { ...source.fetchToolArgs };
    if (!cursor?.cursor) return args;

    // M365 Outlook email uses afterDateTime (ISO string)
    if (source.serverSlug === 'claude_ai_Microsoft_365' && source.sourceType === 'email') {
      args.afterDateTime = cursor.cursor;
      return args;
    }
    // Slack uses after (Unix timestamp)
    if (source.sourceType === 'slack') {
      args.after = cursor.cursor;
      return args;
    }
    // Default: Gmail / generic — preserve historical behavior
    args.after = cursor.cursor;
    args.since = cursor.lastSyncAt;
    return args;
  }

  /**
   * Backfill serverSlug for legacy configs and cap Slack fetch count.
   * Returns true if the config was modified and should be persisted.
   */
  private migrateConfig(config: InboxConfig): boolean {
    let changed = false;
    const suffixPattern = /_(email|calendar)$/;

    for (const source of config.sources) {
      // Infer serverSlug for legacy configs created before this field existed
      if (!source.serverSlug && suffixPattern.test(source.sourceSlug)) {
        source.serverSlug = source.sourceSlug.replace(suffixPattern, '');
        changed = true;
      }

      // Migrate legacy Slack query='*' to 'to:me' (the old query returned 0 messages)
      if (source.sourceType === 'slack' && source.fetchToolArgs?.query === '*') {
        source.fetchToolArgs.query = 'to:me';
        source.fetchToolArgs.sort = 'timestamp';
        source.fetchToolArgs.response_format = 'detailed';
        if (!source.fetchToolArgs.count || (source.fetchToolArgs.count as number) > 5) {
          source.fetchToolArgs.count = 5;
        }
        changed = true;
      }

      // Cap Slack fetch count to avoid SDK truncation
      if (source.sourceType === 'slack' && source.fetchToolArgs?.count &&
          (source.fetchToolArgs.count as number) > 5) {
        source.fetchToolArgs.count = 5;
        changed = true;
      }

      // Fix M365 email: query '*' is rejected by outlook_email_search, use folderName instead
      if (source.sourceType === 'email' && source.fetchToolArgs?.query === '*') {
        delete source.fetchToolArgs.query;
        source.fetchToolArgs.folderName = 'inbox';
        if (!source.fetchToolArgs.limit || (source.fetchToolArgs.limit as number) > 10) {
          source.fetchToolArgs.limit = 10;
        }
        // Clean up legacy count if present
        delete source.fetchToolArgs.count;
        changed = true;
      }

      // Migrate legacy M365 email `count` -> `limit`
      if (
        source.serverSlug === 'claude_ai_Microsoft_365' &&
        source.sourceType === 'email' &&
        source.fetchToolArgs?.count !== undefined
      ) {
        source.fetchToolArgs.limit = source.fetchToolArgs.limit ?? source.fetchToolArgs.count;
        delete source.fetchToolArgs.count;
        changed = true;
      }

      // Cap M365 email limit at 25 to avoid SDK truncation
      if (
        source.serverSlug === 'claude_ai_Microsoft_365' &&
        source.sourceType === 'email' &&
        typeof source.fetchToolArgs?.limit === 'number' &&
        (source.fetchToolArgs.limit as number) > 25
      ) {
        source.fetchToolArgs.limit = 25;
        changed = true;
      }
    }

    return changed;
  }

  /**
   * Compute Slack sync cursor as the maximum Message_ts across fetched messages.
   * Preserves the existing cursor if the current fetch returned no messages.
   */
  private extractSlackCursor(messages: InboxMessage[], existing?: SyncCursor): string | undefined {
    if (messages.length === 0) return existing?.cursor;
    let maxTs = Number(existing?.cursor ?? 0);
    for (const m of messages) {
      const t = Number(m.externalId);
      if (Number.isFinite(t) && t > maxTs) maxTs = t;
    }
    return maxTs > 0 ? String(maxTs) : undefined;
  }

  /**
   * Compute M365 email sync cursor as the maximum receivedDateTime (ISO string) across fetched messages.
   * Preserves the existing cursor if the current fetch returned no messages.
   */
  private extractM365EmailCursor(messages: InboxMessage[], existing?: SyncCursor): string | undefined {
    if (messages.length === 0) return existing?.cursor;
    let maxIso = existing?.cursor;
    let maxMs = maxIso ? Date.parse(maxIso) : 0;
    for (const m of messages) {
      const t = Date.parse(m.receivedAt);
      if (Number.isFinite(t) && t > maxMs) { maxMs = t; maxIso = m.receivedAt; }
    }
    return maxIso;
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
