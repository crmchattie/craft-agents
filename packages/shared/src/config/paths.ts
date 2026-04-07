/**
 * Centralized path configuration for Scrunchy.
 *
 * Supports multi-instance development via SCRUNCHY_CONFIG_DIR environment variable.
 * When running from a numbered folder (e.g., scrunchy-1), the detect-instance.sh
 * script sets SCRUNCHY_CONFIG_DIR to ~/.scrunchy-1, allowing multiple instances to run
 * simultaneously with separate configurations.
 *
 * Default (non-numbered folders): ~/.scrunchy/
 * Instance 1 (-1 suffix): ~/.scrunchy-1/
 * Instance 2 (-2 suffix): ~/.scrunchy-2/
 *
 * Migration: Copies credentials.enc from ~/.craft-agent/ to ~/.scrunchy/ on first run
 * if the new directory doesn't have credentials yet.
 */

import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const LEGACY_DIR = join(homedir(), '.craft-agent');

function resolveConfigDir(): string {
  // Explicit env var overrides take precedence
  if (process.env.SCRUNCHY_CONFIG_DIR) return process.env.SCRUNCHY_CONFIG_DIR;
  if (process.env.CRAFT_CONFIG_DIR) return process.env.CRAFT_CONFIG_DIR;

  return join(homedir(), '.scrunchy');
}

/**
 * Migrate credentials from legacy ~/.craft-agent/ to new config dir.
 * Called once at module load time — copies credentials.enc if missing.
 */
function migrateCredentials(configDir: string): void {
  try {
    const newCreds = join(configDir, 'credentials.enc');
    const legacyCreds = join(LEGACY_DIR, 'credentials.enc');

    if (!existsSync(newCreds) && existsSync(legacyCreds)) {
      mkdirSync(configDir, { recursive: true });
      copyFileSync(legacyCreds, newCreds);
    }
  } catch {
    // Silently ignore migration errors — user can re-authenticate
  }
}

// Allow override via environment variable for multi-instance dev
export const CONFIG_DIR = resolveConfigDir();

// Auto-migrate credentials from legacy Craft Agent install
migrateCredentials(CONFIG_DIR);
