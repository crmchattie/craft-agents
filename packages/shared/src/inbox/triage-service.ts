/**
 * TriageService — uses a cheap LLM (Haiku) to classify incoming messages
 * and calendar events, then creates tasks for actionable items.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import { getDefaultOptions } from '../agent/options.ts';
import { createLogger } from '../utils/debug.ts';
import type { EventBus } from '../automations/event-bus.ts';
import type {
  InboxMessage,
  CalendarEvent,
  Task,
  MessageTriage,
  EventTriage,
  TriageCategory,
  TriagePriority,
} from '@craft-agent/core/types';
import { loadInboxConfig } from './config.ts';
import {
  readMessages,
  rewriteMessages,
  readEvents,
  replaceEvents,
  readTasks,
  createTask,
} from './storage.ts';

const log = createLogger('inbox-triage');

const BATCH_SIZE = 20;

// ============================================================================
// Types
// ============================================================================

export interface TriageServiceOptions {
  workspaceRootPath: string;
  workspaceId: string;
  eventBus: EventBus;
  resolveAuthEnvVars: () => Promise<Record<string, string>>;
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
  private readonly resolveAuthEnvVars: () => Promise<Record<string, string>>;

  constructor(options: TriageServiceOptions) {
    this.workspaceRootPath = options.workspaceRootPath;
    this.workspaceId = options.workspaceId;
    this.eventBus = options.eventBus;
    this.resolveAuthEnvVars = options.resolveAuthEnvVars;
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
    const untriaged = messages.filter(m => !m.triage);
    if (untriaged.length === 0) return { triaged: 0, tasksCreated: 0 };

    log.debug(`Triaging ${untriaged.length} messages`);
    const envVars = await this.resolveAuthEnvVars();
    const existingTasks = new Set(readTasks(this.workspaceRootPath).map(t => t.inboxMessageId).filter(Boolean));
    let tasksCreated = 0;

    for (let i = 0; i < untriaged.length; i += BATCH_SIZE) {
      const batch = untriaged.slice(i, i + BATCH_SIZE);
      const triageResults = await this.callMessageTriage(batch, model, customInstructions, envVars);

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

        if (triage.isActionable && !existingTasks.has(msg.id)) {
          const task = this.createTaskFromMessage(msg);
          tasksCreated++;
          existingTasks.add(msg.id);

          await this.eventBus.emit('InboxActionableMessage', {
            workspaceId: this.workspaceId,
            timestamp: Date.now(),
            messageId: msg.id,
            taskId: task.id,
          });

          await this.eventBus.emit('TaskCreated', {
            workspaceId: this.workspaceId,
            timestamp: Date.now(),
            task,
          });
        }
      }
    }

    rewriteMessages(this.workspaceRootPath, messages);
    log.debug(`Triaged ${untriaged.length} messages, created ${tasksCreated} tasks`);
    return { triaged: untriaged.length, tasksCreated };
  }

  private async callMessageTriage(
    batch: InboxMessage[],
    model: string,
    customInstructions: string,
    envVars: Record<string, string>,
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

    const raw = await callLlm(systemPrompt, userContent, model, envVars);
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
    const untriaged = events.filter(e => !e.triage);
    if (untriaged.length === 0) return { triaged: 0, tasksCreated: 0 };

    log.debug(`Triaging ${untriaged.length} calendar events`);
    const envVars = await this.resolveAuthEnvVars();
    const existingTasks = new Set(readTasks(this.workspaceRootPath).map(t => t.calendarEventId).filter(Boolean));
    let tasksCreated = 0;

    for (let i = 0; i < untriaged.length; i += BATCH_SIZE) {
      const batch = untriaged.slice(i, i + BATCH_SIZE);
      const triageResults = await this.callEventTriage(batch, model, customInstructions, envVars);

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

        if (triage.needsPrep && !existingTasks.has(evt.id)) {
          const task = this.createTaskFromEvent(evt);
          tasksCreated++;
          existingTasks.add(evt.id);

          await this.eventBus.emit('TaskCreated', {
            workspaceId: this.workspaceId,
            timestamp: Date.now(),
            task,
          });
        }
      }
    }

    replaceEvents(this.workspaceRootPath, events);
    log.debug(`Triaged ${untriaged.length} events, created ${tasksCreated} tasks`);
    return { triaged: untriaged.length, tasksCreated };
  }

  private async callEventTriage(
    batch: CalendarEvent[],
    model: string,
    customInstructions: string,
    envVars: Record<string, string>,
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

    const raw = await callLlm(systemPrompt, userContent, model, envVars);
    return parseJsonArray<EventTriageResponse>(raw, batch.length);
  }

  // ============================================================================
  // Task creation
  // ============================================================================

  private createTaskFromMessage(message: InboxMessage): Task {
    return createTask(this.workspaceRootPath, {
      id: `task:msg:${message.id}`,
      title: message.triage!.summary,
      state: 'todo',
      priority: message.triage!.priority,
      source: 'inbox_triage',
      inboxMessageId: message.id,
      preparedPrompt: message.triage!.suggestedPrompt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  private createTaskFromEvent(event: CalendarEvent): Task {
    return createTask(this.workspaceRootPath, {
      id: `task:evt:${event.id}`,
      title: `Prep: ${event.title}`,
      state: 'todo',
      priority: 'medium',
      source: 'calendar_triage',
      calendarEventId: event.id,
      preparedPrompt: event.triage!.suggestedPrepPrompt,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }
}

// ============================================================================
// LLM calling helper
// ============================================================================

async function callLlm(
  systemPrompt: string,
  userPrompt: string,
  model: string,
  envOverrides: Record<string, string>,
): Promise<string> {
  const options = {
    ...getDefaultOptions(envOverrides),
    model,
    maxTurns: 1,
    systemPrompt,
    thinking: { type: 'disabled' as const },
  };

  let result = '';
  for await (const msg of query({ prompt: userPrompt, options })) {
    if (msg.type === 'assistant') {
      for (const block of msg.message.content) {
        if (block.type === 'text') {
          result += block.text;
        }
      }
    }
  }
  return result.trim();
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
