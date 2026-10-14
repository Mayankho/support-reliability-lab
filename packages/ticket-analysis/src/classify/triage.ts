import { loadTaxonomy } from '../taxonomy/load.ts';
import type { AutomationScope } from '../taxonomy/schema.ts';
import type { ValidatedTaxonomy } from '../taxonomy/validate.ts';
import type { Thread, ThreadAnomaly } from '../thread/group.ts';
import { detectSecrets, normalizeText, stripQuotedHistory } from '../thread/text.ts';
import { detectFlags, type EvidenceOrigin, type FlagResult } from './flags.ts';
import {
  detectFeatures,
  isSupportedLanguage,
  SUPPORTED_LANGUAGES,
  type Feature,
  type Language,
} from './lexicon.ts';
import { CLASSIFIER_VERSION, matchRules, SUBSUMED } from './rules.ts';
import { confirmL3, contradictions, stateEvidence, type SyntheticState } from './state.ts';

export interface Evidence {
  origin: EvidenceOrigin;
  code: string;
}

/** A provisional triage. It carries codes only: no message text, names, or contact details. */
export interface Triage {
  threadId: string;
  taxonomyVersion: string;
  classifierVersion: string;
  language: string | null;
  primaryL2: string | null;
  primaryL1: string | null;
  secondaryL2: string | null;
  abstained: boolean;
  confirmedL3: string | null;
  flags: FlagResult[];
  issueState: 'reported' | 'clarification_needed' | 'synthetically_verified';
  suggestedFixHome: string | null;
  candidateAutomationTier: string | null;
  maxAutomationScope: AutomationScope | null;
  protectedMutationTypicallyInvolved: boolean | null;
  evidence: Evidence[];
  matchedRuleIds: string[];
  reviewRequired: boolean;
  safeReasonCodes: string[];
  anomalies: ThreadAnomaly[];
}

export interface TriageOptions {
  state?: SyntheticState;
  taxonomy?: ValidatedTaxonomy;
}

interface Candidate {
  l2: string;
  ruleIds: string[];
  score: number;
  firstSentence: number;
  inSubject: boolean;
  rank: number;
}

const REVIEW_REASONS = new Set([
  'additional_issues_not_labeled',
  'authority_claim_unverified',
  'customer_report_contradicts_state',
  'insufficient_information',
  'language_unsupported',
  'multiple_protected_requests',
  'no_customer_message',
  'no_supported_rule_matched',
  'primary_tie_break',
  'refund_object_ambiguous',
  'subject_body_conflict',
  'thread_too_long',
  'human_only_issue',
  'data_quality_anomaly',
]);
const REVIEW_FLAGS = new Set(['F-SEC', 'F-LEG', 'F-CHB']);
const QUALITY_ANOMALIES = new Set<ThreadAnomaly>([
  'duplicate_ticket_id',
  'inconsistent_metadata',
  'starts_with_agent_message',
]);
const CUSTOMER_EVIDENCE: ReadonlyArray<[Feature, string]> = [
  ['generation_failed', 'generation_failed'],
  ['generation_stuck', 'generation_stuck'],
  ['credits_deducted', 'credits_charged'],
  ['duplicate_charge', 'duplicate_charge'],
  ['pending_charge', 'charge_pending'],
  ['account_compromised', 'account_compromised'],
  ['outage_report', 'outage'],
  ['api_auth_error', 'api_authentication_error'],
  ['api_rate_limit', 'api_rate_limited'],
  ['reports_refund_complete', 'refund_reported_complete'],
];
const AGENT_COMPLETION = [
  /\b(?:i've|i have|we've|we have|i|we) (?:already |just )?(?:refunded|reimbursed|restored|credited|cancell?ed|deleted|processed|issued|sent|unlocked|reset|applied)\b/u,
  /\b(?:refund|credits?|cancellation|deletion|reset) (?:has|have) (?:already )?been (?:sent|issued|processed|completed|restored|applied|done|approved)\b/u,
];
const TRIVIAL = /^(?:help|hello|hi|hey|ok|okay|\?+)?[.!?]*$/u;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => normalizeText(sentence))
    .filter((sentence) => sentence.length > 0);
}

