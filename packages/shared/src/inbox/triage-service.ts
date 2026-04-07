/**
 * TriageService — classifies incoming messages and calendar events
 * using an injected LLM call function (provider-agnostic).
 */

import { createLogger } from '../utils/debug.ts';
import type { EventBus } from '../automations/event-bus.ts';
import type {
  InboxMessage,
  CalendarEvent,
  MessageTriage,
  EventTriage,
  TriageCategory,
  TriagePriority,
} from '@scrunchy/core/types';
import { loadInboxConfig } from './config.ts';
import {
  readMessages,
  rewriteMessages,
  readEvents,
  replaceEvents,
} from './storage.ts';
import type { SimpleLlmCallFn } from '../agent/simple-llm-call.ts';

const log = createLogger('inbox-triage');

const BATCH_SIZE = 20;

// ============================================================================
// Types
// ============================================================================

export interface TriageServiceOptions {
  workspaceRootPath: string;
  workspaceId: string;
  eventBus: EventBus;
  callLlm: SimpleLlmCallFn;
}

export interface TriageResult {
  messagesTriaged: number;
  eventsTriaged: number;
  tasksCreated: number;
}

interface MessageTriageResponse {
  isActionable: boolean;
  category: string;
  priority: string;
  summary: string;
  suggestedPrompt: string | null;
}

interface EventTriageResponse {
  needsPrep: boolean;
  summary: string;
  suggestedPrepPrompt: string | null;
}

// ============================================================================
// Prompts
// ============================================================================

const MESSAGE_TRIAGE_SYSTEM = `You are triaging incoming messages for a software engineer.
For each message, determine:
- isActionable: boolean (someone is asking the user to do something)
- category: "request" | "fyi" | "question" | "approval" | "social" | "automated"
- priority: "high" | "medium" | "low"
- summary: one-line summary
- suggestedPrompt: if actionable, draft a prompt that an AI coding agent could use to fulfill the request. Include relevant context from the message (file paths, URLs, specifics). null if not actionable.

Respond with ONLY a JSON array. Each element corresponds to the message at the same index in the input.`;

const CALENDAR_TRIAGE_SYSTEM = `You are preparing a software engineer for upcoming meetings.
For each event, determine:
- needsPrep: boolean (does this meeting need preparation?)
- summary: one-line context summary
- suggestedPrepPrompt: if prep needed, draft a prompt for an AI agent to help prepare (e.g., "Review PR #X", "Summarize recent changes to feature Y"). null if no prep needed.

Respond with ONLY a JSON array. Each element corresponds to the event at the same index in the input.`;

// ============================================================================
// Service
// ============================================================================

export class TriageService {
  private readonly workspaceRootPath: string;
  private readonly workspaceId: string;
  private readonly eventBus: EventBus;
  private readonly callLlm: SimpleLlmCallFn;

  constructor(options: TriageServiceOptions) {
    this.workspaceRootPath = options.workspaceRootPath;
    this.workspaceId = options.workspaceId;
    this.eventBus = options.eventBus;
    this.callLlm = options.callLlm;
  }

  /**
   * Run triage on all un-triaged messages and events.
   */
  async triageAll(): Promise<TriageResult> {
    const config = loadInboxConfig(this.workspaceRootPath);
    if (!config.triageEnabled) {
      return { messagesTriaged: 0, eventsTriaged: 0, tasksCreated: 0 };
    }

    let messagesTriaged = 0;
    let eventsTriaged = 0;
    let tasksCreated = 0;

    try {
      const msgResult = await this.triageNewMessages(config.triageModel, config.triageCustomInstructions);
      messagesTriaged = msgResult.triaged;
      tasksCreated += msgResult.tasksCreated;
    } catch (error) {
      log.error('Message triage failed:', error);
    }

    if (config.triageCalendar) {
      try {
        const evtResult = await this.triageUpcomingEvents(config.triageModel, config.triageCustomInstructions);
        eventsTriaged = evtResult.triaged;
        tasksCreated += evtResult.tasksCreated;
      } catch (error) {
        log.error('Calendar triage failed:', error);
      }
    }

    return { messagesTriaged, eventsTriaged, tasksCreated };
  }

  // ============================================================================
  // Message triage
  // ============================================================================

  private async triageNewMessages(
    model: string,
    customInstructions: string,
  ): Promise<{ triaged: number; tasksCreated: number }> {
    const messages = readMessages(this.workspaceRootPath);
    const alreadyTriaged = messages.filter(m => m.triage).length;
    const untriaged = messages.filter(m => !m.triage);
    if (untriaged.length === 0) {
      log.debug(`All ${alreadyTriaged} messages already triaged, nothing to do`);
      return { triaged: 0, tasksCreated: 0 };
    }

    const totalBatches = Math.ceil(untriaged.length / BATCH_SIZE);
    log.info(`Triaging ${untriaged.length} messages (${alreadyTriaged} already triaged), model=${model || 'default'}, batches=${totalBatches}`);

    let actionableCount = 0;
    for (let i = 0; i < untriaged.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batch = untriaged.slice(i, i + BATCH_SIZE);
      log.debug(`Processing message batch ${batchNum}/${totalBatches} (${batch.length} items)`);
      const batchStart = Date.now();
      const triageResults = await this.callMessageTriage(batch, model, customInstructions);

      for (let j = 0; j < batch.length; j++) {
        const result = triageResults[j];
        const msg = batch[j];
        if (!result || !msg) continue;

        const triage: MessageTriage = {
          isActionable: Boolean(result.isActionable),
          summary: String(result.summary ?? ''),
          suggestedPrompt: result.suggestedPrompt ?? undefined,
          category: validateCategory(result.category),
          priority: validatePriority(result.priority),
          triagedAt: new Date().toISOString(),
          model,
        };
        msg.triage = triage;

        if (triage.isActionable) {
          actionableCount++;
          await this.eventBus.emit('InboxActionableMessage', {
            workspaceId: this.workspaceId,
            timestamp: Date.now(),
            messageId: msg.id,
          });
        }
      }
      log.debug(`Batch ${batchNum}/${totalBatches} complete in ${Date.now() - batchStart}ms`);
    }

    rewriteMessages(this.workspaceRootPath, messages);
    log.info(`Triaged ${untriaged.length} messages: ${actionableCount} actionable`);
    return { triaged: untriaged.length, tasksCreated: 0 };
  }

