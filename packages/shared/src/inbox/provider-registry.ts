/**
 * Provider Capability Registry — maps known providers/services to inbox/calendar capabilities.
 *
 * Used to auto-wire sources to the inbox sync pipeline when a source is
 * created or authenticated. Also supports MCP tool introspection for
 * unknown providers.
 */

import type { FolderSourceConfig } from '../sources/types.ts';
import {
  inferGoogleServiceFromUrl,
  inferMicrosoftServiceFromUrl,
  inferSlackServiceFromUrl,
} from '../sources/types.ts';
import type { InboxSourceConfig } from './config.ts';
import { createLogger } from '../utils/debug.ts';

const log = createLogger('inbox-provider-registry');

// ============================================================================
// Types
// ============================================================================

export interface InboxCapability {
  /** The inbox source type to create */
  inboxSourceType: 'email' | 'slack' | 'calendar';
  /** MCP tool name to call for fetching data */
  fetchToolName: string;
  /** Default tool arguments */
  fetchToolArgs?: Record<string, unknown>;
  /** Human-readable name (e.g., "Gmail", "Outlook Calendar") */
  displayName: string;
}

interface RegistryEntry {
  provider: string;
  service?: string;
  capabilities: InboxCapability[];
}

// ============================================================================
// Known provider registry
// ============================================================================

const PROVIDER_REGISTRY: RegistryEntry[] = [
  // Google
  {
    provider: 'google',
    service: 'gmail',
    capabilities: [{
      inboxSourceType: 'email',
      fetchToolName: 'list_messages',
      displayName: 'Gmail',
    }],
  },
  {
    provider: 'google',
    service: 'calendar',
    capabilities: [{
      inboxSourceType: 'calendar',
      fetchToolName: 'list_events',
      displayName: 'Google Calendar',
    }],
  },

  // Microsoft
  {
    provider: 'microsoft',
    service: 'outlook',
    capabilities: [{
      inboxSourceType: 'email',
      fetchToolName: 'list_messages',
      displayName: 'Outlook',
    }],
  },
  {
    provider: 'microsoft',
    service: 'microsoft-calendar',
    capabilities: [{
      inboxSourceType: 'calendar',
      fetchToolName: 'list_events',
      displayName: 'Microsoft Calendar',
    }],
  },

  // Slack
  {
    provider: 'slack',
    service: 'messaging',
    capabilities: [{
      inboxSourceType: 'slack',
      fetchToolName: 'list_messages',
      displayName: 'Slack',
    }],
  },
  {
    provider: 'slack',
    service: 'full',
    capabilities: [{
      inboxSourceType: 'slack',
      fetchToolName: 'list_messages',
      displayName: 'Slack',
    }],
  },

  // Anthropic-hosted MCP servers (claude.ai integrations)
  {
    provider: 'claude_ai',
    service: 'Gmail',
    capabilities: [{
      inboxSourceType: 'email',
      fetchToolName: 'gmail_search_messages',
      displayName: 'Gmail (Claude.ai)',
    }],
  },
  {
    provider: 'claude_ai',
    service: 'Google_Calendar',
    capabilities: [{
      inboxSourceType: 'calendar',
      fetchToolName: 'gcal_list_events',
      displayName: 'Google Calendar (Claude.ai)',
    }],
  },
  {
    provider: 'claude_ai',
    service: 'Slack',
    capabilities: [{
      inboxSourceType: 'slack',
      fetchToolName: 'slack_search_public_and_private',
      displayName: 'Slack (Claude.ai)',
    }],
  },
  {
    provider: 'claude_ai',
    service: 'Microsoft_365',
    capabilities: [
      {
        inboxSourceType: 'email',
        fetchToolName: 'outlook_email_search',
        displayName: 'Outlook (Claude.ai)',
      },
      {
        inboxSourceType: 'calendar',
        fetchToolName: 'outlook_calendar_search',
        displayName: 'Outlook Calendar (Claude.ai)',
      },
    ],
  },
];

