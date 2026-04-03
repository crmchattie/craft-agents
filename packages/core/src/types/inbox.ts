/**
 * Inbox, Tasks & Calendar type definitions.
 *
 * These types are dependency-free and shared across all packages.
 */

// ============================================================================
// Enums / Unions
// ============================================================================

export type InboxSourceType = 'slack' | 'email';

export type TriageCategory =
  | 'request'
  | 'fyi'
  | 'question'
  | 'approval'
  | 'social'
  | 'automated';

export type TriagePriority = 'high' | 'medium' | 'low';

export type TaskState = 'todo' | 'in_progress' | 'done' | 'cancelled';

export type TaskSource = 'manual' | 'inbox_triage' | 'calendar_triage';

export type AttendeeStatus = 'accepted' | 'tentative' | 'declined';

// ============================================================================
// Shared Sub-types
// ============================================================================

export interface InboxContact {
  name: string;
  handle?: string;
  email?: string;
  avatarUrl?: string;
}

export interface InboxAttachment {
  name: string;
  type: string;
  size?: number;
}

export interface MessageTriage {
  isActionable: boolean;
  summary: string;
  suggestedPrompt?: string;
  category: TriageCategory;
  priority: TriagePriority;
  triagedAt: string;
  model: string;
}

export interface EventTriage {
  needsPrep: boolean;
  summary: string;
  suggestedPrepPrompt?: string;
  relatedMessageIds?: string[];
  triagedAt: string;
  model: string;
}

export interface EventAttendee {
  name: string;
  email: string;
  status: AttendeeStatus;
}

// ============================================================================
// Core Domain Types
// ============================================================================

export interface InboxMessage {
  id: string;
  sourceSlug: string;
  sourceType: InboxSourceType;
  externalId: string;
  threadId?: string;
  channel?: string;

  from: InboxContact;
  to?: InboxContact[];
  subject?: string;

  body: string;
  bodyHtml?: string;
  attachments?: InboxAttachment[];

  receivedAt: string;
  isRead: boolean;

  triage?: MessageTriage;
}

export interface CalendarEvent {
  id: string;
  sourceSlug: string;
  externalId: string;

  title: string;
  description?: string;
  location?: string;

  startTime: string;
  endTime: string;
  allDay: boolean;

  organizer?: { name: string; email: string };
  attendees?: EventAttendee[];

  calendarName: string;
  calendarColor?: string;
  meetingUrl?: string;

  triage?: EventTriage;
}

export interface Task {
  id: string;
  title: string;
  notes?: string;
  state: TaskState;
  priority: TriagePriority;
  source: TaskSource;

  inboxMessageId?: string;
  calendarEventId?: string;

  preparedPrompt?: string;
  preparedSources?: string[];
  sessionId?: string;

  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
