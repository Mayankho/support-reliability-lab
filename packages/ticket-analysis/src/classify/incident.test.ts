import { describe, expect, it } from 'vitest';
import { applyIncidentFlags, detectIncidentCandidates } from './incident.ts';
import { customer, thread } from './test-helpers.ts';
import { triageThread } from './triage.ts';

const start = Date.UTC(2026, 2, 2, 14);
const outage = (index: number, minutesApart: number) =>
  triageThread(
    thread(
      `t-out-${String(index)}`,
      [customer('The site is down and nothing loads.')],
      start + index * minutesApart * 60_000,
    ),
  );
const entries = (count: number, minutesApart: number) =>
  Array.from({ length: count }, (_, index) => ({
    threadId: `t-out-${String(index)}`,
    firstCustomerAtMs: start + index * minutesApart * 60_000,
    primaryL2: outage(index, minutesApart).primaryL2,
  }));

describe('incident candidates', () => {
  it('needs several distinct threads inside one window', () => {
    expect(detectIncidentCandidates(entries(5, 10))).toEqual([
      {
        l2: 'NET-02',
        windowStart: new Date(start).toISOString(),
        windowEnd: new Date(start + 40 * 60_000).toISOString(),
        threadIds: ['t-out-0', 't-out-1', 't-out-2', 't-out-3', 't-out-4'],
      },
    ]);
  });

  it('does not fire below the threshold or when reports are spread out', () => {
    expect(detectIncidentCandidates(entries(4, 10))).toEqual([]);
    expect(detectIncidentCandidates(entries(5, 45))).toEqual([]);
    expect(detectIncidentCandidates(entries(1, 0))).toEqual([]);
  });

  it('counts a thread once, and ignores unknown and resolved threads', () => {
    const repeated = Array.from({ length: 6 }, () => ({
      threadId: 't-same',
      firstCustomerAtMs: start,
      primaryL2: 'NET-02',
    }));
    const unknown = Array.from({ length: 6 }, (_, index) => ({
      threadId: `t-unk-${String(index)}`,
      firstCustomerAtMs: start,
      primaryL2: 'UNK-01',
    }));
    expect(detectIncidentCandidates([...repeated, ...unknown])).toEqual([]);
  });

  it('adds F-OUT only to member threads, as an inferred pattern that needs review', () => {
    const triages = Array.from({ length: 5 }, (_, index) => outage(index, 10));
    const lone = triageThread(
      thread('t-lone', [customer('The site is down.')], start + 5 * 3_600_000),
    );
    const flagged = applyIncidentFlags(
      [...triages, lone],
      detectIncidentCandidates(entries(5, 10)),
    );
    for (const triage of flagged.slice(0, 5)) {
      expect(triage.flags).toContainEqual({
        code: 'F-OUT',
        origin: 'inferred_pattern',
        reason: 'volume_threshold_met',
      });
      expect(triage.reviewRequired).toBe(true);
    }
    expect(flagged[5]?.flags.map((flag) => flag.code)).not.toContain('F-OUT');
  });
});
