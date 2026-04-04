import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import { autoWireSource, unwireSource } from '../auto-wire.ts';
import { loadInboxConfig, saveInboxConfig, DEFAULT_INBOX_CONFIG } from '../config.ts';
import type { InboxCapability } from '../provider-registry.ts';

const TEST_DIR = join(import.meta.dir, '.test-auto-wire-workspace');

const gmailCap: InboxCapability = {
  inboxSourceType: 'email',
  fetchToolName: 'list_messages',
  displayName: 'Gmail',
};

const gcalCap: InboxCapability = {
  inboxSourceType: 'calendar',
  fetchToolName: 'list_events',
  displayName: 'Google Calendar',
};

describe('autoWireSource', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('adds inbox source configs for detected capabilities', () => {
    const result = autoWireSource(TEST_DIR, 'gmail_abc', [gmailCap]);

    expect(result.added).toHaveLength(1);
    expect(result.alreadyWired).toHaveLength(0);

    const config = loadInboxConfig(TEST_DIR);
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0]!.sourceSlug).toBe('gmail_abc');
    expect(config.sources[0]!.sourceType).toBe('email');
    expect(config.sources[0]!.fetchToolName).toBe('list_messages');
    expect(config.sources[0]!.enabled).toBe(true);
  });

  it('adds multiple capabilities at once', () => {
    const result = autoWireSource(TEST_DIR, 'google_xyz', [gmailCap, gcalCap]);

    expect(result.added).toHaveLength(2);
    const config = loadInboxConfig(TEST_DIR);
    expect(config.sources).toHaveLength(2);
  });

  it('skips already-wired capabilities', () => {
    autoWireSource(TEST_DIR, 'gmail_abc', [gmailCap]);
    const result = autoWireSource(TEST_DIR, 'gmail_abc', [gmailCap]);

    expect(result.added).toHaveLength(0);
    expect(result.alreadyWired).toEqual(['Gmail']);
    expect(loadInboxConfig(TEST_DIR).sources).toHaveLength(1);
  });

  it('returns empty when no capabilities provided', () => {
    const result = autoWireSource(TEST_DIR, 'test', []);
    expect(result.added).toHaveLength(0);
    expect(result.alreadyWired).toHaveLength(0);
  });

  it('preserves existing inbox config settings', () => {
    saveInboxConfig(TEST_DIR, {
      ...DEFAULT_INBOX_CONFIG,
      syncIntervalMinutes: 10,
      triageEnabled: false,
    });

    autoWireSource(TEST_DIR, 'gmail_abc', [gmailCap]);

    const config = loadInboxConfig(TEST_DIR);
    expect(config.syncIntervalMinutes).toBe(10);
    expect(config.triageEnabled).toBe(false);
    expect(config.sources).toHaveLength(1);
  });
});

describe('unwireSource', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  it('removes all inbox configs for a source slug', () => {
    autoWireSource(TEST_DIR, 'google_xyz', [gmailCap, gcalCap]);
    expect(loadInboxConfig(TEST_DIR).sources).toHaveLength(2);

    const removed = unwireSource(TEST_DIR, 'google_xyz');
    expect(removed).toBe(2);
    expect(loadInboxConfig(TEST_DIR).sources).toHaveLength(0);
  });

  it('returns 0 when source slug not found', () => {
    const removed = unwireSource(TEST_DIR, 'nonexistent');
    expect(removed).toBe(0);
  });

  it('only removes entries for the specified slug', () => {
    autoWireSource(TEST_DIR, 'gmail_abc', [gmailCap]);
    autoWireSource(TEST_DIR, 'slack_xyz', [{
      inboxSourceType: 'slack',
      fetchToolName: 'list_messages',
      displayName: 'Slack',
    }]);

    unwireSource(TEST_DIR, 'gmail_abc');

    const config = loadInboxConfig(TEST_DIR);
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0]!.sourceSlug).toBe('slack_xyz');
  });
});
