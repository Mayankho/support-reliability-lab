import { groupThreads, type Thread } from '../thread/group.ts';
import { parseMessages } from '../thread/parse.ts';

export interface Turn {
  author: 'customer' | 'agent';
  body: string;
  subject?: string;
  language?: string | null;
  plan?: string;
}

const customer = (body: string, extra: Omit<Turn, 'author' | 'body'> = {}): Turn => ({
  author: 'customer',
  body,
  ...extra,
});
const agent = (body: string): Turn => ({ author: 'agent', body });
export { agent, customer };

/** Builds one synthetic thread through the same parse and group path as real-format input. */
export function thread(
  id: string,
  turns: readonly Turn[],
  startMs = Date.UTC(2026, 2, 2, 9),
): Thread {
  const records = turns.map((turn, index) => ({
    ticket_id: `${id}-m${String(index + 1)}`,
    thread_id: id,
    created_at: new Date(startMs + index * 600_000).toISOString(),
    author: { type: turn.author },
    plan: turn.plan ?? 'pro',
    language: turn.language === undefined ? 'en' : turn.language,
    channel: 'email',
    subject: turn.subject ?? null,
    body: turn.body,
  }));
  const parsed = parseMessages(records);
  if (!parsed.ok || parsed.issues.length > 0) throw new Error('test thread failed to parse');
  const [result] = groupThreads(parsed.messages);
  if (result === undefined) throw new Error('no thread');
  return result;
}
