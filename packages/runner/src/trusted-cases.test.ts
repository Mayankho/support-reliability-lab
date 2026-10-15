import { describe, expect, it } from 'vitest';
import { loadVerifiedDataset } from './service.ts';
import { trustedCasesForGate } from './trusted-cases.ts';

describe('trustedCasesForGate', () => {
  it('names every case in the verified v1 fixture', async () => {
    const dataset = await loadVerifiedDataset('v1');
    const trusted = trustedCasesForGate(dataset.cases);

    expect(trusted.map((record) => record.caseId)).toEqual(
      dataset.cases.map((goldenCase) => goldenCase.id),
    );
    expect(new Set(trusted.map((record) => record.caseId)).size).toBe(80);
    expect(trusted.map((record) => record.responseConceptsAnnotated)).toEqual(
      dataset.cases.map((goldenCase) => goldenCase.expected.requiredResponseConcepts.length > 0),
    );
  });
});
