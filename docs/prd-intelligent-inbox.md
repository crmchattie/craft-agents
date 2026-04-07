# PRD: Intelligent Inbox, Tasks & Calendar

## Overview

Add Inbox, Tasks, and Calendar sections to the Scrunchy sidebar — alongside the existing Sessions section — that pull in messages (Slack, email) and calendar events via MCP servers from the Anthropic connector store. A cheap triage model (Haiku) scans incoming messages and calendar events, populates a task list from actionable items, and prepares agent sessions with full context — so the user can review and execute with one click.

## Problem

During a typical workday, requests arrive via Slack and email continuously. Each one requires the user to:
1. Read and understand the request
2. Context-switch to the right tool (IDE, browser, docs, etc.)
3. Do the work or delegate it
4. Respond

Most of these requests can be fulfilled by Claude Code with the right context. But today there's no bridge between "someone asked me something on Slack" and "an agent is ready to do it."

## Goals

1. **Inbox section in the sidebar** — pull in Slack and email messages, display them like an email client with channels/folders and threads
2. **Tasks section in the sidebar** — a unified to-do list populated by triage (actionable messages/events) and manual user entries; each task can link to a prepared agent session
3. **Calendar section in the sidebar** — show and manage Google/Outlook calendar events; triage events to surface meeting prep context
4. **Triage incoming messages AND events** cheaply (Haiku) to detect actionable requests and meeting prep needs
5. **Prepare agent sessions** with the right prompt, context, and sources — pre-fill the chat input for user review before sending
6. **Background sync + manual refresh** — background polling keeps data fresh; a button pulls latest on demand

## Non-Goals

- Auto-executing agent sessions without user review (future consideration)
- Sending replies on behalf of the user automatically
- OS-level notifications — users still have Slack/Outlook/Gmail open, so we don't duplicate notifications
- Building our own OAuth infrastructure — MCPs from the Anthropic connector store handle auth
- Replacing Slack/email as composition tools — this is read + triage + act

---

## Architecture

### MCP Strategy

MCPs are sourced from the **Anthropic connector store**, which handles authentication and shows up automatically in the app. No custom OAuth clients or individual MCP server management needed.

The user connects their Slack, Gmail/Outlook, and Calendar MCPs through the connector store. The app calls MCP tools to fetch messages and events, and also to create/modify calendar events.

### Data Ingestion: Background Sync + Manual Refresh

Two sync triggers that work together:

1. **Background polling** (enabled by default): Uses the existing `SchedulerTick` automation system to poll on an interval (every 5 minutes by default, configurable). Keeps the inbox, tasks, and calendar reasonably fresh without user intervention.

2. **Manual refresh**: A [↻] button in the Inbox, Tasks, and Calendar section headers that the user clicks to pull latest data immediately. Useful when waiting for a specific message or before a meeting.

**Flow:**
1. Sync triggered (manual button click or `SchedulerTick`)
2. For each connected inbox MCP, call tools to fetch messages/events since last sync cursor
3. Normalize responses into `InboxMessage` / `CalendarEvent` format
4. Write to local JSONL store, update sync cursors
5. Run triage on new messages and upcoming events (if enabled)
6. Create tasks from actionable triage results
7. UI updates via push to renderer

### Local Storage: JSONL (No Database)

The app is 100% file-based today — sessions use JSONL, config uses JSON, plans use markdown. No database. We follow the same pattern.

**Why JSONL and not a database:**
- Consistent with the rest of the app (sessions, plans, etc.)
- No new dependencies or migration infrastructure
- Atomic writes via the existing persistence queue (write to `.tmp`, rename)
- Portable — workspace folders can be moved/synced across machines
- Simple to reason about and debug (human-readable files)

**Why we need local storage at all (vs. fetching from MCP every time):**
- Triage results need to be persisted — we can't re-triage on every render
- Task state (todo/done/dismissed, linked sessions) needs to live somewhere
- Read/unread state is local to the app
- Offline access to previously synced messages
- Performance — rendering a message list shouldn't require MCP round-trips

**Storage layout:**
```
~/.craft-agent/workspaces/{workspaceId}/
  inbox/
    messages.jsonl            # Append-only message log (one message per line)
    events.jsonl              # Calendar events (replaced on each sync for the active window)
    tasks.jsonl               # Task list (user-created + triage-generated)
    sync-state.json           # Per-source sync cursors
```

Messages use the same resilient JSONL pattern as sessions — corrupted lines are skipped, not fatal.

---

## Data Model

### InboxMessage

