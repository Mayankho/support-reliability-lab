import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { policyIdSchema, policyVersionSchema, type AgentPolicyDoc } from '@srl/contracts';
import {
  parseSyntheticPolicy,
  sha256,
  type PolicyDocument,
  type SyntheticPolicy,
} from './parse-policy.ts';

const policyFileUrl = new URL('../../../fixtures/synthetic_policy.v1.md', import.meta.url);

export type PolicyLookup =
  | { status: 'found'; document: PolicyDocument }
  | { status: 'missing'; id: string }
  | { status: 'invalid_id' }
  | { status: 'version_mismatch'; requestedVersion: string; current: PolicyDocument };

export type PolicySelection =
  | { status: 'ok'; documents: AgentPolicyDoc[] }
  | { status: 'error'; reason: 'invalid_id' | 'duplicate_id' | 'missing_documents'; ids: string[] };

let cached: SyntheticPolicy | undefined;

export function loadSyntheticPolicy(): SyntheticPolicy {
  const bytes = readFileSync(fileURLToPath(policyFileUrl));
  return parseSyntheticPolicy(bytes.toString('utf8'), sha256(bytes));
}

export function getSyntheticPolicy(): SyntheticPolicy {
  cached ??= loadSyntheticPolicy();
  return cached;
}

export function lookupPolicyDocument(id: string, version?: string): PolicyLookup {
  if (!policyIdSchema.safeParse(id).success) {
    return { status: 'invalid_id' };
  }
  if (version !== undefined && !policyVersionSchema.safeParse(version).success) {
    return { status: 'invalid_id' };
  }

  const document = getSyntheticPolicy().documents.find((candidate) => candidate.id === id);
  if (document === undefined) {
    return { status: 'missing', id };
  }
  if (version !== undefined && version !== document.version) {
    return { status: 'version_mismatch', requestedVersion: version, current: document };
  }
  return { status: 'found', document };
}

export function selectPolicyDocuments(ids: readonly string[]): PolicySelection {
  const documents: AgentPolicyDoc[] = [];
  const seen = new Set<string>();
  const missing: string[] = [];

  for (const id of ids) {
    if (seen.has(id)) {
      return { status: 'error', reason: 'duplicate_id', ids: [id] };
    }
    seen.add(id);
    const lookup = lookupPolicyDocument(id);
    switch (lookup.status) {
      case 'found':
        documents.push({
          id: lookup.document.id,
          version: lookup.document.version,
          text: lookup.document.text,
        });
        break;
      case 'missing':
        missing.push(id);
        break;
      case 'invalid_id':
        return { status: 'error', reason: 'invalid_id', ids: [id] };
      case 'version_mismatch':
        throw new Error('selectPolicyDocuments looks up current documents only');
      default:
        return assertNever(lookup);
    }
  }

  if (missing.length > 0) {
    return { status: 'error', reason: 'missing_documents', ids: missing };
  }
  return { status: 'ok', documents };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected policy lookup status ${String(value)}`);
}
