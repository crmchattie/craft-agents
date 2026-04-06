/**
 * Hosted MCP Pool Client
 *
 * Routes tool calls to Anthropic-hosted MCP servers (Gmail, Google Calendar, etc.)
 * through the Claude Agent SDK's query() function. This allows the inbox sync
 * pipeline to fetch data from hosted MCPs that are only available inside the
 * SDK subprocess.
 *
 * Each callTool() invocation spawns a lightweight SDK query with maxTurns=1,
 * forcing the model to call exactly one tool and return.
 */

import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Tool } from '@modelcontextprotocol/sdk/types.js';
import type { PoolClient } from './client.ts';
import { getClaudeCliPaths, buildClaudeSubprocessEnv } from '../agent/options.ts';
import { debug } from '../utils/debug.ts';

export class HostedMcpPoolClient implements PoolClient {
  private serverName: string;
  private toolDefs: Tool[];

  /**
   * @param serverName — The hosted MCP server slug (e.g., 'claude_ai_Gmail')
   * @param toolDefs — Pre-discovered tool definitions for this server
   */
  constructor(serverName: string, toolDefs: Tool[]) {
    this.serverName = serverName;
    this.toolDefs = toolDefs;
  }

  async listTools(): Promise<Tool[]> {
    return this.toolDefs;
  }

  /**
   * Call a hosted MCP tool by spawning a minimal SDK query.
   *
   * The SDK subprocess connects to the hosted MCP server via the user's
   * Claude.ai account (keychain auth). We restrict available tools to just
   * the one we want, set maxTurns=1, and extract the tool result from the
   * message stream.
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const { cliPath, executable } = getClaudeCliPaths();
    if (!cliPath) {
      throw new Error('Claude Code SDK cli.js not found');
    }

    const fullToolName = `mcp__${this.serverName}__${name}`;
    debug(`callTool: ${fullToolName} args=${JSON.stringify(args).substring(0, 200)}`);

    // Retry up to 2 times — the model occasionally doesn't call the tool
    const MAX_ATTEMPTS = 2;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const result = await this.attemptToolCall(fullToolName, args, cliPath, executable);
      if (result !== null) return result;
      if (attempt < MAX_ATTEMPTS) {
        debug(`callTool: ${fullToolName} attempt ${attempt} failed, retrying...`);
      }
    }

    throw new Error(`Model did not call ${fullToolName} after ${MAX_ATTEMPTS} attempts`);
  }

  private async attemptToolCall(
    fullToolName: string,
    args: Record<string, unknown>,
    cliPath: string,
    executable: string,
  ): Promise<unknown | null> {
    const conversation = query({
      prompt: `Call ${fullToolName} with: ${JSON.stringify(args)}`,
      options: {
        maxTurns: 1,
        systemPrompt: 'Call the requested tool.',  // Minimal — replaces 10K-token Claude Code prompt
        tools: [],                                  // No built-in tools (Bash, Read, etc.)
        allowedTools: [fullToolName],               // Auto-approve the one tool we need
        effort: 'low' as any,                       // Minimal model computation
        persistSession: false,                      // No disk I/O for ephemeral calls
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        pathToClaudeCodeExecutable: cliPath,
        executable: executable as 'bun',
        executableArgs: ['--env-file=/dev/null'],
        env: buildClaudeSubprocessEnv() as Record<string, string>,
        model: 'claude-haiku-4-5-20251001',
      },
    });

    let toolResultContent: string | null = null;
    let toolCallMade = false;

    try {
      for await (const msg of conversation) {
        const m = msg as any;

        if (m.type === 'assistant' && m.message?.content) {
          for (const block of m.message.content) {
            if (block.type === 'tool_use' && block.name === fullToolName) {
              toolCallMade = true;
            }
          }
        }

        if (m.type === 'user') {
          const content = m.content || m.message?.content || [];
          for (const block of (Array.isArray(content) ? content : [])) {
            if (block.type === 'tool_result') {
              const resultContent = Array.isArray(block.content) ? block.content : [block.content];
              for (const c of resultContent) {
                if (typeof c === 'string') {
                  toolResultContent = c;
                } else if (c?.type === 'text') {
                  toolResultContent = c.text;
                }
              }
              // Got the result — close immediately, don't let model process it
              conversation.close();
            }
          }
        }
      }
    } finally {
      try { conversation.close(); } catch { /* ignore */ }
    }

    if (!toolCallMade || toolResultContent === null) {
      return null; // Signal retry
    }

    debug(`callTool result: ${toolResultContent.substring(0, 200)}...`);

    try {
      return JSON.parse(toolResultContent);
    } catch {
      return toolResultContent;
    }
  }

  async close(): Promise<void> {
    // No-op — hosted MCP connections are managed by the SDK
  }
}
