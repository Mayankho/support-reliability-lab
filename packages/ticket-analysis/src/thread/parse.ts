import { z } from 'zod';

export interface Limits {
  maxRecords: number;
  maxBodyChars: number;
  maxSubjectChars: number;
  maxThreadMessages: number;
}

export const LIMITS: Limits = {
  maxRecords: 50_000,
  maxBodyChars: 20_000,
  maxSubjectChars: 500,
  maxThreadMessages: 200,
};

const optionalText = (max: number) => z.string().max(max).nullish();

/**
 * One message record at the raw boundary, shaped like a helpdesk export. Unknown fields are
 * dropped. Names and email addresses are accepted so real-format input parses, then discarded.
 */
export const rawMessageSchema = z.object({
  ticket_id: z.string().min(1).max(128),
  thread_id: z.string().min(1).max(128),
  created_at: z.string().min(1).max(64),
  author: z.object({
    type: z.enum(['customer', 'agent']),
    name: optionalText(200),
    email: optionalText(320),
  }),
  plan: optionalText(64),
  language: optionalText(16),
  channel: optionalText(32),
  subject: optionalText(LIMITS.maxSubjectChars),
  body: z.string().max(LIMITS.maxBodyChars),
  minutes_to_first_reply: z.number().nonnegative().nullish(),
});

export interface ParsedMessage {
  inputIndex: number;
  ticketId: string;
  threadId: string;
  createdAtMs: number;
  author: 'customer' | 'agent';
  plan: string | null;
  language: string | null;
  channel: string | null;
  subject: string | null;
  body: string;
}

export type RecordIssueCode =
  | 'NOT_AN_OBJECT'
  | 'MISSING_FIELD'
  | 'INVALID_TYPE'
  | 'FIELD_TOO_LONG'
  | 'UNKNOWN_AUTHOR_ROLE'
  | 'INVALID_TIMESTAMP';

/** Identifies a rejected record by position and field. Values are never included. */
export interface RecordIssue {
  index: number;
  code: RecordIssueCode;
  field: string;
}

export type ParseResult =
  | { ok: true; messages: ParsedMessage[]; issues: RecordIssue[] }
  | { ok: false; fatal: 'NOT_AN_ARRAY' | 'TOO_MANY_RECORDS' };

const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/u;

function languageCode(value: string | null | undefined): string | null {
  const base = value?.trim().toLowerCase().split(/[-_]/u)[0] ?? '';
  return /^[a-z]{2,3}$/u.test(base) ? base : null;
}

function issueCode(issue: z.core.$ZodIssue, record: unknown): RecordIssueCode {
  if (issue.path.join('.') === 'author.type' && issue.code === 'invalid_value') {
    return 'UNKNOWN_AUTHOR_ROLE';
  }
  if (issue.code === 'too_big') return 'FIELD_TOO_LONG';
  let value: unknown = record;
  for (const key of issue.path) {
    value =
      typeof value === 'object' && value !== null
        ? (value as Record<PropertyKey, unknown>)[key]
        : undefined;
  }
  return value === undefined ? 'MISSING_FIELD' : 'INVALID_TYPE';
}

/** Validates a bounded array of raw records. Invalid records are rejected individually, by position. */
export function parseMessages(input: unknown, limits: Limits = LIMITS): ParseResult {
  if (!Array.isArray(input)) return { ok: false, fatal: 'NOT_AN_ARRAY' };
  if (input.length > limits.maxRecords) return { ok: false, fatal: 'TOO_MANY_RECORDS' };

  const messages: ParsedMessage[] = [];
  const issues: RecordIssue[] = [];
  input.forEach((record: unknown, index) => {
    if (typeof record !== 'object' || record === null || Array.isArray(record)) {
      issues.push({ index, code: 'NOT_AN_OBJECT', field: '' });
      return;
    }
    const parsed = rawMessageSchema.safeParse(record);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      issues.push({
        index,
        code: first === undefined ? 'INVALID_TYPE' : issueCode(first, record),
        field: first?.path.join('.') ?? '',
      });
      return;
    }
    const value = parsed.data;
    const createdAtMs = ISO_TIMESTAMP.test(value.created_at) ? Date.parse(value.created_at) : NaN;
    if (!Number.isFinite(createdAtMs)) {
      issues.push({ index, code: 'INVALID_TIMESTAMP', field: 'created_at' });
      return;
    }
    messages.push({
      inputIndex: index,
      ticketId: value.ticket_id,
      threadId: value.thread_id,
      createdAtMs,
      author: value.author.type,
      plan: value.plan?.trim().toLowerCase() || null,
      language: languageCode(value.language),
      channel: value.channel?.trim().toLowerCase() || null,
      subject: value.subject ?? null,
      body: value.body,
    });
  });
  return { ok: true, messages, issues };
}
