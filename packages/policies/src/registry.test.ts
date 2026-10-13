import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PolicyParseError, parseSyntheticPolicy, sha256 } from './parse-policy.ts';
import { getSyntheticPolicy, lookupPolicyDocument, selectPolicyDocuments } from './registry.ts';

const policyFile = fileURLToPath(
  new URL('../../../fixtures/synthetic_policy.v1.md', import.meta.url),
);

describe('SYN-POLICY-1 registry', () => {
  it('loads eight fictional documents and locks their hashes to the file bytes', () => {
    const bytes = readFileSync(policyFile);
    const policy = getSyntheticPolicy();

    expect(policy.id).toBe('SYN-POLICY-1');
    expect(policy.disclaimer).toContain('No relation to Runway policy');
    expect(policy.sha256).toBe(sha256(bytes));
    expect(policy.documents).toHaveLength(8);
    expect(policy.globalRules).toContain('no action executor exists');

    for (const document of policy.documents) {
      expect(document.sha256).toBe(sha256(document.text));
      expect(document.sha256).toMatch(/^[a-f0-9]{64}$/u);
    }

    expect(Object.fromEntries(policy.documents.map((document) => [document.id, document.sha256])))
      .toMatchInlineSnapshot(`
        {
          "KB-CANCEL-001": "098628dfbee8ca7ae71c0b92086a7ca47f8012e63e30c8975bb40779477c0999",
          "KB-CREDIT-001": "740be3549f26ecdb210c1f4ca650e773b9c0973181f4f13857617eb917eaa4e9",
          "KB-GEN-001": "644d911693e1248ee0ff0bce17b2be42221487af40c8d776c180e966b27c8c70",
          "KB-KNOW-001": "a1375a8a21ceb6501f1a3d7779b12d5005dd1967f500d3245a9b0705bdebaf2a",
          "KB-PRORATE-001": "03816e5aa2c9bbce8b39131271aa044b21e9d9ea910cb0fd52b4291273e3292b",
          "KB-REFUND-001": "c74d60678b133ac60073d437ad1a7af8fa98b07042825491d61da0b221f5e251",
          "KB-SEC-001": "a9694057628048aea1a9eff5df4d9f07a4c331f7da2ecb54dfc1c30ccaba2370",
          "KB-TECH-001": "4ec41516e64adb9c5bcc90c00fa5973367d7b3cdbe0206e760c35e9f8e2729da",
        }
      `);
    expect(policy.sha256).toMatchInlineSnapshot(
      `"ff92f6522d75dc500798a993d3f2a4b0ff96e02f06bb791c47a9227628838f6a"`,
    );
    expect(policy.globalRulesSha256).toMatchInlineSnapshot(
      `"f13992cc023fb9d4f1c1d527727cb564d94a3462b5d45e84362be677f6df21ca"`,
    );
  });

  it('changes a document hash when its text changes', () => {
    const markdown = readFileSync(policyFile, 'utf8');
    const original = parseSyntheticPolicy(markdown, sha256(markdown));
    const edited = parseSyntheticPolicy(
      markdown.replace('within 14 days', 'within 15 days'),
      sha256(markdown),
    );
    const originalRefund = original.documents.find((document) => document.id === 'KB-REFUND-001');
    const editedRefund = edited.documents.find((document) => document.id === 'KB-REFUND-001');

    expect(originalRefund?.sha256).not.toBe(editedRefund?.sha256);
  });

  it('rejects policy text that drops the fictional-policy disclaimer', () => {
    expect(() => parseSyntheticPolicy('# Other policy\n', 'abc')).toThrow(PolicyParseError);
  });

  it('rejects a duplicate document id', () => {
    const markdown = [
      '**No relation to Runway policy. Not valid for real customer support.**',
      '- `KB-SEC-001@1.0.0`: First copy.',
      '- `KB-SEC-001@1.0.0`: Second copy.',
    ].join('\n');

    expect(() => parseSyntheticPolicy(markdown, 'abc')).toThrow(
      /Duplicate policy document KB-SEC-001/,
    );
  });

  it('returns the current document and reports a stale version', () => {
    const current = lookupPolicyDocument('KB-REFUND-001');
    const stale = lookupPolicyDocument('KB-REFUND-001', '0.9.0');

    expect(current.status).toBe('found');
    if (current.status === 'found') {
      expect(current.document.version).toBe('1.0.0');
      expect(current.document.text).toContain('14 days');
    }
    expect(stale).toMatchObject({
      status: 'version_mismatch',
      requestedVersion: '0.9.0',
    });
    if (stale.status === 'version_mismatch') {
      expect(stale.current.version).toBe('1.0.0');
    }
  });

  it('reports missing and invalid ids without returning another document', () => {
    expect(lookupPolicyDocument('KB-NONE-999')).toEqual({
      status: 'missing',
      id: 'KB-NONE-999',
    });
    expect(lookupPolicyDocument('not-a-policy')).toEqual({ status: 'invalid_id' });
    expect(lookupPolicyDocument('KB-REFUND-001', 'latest')).toEqual({ status: 'invalid_id' });
  });

  it('selects agent-visible documents and omits registry hashes', () => {
    const selected = selectPolicyDocuments(['KB-CREDIT-001', 'KB-REFUND-001']);

    expect(selected.status).toBe('ok');
    if (selected.status === 'ok') {
      expect(selected.documents.map((document) => document.id)).toEqual([
        'KB-CREDIT-001',
        'KB-REFUND-001',
      ]);
      expect(selected.documents[0]).not.toHaveProperty('sha256');
      expect(selected.documents[1]?.text).toContain('Never issue money');
    }
  });

  it('reports missing, duplicate, and invalid selections', () => {
    expect(selectPolicyDocuments(['KB-NONE-999'])).toEqual({
      status: 'error',
      reason: 'missing_documents',
      ids: ['KB-NONE-999'],
    });
    expect(selectPolicyDocuments(['KB-SEC-001', 'KB-SEC-001'])).toEqual({
      status: 'error',
      reason: 'duplicate_id',
      ids: ['KB-SEC-001'],
    });
    expect(selectPolicyDocuments(['admin'])).toEqual({
      status: 'error',
      reason: 'invalid_id',
      ids: ['admin'],
    });
  });
});
