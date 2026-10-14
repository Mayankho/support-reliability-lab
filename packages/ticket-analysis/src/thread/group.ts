import { LIMITS, type Limits, type ParsedMessage } from './parse.ts';

export const THREAD_ANOMALIES = [
  'input_out_of_order',
  'timestamp_tie',
  'duplicate_ticket_id',
  'missing_customer_message',
  'starts_with_agent_message',
  'inconsistent_metadata',
  'thread_too_long',
] as const;
export type ThreadAnomaly = (typeof THREAD_ANOMALIES)[number];

export interface Thread {
  threadId: string;
  /** Chronological: timestamp, then ticket ID, then input position. */
  messages: ParsedMessage[];
  anomalies: ThreadAnomaly[];
}

const compare = (a: ParsedMessage, b: ParsedMessage): number =>
  a.createdAtMs - b.createdAtMs ||
  (a.ticketId < b.ticketId ? -1 : a.ticketId > b.ticketId ? 1 : 0) ||
  a.inputIndex - b.inputIndex;

/**
 * Groups records into threads with a deterministic order and reports anything unusual instead of
 * silently repairing it. A repeated ticket ID keeps its first record in input order.
 */
export function groupThreads(
  messages: readonly ParsedMessage[],
  limits: Limits = LIMITS,
): Thread[] {
  const counts = new Map<string, number>();
  for (const message of messages) {
    counts.set(message.ticketId, (counts.get(message.ticketId) ?? 0) + 1);
  }

  const byThread = new Map<string, ParsedMessage[]>();
  for (const message of messages) {
    const list = byThread.get(message.threadId) ?? [];
    list.push(message);
    byThread.set(message.threadId, list);
  }

  const threads: Thread[] = [];
  for (const [threadId, list] of byThread) {
    const anomalies = new Set<ThreadAnomaly>();
    const seen = new Set<string>();
    const unique: ParsedMessage[] = [];
    for (const message of [...list].sort((a, b) => a.inputIndex - b.inputIndex)) {
      if ((counts.get(message.ticketId) ?? 0) > 1) anomalies.add('duplicate_ticket_id');
      if (seen.has(message.ticketId)) continue;
      seen.add(message.ticketId);
      unique.push(message);
    }

    const sorted = [...unique].sort(compare);
    if (
      sorted.some((message, i) => i > 0 && message.inputIndex < (sorted[i - 1]?.inputIndex ?? 0))
    ) {
      anomalies.add('input_out_of_order');
    }
    if (sorted.some((message, i) => i > 0 && message.createdAtMs === sorted[i - 1]?.createdAtMs)) {
      anomalies.add('timestamp_tie');
    }
    const customer = sorted.filter((message) => message.author === 'customer');
    if (customer.length === 0) anomalies.add('missing_customer_message');
    if (sorted[0]?.author === 'agent') anomalies.add('starts_with_agent_message');
    for (const field of ['plan', 'language', 'channel'] as const) {
      const values = new Set(customer.map((message) => message[field]).filter((v) => v !== null));
      if (values.size > 1) anomalies.add('inconsistent_metadata');
    }
    if (sorted.length > limits.maxThreadMessages) anomalies.add('thread_too_long');

    threads.push({
      threadId,
      messages: sorted,
      anomalies: THREAD_ANOMALIES.filter((code) => anomalies.has(code)),
    });
  }
  return threads.sort((a, b) => (a.threadId < b.threadId ? -1 : a.threadId > b.threadId ? 1 : 0));
}
