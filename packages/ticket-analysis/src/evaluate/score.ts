import { z } from 'zod';
import { RISK_FLAG_CODES, type RiskFlagCode } from '../taxonomy/schema.ts';
import type { Triage } from '../classify/triage.ts';

const l2Code = z.string().regex(/^[A-Z]{3}-\d{2}$/u);

export const threadLabelSchema = z.strictObject({
  threadId: z.string().min(1).max(128),
  /** `null` means the right answer is to abstain. */
  primaryL2: l2Code.nullable(),
  acceptablePrimaryL2: z.array(l2Code).max(3),
  secondaryL2: l2Code.nullable(),
  flags: z.array(z.enum(RISK_FLAG_CODES)).max(RISK_FLAG_CODES.length),
});

export const labelSetSchema = z.strictObject({
  labelSetVersion: z.string().min(1).max(60),
  labelStatus: z.enum(['author_labeled_development_set', 'independently_adjudicated']),
  note: z.string().min(1).max(600),
  labels: z.array(threadLabelSchema).max(1000),
});
export type LabelSet = z.infer<typeof labelSetSchema>;

export interface Ratio {
  numerator: number;
  denominator: number;
  value: number | null;
}

const ratio = (numerator: number, denominator: number): Ratio => ({
  numerator,
  denominator,
  value: denominator === 0 ? null : numerator / denominator,
});

export interface FlagScore {
  truePositive: number;
  falsePositive: number;
  falseNegative: number;
  precision: Ratio;
  recall: Ratio;
}

export interface AgreementReport {
  labelSetVersion: string;
  labelStatus: LabelSet['labelStatus'];
  threads: number;
  unlabeledThreads: string[];
  exactPrimary: Ratio;
  acceptablePrimary: Ratio;
  secondary: Ratio;
  abstention: { expected: number; correct: number; abstainedWhenLabeled: number };
  flags: Partial<Record<RiskFlagCode, FlagScore>>;
}

/**
 * Agreement between triages and a label set, kept as separate measures. Exact and acceptable primary
 * agreement use only threads whose label has a primary issue; secondary agreement uses only threads
 * whose label has a secondary. A label set written by the rules' author measures consistency with that
 * author, not accuracy.
 */
export function scoreAgreement(triages: readonly Triage[], labelSet: LabelSet): AgreementReport {
  const byThread = new Map(triages.map((triage) => [triage.threadId, triage]));
  let exact = 0;
  let acceptable = 0;
  let primaryDenominator = 0;
  let secondaryMatches = 0;
  let secondaryDenominator = 0;
  const abstention = { expected: 0, correct: 0, abstainedWhenLabeled: 0 };
  const counts = new Map<RiskFlagCode, { tp: number; fp: number; fn: number }>();
  const unlabeledThreads: string[] = [];
  let threads = 0;

  for (const label of labelSet.labels) {
    const triage = byThread.get(label.threadId);
    if (triage === undefined) {
      unlabeledThreads.push(label.threadId);
      continue;
    }
    threads += 1;
    if (label.primaryL2 === null) {
      abstention.expected += 1;
      if (triage.abstained) abstention.correct += 1;
    } else {
      primaryDenominator += 1;
      if (triage.abstained) abstention.abstainedWhenLabeled += 1;
      if (triage.primaryL2 === label.primaryL2) exact += 1;
      if (
        triage.primaryL2 !== null &&
        [label.primaryL2, ...label.acceptablePrimaryL2].includes(triage.primaryL2)
      ) {
        acceptable += 1;
      }
    }
    if (label.secondaryL2 !== null) {
      secondaryDenominator += 1;
      if (triage.secondaryL2 === label.secondaryL2) secondaryMatches += 1;
    }
    const predicted = new Set(triage.flags.map((flag) => flag.code));
    const expected = new Set(label.flags);
    for (const code of new Set([...predicted, ...expected])) {
      const count = counts.get(code) ?? { tp: 0, fp: 0, fn: 0 };
      if (predicted.has(code) && expected.has(code)) count.tp += 1;
      else if (predicted.has(code)) count.fp += 1;
      else count.fn += 1;
      counts.set(code, count);
    }
  }

  const flags: AgreementReport['flags'] = {};
  for (const code of RISK_FLAG_CODES) {
    const count = counts.get(code);
    if (count === undefined) continue;
    flags[code] = {
      truePositive: count.tp,
      falsePositive: count.fp,
      falseNegative: count.fn,
      precision: ratio(count.tp, count.tp + count.fp),
      recall: ratio(count.tp, count.tp + count.fn),
    };
  }

  return {
    labelSetVersion: labelSet.labelSetVersion,
    labelStatus: labelSet.labelStatus,
    threads,
    unlabeledThreads,
    exactPrimary: ratio(exact, primaryDenominator),
    acceptablePrimary: ratio(acceptable, primaryDenominator),
    secondary: ratio(secondaryMatches, secondaryDenominator),
    abstention,
    flags,
  };
}