export { PROVIDER_REGISTRY };

// ============================================================================
// Detection from source config (known providers)
// ============================================================================

/**
 * Detect inbox/calendar capabilities from a source's config.
 * Matches against the known provider registry using provider + service fields.
 */
export function detectCapabilities(source: FolderSourceConfig): InboxCapability[] {
  const provider = source.provider?.toLowerCase();
  if (!provider) {
    log.debug(`No provider set for source, skipping capability detection`);
    return [];
  }

  // Resolve the service from explicit config or URL inference
  const service = resolveService(source);

  const capabilities: InboxCapability[] = [];
  for (const entry of PROVIDER_REGISTRY) {
    if (entry.provider !== provider) continue;
    if (entry.service && entry.service !== service) continue;
    capabilities.push(...entry.capabilities);
  }

  if (capabilities.length > 0) {
    log.info(`Detected capabilities for provider=${provider} service=${service ?? 'any'}: ${capabilities.map(c => c.displayName).join(', ')}`);
  } else {
    log.debug(`No capabilities found for provider=${provider} service=${service ?? 'any'}`);
  }

  return capabilities;
}

function resolveService(source: FolderSourceConfig): string | undefined {
  const api = source.api;
  if (!api) return undefined;

  // Check explicit service fields first
  if (api.googleService) return api.googleService;
  if (api.microsoftService) return api.microsoftService;
  if (api.slackService) return api.slackService;

  // Fall back to URL inference
  const provider = source.provider?.toLowerCase();
  if (provider === 'google') return inferGoogleServiceFromUrl(api.baseUrl) ?? undefined;
  if (provider === 'microsoft') return inferMicrosoftServiceFromUrl(api.baseUrl) ?? undefined;
  if (provider === 'slack') return inferSlackServiceFromUrl(api.baseUrl) ?? undefined;

  return undefined;
}

// ============================================================================
// Detection from MCP tool introspection (unknown providers)
// ============================================================================

const EMAIL_TOOL_PATTERNS = /^(list_messages|get_messages|list_emails|get_emails|search_messages|fetch_messages|read_inbox)$/i;
const CALENDAR_TOOL_PATTERNS = /^(list_events|get_events|list_calendar_events|get_calendar|fetch_events|upcoming_events)$/i;

/**
 * Discover inbox/calendar capabilities by pattern-matching MCP tool names.
 * Used as a fallback when a source doesn't match any known provider.
 */
export function discoverCapabilitiesFromTools(toolNames: string[]): InboxCapability[] {
  const capabilities: InboxCapability[] = [];
  let hasEmail = false;
  let hasCalendar = false;

  for (const name of toolNames) {
    if (!hasEmail && EMAIL_TOOL_PATTERNS.test(name)) {
      hasEmail = true;
      capabilities.push({
        inboxSourceType: 'email',
        fetchToolName: name,
        displayName: 'Email',
      });
    }
    if (!hasCalendar && CALENDAR_TOOL_PATTERNS.test(name)) {
      hasCalendar = true;
      capabilities.push({
        inboxSourceType: 'calendar',
        fetchToolName: name,
        displayName: 'Calendar',
      });
    }
  }

  if (capabilities.length > 0) {
    log.info(`Discovered capabilities from MCP tools: ${capabilities.map(c => `${c.displayName} (${c.fetchToolName})`).join(', ')}`);
  }

  return capabilities;
}

// ============================================================================
// Config builder
// ============================================================================

/**
 * Build an InboxSourceConfig entry from a detected capability.
 */
export function buildInboxSourceConfig(
  sourceSlug: string,
  capability: InboxCapability,
): InboxSourceConfig {
  return {
    sourceSlug,
    sourceType: capability.inboxSourceType,
    enabled: true,
    fetchToolName: capability.fetchToolName,
    ...(capability.fetchToolArgs && { fetchToolArgs: capability.fetchToolArgs }),
  };
}