```typescript
interface InboxMessage {
  id: string                          // Unique across sources (source:externalId)
  sourceSlug: string                  // MCP source identifier
  sourceType: 'slack' | 'email'
  externalId: string                  // Original ID in source system
  threadId?: string                   // Thread/conversation grouping
  channel?: string                    // Slack channel or email folder

  from: { name: string; handle?: string; email?: string; avatarUrl?: string }
  to?: { name: string; handle?: string; email?: string }[]
  subject?: string                    // Email subject or Slack channel topic

  body: string                        // Plain text content
  bodyHtml?: string                   // Rich content (email HTML)
  attachments?: { name: string; type: string; size?: number }[]

  receivedAt: string                  // ISO timestamp
  isRead: boolean

  // Triage results (populated by Haiku)
  triage?: {
    isActionable: boolean
    summary: string                   // One-line summary
    suggestedPrompt?: string          // Draft prompt for agent session (only if actionable)
    category: 'request' | 'fyi' | 'question' | 'approval' | 'social' | 'automated'
    priority: 'high' | 'medium' | 'low'
    triagedAt: string
    model: string                     // Model ID used for triage
  }
}
```

### CalendarEvent

```typescript
interface CalendarEvent {
  id: string
  sourceSlug: string
  externalId: string

  title: string
  description?: string
  location?: string

  startTime: string                   // ISO
  endTime: string                     // ISO
  allDay: boolean

  organizer?: { name: string; email: string }
  attendees?: { name: string; email: string; status: 'accepted' | 'tentative' | 'declined' }[]

  calendarName: string
  calendarColor?: string
  meetingUrl?: string                 // Zoom/Meet/Teams link extracted from body

  // Triage results (populated by Haiku)
  triage?: {
    needsPrep: boolean                // Does this meeting need preparation?
    summary: string                   // One-line context summary
    suggestedPrepPrompt?: string      // "Review PR #123 before this meeting"
    relatedMessageIds?: string[]      // Inbox messages related to this event
    triagedAt: string
    model: string
  }
}
```

### Task

Tasks are a first-class entity — separate from sessions. A task represents a piece of work. It may or may not have an agent session attached.

```typescript
type TaskState = 'todo' | 'in_progress' | 'done' | 'cancelled'
type TaskSource = 'manual' | 'inbox_triage' | 'calendar_triage'

interface Task {
  id: string
  title: string
  notes?: string                      // Markdown notes/context
  state: TaskState
  priority: 'high' | 'medium' | 'low'
  source: TaskSource                  // How this task was created

  // Link to origin (if created by triage)
  inboxMessageId?: string             // Message that spawned this task
  calendarEventId?: string            // Event that spawned this task

  // Prepared agent session
  preparedPrompt?: string             // Draft prompt, editable by user
  preparedSources?: string[]          // MCP sources to activate
  sessionId?: string                  // Links to actual session once started

  createdAt: string
  updatedAt: string
  completedAt?: string
}
```

**How tasks get created:**
1. **From inbox triage**: Haiku flags a message as actionable → task created with `source: 'inbox_triage'`, linked to the message, with a suggested prompt
2. **From calendar triage**: Haiku identifies a meeting needing prep → task created with `source: 'calendar_triage'`, linked to the event, with a prep prompt
3. **Manually by user**: User clicks "Add Task" in the Tasks section → task created with `source: 'manual'`, no linked message/event

---

## Connecting to Existing Agent Flows

### How "Start Session" Works

When a user clicks "Start Session" on a task, we use the existing `openNewChat` flow:

**Current flow** (from `App.tsx` line 1327):
```typescript
openNewChat({ input?: string, name?: string })
  → handleCreateSession(workspaceId)        // Creates session via RPC
  → navigate(routes.view.allSessions(session.id))  // Navigate to chat
  → handleInputChange(session.id, input)    // Pre-fill input (100ms delay)
```

**What we need to change:**
1. Extend `NewChatActionParams` to include session options:
   ```typescript
   interface NewChatActionParams {
     input?: string
     name?: string
     // NEW: session creation options
     sessionOptions?: {
       permissionMode?: PermissionMode
       enabledSourceSlugs?: string[]
       labels?: string[]
       sessionStatus?: string
     }
   }
   ```

2. Pass `sessionOptions` through to `handleCreateSession`:
   ```typescript
   const session = await handleCreateSession(workspaceId, params.sessionOptions)
   ```

3. After session creation, link it back to the task:
   ```typescript
   // Update task with sessionId
   await updateTask(task.id, { sessionId: session.id, state: 'in_progress' })
   ```

**User experience:**
1. User views a task (from triage or manually created)
2. Sees the draft prompt and context
3. Can edit the prompt inline
4. Clicks "Start Session"
5. App creates a new session with the right sources and permission mode
6. Navigates to the session's chat view
7. Draft prompt appears pre-filled in the input box
8. User reviews, optionally edits, and hits send
9. Agent starts working

This is exactly how `openNewChat` works today — we just pass more options through it.

### Session ↔ Task Linking

