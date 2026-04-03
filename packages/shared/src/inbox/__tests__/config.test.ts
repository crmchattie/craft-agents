import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'fs';
import { join } from 'path';
import {
  loadInboxConfig,
  saveInboxConfig,
  validateInboxConfig,
  getInboxConfigPath,
  DEFAULT_INBOX_CONFIG,
} from '../config.ts';

const TEST_DIR = join(import.meta.dir, '.test-config-workspace');

describe('inbox config', () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
    mkdirSync(TEST_DIR, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true });
  });

  describe('loadInboxConfig', () => {
    it('returns defaults when no config file exists', () => {
      const config = loadInboxConfig(TEST_DIR);
      expect(config).toEqual(DEFAULT_INBOX_CONFIG);
    });

    it('loads and merges with defaults', () => {
      writeFileSync(
        getInboxConfigPath(TEST_DIR),
        JSON.stringify({ syncIntervalMinutes: 10, sources: [{ sourceSlug: 'slack', sourceType: 'slack', enabled: true, fetchToolName: 'list_messages' }] }),
      );
      const config = loadInboxConfig(TEST_DIR);
      expect(config.syncIntervalMinutes).toBe(10);
      expect(config.sources).toHaveLength(1);
      expect(config.triageEnabled).toBe(true); // from defaults
    });

    it('returns defaults on invalid JSON', () => {
      writeFileSync(getInboxConfigPath(TEST_DIR), 'not json');
      const config = loadInboxConfig(TEST_DIR);
      expect(config).toEqual(DEFAULT_INBOX_CONFIG);
    });
  });

  describe('saveInboxConfig', () => {
    it('writes config and can be read back', () => {
      const config = { ...DEFAULT_INBOX_CONFIG, syncIntervalMinutes: 3 };
      saveInboxConfig(TEST_DIR, config);
      const loaded = loadInboxConfig(TEST_DIR);
      expect(loaded.syncIntervalMinutes).toBe(3);
    });
  });

  describe('validateInboxConfig', () => {
    it('accepts valid config', () => {
      const result = validateInboxConfig({
        syncIntervalMinutes: 5,
        sources: [{ sourceSlug: 'slack', sourceType: 'slack', fetchToolName: 'list' }],
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('rejects non-object', () => {
      expect(validateInboxConfig(null).valid).toBe(false);
      expect(validateInboxConfig('string').valid).toBe(false);
    });

    it('rejects invalid syncIntervalMinutes', () => {
      const result = validateInboxConfig({ syncIntervalMinutes: 0 });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('syncIntervalMinutes');
    });

    it('rejects source without sourceSlug', () => {
      const result = validateInboxConfig({ sources: [{ sourceType: 'slack', fetchToolName: 'list' }] });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('sourceSlug');
    });

    it('rejects source with invalid sourceType', () => {
      const result = validateInboxConfig({ sources: [{ sourceSlug: 's', sourceType: 'invalid', fetchToolName: 'list' }] });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('sourceType');
    });
  });
});
