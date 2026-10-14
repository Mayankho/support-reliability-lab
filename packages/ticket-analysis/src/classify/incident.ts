import type { Triage } from './triage.ts';

export interface IncidentSettings {
  windowMinutes: number;
  minThreads: number;
}

/** Illustrative thresholds for the synthetic demo, not tuned against any real volume. */
export const DEFAULT_INCIDENT_SETTINGS: IncidentSettings = { windowMinutes: 60, minThreads: 5 };

export interface IncidentCandidate {
  l2: string;
  windowStart: string;
  windowEnd: string;
  threadIds: string[];
}

const NOT_COUNTED = new Set(['UNK-01', 'UNK-02', 'FBK-03']);

/**
 * Finds issue types reported by at least `minThreads` distinct threads within one window. A single
 * complaint, however urgent it sounds, can never produce a candidate. A candidate is a prompt for a
 * human to check, not a confirmed incident.
 */
export function detectIncidentCandidates(
  entries: ReadonlyArray<{ threadId: string; firstCustomerAtMs: number; primaryL2: string | null }>,
  settings: IncidentSettings = DEFAULT_INCIDENT_SETTINGS,
): IncidentCandidate[] {
  const windowMs = settings.windowMinutes * 60_000;
  const byIssue = new Map<string, Array<{ threadId: string; at: number }>>();
  for (const entry of entries) {
    if (entry.primaryL2 === null || NOT_COUNTED.has(entry.primaryL2)) continue;
    const list = byIssue.get(entry.primaryL2) ?? [];
    list.push({ threadId: entry.threadId, at: entry.firstCustomerAtMs });
    byIssue.set(entry.primaryL2, list);
  }

  const candidates: IncidentCandidate[] = [];
  for (const [l2, list] of [...byIssue].sort(([a], [b]) => a.localeCompare(b))) {
    const sorted = [...new Map(list.map((item) => [item.threadId, item])).values()].sort(
      (a, b) => a.at - b.at || a.threadId.localeCompare(b.threadId),
    );
    let best: typeof sorted = [];
    let start = 0;
    for (let end = 0; end < sorted.length; end += 1) {
      while ((sorted[end]?.at ?? 0) - (sorted[start]?.at ?? 0) > windowMs) start += 1;
      const window = sorted.slice(start, end + 1);
      if (window.length > best.length) best = window;
    }
    if (best.length >= settings.minThreads) {
      candidates.push({
        l2,
        windowStart: new Date(best[0]?.at ?? 0).toISOString(),
        windowEnd: new Date(best.at(-1)?.at ?? 0).toISOString(),
        threadIds: best.map((item) => item.threadId),
      });
    }
  }
  return candidates;
}

/** Adds `F-OUT` to member threads as an inferred pattern, and marks them for review. */
export function applyIncidentFlags(
  triages: readonly Triage[],
  candidates: readonly IncidentCandidate[],
): Triage[] {
  const members = new Set(candidates.flatMap((candidate) => candidate.threadIds));
  return triages.map((triage) =>
    members.has(triage.threadId) && !triage.flags.some((flag) => flag.code === 'F-OUT')
      ? {
          ...triage,
          flags: [
            ...triage.flags,
            { code: 'F-OUT', origin: 'inferred_pattern', reason: 'volume_threshold_met' },
          ],
          reviewRequired: true,
          safeReasonCodes: [...new Set([...triage.safeReasonCodes, 'incident_candidate'])].sort(),
        }
      : triage,
  );
}
