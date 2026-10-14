import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_DIR, MANIFEST_FILE, readTaxonomy } from './load.ts';
import { AUTOMATION_SCOPES, type Taxonomy } from './schema.ts';
import { sha256Hex, validateTaxonomy } from './validate.ts';

const bytes = readFileSync(join(DATA_DIR, 'taxonomy.v1.1.json'));
const manifestText = readFileSync(MANIFEST_FILE, 'utf8');
const original = JSON.parse(bytes.toString('utf8')) as Taxonomy;

/** Applies an edit and re-pins the manifest, so the integrity checks run rather than the hash check. */
function mutated(
  edit: (taxonomy: Taxonomy) => void,
  manifestEdit?: (m: Record<string, unknown>) => void,
) {
  const taxonomy = structuredClone(original);
  edit(taxonomy);
  const editedBytes = Buffer.from(`${JSON.stringify(taxonomy, null, 2)}\n`);
  const manifest = JSON.parse(manifestText) as Record<string, unknown>;
  manifest.sha256 = sha256Hex(editedBytes);
  manifestEdit?.(manifest);
  return validateTaxonomy({ bytes: editedBytes, manifestText: JSON.stringify(manifest) });
}

function codes(result: ReturnType<typeof validateTaxonomy>): string[] {
  return result.ok ? [] : result.issues.map((issue) => issue.code);
}

describe('taxonomy registry', () => {
  it('validates the committed registry and recomputes its counts', () => {
    const result = readTaxonomy();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { taxonomy, l1, l2, l3, l3ByParent } = result.value;
    expect([l1.size, l2.size, l3.size, taxonomy.riskFlags.length]).toEqual([15, 67, 80, 9]);
    expect(l3ByParent.size).toBe(24);
    for (const issue of taxonomy.l2Issues) expect(l1.has(issue.l1Code)).toBe(true);
    for (const option of taxonomy.l3Options) expect(l2.has(option.parentL2)).toBe(true);
  });

  it('pins the bytes: a one-byte change fails without a new manifest', () => {
    const edited = Buffer.from(bytes);
    edited[edited.length - 2] = edited[edited.length - 2] === 0x7d ? 0x20 : 0x7d;
    expect(codes(validateTaxonomy({ bytes: edited, manifestText }))).toEqual(['HASH_MISMATCH']);
  });

  it('keeps ownership, tier, and scope as provisional metadata', () => {
    const result = readTaxonomy();
    if (!result.ok) throw new Error('registry invalid');
    const { taxonomy } = result.value;
    expect(taxonomy.reviewStatus).toBe('draft_not_independently_adjudicated');
    expect(taxonomy.metadataInterpretation).toMatch(/never permission/u);
    for (const issue of taxonomy.l2Issues) {
      expect(AUTOMATION_SCOPES).toContain(issue.maxAutomationScope);
      expect(issue.maxAutomationScope).not.toMatch(/execute|refund|grant|delete/iu);
      expect(typeof issue.protectedMutationTypicallyInvolved).toBe('boolean');
    }
  });

  it('contains definitions only, with no contact details or credential-like values', () => {
    const text = bytes.toString('utf8');
    expect(text).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u);
    expect(text).not.toMatch(/\b(?:sk-|srl_live_|key_)[A-Za-z0-9]{8,}/u);
    expect(text).not.toMatch(/\b\d{6,}\b/u);
  });

  it.each([
    [
      'a duplicate L2 code',
      (t: Taxonomy) => {
        t.l2Issues[1] = { ...t.l2Issues[1]!, code: t.l2Issues[0]!.code };
      },
      'DUPLICATE_CODE',
    ],
    [
      'an L2 whose L1 does not exist',
      (t: Taxonomy) => {
        t.l2Issues[0] = { ...t.l2Issues[0]!, l1Code: 'ZZZ' };
      },
      'UNKNOWN_L1',
    ],
    [
      'an L2 code that does not start with its L1',
      (t: Taxonomy) => {
        t.l2Issues[0] = { ...t.l2Issues[0]!, l1Code: 'CRD' };
      },
      'L2_PREFIX_MISMATCH',
    ],
    [
      'an L3 whose parent does not exist',
      (t: Taxonomy) => {
        t.l3Options[0] = { ...t.l3Options[0]!, parentL2: 'BIL-99' };
      },
      'UNKNOWN_PARENT_L2',
    ],
    [
      'a missing risk flag definition',
      (t: Taxonomy) => {
        t.riskFlags = t.riskFlags.filter((flag) => flag.code !== 'F-SEC');
      },
      'MISSING_FLAG_DEFINITION',
    ],
    [
      'an L1 with no tie-break rank',
      (t: Taxonomy) => {
        t.classificationPrinciples.lastResortTieBreakGroups =
          t.classificationPrinciples.lastResortTieBreakGroups
            .map((group) => group.filter((code) => code !== 'NSP'))
            .filter((group) => group.length > 0);
      },
      'TIE_BREAK_COVERAGE',
    ],
    [
      'a human-only issue offered to automation',
      (t: Taxonomy) => {
        const index = t.l2Issues.findIndex((issue) => issue.maxAutomationScope === 'Human only');
        t.l2Issues[index] = {
          ...t.l2Issues[index]!,
          candidateAutomationTier: 'A: Automation candidate',
        };
      },
      'SCOPE_TIER_MISMATCH',
    ],
    [
      'a missing unknown issue type',
      (t: Taxonomy) => {
        t.l2Issues = t.l2Issues.filter((issue) => issue.code !== 'UNK-02');
      },
      'MISSING_UNKNOWN_ISSUE',
    ],
  ])('rejects %s', (_label, edit, code) => {
    expect(codes(mutated(edit))).toContain(code);
  });

  it('recomputes counts instead of trusting the manifest', () => {
    const result = mutated(
      () => undefined,
      (manifest) => {
        manifest.counts = { l1Domains: 15, l2Issues: 68, l3Options: 80, riskFlags: 9 };
      },
    );
    expect(codes(result)).toEqual(['COUNT_MISMATCH']);
  });

  it('rejects an unknown enum value and names the path, not the value', () => {
    const result = mutated((t) => {
      (t.l2Issues[0] as { candidatePriority: string }).candidatePriority = 'URGENT';
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toEqual({
      code: 'SCHEMA_INVALID',
      detail: 'l2Issues.0.candidatePriority',
    });
    expect(JSON.stringify(result.issues)).not.toContain('URGENT');
  });

  it('rejects an unreadable or malformed manifest', () => {
    expect(codes(validateTaxonomy({ bytes, manifestText: '{' }))).toEqual(['MANIFEST_INVALID']);
    expect(codes(validateTaxonomy({ bytes, manifestText: '{"file":"x.json"}' }))).toEqual([
      'MANIFEST_INVALID',
    ]);
  });
});
