/**
 * Inbox configuration — schema, loading, validation, and persistence.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { readJsonFileSync, atomicWriteFileSync } from '../utils/files.ts';
import { createLogger } from '../utils/debug.ts';

const log = createLogger('inbox-config');

// ============================================================================
// Types
// ============================================================================

export interface InboxSourceConfig {
  sourceSlug: string;
  sourceType: 'slack' | 'email' | 'calendar';
  enabled: boolean;
  fetchToolName: string;
  fetchToolArgs?: Record<string, unknown>;
}

export interface InboxConfig {
  backgroundSyncEnabled: boolean;
  syncIntervalMinutes: number;
  triageEnabled: boolean;
  triageModel: string;
  triageCustomInstructions: string;
  triageCalendar: boolean;
  calendarLookaheadHours: number;
  /** LLM connection slug to use for triage. Empty = workspace default. */
  triageConnection: string;
  /** Days to retain messages and events. 0 = no cleanup. */
  retentionDays: number;
  sources: InboxSourceConfig[];
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_INBOX_CONFIG: InboxConfig = {
  backgroundSyncEnabled: true,
  syncIntervalMinutes: 5,
  triageEnabled: true,
  triageModel: '',
  triageCustomInstructions: '',
  triageCalendar: true,
  calendarLookaheadHours: 24,
  triageConnection: '',
  retentionDays: 30,
  sources: [],
};

// ============================================================================
// Path helpers
// ============================================================================

export function getInboxConfigPath(workspaceRootPath: string): string {
  return join(workspaceRootPath, 'inbox-config.json');
}

// ============================================================================
// Load / Save
// ============================================================================

export function loadInboxConfig(workspaceRootPath: string): InboxConfig {
  const configPath = getInboxConfigPath(workspaceRootPath);
  if (!existsSync(configPath)) {
    log.debug('No inbox-config.json found, using defaults');
    return { ...DEFAULT_INBOX_CONFIG, sources: [] };
  }
  try {
    const raw = readJsonFileSync<Partial<InboxConfig>>(configPath);
    const config = { ...DEFAULT_INBOX_CONFIG, ...raw, sources: [...(raw.sources ?? [])] };
    log.debug(`Loaded inbox config: ${config.sources.length} sources, sync=${config.backgroundSyncEnabled}, triage=${config.triageEnabled}`);
    return config;
  } catch (error) {
    log.error('Failed to load inbox-config.json, using defaults:', error);
    return { ...DEFAULT_INBOX_CONFIG, sources: [] };
  }
}

export function saveInboxConfig(workspaceRootPath: string, config: InboxConfig): void {
  const configPath = getInboxConfigPath(workspaceRootPath);
  atomicWriteFileSync(configPath, JSON.stringify(config, null, 2));
  log.info(`Saved inbox config: ${config.sources.length} sources`);
}

// ============================================================================
// Validation
// ============================================================================

export function validateInboxConfig(config: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (typeof config !== 'object' || config === null) {
    return { valid: false, errors: ['Config must be an object'] };
  }
  const c = config as Record<string, unknown>;
  if (c.syncIntervalMinutes !== undefined) {
    if (typeof c.syncIntervalMinutes !== 'number' || c.syncIntervalMinutes < 1) {
      errors.push('syncIntervalMinutes must be a number >= 1');
    }
  }
  if (c.calendarLookaheadHours !== undefined) {
    if (typeof c.calendarLookaheadHours !== 'number' || c.calendarLookaheadHours < 1) {
      errors.push('calendarLookaheadHours must be a number >= 1');
    }
  }
  if (c.sources !== undefined && !Array.isArray(c.sources)) {
    errors.push('sources must be an array');
  }
  if (Array.isArray(c.sources)) {
    for (const [i, src] of (c.sources as unknown[]).entries()) {
      if (typeof src !== 'object' || src === null) {
        errors.push(`sources[${i}] must be an object`);
        continue;
      }
      const s = src as Record<string, unknown>;
      if (!s.sourceSlug || typeof s.sourceSlug !== 'string') {
        errors.push(`sources[${i}].sourceSlug is required`);
      }
      if (!s.sourceType || !['slack', 'email', 'calendar'].includes(s.sourceType as string)) {
        errors.push(`sources[${i}].sourceType must be 'slack', 'email', or 'calendar'`);
      }
      if (!s.fetchToolName || typeof s.fetchToolName !== 'string') {
        errors.push(`sources[${i}].fetchToolName is required`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}
