/**
 * Slack "detailed" markdown response parser.
 *
 * The hosted Slack MCP tool `slack_search_public_and_private` with
 * `response_format: 'detailed'` returns a markdown-formatted string
 * rather than structured JSON. This module converts that markdown into
 * structured records so the existing `toInboxMessage` normalization works.
 *
 * Expected format (per block):
 * ```
 * ### Result 1 of 3
 * Channel: Group DM (ID: C0ACJDP09CK)
 * From: Arthur Oliveira Da Silva (ID: U0A3VTPGVQ9)
 * Time: 2026-04-15 16:49:55 EDT
 * Message_ts: 1776286195.218429
 * Permalink: [link](https://...)
 * Text:
 * next summer I'm going to have septoplasty surgery...
 * Context before:
 *   - From: ...
 * ---
 * ```
 */

export interface ParsedSlackMessage {
  ts: string;
  channel: string;
  channelId: string;
  user: { name: string; id: string };
  text: string;
}

// Labels that start top-level fields (used to terminate multi-line Text: capture)
const TOP_LEVEL_LABELS = /^(?:Channel|Participants|From|Time|Message_ts|Permalink|Text|Context before|Context after):/;

/**
 * Parse the markdown-formatted `results` string from the Slack MCP
 * `detailed` response format into structured message records.
 */
export function parseSlackDetailedMarkdown(results: string): ParsedSlackMessage[] {
  if (!results || typeof results !== 'string') return [];

  // Split on "### Result N of M" headers — each chunk is one message block
  const chunks = results.split(/^### Result \d+ of \d+$/m);

  const messages: ParsedSlackMessage[] = [];

  for (const chunk of chunks) {
    // First chunk is the preamble (headers like "# Search Results...") — skip it
    if (!chunk.trim()) continue;

    // Strip everything from "Context before:" or "Context after:" onward
    const cleanChunk = chunk.replace(/^(?:Context before|Context after):[\s\S]*/m, '');

    const lines = cleanChunk.split('\n');

    let channel: string | undefined;
    let channelId: string | undefined;
    let from: { name: string; id: string } | undefined;
    let ts: string | undefined;
    let textLines: string[] | undefined;
    let collectingText = false;

    for (const line of lines) {
      // If we're collecting multi-line Text:, stop at the next labeled field or block separator
      if (collectingText) {
        if (TOP_LEVEL_LABELS.test(line) || line.trim() === '---') {
          collectingText = false;
          // Fall through to process this line as a field
        } else {
          textLines!.push(line);
          continue;
        }
      }

      if (line.startsWith('Channel:')) {
        const value = line.slice('Channel:'.length).trim();
        // Match "Display Name (ID: C0ACJDP09CK)" pattern
        const m = value.match(/^(.+?)\s*\(ID:\s*([A-Z0-9]+)\)$/);
        if (m) {
          channel = m[1]!.trim();
          channelId = m[2]!;
        } else {
          channel = value;
          channelId = '';
        }
      } else if (line.startsWith('From:')) {
        const value = line.slice('From:'.length).trim();
        const m = value.match(/^(.+?)\s*\(ID:\s*(U[A-Z0-9]+)\)$/);
        if (m) {
          from = { name: m[1]!.trim(), id: m[2]! };
        } else {
          from = { name: value, id: '' };
        }
      } else if (line.startsWith('Message_ts:')) {
        ts = line.slice('Message_ts:'.length).trim();
      } else if (line.startsWith('Text:')) {
        // Text: may have inline content or be followed by multi-line content
        const inline = line.slice('Text:'.length);
        textLines = inline ? [inline] : [];
        collectingText = true;
      }
      // We intentionally ignore Time:, Permalink:, Participants:, etc.
    }

    // Finalize text
    const text = textLines ? textLines.join('\n').trim() : '';

    // Skip malformed blocks (missing Message_ts or Text)
    if (!ts || !text) continue;

    messages.push({
      ts,
      channel: channel ?? '',
      channelId: channelId ?? '',
      user: from ?? { name: 'Unknown', id: '' },
      text,
    });
  }

  return messages;
}
