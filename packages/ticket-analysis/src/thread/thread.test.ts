import { describe, expect, it } from 'vitest';
import { groupThreads } from './group.ts';
import { parseMessages, type ParsedMessage } from './parse.ts';

type Raw = Record<string, unknown>;

const message = (overrides: Raw = {}): Raw => ({
  ticket_id: 'm-1',
  thread_id: 't-1',
  created_at: '2026-03-02T10:00:00Z',
  author: { type: 'customer', name: 'Avery Example', email: 'avery@example.com' },
  plan: 'pro',
  language: 'en-US',
  channel: 'email',
  subject: 'Render problem',
  body: 'My render is stuck.',
  minutes_to_first_reply: 12,
  ...overrides,
});

function parsed(records: Raw[]): ParsedMessage[] {
  const result = parseMessages(records);
  if (!result.ok) throw new Error(result.fatal);
  return result.messages;
}

describe('parseMessages', () => {
  it('accepts real-format records and drops names and email addresses at the boundary', () => {
    const result = parseMessages([message({ extra_field: 'ignored' })]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.issues).toEqual([]);
    const [first] = result.messages;
    expect(first).toMatchObject({
      author: 'customer',
      language: 'en',
      plan: 'pro',
      channel: 'email',
    });
    expect(JSON.stringify(result.messages)).not.toMatch(/Avery|example\.com|extra_field/u);
  });

  it('handles missing optional fields explicitly', () => {
    const result = parseMessages([
      message({ plan: null, language: undefined, subject: null, minutes_to_first_reply: null }),
    ]);
    expect(result.ok && result.messages[0]).toMatchObject({
      plan: null,
      language: null,
      subject: null,
    });
  });

  it('rejects a non-array or oversized input as a whole', () => {
    expect(parseMessages({ records: [] })).toEqual({ ok: false, fatal: 'NOT_AN_ARRAY' });
    expect(
      parseMessages([message(), message()], {
        maxRecords: 1,
        maxBodyChars: 10,
        maxSubjectChars: 10,
        maxThreadMessages: 10,
      }),
    ).toEqual({ ok: false, fatal: 'TOO_MANY_RECORDS' });
  });

  it.each([
    ['a non-object record', 'not a record', 'NOT_AN_OBJECT', ''],
    ['a missing body', message({ body: undefined }), 'MISSING_FIELD', 'body'],
    ['a numeric thread id', message({ thread_id: 42 }), 'INVALID_TYPE', 'thread_id'],
    [
      'an unknown author role',
      message({ author: { type: 'system' } }),
      'UNKNOWN_AUTHOR_ROLE',
      'author.type',
    ],
    ['an oversized body', message({ body: 'x'.repeat(20_001) }), 'FIELD_TOO_LONG', 'body'],
    [
      'a malformed timestamp',
      message({ created_at: 'yesterday at noon' }),
      'INVALID_TIMESTAMP',
      'created_at',
    ],
    [
      'an impossible date',
      message({ created_at: '2026-02-30T25:61:00Z' }),
      'INVALID_TIMESTAMP',
      'created_at',
    ],
  ])('rejects %s by position without echoing its value', (_label, record, code, field) => {
    const result = parseMessages([message({ ticket_id: 'ok' }), record]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.messages).toHaveLength(1);
    expect(result.issues).toEqual([{ index: 1, code, field }]);
    expect(JSON.stringify(result.issues)).not.toMatch(/system|yesterday|xxxx|not a record/u);
  });
});

describe('groupThreads', () => {
  it('orders messages by timestamp, then ticket id, whatever the input order', () => {
    const records = [
      message({ ticket_id: 'c', created_at: '2026-03-02T10:05:00Z' }),
      message({ ticket_id: 'b', created_at: '2026-03-02T10:00:00Z' }),
      message({ ticket_id: 'a', created_at: '2026-03-02T10:00:00Z' }),
    ];
    const forward = groupThreads(parsed(records));
    const reversed = groupThreads(parsed([...records].reverse()));
    expect(forward[0]?.messages.map((m) => m.ticketId)).toEqual(['a', 'b', 'c']);
    expect(reversed[0]?.messages.map((m) => m.ticketId)).toEqual(['a', 'b', 'c']);
    expect(forward[0]?.anomalies).toEqual(['input_out_of_order', 'timestamp_tie']);
  });

  it('keeps the first of a repeated ticket id and reports it', () => {
    const [thread] = groupThreads(
      parsed([
        message({ ticket_id: 'x', body: 'first' }),
        message({ ticket_id: 'x', body: 'second' }),
      ]),
    );
    expect(thread?.messages.map((m) => m.body)).toEqual(['first']);
    expect(thread?.anomalies).toContain('duplicate_ticket_id');
  });

  it('reports an agent-only thread and a thread that starts with an agent reply', () => {
    const threads = groupThreads(
      parsed([
        message({ thread_id: 'agent-only', author: { type: 'agent' } }),
        message({ thread_id: 'outbound', ticket_id: 'o1', author: { type: 'agent' } }),
        message({
          thread_id: 'outbound',
          ticket_id: 'o2',
          created_at: '2026-03-02T11:00:00Z',
        }),
      ]),
    );
    expect(threads.find((t) => t.threadId === 'agent-only')?.anomalies).toEqual([
      'missing_customer_message',
      'starts_with_agent_message',
    ]);
    expect(threads.find((t) => t.threadId === 'outbound')?.anomalies).toEqual([
      'starts_with_agent_message',
    ]);
  });

  it('reports inconsistent plan, language, or channel across customer turns', () => {
    const [thread] = groupThreads(
      parsed([
        message({ ticket_id: 'p1', plan: 'pro' }),
        message({ ticket_id: 'p2', plan: 'enterprise', created_at: '2026-03-02T11:00:00Z' }),
      ]),
    );
    expect(thread?.anomalies).toEqual(['inconsistent_metadata']);
  });

  it('flags a thread longer than the limit instead of truncating it', () => {
    const records = Array.from({ length: 4 }, (_, i) =>
      message({ ticket_id: `l${String(i)}`, created_at: `2026-03-02T10:0${String(i)}:00Z` }),
    );
    const [thread] = groupThreads(parsed(records), {
      maxRecords: 10,
      maxBodyChars: 100,
      maxSubjectChars: 100,
      maxThreadMessages: 3,
    });
    expect(thread?.messages).toHaveLength(4);
    expect(thread?.anomalies).toEqual(['thread_too_long']);
  });

  it('groups by thread id and returns threads in a stable order', () => {
    const threads = groupThreads(
      parsed([
        message({ thread_id: 't-b', ticket_id: '1' }),
        message({ thread_id: 't-a', ticket_id: '2' }),
      ]),
    );
    expect(threads.map((t) => t.threadId)).toEqual(['t-a', 't-b']);
  });
});
