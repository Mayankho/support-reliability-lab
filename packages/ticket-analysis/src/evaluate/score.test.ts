import { describe, expect, it } from 'vitest';
import type { Triage } from '../classify/triage.ts';
import { scoreAgreement, type LabelSet } from './score.ts';

const triage = (threadId: string, overrides: Partial<Triage>): Triage => ({
  threadId,
  taxonomyVersion: 'issue-taxonomy-v1.1',
  classifierVersion: 'test',
  language: 'en',
  primaryL2: null,
  primaryL1: null,
  secondaryL2: null,
  abstained: false,
  confirmedL3: null,
  flags: [],
  issueState: 'reported',
  suggestedFixHome: null,
  candidateAutomationTier: null,
  maxAutomationScope: null,
  protectedMutationTypicallyInvolved: null,
  evidence: [],
  matchedRuleIds: [],
  reviewRequired: false,
  safeReasonCodes: [],
  anomalies: [],
  ...overrides,
});

const labels: LabelSet = {
  labelSetVersion: 'test-labels',
  labelStatus: 'author_labeled_development_set',
  note: 'test',
  labels: [
    {
      threadId: 'a',
      primaryL2: 'CRD-01',
      acceptablePrimaryL2: [],
      secondaryL2: 'PRC-01',
      flags: ['F-MON'],
    },
    {
      threadId: 'b',
      primaryL2: 'CRD-01',
      acceptablePrimaryL2: ['PRC-01'],
      secondaryL2: null,
      flags: [],
    },
    {
      threadId: 'c',
      primaryL2: null,
      acceptablePrimaryL2: [],
      secondaryL2: null,
      flags: ['F-SEC'],
    },
    {
      threadId: 'd',
      primaryL2: 'API-01',
      acceptablePrimaryL2: [],
      secondaryL2: null,
      flags: ['F-SEC'],
    },
    {
      threadId: 'missing',
      primaryL2: 'BIL-01',
      acceptablePrimaryL2: [],
      secondaryL2: null,
      flags: [],
    },
  ],
};

describe('scoreAgreement', () => {
  const report = scoreAgreement(
    [
      triage('a', {
        primaryL2: 'CRD-01',
        secondaryL2: 'PRC-01',
        flags: [{ code: 'F-MON', origin: 'inferred_pattern', reason: 'x' }],
      }),
      triage('b', {
        primaryL2: 'PRC-01',
        flags: [{ code: 'F-MON', origin: 'inferred_pattern', reason: 'x' }],
      }),
      triage('c', {
        abstained: true,
        flags: [{ code: 'F-SEC', origin: 'inferred_pattern', reason: 'x' }],
      }),
      triage('d', { abstained: true }),
    ],
    labels,
  );

  it('keeps exact and acceptable primary agreement separate, over labeled primaries only', () => {
    expect(report.exactPrimary).toEqual({ numerator: 1, denominator: 3, value: 1 / 3 });
    expect(report.acceptablePrimary).toEqual({ numerator: 2, denominator: 3, value: 2 / 3 });
  });

  it('scores secondary issues only where the label has one', () => {
    expect(report.secondary).toEqual({ numerator: 1, denominator: 1, value: 1 });
  });

  it('separates correct abstention from abstaining on a labeled thread', () => {
    expect(report.abstention).toEqual({ expected: 1, correct: 1, abstainedWhenLabeled: 1 });
  });

  it('reports precision and recall per flag, with the false positives and negatives', () => {
    expect(report.flags['F-MON']).toMatchObject({
      truePositive: 1,
      falsePositive: 1,
      falseNegative: 0,
    });
    expect(report.flags['F-SEC']).toMatchObject({
      truePositive: 1,
      falseNegative: 1,
      recall: { numerator: 1, denominator: 2, value: 0.5 },
    });
  });

  it('lists labels with no triage instead of counting them', () => {
    expect(report.threads).toBe(4);
    expect(report.unlabeledThreads).toEqual(['missing']);
    expect(report.labelStatus).toBe('author_labeled_development_set');
  });

  it('reports an empty denominator as n/a rather than zero', () => {
    const empty = scoreAgreement([], { ...labels, labels: [] });
    expect(empty.exactPrimary).toEqual({ numerator: 0, denominator: 0, value: null });
  });
});
