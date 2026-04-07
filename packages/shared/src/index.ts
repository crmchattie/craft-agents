/**
 * @scrunchy/shared
 *
 * Shared business logic for Scrunchy.
 * Used by the Electron app.
 *
 * Import specific modules via subpath exports:
 *   import { Scrunchy } from '@scrunchy/shared/agent';
 *   import { loadStoredConfig } from '@scrunchy/shared/config';
 *   import { getCredentialManager } from '@scrunchy/shared/credentials';
 *   import { CraftMcpClient } from '@scrunchy/shared/mcp';
 *   import { debug } from '@scrunchy/shared/utils';
 *   import { loadSource, createSource, getSourceCredentialManager } from '@scrunchy/shared/sources';
 *   import { createWorkspace, loadWorkspace } from '@scrunchy/shared/workspaces';
 *
 * Available modules:
 *   - agent: Scrunchy SDK wrapper, plan tools
 *   - auth: OAuth, token management, auth state
 *   - clients: Craft API client
 *   - config: Storage, models, preferences
 *   - credentials: Encrypted credential storage
 *   - mcp: MCP client, connection validation
 *   - prompts: System prompt generation
 *   - sources: Workspace-scoped source management (MCP, API, local)
 *   - utils: Debug logging, file handling, summarization
 *   - validation: URL validation
 *   - version: Version and installation management
 *   - workspaces: Workspace management (top-level organizational unit)
 */

// Export branding (standalone, no dependencies)
export * from './branding.ts';
