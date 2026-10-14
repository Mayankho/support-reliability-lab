import type { AgentPolicyDoc, PolicyCitation } from '@srl/contracts';
import { topicDocId, type Plan, type ReasonCode } from './plan.ts';

const SECURITY_REASONS: ReadonlySet<ReasonCode> = new Set([
  'workspace_mismatch',
  'unverified_bypass_attempt',
  'identity_unverified',
  'ownership_or_disclosure_request',
  'account_compromise',
  'account_deletion',
  'identity_provider_unavailable',
  'access_recovery',
  'instruction_override_attempt',
]);

const TECHNICAL_REASONS: ReadonlySet<ReasonCode> = new Set([
  'service_unavailable',
  'identity_provider_unavailable',
  'prolonged_processing',
  'status_unknown',
]);

const PROVENANCE_REASONS: ReadonlySet<ReasonCode> = new Set([
  'policy_missing',
  'policy_conflict',
  'policy_stale',
]);

/**
 * Picks citations only from documents actually supplied, using their supplied versions.
 */
export function selectCitations(plan: Plan, supplied: readonly AgentPolicyDoc[]): PolicyCitation[] {
  const wanted = new Set<string>();
  const topicDoc = topicDocId(plan.intent, plan.policyTopic);
  if (topicDoc !== null) {
    wanted.add(topicDoc);
  }
  if (plan.intent === 'policy_question' && plan.policyTopic === 'credit') {
    wanted.add('KB-GEN-001');
  }
  if (SECURITY_REASONS.has(plan.reason)) {
    wanted.add('KB-SEC-001');
  }
  if (TECHNICAL_REASONS.has(plan.reason)) {
    wanted.add('KB-TECH-001');
  }
  if (PROVENANCE_REASONS.has(plan.reason)) {
    wanted.add('KB-KNOW-001');
  }

  return supplied
    .filter((doc) => wanted.has(doc.id))
    .map((doc) => ({ id: doc.id, version: doc.version }));
}
