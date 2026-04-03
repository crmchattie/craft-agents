/**
 * SimpleLlmCallFn — provider-agnostic interface for simple LLM calls.
 *
 * Used by the triage service and other features that need a single-turn
 * "system prompt + user prompt → text" call without tools or multi-turn.
 *
 * Provider implementations are created via factory functions and injected
 * at the composition root.
 */

import type { LlmConnection } from '../config/llm-connections.ts';

// ============================================================================
// Core type
// ============================================================================

export interface SimpleLlmCallFn {
  (options: { systemPrompt: string; userPrompt: string; model: string }): Promise<string>;
}

// ============================================================================
// Anthropic implementation
// ============================================================================

/**
 * Create a SimpleLlmCallFn backed by the Anthropic Claude Agent SDK.
 * Uses the same `query()` + `getDefaultOptions()` pattern the agent uses.
 */
export function createAnthropicSimpleLlmCall(
  resolveEnvVars: () => Promise<Record<string, string>>,
): SimpleLlmCallFn {
  return async ({ systemPrompt, userPrompt, model }) => {
    // Lazy imports to avoid loading the SDK at module level
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const { getDefaultOptions } = await import('./options.ts');

    const envVars = await resolveEnvVars();
    const options = {
      ...getDefaultOptions(envVars),
      model,
      maxTurns: 1,
      systemPrompt,
      thinking: { type: 'disabled' as const },
    };

    let result = '';
    for await (const msg of query({ prompt: userPrompt, options })) {
      if (msg.type === 'assistant') {
        for (const block of msg.message.content) {
          if (block.type === 'text') {
            result += block.text;
          }
        }
      }
    }
    return result.trim();
  };
}

// ============================================================================
// Pi implementation (injected at startup)
// ============================================================================

/**
 * Factory function type for creating Pi-backed SimpleLlmCallFn instances.
 * Registered at app startup to avoid importing the Pi SDK in the wrong context.
 */
export type PiSimpleLlmCallFactory = (
  connection: LlmConnection,
) => SimpleLlmCallFn;

let _piFactory: PiSimpleLlmCallFactory | null = null;

/**
 * Register the Pi factory. Called once at app startup from main-process code
 * that has access to the Pi SDK.
 */
export function registerPiSimpleLlmCallFactory(factory: PiSimpleLlmCallFactory): void {
  _piFactory = factory;
}

/**
 * Create a SimpleLlmCallFn backed by the Pi SDK.
 * Requires `registerPiSimpleLlmCallFactory()` to have been called first.
 */
export function createPiSimpleLlmCall(connection: LlmConnection): SimpleLlmCallFn {
  if (!_piFactory) {
    throw new Error(
      'Pi simple LLM call factory not registered. ' +
      'Call registerPiSimpleLlmCallFactory() at startup.',
    );
  }
  return _piFactory(connection);
}
