/**
 * Auto-wire — automatically connects sources to the inbox/calendar sync pipeline
 * when capabilities are detected (known providers or MCP tool introspection).
 */

import { createLogger } from '../utils/debug.ts';
import { loadInboxConfig, saveInboxConfig } from './config.ts';
import type { InboxSourceConfig } from './config.ts';
import { type InboxCapability, buildInboxSourceConfig } from './provider-registry.ts';

const log = createLogger('inbox-auto-wire');

// ============================================================================
// Types
// ============================================================================

export interface AutoWireResult {
  /** Newly added inbox source configs */
  added: InboxSourceConfig[];
  /** Source types that were already wired */
  alreadyWired: string[];
}

// ============================================================================
// Auto-wire
// ============================================================================

/**
 * Wire a source into the inbox sync pipeline for each detected capability.
 * Skips capabilities that are already wired for this source slug.
 * Saves the updated config to disk.
 */
export function autoWireSource(
  workspaceRootPath: string,
  sourceSlug: string,
  capabilities: InboxCapability[],
): AutoWireResult {
  log.info(`Auto-wire requested for ${sourceSlug} with ${capabilities.length} capabilities: ${capabilities.map(c => c.displayName).join(', ')}`);

  if (capabilities.length === 0) {
    return { added: [], alreadyWired: [] };
  }

  const config = loadInboxConfig(workspaceRootPath);
  const added: InboxSourceConfig[] = [];
  const alreadyWired: string[] = [];

  for (const cap of capabilities) {
    const exists = config.sources.some(
      s => s.sourceSlug === sourceSlug && s.sourceType === cap.inboxSourceType,
    );

    if (exists) {
      alreadyWired.push(cap.displayName);
      log.debug(`Skipping ${sourceSlug}/${cap.displayName}: already wired`);
      continue;
    }

    const entry = buildInboxSourceConfig(sourceSlug, cap);
    config.sources.push(entry);
    added.push(entry);
  }

  if (added.length > 0) {
    saveInboxConfig(workspaceRootPath, config);
    log.debug(
      `Auto-wired ${sourceSlug}: ${added.map(a => a.sourceType).join(', ')}`,
    );
  }

  return { added, alreadyWired };
}

/**
 * Remove all inbox source configs for a given source slug.
 * Called when a source is deleted to prevent orphaned sync entries.
 */
export function unwireSource(
  workspaceRootPath: string,
  sourceSlug: string,
): number {
  const config = loadInboxConfig(workspaceRootPath);
  const before = config.sources.length;
  config.sources = config.sources.filter(s => s.sourceSlug !== sourceSlug);
  const removed = before - config.sources.length;

  if (removed > 0) {
    saveInboxConfig(workspaceRootPath, config);
    log.debug(`Unwired ${sourceSlug}: removed ${removed} inbox source(s)`);
  }

  return removed;
}
