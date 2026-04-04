import { describe, it, expect } from 'bun:test';
import {
  detectCapabilities,
  discoverCapabilitiesFromTools,
  buildInboxSourceConfig,
} from '../provider-registry.ts';
import type { FolderSourceConfig } from '../../sources/types.ts';

function makeSource(overrides: Partial<FolderSourceConfig>): FolderSourceConfig {
  return {
    id: 'test-id',
    name: 'Test Source',
    slug: 'test-source',
    enabled: true,
    provider: 'custom',
    type: 'mcp',
    ...overrides,
  } as FolderSourceConfig;
}

describe('detectCapabilities', () => {
  it('detects Gmail from explicit googleService', () => {
    const source = makeSource({
      provider: 'google',
      type: 'api',
      api: { baseUrl: 'https://www.googleapis.com/gmail/v1', authType: 'oauth', googleService: 'gmail' },
    });
    const caps = detectCapabilities(source);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.inboxSourceType).toBe('email');
    expect(caps[0]!.displayName).toBe('Gmail');
  });

  it('detects Google Calendar from explicit googleService', () => {
    const source = makeSource({
      provider: 'google',
      type: 'api',
      api: { baseUrl: 'https://www.googleapis.com/calendar/v3', authType: 'oauth', googleService: 'calendar' },
    });
    const caps = detectCapabilities(source);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.inboxSourceType).toBe('calendar');
    expect(caps[0]!.displayName).toBe('Google Calendar');
  });

  it('detects Gmail from URL inference', () => {
    const source = makeSource({
      provider: 'google',
      type: 'api',
      api: { baseUrl: 'https://gmail.googleapis.com/', authType: 'oauth' },
    });
    const caps = detectCapabilities(source);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.inboxSourceType).toBe('email');
  });

  it('detects Outlook from explicit microsoftService', () => {
    const source = makeSource({
      provider: 'microsoft',
      type: 'api',
      api: { baseUrl: 'https://graph.microsoft.com/v1.0', authType: 'oauth', microsoftService: 'outlook' },
    });
    const caps = detectCapabilities(source);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.inboxSourceType).toBe('email');
    expect(caps[0]!.displayName).toBe('Outlook');
  });

  it('detects Microsoft Calendar', () => {
    const source = makeSource({
      provider: 'microsoft',
      type: 'api',
      api: { baseUrl: 'https://graph.microsoft.com/v1.0', authType: 'oauth', microsoftService: 'microsoft-calendar' },
    });
    const caps = detectCapabilities(source);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.inboxSourceType).toBe('calendar');
  });

  it('detects Slack from slackService', () => {
    const source = makeSource({
      provider: 'slack',
      type: 'api',
      api: { baseUrl: 'https://slack.com/api', authType: 'oauth', slackService: 'full' },
    });
    const caps = detectCapabilities(source);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.inboxSourceType).toBe('slack');
    expect(caps[0]!.displayName).toBe('Slack');
  });

  it('returns empty for unknown provider', () => {
    const source = makeSource({ provider: 'notion', type: 'mcp' });
    expect(detectCapabilities(source)).toHaveLength(0);
  });

  it('returns empty for Google Drive (no inbox capability)', () => {
    const source = makeSource({
      provider: 'google',
      type: 'api',
      api: { baseUrl: 'https://drive.googleapis.com/', authType: 'oauth', googleService: 'drive' },
    });
    expect(detectCapabilities(source)).toHaveLength(0);
  });

  it('returns empty when provider is missing', () => {
    const source = makeSource({ provider: '' });
    expect(detectCapabilities(source)).toHaveLength(0);
  });
});

describe('discoverCapabilitiesFromTools', () => {
  it('detects email from list_messages tool', () => {
    const caps = discoverCapabilitiesFromTools(['list_messages', 'send_message']);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.inboxSourceType).toBe('email');
    expect(caps[0]!.fetchToolName).toBe('list_messages');
  });

  it('detects calendar from list_events tool', () => {
    const caps = discoverCapabilitiesFromTools(['list_events', 'create_event']);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.inboxSourceType).toBe('calendar');
    expect(caps[0]!.fetchToolName).toBe('list_events');
  });

  it('detects both email and calendar', () => {
    const caps = discoverCapabilitiesFromTools(['list_messages', 'list_events', 'other_tool']);
    expect(caps).toHaveLength(2);
    const types = caps.map(c => c.inboxSourceType).sort();
    expect(types).toEqual(['calendar', 'email']);
  });

  it('returns empty for unrelated tools', () => {
    const caps = discoverCapabilitiesFromTools(['create_issue', 'search_code', 'run_query']);
    expect(caps).toHaveLength(0);
  });

  it('deduplicates — only first matching tool per type', () => {
    const caps = discoverCapabilitiesFromTools(['list_messages', 'get_emails']);
    expect(caps).toHaveLength(1);
    expect(caps[0]!.fetchToolName).toBe('list_messages');
  });

  it('handles case-insensitive matching', () => {
    const caps = discoverCapabilitiesFromTools(['List_Messages', 'LIST_EVENTS']);
    expect(caps).toHaveLength(2);
  });
});

describe('buildInboxSourceConfig', () => {
  it('creates a valid InboxSourceConfig', () => {
    const config = buildInboxSourceConfig('gmail_abc', {
      inboxSourceType: 'email',
      fetchToolName: 'list_messages',
      displayName: 'Gmail',
    });
    expect(config).toEqual({
      sourceSlug: 'gmail_abc',
      sourceType: 'email',
      enabled: true,
      fetchToolName: 'list_messages',
    });
  });

  it('includes fetchToolArgs when provided', () => {
    const config = buildInboxSourceConfig('gcal', {
      inboxSourceType: 'calendar',
      fetchToolName: 'list_events',
      fetchToolArgs: { maxResults: 50 },
      displayName: 'Google Calendar',
    });
    expect(config.fetchToolArgs).toEqual({ maxResults: 50 });
  });
});
