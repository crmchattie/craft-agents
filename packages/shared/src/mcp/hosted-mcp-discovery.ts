/**
 * Hosted MCP Discovery
 *
 * Discovers Anthropic-hosted MCP servers (Gmail, Google Calendar, etc.)
 * by spawning a minimal SDK query and reading the init message.
 * Results are cached to avoid repeated subprocess spawns.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import { hasClaudeCodeCliAuth } from '../auth/state.ts';
import { getClaudeCliPaths, buildClaudeSubprocessEnv } from '../agent/options.ts';
import { debug } from '../utils/debug.ts';

export interface HostedMcpServer {
  name: string;       // e.g., 'claude.ai Gmail'
  slug: string;       // e.g., 'claude_ai_Gmail'
  status: string;     // e.g., 'connected', 'needs-auth', 'pending'
  tools: Tool[];      // Tool definitions for this server
}

// Cache discovery results (valid for the process lifetime)
let cachedServers: HostedMcpServer[] | null = null;
let cachedAt: number | null = null;
let discoveryInProgress: Promise<HostedMcpServer[]> | null = null;

/**
 * Convert a hosted MCP server name to a slug.
 * e.g., 'claude.ai Gmail' → 'claude_ai_Gmail'
 */
function serverNameToSlug(name: string): string {
  return name.replace(/^claude\.ai\s+/, 'claude_ai_').replace(/\s+/g, '_');
}

/**
 * Check if hosted MCPs are potentially available.
 */
export function isHostedMcpAvailable(): boolean {
  return hasClaudeCodeCliAuth();
}

/**
 * Discover hosted MCP servers by spawning a minimal SDK query.
 * Returns cached results on subsequent calls.
 */
export async function discoverHostedMcpServers(): Promise<HostedMcpServer[]> {
  if (cachedServers !== null) {
    const ageSec = cachedAt ? Math.floor((Date.now() - cachedAt) / 1000) : -1;
    const summary = cachedServers.map(s => `${s.slug}(${s.status})`).join(', ') || '<empty>';
    debug(`Returning cached hosted MCP discovery (age=${ageSec}s, ${cachedServers.length} servers): ${summary}`);
    return cachedServers;
  }
  if (discoveryInProgress) {
    debug('Hosted MCP discovery already in progress — awaiting existing promise');
    return discoveryInProgress;
  }

  if (!isHostedMcpAvailable()) {
    debug('Hosted MCPs unavailable: no Claude Code CLI auth detected');
    cachedServers = [];
    cachedAt = Date.now();
    return cachedServers;
  }

  discoveryInProgress = doDiscovery();
  try {
    cachedServers = await discoveryInProgress;
    cachedAt = Date.now();
    return cachedServers;
  } finally {
    discoveryInProgress = null;
  }
}

/**
 * Get tool definitions for a specific hosted MCP server by slug.
 */
export async function getHostedMcpToolDefs(slug: string): Promise<Tool[]> {
  const servers = await discoverHostedMcpServers();
  const server = servers.find(s => s.slug === slug);
  return server?.tools ?? [];
}

/**
 * Get all discovered hosted MCP server slugs that are connected.
 */
export async function getConnectedHostedMcpSlugs(): Promise<string[]> {
  const servers = await discoverHostedMcpServers();
  return servers.filter(s => s.status === 'connected').map(s => s.slug);
}

/**
 * Clear the discovery cache (e.g., after auth changes).
 */
export function clearHostedMcpCache(): void {
  const prevAge = cachedAt ? Math.floor((Date.now() - cachedAt) / 1000) : -1;
  debug(`Clearing hosted MCP discovery cache (prev age=${prevAge}s)`);
  cachedServers = null;
  cachedAt = null;
}

async function doDiscovery(): Promise<HostedMcpServer[]> {
  const { cliPath, executable } = getClaudeCliPaths();
  if (!cliPath) {
    debug('CLI path not available, skipping discovery');
    return [];
  }

  debug('Starting hosted MCP discovery...');

  try {
    const conversation = query({
      prompt: 'hi',
      options: {
        maxTurns: 1,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        pathToClaudeCodeExecutable: cliPath,
        executable: executable as 'bun',
        executableArgs: ['--env-file=/dev/null'],
        env: buildClaudeSubprocessEnv() as Record<string, string>,
        model: 'claude-haiku-4-5-20251001',
      },
    });

    let mcpServers: Array<{ name: string; status: string }> = [];
    let allTools: string[] = [];

    for await (const msg of conversation) {
      const m = msg as any;
      if (m.type === 'system' && m.subtype === 'init') {
        mcpServers = m.mcp_servers || [];
        allTools = m.tools || [];
        conversation.close();
        break;
      }
    }

    // Filter to only claude.ai hosted servers
    const hostedServers: HostedMcpServer[] = [];
    for (const server of mcpServers) {
      if (!server.name.startsWith('claude.ai ')) continue;

      const slug = serverNameToSlug(server.name);
      const prefix = `mcp__${slug}__`;
      const serverTools: Tool[] = allTools
        .filter(t => t.startsWith(prefix))
        .map(t => ({
          name: t.replace(prefix, ''),
          description: `Tool from ${server.name}`,
          inputSchema: { type: 'object' as const, properties: {} },
        }));

      hostedServers.push({
        name: server.name,
        slug,
        status: server.status,
        tools: serverTools,
      });
    }

    debug(`Discovered ${hostedServers.length} hosted MCP servers: ${hostedServers.map(s => `${s.slug}(${s.status}, ${s.tools.length} tools)`).join(', ')}`);
    // Emit a per-server breakdown for easier diagnosis of individual server states
    for (const s of hostedServers) {
      debug(`  hosted MCP: slug=${s.slug} status=${s.status} tools=${s.tools.length}`);
    }
    return hostedServers;
  } catch (error) {
    // Use console.error so the failure is visible even with debug filters off
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[hosted-mcp-discovery] Discovery failed: ${msg}`);
    debug(`Discovery failed: ${msg}`);
    return [];
  }
}