- Task stores `sessionId` once a session is started
- Session can be viewed from the task (click through)
- Task state can update based on session state (e.g., session completed → suggest marking task done)
- Multiple sessions can be linked to one task (if the first attempt doesn't fully resolve it)

---

## Sidebar Integration

### How the Sidebar Works (from codebase analysis)

The sidebar is built from `SidebarItem[]` in `AppShell.tsx`. Each item has:
- `id`, `title`, `icon`, `variant` ("default" = selected, "ghost" = unselected)
- `onClick` → calls `navigate(routes.view.xxx())` (route-driven navigation)
- `expandable` / `expanded` / `onToggle` for collapsible sections
- `items` for nested children
- `label` for badge counts (shown on hover)
- `contextMenu` for right-click actions

Navigation state types live in `shared/types.ts`. `MainContentPanel.tsx` maps navigation state to the right component.

### What We Add

**New routes** in `shared/routes.ts`:
```typescript
routes.view.inbox()                    // All messages
routes.view.inbox({ source, channel }) // Filtered by source/channel
routes.view.inbox({ messageId })       // Message detail/thread

routes.view.tasks()                    // All tasks
routes.view.tasks({ filter })          // Filtered (e.g., 'todo', 'in_progress')

routes.view.calendar()                 // Week view (default)
routes.view.calendar({ view })         // 'day' | 'week' | 'month'
routes.view.calendar({ date })         // Centered on specific date
routes.view.calendar({ eventId })      // Event detail
```

**New navigation state types** in `shared/types.ts`:
```typescript
interface InboxNavigationState { navigator: 'inbox'; /* filter, details */ }
interface TasksNavigationState { navigator: 'tasks'; /* filter, details */ }
interface CalendarNavigationState { navigator: 'calendar'; /* view, details */ }
```

**New sidebar sections** in `AppShell.tsx`:

### Updated Sidebar Structure

```
┌─────────────────────────┐
│  🔍 Search              │
├─────────────────────────┤
│                         │
│  ▼ Sessions             │  ← Existing
│    All                  │
│    Flagged              │
│    Archived             │
│                         │
│  ▼ Inbox          [↻]  │  ← NEW
│    All Messages    (8)  │  ← DEFAULT: unified view, all sources mixed by time
│    Actionable      (3)  │  ← Filtered to triage-flagged items
│    ─────────────        │
│    📧 Gmail             │  ← Filter: show only Gmail messages
│    💬 Slack             │  ← Filter: show only Slack messages
│      #engineering  (2)  │  ← Filter: show only this channel
│      #requests     (1)  │
│      DMs                │
│                         │
│  ▼ Tasks           [+]  │  ← NEW (+ button to add manual task)
│    Todo            (4)  │
│    In Progress     (2)  │
│    Done                 │
│                         │
│  ▼ Calendar        [↻]  │  ← NEW
│    Day | Week | Month   │  ← View switcher (Week is default)
│    Today                │  ← Jump to current day/week/month
│    ─────────────        │
│    Work Calendar        │  ← Calendar source toggles
│    Personal             │
│                         │
│  ▼ Statuses             │  ← Existing
│  ▼ Labels               │  ← Existing
│  ▼ Sources              │  ← Existing
│  ▼ Skills               │  ← Existing
│  ▼ Automations          │  ← Existing
│                         │
└─────────────────────────┘
```

**Implementation pattern** (same as existing sections):
```typescript
// In AppShell.tsx links array:
{
  id: 'nav:inbox',
  title: 'Inbox',
  icon: Inbox,                                              // lucide-react
  label: String(unreadCount),                               // Badge
  variant: isInboxNavigation(navState) ? 'default' : 'ghost',
  onClick: () => navigate(routes.view.inbox()),
  expandable: true,
  expanded: isExpanded('nav:inbox'),
  onToggle: () => toggleExpanded('nav:inbox'),
  afterTitle: <RefreshButton onClick={handleInboxSync} syncing={inboxSyncing} />,
  items: [
    { id: 'nav:inbox:all', title: 'All Messages', ... },
    { id: 'nav:inbox:actionable', title: 'Actionable', label: String(actionableCount), ... },
    { id: 'separator:inbox-sources', type: 'separator' },
    // Dynamic source/channel items...
  ],
}
```

---

## Main Panel Views

### Message List View — Unified (default: "All Messages")
```
┌──────────────────────────────────────────────────────┐
│  All Messages                              [↻] [⚙]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ★ 💬 Alice · #engineering · 10:32 AM                │  ← 💬 = Slack source badge
│  Can you update the API docs for the new endpoints?  │
│  ┌─ 🤖 Ready to act · "Update API docs for..."  ─┐ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
│  ● 📧 Bob Smith · 10:20 AM                           │  ← 📧 = Email source badge
│  Re: Q2 metrics review                              │
│  Hey, can you pull the API latency numbers for...    │
│                                                      │
│  ● 💬 Bob · #engineering · 10:15 AM                  │
│  FYI: deployed v2.3.1 to staging                     │
│                                                      │
│  ○ 📧 Carol · 9:50 AM                                │
│  Re: Sprint planning notes                           │
│                                                      │
│  ○ 💬 Carol · #requests · 9:48 AM                    │
│  Thanks for the review!                              │
│                                                      │
└──────────────────────────────────────────────────────┘

All sources mixed together, sorted by time (newest first).
Source badge (💬/📧) + channel/folder shown on each message.
Click sidebar sub-items (Gmail, Slack, #engineering) to filter.
```
```

### Message Detail / Thread View (clicking a message)
```
┌──────────────────────────────────────────────────────┐
│  ← Back to #engineering                              │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Alice · #engineering · 10:32 AM                     │
│  Can you update the API docs for the new v3          │
│  endpoints? The OpenAPI spec is in /docs/api.yaml    │
│  and the deployed docs are at docs.example.com.      │
│                                                      │
│  ┌─ Bob · 10:34 AM (reply) ─────────────────────┐   │
│  │ I can take a look but swamped today           │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  ┌─ Alice · 10:35 AM (reply) ───────────────────┐   │
│  │ @you could you help instead?                  │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  ┌─────────────────────────────────────────────────┐ │
│  │  🤖 Triage: Actionable request                  │ │
│  │                                                  │ │
│  │  Summary: Update API documentation for v3       │ │
│  │  endpoints using OpenAPI spec at /docs/api.yaml │ │
│  │                                                  │ │
│  │  [View Task]    [Start Session]    [Dismiss]    │ │
│  └─────────────────────────────────────────────────┘ │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Tasks View
```
┌──────────────────────────────────────────────────────┐
│  Tasks                                     [+] [⚙]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  ▼ Todo (4)                                          │
│                                                      │
│  ○ Update API docs for v3 endpoints         high     │
│    From: Alice · #engineering · 10:32 AM             │
│    [Start Session]                                   │
│                                                      │
│  ○ Review PR #456 before standup            medium   │
│    From: Calendar · Standup (tomorrow 9am)           │
│    [Start Session]                                   │
│                                                      │
│  ○ Fix auth bug in login flow               high     │
│    From: Carol · DM · 9:15 AM                        │
│    [Start Session]                                   │
│                                                      │
│  ○ Write quarterly metrics summary          low      │
│    Added manually                                    │
│                                                      │
│  ▼ In Progress (2)                                   │
│                                                      │
│  ◐ Migrate DB schema to v4                  medium   │
│    Session: 260402-swift-river [View →]              │
│                                                      │
│  ◐ Set up CI pipeline for new repo          medium   │
│    Session: 260402-calm-lake [View →]                │
│                                                      │
│  ▶ Done (collapsed)                                  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Task Detail View (clicking a task)
```
┌──────────────────────────────────────────────────────┐
│  ← Back to Tasks                                     │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Update API docs for v3 endpoints                    │
│  Priority: high · Status: ○ Todo                     │
│  Created: 10:32 AM · From: Inbox triage              │
│                                                      │
│  ┌─ Source Message ──────────────────────────────┐   │
│  │  Alice · #engineering · 10:32 AM              │   │
│  │  Can you update the API docs for the new v3   │   │
│  │  endpoints? The OpenAPI spec is in             │   │
│  │  /docs/api.yaml...                            │   │
│  │  [View full thread →]                         │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  Draft prompt:                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │ Read the OpenAPI spec at /docs/api.yaml and   │  │
│  │ update the API documentation for the new v3   │  │
│  │ endpoints. Follow the existing documentation  │  │
│  │ style. The docs are deployed at               │  │
│  │ docs.example.com.                             │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  Sources: [slack] [github]                           │
│  Permission: Ask                                     │
│                                                      │
│  [Start Session]              [Mark Done] [Dismiss]  │
│                                                      │
│  ─────────────────────────────────────────────────── │
│                                                      │
│  Linked Sessions:                                    │
│  (none yet)                                          │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Calendar View (Monthly Grid — Default)
```
┌──────────────────────────────────────────────────────┐
│  ← April 2026 →                            [↻] [⚙]  │
├──────────────────────────────────────────────────────┤
│  Mon    Tue    Wed    Thu    Fri    Sat    Sun       │
├──────┬──────┬──────┬──────┬──────┬──────┬──────┤
│      │      │  1   │  2●  │  3   │  4   │  5   │
│      │      │      │Stand │      │      │      │
│      │      │      │1:1   │      │      │      │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│  6   │  7   │  8   │  9   │  10  │  11  │  12  │
│      │Sprint│      │Stand │      │      │      │
│      │Plan  │      │      │      │      │      │
├──────┼──────┼──────┼──────┼──────┼──────┼──────┤
│  ... │      │      │      │      │      │      │
└──────┴──────┴──────┴──────┴──────┴──────┴──────┘

● = today    Events shown as colored pills in day cells
Click a day → expands to day detail view
Click an event → opens event detail
```

### Day Detail View (clicking a day in the grid)
```
┌──────────────────────────────────────────────────────┐
│  ← Back to April 2026          Wed, Apr 2   [+ New]  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  9:00 AM ─────────────────────────────────────────── │
│  ┌─ 🔵 Standup (9:00 - 9:15) ───────────────────┐  │
│  │  Engineering standup · Zoom · 12 attendees     │  │
│  │  🤖 Prep: Review PR #456 (assigned yesterday) │  │
│  │  [Join Meeting]  [View Prep Task]              │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  10:00 AM ────────────────────────────────────────── │
│  ┌─ 🟢 1:1 with Alice (10:00 - 10:30) ──────────┐  │
│  │  Weekly sync · Google Meet                     │  │
│  │  [Join Meeting]                                │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  12:00 PM ────────────────────────────────────────── │
│  ┌─ 🟡 Lunch & Learn (12:00 - 1:00) ────────────┐  │
│  │  "Intro to MCP Servers" · Main conf room       │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
└──────────────────────────────────────────────────────┘
```

### Calendar Event Detail / Create / Edit
```
┌──────────────────────────────────────────────────────┐
│  ← Back to Calendar                                  │
├──────────────────────────────────────────────────────┤
│                                                      │
│  Standup                                    [Edit]   │
│  🔵 Work Calendar                                    │
│                                                      │
│  📅 Wed, Apr 2 · 9:00 AM - 9:15 AM                  │
│  📍 Zoom                                             │
│  🔗 https://zoom.us/j/123456                         │
│                                                      │
│  Attendees (12):                                     │
│  Alice (organizer), Bob, Carol, ...                  │
│                                                      │
│  Description:                                        │
│  Weekly engineering standup. Discuss blockers         │
│  and progress.                                       │
│                                                      │
│  ┌─ 🤖 Meeting Prep ────────────────────────────┐   │
│  │  You have PR #456 assigned - review before    │   │
│  │  this meeting. Alice mentioned it in           │   │
│  │  #engineering yesterday.                       │   │
│  │                                                │   │
│  │  [View Prep Task]                             │   │
│  └───────────────────────────────────────────────┘   │
│                                                      │
│  [Join Meeting]              [Delete Event]          │
│                                                      │
└──────────────────────────────────────────────────────┘
```

---

## Triage Pipeline

### Message Triage

When new messages are synced, a cheap triage pass runs:

1. **Batch** new un-triaged messages (up to 20 per call)
2. **Send to Haiku** with a structured prompt:
   ```
   You are triaging incoming messages for a software engineer.
   For each message, determine:
   - Is this actionable? (someone is asking the user to do something)
   - Category: request | fyi | question | approval | social | automated
   - Priority: high | medium | low
   - One-line summary
   - If actionable: draft a prompt that an AI coding agent could use to fulfill
     the request. Include relevant context from the message (file paths, URLs, specifics).

   Respond as a JSON array.
   ```
3. **Update** `InboxMessage.triage` in the JSONL store
4. **Create Task** for each actionable message (with linked prompt)
5. **UI updates** — actionable messages get a star badge; task count updates in sidebar

### Calendar Triage

When events are synced, triage upcoming events (next 24 hours):

1. **Batch** un-triaged upcoming events
2. **Send to Haiku** with context:
   ```
   You are preparing a software engineer for upcoming meetings.
   For each event, determine:
   - Does this meeting need preparation?
   - One-line summary of what to prepare
   - If prep needed: draft a prompt for an AI agent to help prepare
     (e.g., "Review PR #X", "Summarize recent changes to feature Y")
   - Reference any related inbox messages if the context suggests it

   Respond as a JSON array.
   ```
3. **Update** `CalendarEvent.triage` in events JSONL
4. **Create Task** for events needing prep (with linked prep prompt)
5. **UI updates** — events with prep show a triage badge; prep task appears in task list

### Cost

Haiku at ~$0.25/MTok input, ~$1.25/MTok output. A batch of 20 messages ≈ 5K tokens in, ~2K tokens out ≈ **$0.004 per batch**. Calendar events are lower volume (5-10/day). Total cost with 5-minute background sync over 8 hours: ~$0.64/day.

### Triage Config

```json
{
  "triage": {
    "enabled": true,
    "llmConnection": "anthropic-api",
    "model": "claude-haiku-4-5-20251001",
    "customInstructions": "I'm a backend engineer. Requests about frontend can be low priority.",
    "triageCalendar": true,
    "calendarPrepWindowHours": 24
  }
}
```

---

## Inbox Configuration

```json
// ~/.craft-agent/workspaces/{id}/inbox-config.json
{
  "enabled": true,
  "backgroundSync": {
    "enabled": true,
    "intervalMinutes": 5
  },
  "sources": [
    {
      "sourceSlug": "slack",
      "channels": ["#engineering", "#requests", "DMs"],
      "syncReplies": true
    },
    {
      "sourceSlug": "gmail",
      "query": "is:unread -category:promotions -category:social",
      "maxResults": 50
    },
    {
      "sourceSlug": "outlook-calendar",
      "calendarIds": ["primary"],
      "daysAhead": 7
    }
  ],
  "triage": {
    "enabled": true,
    "llmConnection": "anthropic-api",
    "model": "claude-haiku-4-5-20251001",
    "customInstructions": "",
    "triageCalendar": true,
    "calendarPrepWindowHours": 24
  }
}
```

---

## Component Design

### Reusing Existing Patterns

| New Component | Based On | Notes |
|---------------|----------|-------|
| Inbox sidebar section | Expandable sections (Sources, Labels) | Same `LeftSidebar` `SidebarItem` pattern with nested items, unread badge labels |
| Tasks sidebar section | Status section pattern | Expandable with todo/in-progress/done sub-items, count badges |
| Calendar sidebar section | Same expandable pattern | Today/This Week as filter items, calendar sources as sub-items |
| Message list | Session list (`SessionList.tsx`) | Same `EntityList` + `EntityRow` pattern, click to open detail |
| Message detail | `TurnCard` from `@scrunchy/ui` | Similar sender/content/timestamp layout, thread as nested cards |
| Thread view | Chat message display (existing) | Messages rendered as a conversation |
| Task list | Planner playground component | Task state machine, grouping by state, drag support via `@dnd-kit` (already a dependency) |
| Task detail | `Info_Page` pattern | Title, metadata, linked message, draft prompt, action buttons |
| Triage card | `AutomationActionPreview` pattern | Structured summary + action buttons |
| Calendar month grid | New component | Classic Outlook/Google Calendar monthly grid with day cells and event pills |
| Calendar day detail | New component | Hour timeline with event blocks (shown when clicking a day) |
| Event card | `Info_Page` detail pattern | Title, time, attendees, location, join link, triage prep |
| Event create/edit | New form component | Uses MCP tools to create/modify events |
| Refresh button | Existing icon buttons in sidebar | `afterTitle` slot with [↻] icon, shows spinner during sync |

### State Management

New Jotai atoms in `apps/electron/src/renderer/atoms/`:

```typescript
// inbox-atoms.ts
export const inboxMessagesAtom = atom<InboxMessage[]>([])
export const inboxFilterAtom = atom<InboxFilter>({ view: 'all', source: null, channel: null })
export const selectedMessageIdAtom = atom<string | null>(null)
export const inboxSyncingAtom = atom<boolean>(false)
export const inboxUnreadCountAtom = atom<number>((get) => {
  return get(inboxMessagesAtom).filter(m => !m.isRead).length
})

// task-atoms.ts
export const tasksAtom = atom<Task[]>([])
export const taskFilterAtom = atom<TaskState | 'all'>('all')
export const selectedTaskIdAtom = atom<string | null>(null)
export const taskCountsByStateAtom = atom<Record<TaskState, number>>((get) => {
  const tasks = get(tasksAtom)
  return { todo: 0, in_progress: 0, done: 0, cancelled: 0, ...countBy(tasks, 'state') }
})

// calendar-atoms.ts
export const calendarEventsAtom = atom<CalendarEvent[]>([])
export const calendarViewAtom = atom<'day' | 'week' | 'month'>('week')
export const calendarSelectedDateAtom = atom<string>(new Date().toISOString().slice(0, 10))
export const calendarSyncingAtom = atom<boolean>(false)
```

### New RPC Channels

```typescript
// Inbox
'inbox:getMessages':          (workspaceId, filter?) => InboxMessage[]
'inbox:getMessage':           (workspaceId, messageId) => InboxMessage
'inbox:getThread':            (workspaceId, threadId) => InboxMessage[]
'inbox:markRead':             (workspaceId, messageId) => void
'inbox:sync':                 (workspaceId, sourceSlug?) => void
'inbox:getSyncStatus':        (workspaceId) => SyncStatus
'inbox:getConfig':            (workspaceId) => InboxConfig
'inbox:updateConfig':         (workspaceId, config) => void

// Tasks
'tasks:getAll':               (workspaceId, filter?) => Task[]
'tasks:get':                  (workspaceId, taskId) => Task
'tasks:create':               (workspaceId, task) => Task
'tasks:update':               (workspaceId, taskId, patch) => Task
'tasks:delete':               (workspaceId, taskId) => void
'tasks:startSession':         (workspaceId, taskId) => { sessionId: string }

// Calendar
'calendar:getEvents':         (workspaceId, range) => CalendarEvent[]
'calendar:getEvent':          (workspaceId, eventId) => CalendarEvent
'calendar:createEvent':       (workspaceId, event) => CalendarEvent
'calendar:updateEvent':       (workspaceId, eventId, patch) => CalendarEvent
'calendar:deleteEvent':       (workspaceId, eventId) => void
'calendar:sync':              (workspaceId) => void
'calendar:getSyncStatus':     (workspaceId) => SyncStatus
```

---

## New App Events

Added to the workspace EventBus:

| Event | Payload | Emitted When |
|-------|---------|--------------|
| `InboxNewMessages` | `{ sourceSlug, messageIds, count }` | New messages fetched during sync |
| `InboxActionableMessage` | `{ messageId, triage }` | Triage identifies actionable message |
| `TaskCreated` | `{ taskId, source, title }` | New task created (triage or manual) |
| `TaskStateChanged` | `{ taskId, from, to }` | Task status changed |
| `TaskSessionStarted` | `{ taskId, sessionId }` | User starts a session from a task |
| `CalendarEventsPrepared` | `{ eventIds }` | Triage identified events needing prep |
| `InboxSyncError` | `{ sourceSlug, error }` | Sync fails for a source |

---

## Implementation Plan

### Milestone 1: Data Layer & Types (1.5 weeks)
- [ ] `InboxMessage`, `CalendarEvent`, `Task` types in `@scrunchy/core`
- [ ] JSONL read/write helpers for messages, events, and tasks in `@scrunchy/shared` (follow session JSONL patterns: atomic writes, resilient parsing, portable paths)
- [ ] `inbox-config.json` schema, loading, and validation
- [ ] Sync cursor management (`sync-state.json`)
- [ ] `InboxSyncService` — calls MCP tools, normalizes responses, writes to JSONL
- [ ] Background sync via existing `SchedulerTick` (enabled by default, 5-min interval)
- [ ] Manual sync trigger (for the refresh button)

### Milestone 2: Triage Pipeline (1 week)
- [ ] Message triage: Haiku prompt engineering, batch execution, JSONL persistence
- [ ] Calendar triage: prep detection for upcoming events
- [ ] Task creation from actionable triage results
- [ ] Triage config (custom instructions, enable/disable, model selection)

### Milestone 3: RPC + Agent Integration (1 week)
- [ ] New RPC channels for inbox, tasks, and calendar
- [ ] Jotai atoms and hooks for all three sections
- [ ] Wire up to Electron main process handlers
- [ ] Extend `NewChatActionParams` to pass session options (sources, permission mode)
- [ ] "Start Session" flow: `openNewChat` with pre-filled prompt from task
- [ ] Task ↔ Session linking (update task when session created)

### Milestone 4: Inbox UI (1.5 weeks)
- [ ] Inbox section in sidebar with channel/folder tree and unread badges
- [ ] Message list view (click channel → see messages)
- [ ] Message detail / thread view
- [ ] Triage badge on actionable messages with link to task
- [ ] Refresh button in section header

### Milestone 5: Tasks UI (1.5 weeks)
- [ ] Tasks section in sidebar with todo/in-progress/done sub-items and counts
- [ ] Task list view grouped by state (inspired by planner playground component)
- [ ] Task detail view with source message, draft prompt, action buttons
- [ ] Manual task creation (+ button in sidebar header)
- [ ] "Start Session" button → uses `openNewChat` flow
- [ ] "View Session" link for tasks with linked sessions
- [ ] Task state transitions (todo → in_progress → done)

### Milestone 6: Calendar UI (2 weeks)
- [ ] Calendar section in sidebar with view switcher (Day/Week/Month) and "Today" jump
- [ ] Week view (default) — 7-column grid with hour rows, events as colored blocks
- [ ] Day view — single-column hour timeline with event blocks
- [ ] Month view — classic grid with day cells and event pills
- [ ] Event detail card (title, time, attendees, location, join link, triage prep)
- [ ] Event create/edit forms (calls MCP tools to persist)
- [ ] Triage prep badge on events that need preparation
- [ ] Refresh button
- [ ] Calendar source toggles (show/hide individual calendars)

### Milestone 7: Polish (1 week)
- [ ] Inbox settings panel (configure sources, triage, background sync interval)
- [ ] Error handling and retry logic for MCP calls
- [ ] Empty states and onboarding (no MCP sources connected yet)
- [ ] Keyboard navigation for inbox, tasks, and calendar
- [ ] Offline resilience (show cached data when MCP unavailable)
- [ ] Triage feedback: track which tasks users start vs. dismiss to improve prompts

---

## Technical Considerations

### Why JSONL, Not a Database

The app has no database today and adding one would be a significant architectural change. JSONL works well for this use case:
- Messages are append-mostly (new messages added, triage results updated)
- Read patterns are simple (load all for a channel, load a thread, filter tasks by state)
- Volume is manageable (hundreds of messages per day, not millions)
- Existing infrastructure handles atomic writes, corruption recovery, and portability

If message volume or query complexity grows beyond what JSONL handles well (e.g., full-text search across thousands of messages), we can introduce SQLite later as a targeted optimization — but it's not needed for v1.

### MCP Efficiency

Since we're calling MCP tools directly (not through an agent), efficiency matters:
- **Keep MCP connections alive** between sync cycles — don't reconnect on every poll
- **Delta fetching** — always pass sync cursors (timestamps, message IDs) to only fetch new data
- **Batch requests** — fetch multiple channels/folders in parallel where the MCP supports it
- **Minimize tool calls** — prefer one broad query (e.g., "all unread messages") over many narrow ones
- **Connection pooling** — reuse the existing `CraftMcpClient` pool from `packages/shared/src/mcp/`, creating a persistent connection per inbox source that lives outside of session scope

### Cost Control
- Background sync runs every 5 minutes by default (configurable)
- Haiku triage is ~$0.004 per batch of 20 messages
- Calendar triage is low volume (5-10 events/day)
- Triage can be disabled entirely
- Max messages per sync batch prevents runaway costs

### Data Privacy
- All message data stored locally in the workspace folder
- Triage uses the user's own API key — no data sent to third parties beyond their LLM provider
- MCP credentials managed by the Anthropic connector store
- Calendar events with sensitive info (meeting notes, etc.) stay local

### Offline Behavior
- Inbox, tasks, and calendar show last-synced data when offline
- Refresh button shows error state when MCP unavailable
- Triage skipped when LLM connection unavailable
- Sync resumes on next manual refresh or background tick

### WebUI Compatibility
- All RPC channels work over WebSocket (same as sessions)
- UI components placed in `@scrunchy/ui` where possible for cross-platform reuse
- WebUI gets inbox/tasks/calendar if connected to a server with inbox enabled

---

## Key Implementation Details

### Extending `openNewChat` for Tasks

Current `NewChatActionParams` (`packages/shared/src/protocol/dto.ts` line 245):
```typescript
interface NewChatActionParams {
  input?: string
  name?: string
}
```

Extended version:
```typescript
interface NewChatActionParams {
  input?: string
  name?: string
  sessionOptions?: Partial<CreateSessionOptions>  // permissionMode, enabledSourceSlugs, labels, etc.
  taskId?: string                                  // Link back to originating task
}
```

`openNewChat` in `App.tsx` (line 1327) changes from:
```typescript
const session = await handleCreateSession(windowWorkspaceId)
```
to:
```typescript
const session = await handleCreateSession(windowWorkspaceId, params.sessionOptions)
if (params.taskId) {
  await window.electronAPI.taskUpdate(params.taskId, { sessionId: session.id, state: 'in_progress' })
}
```

### Adding Sidebar Sections

Each new section follows the same pattern as Sources/Automations in `AppShell.tsx`:

1. **State**: `isExpanded('nav:inbox')` persisted in localStorage
2. **Click handler**: `() => navigate(routes.view.inbox())`
3. **Active state**: `variant: isInboxNavigation(navState) ? 'default' : 'ghost'`
4. **Badge**: `label: String(unreadCount)` shown on hover
5. **Refresh**: `afterTitle: <RefreshButton />` in the section header
6. **Children**: Dynamic items from inbox sources/channels, task states, calendar sources

### Navigation State Resolution

In `MainContentPanel.tsx`, add cases:
```typescript
if (isInboxNavigation(navState)) return <InboxPage />
if (isTasksNavigation(navState)) return <TasksPage />
if (isCalendarNavigation(navState)) return <CalendarPage />
```

Each page component handles its own sub-navigation (list vs. detail) based on the navigation state details.

---

## Decisions Made

1. **Sidebar sections, not tabs** — Inbox, Tasks, and Calendar are new expandable sections in the existing sidebar, alongside Sessions, Sources, etc.

2. **Email metaphor for all messaging** — Slack channels are treated as folders, DMs as a folder. Everything renders in an email-like inbox view with threads.

3. **Tasks as a first-class entity** — Separate from sessions. A task is a work item; a session is an execution. Tasks can be created from triage or manually. Tasks link to sessions when the user starts one.

4. **No notifications** — Users still have native Slack/Outlook/Gmail. We don't duplicate notifications.

5. **MCPs from Anthropic connector store** — No custom MCP server recommendations or OAuth setup guides needed. Users connect via the connector store and it just works.

6. **File-based storage (JSONL)** — Consistent with the rest of the app. No database.

7. **Background sync on by default** — 5-minute polling keeps data fresh. Manual refresh button for immediacy.

8. **Pre-fill, don't auto-send** — "Start Session" creates a session with the prompt in the input box. User reviews and hits send. Uses existing `openNewChat` flow.

9. **Calendar read AND write** — Support creating and modifying events via MCP tools, not just viewing.

10. **Triage both messages and calendar events** — Messages get actionability detection; calendar events get meeting prep suggestions. Both create tasks.

---

## Open Questions

1. **Thread grouping**: Should Slack threads and email threads render identically, or should each source type have its own thread rendering?

2. **Inbox scope**: Should inbox be per-workspace or global? The sidebar is workspace-scoped today, so inbox likely follows. But calendar might make sense as global.

3. **Message retention**: How long do we keep messages in JSONL? Should there be auto-cleanup (e.g., messages older than 30 days)?

4. **Task re-triage**: When a user dismisses a task but the thread continues with new messages, should we re-triage and potentially create a new task?

5. **Planner integration**: The playground has a full planner component with projects, headings, and drag-and-drop. Should the Tasks view evolve toward that, or stay as a simple flat list grouped by state?
