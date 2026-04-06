/**
 * Onboarding IPC handlers for Electron main process
 *
 * Handles workspace setup and configuration persistence.
 */
import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { getAuthState, getSetupNeeds } from '@craft-agent/shared/auth'
import { isSetupDeferred, setSetupDeferred } from '@craft-agent/shared/config/storage'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { prepareClaudeOAuth, exchangeClaudeCode, hasValidOAuthState, clearOAuthState, prepareMcpOAuth } from '@craft-agent/shared/auth'
import { validateMcpConnection } from '@craft-agent/shared/mcp'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol'
import { getClaudeCliPaths, buildClaudeSubprocessEnv } from '@craft-agent/shared/agent/options'
import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handlers/handler-deps'

// ============================================
// IPC Handlers
// ============================================

export const HANDLED_CHANNELS = [
  RPC_CHANNELS.onboarding.GET_AUTH_STATE,
  RPC_CHANNELS.onboarding.VALIDATE_MCP,
  RPC_CHANNELS.onboarding.START_MCP_OAUTH,
  RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH,
  RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE,
  RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE,
  RPC_CHANNELS.onboarding.DEFER_SETUP,
  RPC_CHANNELS.onboarding.CLAUDE_CODE_AUTH_LOGIN,
  RPC_CHANNELS.onboarding.CLAUDE_CODE_AUTH_STATUS,
] as const