function tieRank(l2: string, taxonomy: ValidatedTaxonomy): number {
  const l1 = taxonomy.l2.get(l2)?.l1Code ?? 'UNK';
  const index = taxonomy.taxonomy.classificationPrinciples.lastResortTieBreakGroups.findIndex(
    (group) => group.includes(l1),
  );
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

/**
 * Ranks the issue types in one stretch of customer text by central need: an issue raised in a
 * sentence that asks for something outranks one only mentioned. For a failed or stuck job that cost
 * credits, the requested remedy decides between credits back (CRD-01) and fixing the job (PRC-01).
 */
function rankCandidates(
  text: string,
  languages: readonly Language[],
  taxonomy: ValidatedTaxonomy,
  subjectIssues: ReadonlySet<string>,
  reasons: Set<string>,
): { candidates: Candidate[]; tie: boolean; subjectBrokeTie: boolean } {
  const whole = detectFeatures(normalizeText(text), languages);
  const perSentence = sentences(text).map((sentence) => detectFeatures(sentence, languages));
  const byIssue = new Map<string, string[]>();
  for (const { id, l2 } of matchRules((feature) => whole.has(feature))) {
    byIssue.set(l2, [...(byIssue.get(l2) ?? []), id]);
  }
  for (const { keep, drop, reason } of SUBSUMED) {
    if (byIssue.has(keep) && byIssue.has(drop)) {
      byIssue.delete(drop);
      reasons.add(reason);
    }
  }

  const candidates: Candidate[] = [...byIssue].map(([l2, ruleIds]) => {
    let score = 1;
    let firstSentence = Number.MAX_SAFE_INTEGER;
    perSentence.forEach((features, index) => {
      const local = matchRules((feature) => features.has(feature)).some((rule) => rule.l2 === l2);
      if (!local) return;
      firstSentence = Math.min(firstSentence, index);
      if (features.has('request_cue')) score = 2;
    });
    return {
      l2,
      ruleIds,
      score,
      firstSentence,
      inSubject: subjectIssues.has(l2),
      rank: tieRank(l2, taxonomy),
    };
  });

  const credits = candidates.find((c) => c.l2 === 'CRD-01');
  const job = candidates.find((c) => c.l2 === 'PRC-01');
  if (credits !== undefined && job !== undefined) {
    credits.score = whole.has('wants_credits_back') ? 2 : whole.has('credits_deducted') ? 1 : 0;
    job.score = whole.has('wants_job_fixed') ? 2 : whole.has('generation_stuck') ? 1 : 0;
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      Number(b.inSubject) - Number(a.inSubject) ||
      a.rank - b.rank ||
      a.firstSentence - b.firstSentence,
  );
  const [first, second] = candidates;
  const tie = first !== undefined && second !== undefined && first.score === second.score;
  return { candidates, tie, subjectBrokeTie: tie && first.inSubject && !second.inSubject };
}

function abstain(
  thread: Thread,
  taxonomy: ValidatedTaxonomy,
  base: Pick<Triage, 'language' | 'flags' | 'evidence' | 'anomalies'>,
  reasons: Set<string>,
): Triage {
  return {
    threadId: thread.threadId,
    taxonomyVersion: taxonomy.taxonomy.taxonomyVersion,
    classifierVersion: CLASSIFIER_VERSION,
    ...base,
    primaryL2: null,
    primaryL1: null,
    secondaryL2: null,
    abstained: true,
    confirmedL3: null,
    issueState: 'clarification_needed',
    suggestedFixHome: null,
    candidateAutomationTier: null,
    maxAutomationScope: null,
    protectedMutationTypicallyInvolved: null,
    matchedRuleIds: [],
    reviewRequired: true,
    safeReasonCodes: [...reasons].sort(),
  };
}

/** Classifies one synthetic thread. Agent replies and quoted history never define the current need. */
export function triageThread(thread: Thread, options: TriageOptions = {}): Triage {
  const taxonomy = options.taxonomy ?? loadTaxonomy();
  const reasons = new Set<string>();
  const ruleIds = new Set<string>();
  const evidence: Evidence[] = [];

  const customer = thread.messages.filter((message) => message.author === 'customer');
  const agents = thread.messages.filter((message) => message.author === 'agent');
  const secretKinds = [
    ...new Set(thread.messages.flatMap((m) => detectSecrets(`${m.subject ?? ''}\n${m.body}`))),
  ].sort();
  if (secretKinds.length > 0) reasons.add('secret_like_value_redacted');
  if (thread.anomalies.some((anomaly) => QUALITY_ANOMALIES.has(anomaly))) {
    reasons.add('data_quality_anomaly');
  }

  for (const agent of agents) {
    const text = normalizeText(agent.body);
    if (AGENT_COMPLETION.some((pattern) => pattern.test(text))) {
      evidence.push({ origin: 'agent_claimed', code: 'action_completion_claimed' });
      reasons.add('agent_claim_unverified');
      break;
    }
  }

  const latest = customer.at(-1);
  const declared = latest?.language ?? null;
  const supported = declared === null || isSupportedLanguage(declared);
  const languages: readonly Language[] =
    declared === null ? SUPPORTED_LANGUAGES : supported ? [declared] : [];
  if (declared === null) reasons.add('language_not_declared');

  const turns = customer.map((message) => {
    const { current, removedHistory } = stripQuotedHistory(message.body);
    if (removedHistory) reasons.add('quoted_history_ignored');
    return current;
  });
  const allCustomer = detectFeatures(normalizeText(turns.join('\n')), languages);
  const flagsFor = (issues: Array<string | null>) =>
    detectFlags({
      customer: allCustomer,
      secretKinds,
      issues,
      plans: customer.map((m) => m.plan).filter((plan): plan is string => plan !== null),
    });

  if (latest === undefined || thread.anomalies.includes('thread_too_long')) {
    reasons.add(latest === undefined ? 'no_customer_message' : 'thread_too_long');
    return abstain(
      thread,
      taxonomy,
      { language: declared, flags: flagsFor([]), evidence, anomalies: thread.anomalies },
      reasons,
    );
  }
  if (!supported) {
    reasons.add('language_unsupported');
    return abstain(
      thread,
      taxonomy,
      { language: declared, flags: flagsFor([]), evidence, anomalies: thread.anomalies },
      reasons,
    );
  }

  for (const [feature, code] of CUSTOMER_EVIDENCE) {
    if (allCustomer.has(feature)) evidence.push({ origin: 'customer_reported', code });
  }
  if (allCustomer.has('reports_refund_complete')) reasons.add('customer_claim_unverified');
  if (allCustomer.has('instruction_like')) reasons.add('instruction_like_text_ignored');
  if (allCustomer.has('authority_claim')) reasons.add('authority_claim_unverified');

  const subject =
    latest.subject ?? customer.find((message) => message.subject !== null)?.subject ?? null;
  const subjectRank =
    subject === null
      ? { candidates: [] as Candidate[] }
      : rankCandidates(subject, languages, taxonomy, new Set(), new Set());
  const subjectIssues = new Set(subjectRank.candidates.map((c) => c.l2));

  const latestText = turns.at(-1) ?? '';
  const latestFeatures = detectFeatures(normalizeText(latestText), languages);
  const current = rankCandidates(latestText, languages, taxonomy, subjectIssues, reasons);
  const earlier = rankCandidates(
    turns.slice(0, -1).join('\n'),
    languages,
    taxonomy,
    subjectIssues,
    new Set(),
  );

  let primary: string | null;
  let secondary: string | null = null;
  const take = (candidate: Candidate | undefined): string | null => {
    if (candidate === undefined) return null;
    for (const id of candidate.ruleIds) ruleIds.add(id);
    return candidate.l2;
  };

  if (current.candidates.length > 0) {
    primary = take(current.candidates[0]);
    secondary = take(current.candidates[1]);
    if (current.candidates.length > 2) reasons.add('additional_issues_not_labeled');
    if (current.tie)
      reasons.add(current.subjectBrokeTie ? 'subject_broke_tie' : 'primary_tie_break');
    const previous = earlier.candidates[0];
    if (previous !== undefined && previous.l2 !== primary && previous.l2 !== secondary) {
      if (secondary === null) {
        secondary = take(previous);
        reasons.add('earlier_need_retained_as_secondary');
      } else {
        reasons.add('earlier_need_present');
      }
    }
    if (subjectIssues.size > 0 && !current.candidates.some((c) => subjectIssues.has(c.l2))) {
      reasons.add('subject_body_conflict');
    }
  } else {
    const normalized = normalizeText(latestText);
    const trivial = TRIVIAL.test(normalized);
    const acknowledged =
      latestFeatures.has('resolution_ack') ||
      (latestFeatures.has('thanks') && normalized.length <= 60);
    const followUp = latestFeatures.has('follow_up') || trivial;
    if (acknowledged) {
      primary = 'FBK-03';
      ruleIds.add('TR-FBK-03');
      reasons.add('customer_reports_resolved');
      if (earlier.candidates.length > 0) reasons.add('earlier_need_reported_resolved');
    } else if (earlier.candidates.length > 0) {
      primary = take(earlier.candidates[0]);
      secondary = take(earlier.candidates[1]);
      reasons.add('follow_up_inherits_earlier_need');
    } else if (followUp) {
      primary = 'UNK-01';
      ruleIds.add('TR-UNK-01');
      reasons.add('insufficient_information');
    } else if (latestFeatures.has('refund_word')) {
      primary = 'UNK-01';
      ruleIds.add('TR-UNK-01-refund');
      reasons.add('refund_object_ambiguous');
    } else if (subjectRank.candidates.length > 0) {
      primary = take(subjectRank.candidates[0]);
      reasons.add('subject_used_for_missing_detail');
    } else {
      reasons.add('no_supported_rule_matched');
      return abstain(
        thread,
        taxonomy,
        { language: declared, flags: flagsFor([]), evidence, anomalies: thread.anomalies },
        reasons,
      );
    }
  }

  const state = options.state;
  let confirmedL3: string | null = null;
  if (state !== undefined) {
    for (const code of stateEvidence(state))
      evidence.push({ origin: 'verified_synthetic_state', code });
    const conflicts = contradictions(allCustomer, state);
    if (conflicts.length > 0) {
      reasons.add('customer_report_contradicts_state');
      for (const conflict of conflicts) reasons.add(conflict);
    }
    const l3 = confirmL3([primary, secondary], state);
    if (l3 !== null) {
      confirmedL3 = l3.l3;
      ruleIds.add(l3.ruleId);
      reasons.add('l3_confirmed_by_synthetic_state');
    }
  }
  if (
    confirmedL3 === null &&
    [primary, secondary].some((c) => c !== null && taxonomy.l3ByParent.has(c))
  ) {
    reasons.add('root_cause_unverified');
  }

  const issue = primary === null ? undefined : taxonomy.l2.get(primary);
  const other = secondary === null ? undefined : taxonomy.l2.get(secondary);
  if (issue?.maxAutomationScope === 'Human only') reasons.add('human_only_issue');
  if (
    issue?.protectedMutationTypicallyInvolved === true &&
    other?.protectedMutationTypicallyInvolved === true
  ) {
    reasons.add('multiple_protected_requests');
  }

  const flags = flagsFor([primary, secondary]);
  const reviewRequired =
    [...reasons].some((reason) => REVIEW_REASONS.has(reason)) ||
    flags.some((flag) => REVIEW_FLAGS.has(flag.code));

  return {
    threadId: thread.threadId,
    taxonomyVersion: taxonomy.taxonomy.taxonomyVersion,
    classifierVersion: CLASSIFIER_VERSION,
    language: declared,
    primaryL2: primary,
    primaryL1: issue?.l1Code ?? null,
    secondaryL2: secondary,
    abstained: false,
    confirmedL3,
    flags,
    issueState:
      state !== undefined
        ? 'synthetically_verified'
        : primary === 'UNK-01'
          ? 'clarification_needed'
          : 'reported',
    suggestedFixHome: issue?.candidateFixHome ?? null,
    candidateAutomationTier: issue?.candidateAutomationTier ?? null,
    maxAutomationScope: issue?.maxAutomationScope ?? null,
    protectedMutationTypicallyInvolved: issue?.protectedMutationTypicallyInvolved ?? null,
    evidence: evidence.sort(
      (a, b) => a.origin.localeCompare(b.origin) || a.code.localeCompare(b.code),
    ),
    matchedRuleIds: [...ruleIds].sort(),
    reviewRequired,
    safeReasonCodes: [...reasons].sort(),
    anomalies: thread.anomalies,
  };
}