  private async callMessageTriage(
    batch: InboxMessage[],
    model: string,
    customInstructions: string,
  ): Promise<MessageTriageResponse[]> {
    const userContent = batch.map((m, i) => {
      const parts = [`[${i}] From: ${m.from.name}`];
      if (m.channel) parts.push(`Channel: ${m.channel}`);
      if (m.subject) parts.push(`Subject: ${m.subject}`);
      parts.push(`Body: ${m.body.slice(0, 500)}`);
      return parts.join('\n');
    }).join('\n\n---\n\n');

    const systemPrompt = customInstructions
      ? `${MESSAGE_TRIAGE_SYSTEM}\n\nAdditional context:\n${customInstructions}`
      : MESSAGE_TRIAGE_SYSTEM;

    const raw = await this.callLlm({ systemPrompt, userPrompt: userContent, model });
    return parseJsonArray<MessageTriageResponse>(raw, batch.length);
  }

  // ============================================================================
  // Calendar triage
  // ============================================================================

  private async triageUpcomingEvents(
    model: string,
    customInstructions: string,
  ): Promise<{ triaged: number; tasksCreated: number }> {
    const events = readEvents(this.workspaceRootPath);
    const alreadyTriaged = events.filter(e => e.triage).length;
    const untriaged = events.filter(e => !e.triage);
    if (untriaged.length === 0) {
      log.debug(`All ${alreadyTriaged} events already triaged, nothing to do`);
      return { triaged: 0, tasksCreated: 0 };
    }

    const totalBatches = Math.ceil(untriaged.length / BATCH_SIZE);
    log.info(`Triaging ${untriaged.length} calendar events (${alreadyTriaged} already triaged), model=${model || 'default'}, batches=${totalBatches}`);

    let needsPrepCount = 0;
    for (let i = 0; i < untriaged.length; i += BATCH_SIZE) {
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const batch = untriaged.slice(i, i + BATCH_SIZE);
      log.debug(`Processing event batch ${batchNum}/${totalBatches} (${batch.length} items)`);
      const batchStart = Date.now();
      const triageResults = await this.callEventTriage(batch, model, customInstructions);

      for (let j = 0; j < batch.length; j++) {
        const result = triageResults[j];
        const evt = batch[j];
        if (!result || !evt) continue;

        const triage: EventTriage = {
          needsPrep: Boolean(result.needsPrep),
          summary: String(result.summary ?? ''),
          suggestedPrepPrompt: result.suggestedPrepPrompt ?? undefined,
          triagedAt: new Date().toISOString(),
          model,
        };
        evt.triage = triage;
        if (triage.needsPrep) needsPrepCount++;
      }
      log.debug(`Batch ${batchNum}/${totalBatches} complete in ${Date.now() - batchStart}ms`);
    }

    replaceEvents(this.workspaceRootPath, events);
    log.info(`Triaged ${untriaged.length} events: ${needsPrepCount} need prep`);
    return { triaged: untriaged.length, tasksCreated: 0 };
  }

  private async callEventTriage(
    batch: CalendarEvent[],
    model: string,
    customInstructions: string,
  ): Promise<EventTriageResponse[]> {
    const userContent = batch.map((e, i) => {
      const parts = [`[${i}] Title: ${e.title}`];
      parts.push(`Time: ${e.startTime} - ${e.endTime}`);
      if (e.description) parts.push(`Description: ${e.description.slice(0, 300)}`);
      if (e.attendees?.length) parts.push(`Attendees: ${e.attendees.map(a => a.name).join(', ')}`);
      if (e.location) parts.push(`Location: ${e.location}`);
      return parts.join('\n');
    }).join('\n\n---\n\n');

    const systemPrompt = customInstructions
      ? `${CALENDAR_TRIAGE_SYSTEM}\n\nAdditional context:\n${customInstructions}`
      : CALENDAR_TRIAGE_SYSTEM;

    const raw = await this.callLlm({ systemPrompt, userPrompt: userContent, model });
    return parseJsonArray<EventTriageResponse>(raw, batch.length);
  }

}

// ============================================================================
// Parsing helpers
// ============================================================================

function parseJsonArray<T>(raw: string, expectedLength: number): T[] {
  try {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) {
      log.debug('Triage response is not an array, wrapping');
      return [parsed as T];
    }
    return parsed as T[];
  } catch (error) {
    log.error('Failed to parse triage JSON response:', error, '\nRaw:', raw.slice(0, 200));
    return new Array(expectedLength).fill(null);
  }
}

const VALID_CATEGORIES: Set<string> = new Set(['request', 'fyi', 'question', 'approval', 'social', 'automated']);
const VALID_PRIORITIES: Set<string> = new Set(['high', 'medium', 'low']);

function validateCategory(value: string): TriageCategory {
  return VALID_CATEGORIES.has(value) ? value as TriageCategory : 'fyi';
}

function validatePriority(value: string): TriagePriority {
  return VALID_PRIORITIES.has(value) ? value as TriagePriority : 'medium';
}