export function registerOnboardingHandlers(server: RpcServer, deps: HandlerDeps): void {
  const log = deps.platform.logger

  // Get current auth state
  server.handle(RPC_CHANNELS.onboarding.GET_AUTH_STATE, async () => {
    const authState = await getAuthState()
    const setupNeeds = getSetupNeeds(authState, isSetupDeferred())
    // Redact raw credentials — renderer only needs boolean flags (hasCredentials, setupNeeds)
    return {
      authState: {
        ...authState,
        billing: {
          ...authState.billing,
          apiKey: authState.billing.apiKey ? '••••' : null,
          claudeOAuthToken: authState.billing.claudeOAuthToken ? '••••' : null,
        },
      },
      setupNeeds,
    }
  })

  // Validate MCP connection
  server.handle(RPC_CHANNELS.onboarding.VALIDATE_MCP, async (_ctx, mcpUrl: string, accessToken?: string) => {
    try {
      const result = await validateMcpConnection({
        mcpUrl,
        mcpAccessToken: accessToken,
      })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      return { success: false, error: message }
    }
  })

  // Prepare MCP server OAuth (server-side only — no browser open).
  // Returns authUrl for the client to open locally.
  // NOTE: Currently unused in renderer. If re-enabled, needs client-side
  // orchestration (callback server + browser open) like performOAuth().
  server.handle(RPC_CHANNELS.onboarding.START_MCP_OAUTH, async (_ctx, mcpUrl: string, callbackPort?: number) => {
    log.info('[Onboarding:Main] ONBOARDING_START_MCP_OAUTH received')
    try {
      if (!callbackPort) {
        throw new Error('callbackPort is required — client must run a local callback server')
      }
      const prepared = await prepareMcpOAuth(mcpUrl, { callbackPort })
      log.info('[Onboarding:Main] MCP OAuth prepared, returning authUrl to client')

      return {
        success: true,
        authUrl: prepared.authUrl,
        state: prepared.state,
        codeVerifier: prepared.codeVerifier,
        tokenEndpoint: prepared.tokenEndpoint,
        clientId: prepared.clientId,
        redirectUri: prepared.redirectUri,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding:Main] MCP OAuth prepare failed:', message)
      return { success: false, error: message }
    }
  })

  /* [ROLLBACK] Original two-step Claude OAuth handlers — replaced by CLI auth login below.
  server.handle(RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH, async () => {
    try {
      log.info('[Onboarding] Preparing Claude OAuth flow...')
      const authUrl = prepareClaudeOAuth()
      log.info('[Onboarding] Claude OAuth URL generated (client will open browser)')
      return { success: true, authUrl }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding] Prepare Claude OAuth error:', message)
      return { success: false, error: message }
    }
  })

  server.handle(RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE, async (_ctx, authorizationCode: string, connectionSlug: string) => {
    try {
      log.info(`[Onboarding] Exchanging Claude authorization code for connection: ${connectionSlug}`)
      if (!hasValidOAuthState()) {
        log.error('[Onboarding] No valid OAuth state found')
        return { success: false, error: 'OAuth session expired. Please start again.' }
      }
      const tokens = await exchangeClaudeCode(authorizationCode, (status) => {
        log.info('[Onboarding] Claude code exchange status:', status)
      })
      const manager = getCredentialManager()
      await manager.setLlmOAuth(connectionSlug, {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      })
      await manager.setClaudeOAuthCredentials({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        source: 'native',
      })
      const expiresAtDate = tokens.expiresAt ? new Date(tokens.expiresAt).toISOString() : 'never'
      log.info(`[Onboarding] Claude OAuth saved to LLM connection (expires: ${expiresAtDate})`)
      return { success: true, token: tokens.accessToken }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding] Exchange Claude code error:', message)
      return { success: false, error: message }
    }
  })

  server.handle(RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE, async () => {
    return hasValidOAuthState()
  })

  server.handle(RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE, async () => {
    clearOAuthState()
    return { success: true }
  })
  */

  // Stub handlers for old channels — renderer may still reference them
  server.handle(RPC_CHANNELS.onboarding.START_CLAUDE_OAUTH, async () => {
    return { success: false, error: 'Use claudeCodeAuthLogin instead' }
  })
  server.handle(RPC_CHANNELS.onboarding.EXCHANGE_CLAUDE_CODE, async () => {
    return { success: false, error: 'Use claudeCodeAuthLogin instead' }
  })
  server.handle(RPC_CHANNELS.onboarding.HAS_CLAUDE_OAUTH_STATE, async () => {
    return false
  })
  server.handle(RPC_CHANNELS.onboarding.CLEAR_CLAUDE_OAUTH_STATE, async () => {
    return { success: true }
  })

  // User chose "Setup later" — persist so onboarding doesn't re-show on next launch.
  // Cleared automatically when user configures a provider from Settings.
  server.handle(RPC_CHANNELS.onboarding.DEFER_SETUP, async () => {
    setSetupDeferred(true)
    log.info('[Onboarding] User deferred setup')
    return { success: true }
  })

  // ============================================
  // Claude Code CLI Auth (for hosted MCP servers)
  // ============================================

  /**
   * Helper: run a Claude Code CLI command and return stdout.
   * Uses the bundled cli.js from the Agent SDK — no separate install needed.
   */
  function runClaudeCliCommand(args: string[]): Promise<string> {
    const { cliPath, executable } = getClaudeCliPaths()
    if (!cliPath) {
      return Promise.reject(new Error('Claude Code SDK cli.js not found'))
    }

    return new Promise((resolve, reject) => {
      execFile(
        executable,
        [cliPath, ...args],
        {
          cwd: homedir(),
          env: buildClaudeSubprocessEnv() as Record<string, string>,
          timeout: 600_000, // 10 min — user needs time to complete browser OAuth
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || error.message))
          } else {
            resolve(stdout)
          }
        },
      )
    })
  }

  // Check Claude Code CLI auth status (JSON output)
  server.handle(RPC_CHANNELS.onboarding.CLAUDE_CODE_AUTH_STATUS, async () => {
    try {
      const stdout = await runClaudeCliCommand(['auth', 'status'])
      const status = JSON.parse(stdout)
      return { success: true, ...status }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding] Claude Code auth status error:', message)
      return { success: false, loggedIn: false, error: message }
    }
  })

  // Trigger Claude Code CLI OAuth login (opens browser, waits for completion)
  server.handle(RPC_CHANNELS.onboarding.CLAUDE_CODE_AUTH_LOGIN, async () => {
    try {
      log.info('[Onboarding] Starting Claude Code auth login...')
      await runClaudeCliCommand(['auth', 'login'])
      log.info('[Onboarding] Claude Code auth login process completed')

      // Check the result
      const stdout = await runClaudeCliCommand(['auth', 'status'])
      const status = JSON.parse(stdout)

      if (status.loggedIn) {
        log.info(`[Onboarding] Claude Code auth success: ${status.email} (${status.subscriptionType})`)
        return { success: true, ...status }
      } else {
        return { success: false, loggedIn: false, error: 'Login was not completed' }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      log.error('[Onboarding] Claude Code auth login error:', message)
      return { success: false, loggedIn: false, error: message }
    }
  })
}
