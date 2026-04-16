import { describe, it, expect } from 'bun:test';
import { parseSlackDetailedMarkdown } from '../slack-parser.ts';

describe('parseSlackDetailedMarkdown', () => {
  it('parses a single message with all fields present', () => {
    const input = `# Search Results for "to:me"

## Messages (1 result)

### Result 1 of 1
Channel: Group DM (ID: C0ACJDP09CK)
Participants: Alice, Bob
From: Arthur Oliveira Da Silva (ID: U0A3VTPGVQ9)
Time: 2026-04-15 16:49:55 EDT
Message_ts: 1776286195.218429
Permalink: [link](https://daloopa.slack.com/archives/C0ACJDP09CK/p1776286195218429)
Text:
next summer I'm going to have septoplasty surgery
---`;

    const result = parseSlackDetailedMarkdown(input);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      ts: '1776286195.218429',
      channel: 'Group DM',
      channelId: 'C0ACJDP09CK',
      user: { name: 'Arthur Oliveira Da Silva', id: 'U0A3VTPGVQ9' },
      text: 'next summer I\'m going to have septoplasty surgery',
    });
  });

  it('parses multiple messages split by ---', () => {
    const input = `# Search Results for "to:me"

## Messages (3 results)

### Result 1 of 3
Channel: #general (ID: C012345)
From: Alice Smith (ID: U0000001)
Time: 2026-04-15 10:00:00 EDT
Message_ts: 1776200000.000001
Permalink: [link](https://example.slack.com/archives/C012345/p1776200000000001)
Text:
Hey team, quick update on the project
---
### Result 2 of 3
Channel: Group DM (ID: C067890)
From: Bob Jones (ID: U0000002)
Time: 2026-04-15 11:00:00 EDT
Message_ts: 1776203600.000002
Permalink: [link](https://example.slack.com/archives/C067890/p1776203600000002)
Text:
Can you review this PR?
---
### Result 3 of 3
Channel: #engineering (ID: C099999)
From: Carol Davis (ID: U0000003)
Time: 2026-04-15 12:00:00 EDT
Message_ts: 1776207200.000003
Permalink: [link](https://example.slack.com/archives/C099999/p1776207200000003)
Text:
Deployment is done!
---`;

    const result = parseSlackDetailedMarkdown(input);
    expect(result).toHaveLength(3);
    expect(result[0]!.ts).toBe('1776200000.000001');
    expect(result[0]!.user.name).toBe('Alice Smith');
    expect(result[0]!.channel).toBe('#general');
    expect(result[0]!.channelId).toBe('C012345');
    expect(result[1]!.ts).toBe('1776203600.000002');
    expect(result[1]!.user.name).toBe('Bob Jones');
    expect(result[1]!.text).toBe('Can you review this PR?');
    expect(result[2]!.ts).toBe('1776207200.000003');
    expect(result[2]!.channel).toBe('#engineering');
  });

  it('strips Context before: and Context after: from the result', () => {
    const input = `### Result 1 of 1
Channel: #general (ID: C012345)
From: Alice Smith (ID: U0000001)
Message_ts: 1776200000.000001
Text:
Hello everyone!
Context before:
  - From: Bob (ID: U9999)
  - Message_ts: 1776199999.000000
  - Text: Previous message
Context after:
  - From: Carol (ID: U8888)
  - Message_ts: 1776200001.000000
  - Text: Next message
---`;

    const result = parseSlackDetailedMarkdown(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('Hello everyone!');
    // Context should not leak into the text
    expect(result[0]!.text).not.toContain('Previous message');
    expect(result[0]!.text).not.toContain('Next message');
  });

  it('skips blocks with missing Message_ts', () => {
    const input = `### Result 1 of 2
Channel: #general (ID: C012345)
From: Alice Smith (ID: U0000001)
Text:
No timestamp here
---
### Result 2 of 2
Channel: #general (ID: C012345)
From: Bob Jones (ID: U0000002)
Message_ts: 1776200000.000001
Text:
This one has a timestamp
---`;

    const result = parseSlackDetailedMarkdown(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.user.name).toBe('Bob Jones');
  });

  it('returns empty array for empty input', () => {
    expect(parseSlackDetailedMarkdown('')).toEqual([]);
    expect(parseSlackDetailedMarkdown(null as any)).toEqual([]);
    expect(parseSlackDetailedMarkdown(undefined as any)).toEqual([]);
  });

  it('returns empty array for header-only input', () => {
    const input = `# Search Results for "to:me"

## Messages (0 results)

`;
    expect(parseSlackDetailedMarkdown(input)).toEqual([]);
  });

  it('handles multi-line text correctly', () => {
    const input = `### Result 1 of 1
Channel: #general (ID: C012345)
From: Alice Smith (ID: U0000001)
Message_ts: 1776200000.000001
Text:
Line one of the message
Line two of the message
Line three of the message
---`;

    const result = parseSlackDetailedMarkdown(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.text).toBe('Line one of the message\nLine two of the message\nLine three of the message');
  });

  it('handles Channel without ID pattern', () => {
    const input = `### Result 1 of 1
Channel: Direct Message
From: Alice Smith (ID: U0000001)
Message_ts: 1776200000.000001
Text:
Hello
---`;

    const result = parseSlackDetailedMarkdown(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.channel).toBe('Direct Message');
    expect(result[0]!.channelId).toBe('');
  });

  it('handles From without ID pattern', () => {
    const input = `### Result 1 of 1
Channel: #general (ID: C012345)
From: Unknown Bot
Message_ts: 1776200000.000001
Text:
Bot message
---`;

    const result = parseSlackDetailedMarkdown(input);
    expect(result).toHaveLength(1);
    expect(result[0]!.user).toEqual({ name: 'Unknown Bot', id: '' });
  });
});
