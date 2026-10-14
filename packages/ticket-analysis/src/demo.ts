import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  applyIncidentFlags,
  detectIncidentCandidates,
  type IncidentCandidate,
} from './classify/incident.ts';
import { SUPPORTED_LANGUAGES } from './classify/lexicon.ts';
import { CLASSIFIER_VERSION } from './classify/rules.ts';
import { syntheticStateSchema } from './classify/state.ts';
import { triageThread, type Triage } from './classify/triage.ts';
import {
  labelSetSchema,
  scoreAgreement,
  type AgreementReport,
  type Ratio,
} from './evaluate/score.ts';
import { loadTaxonomy } from './taxonomy/load.ts';
import { groupThreads } from './thread/group.ts';
import { parseMessages, type RecordIssue } from './thread/parse.ts';
import {
  detectSecrets,
  redactForDisplay,
  secretValues,
  stripQuotedHistory,
} from './thread/text.ts';

export const FIXTURES_DIR = fileURLToPath(new URL('../fixtures/', import.meta.url));

const stateSetSchema = z.strictObject({
  stateSetVersion: z.string().min(1).max(60),
  note: z.string().min(1).max(600),
  states: z.record(z.string().min(1).max(128), syntheticStateSchema),
});

export interface DemoArtifact {
  demo: 'ticket-triage-demo';
  taxonomyVersion: string;
  taxonomySha256: string;
  classifierVersion: string;
  parse: { records: number; parsed: number; rejected: RecordIssue[] };
  threads: Triage[];
  incidents: IncidentCandidate[];
  agreement: AgreementReport;
}

export interface DemoResult {
  ok: boolean;
  lines: string[];
  artifact: DemoArtifact;
  /** Kinds of input values found in the output. Must be empty; values are never listed. */
  leaks: string[];
}

const readJson = (name: string): unknown =>
  JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8'));
const pct = (r: Ratio) => `${String(r.numerator)}/${String(r.denominator)}`;
const pad = (value: string, width: number) => value.padEnd(width);

/** Reasons that explain a triage; routine ones are left out of the table to keep it readable. */
const QUIET = new Set(['language_not_declared', 'root_cause_unverified']);

export function runTicketDemo(): DemoResult {
  const taxonomy = loadTaxonomy();
  const raw = readJson('threads.demo.v1.json');
  const states = stateSetSchema.parse(readJson('states.demo.v1.json'));
  const labels = labelSetSchema.parse(readJson('labels.demo.v1.json'));

  const parsed = parseMessages(raw);
  if (!parsed.ok) throw new Error(`demo input rejected: ${parsed.fatal}`);
  const threads = groupThreads(parsed.messages);

  const firstCustomerAt = new Map(
    threads.map((thread) => [
      thread.threadId,
      thread.messages.find((m) => m.author === 'customer')?.createdAtMs ?? 0,
    ]),
  );
  const initial = threads.map((thread) => {
    const state = states.states[thread.threadId];
    return triageThread(thread, state === undefined ? { taxonomy } : { taxonomy, state });
  });
  const incidents = detectIncidentCandidates(
    initial.map((t) => ({
      threadId: t.threadId,
      firstCustomerAtMs: firstCustomerAt.get(t.threadId) ?? 0,
      primaryL2: t.primaryL2,
    })),
  );
  const triages = applyIncidentFlags(initial, incidents);
  const agreement = scoreAgreement(triages, labels);
  const recordCount = Array.isArray(raw) ? raw.length : 0;

  const lines: string[] = [
    'Ticket triage demo: invented conversations only',
    `taxonomy ${taxonomy.taxonomy.taxonomyVersion} (sha256 ${taxonomy.sha256.slice(0, 12)}…, ${taxonomy.taxonomy.reviewStatus}), rules ${CLASSIFIER_VERSION}, languages ${SUPPORTED_LANGUAGES.join(', ')}`,
    '',
    `Input: ${String(recordCount)} records, ${String(parsed.messages.length)} parsed, ${String(parsed.issues.length)} rejected${parsed.issues.map((i) => ` (record ${String(i.index)}: ${i.code} ${i.field})`).join('')}. ${String(threads.length)} threads. Names and email addresses were dropped while parsing.`,
    ...threads
      .filter((thread) => thread.anomalies.length > 0)
      .map((thread) => `  ${thread.threadId} anomalies: ${thread.anomalies.join(', ')}`),
    '',
    `${pad('Thread', 11)}${pad('Primary', 9)}${pad('Second', 8)}${pad('L3', 9)}${pad('Flags', 20)}${pad('Review', 7)}Reasons`,
    ...triages.map(
      (t) =>
        `${pad(t.threadId, 11)}${pad(t.primaryL2 ?? 'abstain', 9)}${pad(t.secondaryL2 ?? '-', 8)}${pad(t.confirmedL3 ?? '-', 9)}${pad(t.flags.map((f) => f.code).join(' ') || '-', 20)}${pad(t.reviewRequired ? 'yes' : 'no', 7)}${t.safeReasonCodes.filter((r) => !QUIET.has(r)).join(', ')}`,
    ),
    '',
    'Customer report versus trusted synthetic state:',
    ...triages
      .filter((t) => t.evidence.some((e) => e.origin === 'verified_synthetic_state'))
      .map((t) => {
        const of = (origin: string) =>
          t.evidence
            .filter((e) => e.origin === origin)
            .map((e) => e.code)
            .join(', ') || 'nothing';
        const verdict = t.safeReasonCodes.includes('customer_report_contradicts_state')
          ? 'contradiction recorded'
          : 'consistent';
        return `  ${t.threadId}: customer reported ${of('customer_reported')}; state shows ${of('verified_synthetic_state')}; ${verdict}; L3 ${t.confirmedL3 ?? 'not confirmed'}`;
      }),
    `  Agent claims of completed actions, kept unverified: ${
      triages
        .filter((t) => t.evidence.some((e) => e.origin === 'agent_claimed'))
        .map((t) => t.threadId)
        .join(', ') || 'none'
    }`,
    `  Root cause left unconfirmed (no trusted evidence): ${String(triages.filter((t) => t.safeReasonCodes.includes('root_cause_unverified')).length)} threads`,
    '',
    'Fix home and automation cap are hypotheses; nothing is executed:',
    ...['demo-t01', 'demo-t06', 'demo-t24']
      .map((id) => triages.find((t) => t.threadId === id))
      .filter((t): t is Triage => t !== undefined)
      .map(
        (t) =>
          `  ${t.threadId} ${t.primaryL2 ?? '-'}: fix home ${t.suggestedFixHome ?? '-'}, cap "${t.maxAutomationScope ?? '-'}", protected change typically involved: ${String(t.protectedMutationTypicallyInvolved)}`,
      ),
    '',
    'Incident candidates (volume across threads, never one report):',
    ...(incidents.length === 0
      ? ['  none']
      : incidents.map(
          (i) =>
            `  ${i.l2}: ${String(i.threadIds.length)} threads between ${i.windowStart} and ${i.windowEnd}; F-OUT added as an inferred pattern for review`,
        )),
    '',
    'Redaction:',
    ...threads
      .filter((thread) => thread.messages.some((m) => detectSecrets(m.body).length > 0))
      .map((thread) => {
        const latest = thread.messages.filter((m) => m.author === 'customer').at(-1);
        const body = latest === undefined ? '' : stripQuotedHistory(latest.body).current;
        return `  ${thread.threadId} (${detectSecrets(body).join(', ')}): "${redactForDisplay(body)}"`;
      }),
    '',
    `Agreement with ${labels.labelSetVersion} (${labels.labelStatus}, ${String(agreement.threads)} threads). The threads and labels were written alongside the rules by the same author, so this shows consistency, not accuracy; expect lower agreement on anything new:`,
    `  exact primary ${pct(agreement.exactPrimary)}, acceptable primary ${pct(agreement.acceptablePrimary)}, secondary ${pct(agreement.secondary)}`,
    `  abstention: ${String(agreement.abstention.correct)}/${String(agreement.abstention.expected)} expected abstentions, ${String(agreement.abstention.abstainedWhenLabeled)} abstentions on labeled threads`,
    `  flags: ${Object.entries(agreement.flags)
      .map(([code, s]) => `${code} precision ${pct(s.precision)} recall ${pct(s.recall)}`)
      .join('; ')}`,
  ];

  const artifact: DemoArtifact = {
    demo: 'ticket-triage-demo',
    taxonomyVersion: taxonomy.taxonomy.taxonomyVersion,
    taxonomySha256: taxonomy.sha256,
    classifierVersion: CLASSIFIER_VERSION,
    parse: { records: recordCount, parsed: parsed.messages.length, rejected: parsed.issues },
    threads: triages,
    incidents,
    agreement,
  };

  const leaks = findLeaks(raw, lines.join('\n'), JSON.stringify(artifact));
  lines.push(
    '',
    leaks.length === 0
      ? 'Self-check: no secret, name, email address, or message text from the input appears in this output or the artifact.'
      : `Self-check FAILED: input values leaked (${leaks.join(', ')}).`,
  );
  return { ok: leaks.length === 0, lines, artifact, leaks };
}

/** Kinds of input values that appear in the output. Display previews are redacted, so none should. */
function findLeaks(raw: unknown, printed: string, artifact: string): string[] {
  const records = z
    .array(
      z.looseObject({
        body: z.string().optional(),
        author: z
          .looseObject({ name: z.string().nullish(), email: z.string().nullish() })
          .optional(),
      }),
    )
    .parse(raw);
  const leaks = new Set<string>();
  const both = `${printed}\n${artifact}`;
  for (const record of records) {
    const body = record.body ?? '';
    for (const value of secretValues(body)) if (both.includes(value)) leaks.add('secret');
    for (const value of [record.author?.name, record.author?.email]) {
      if (typeof value === 'string' && value.length > 0 && both.includes(value))
        leaks.add('contact');
    }
    const fragment = body.trim().slice(0, 24);
    if (fragment.length >= 16 && artifact.includes(fragment)) leaks.add('message_text');
  }
  return [...leaks].sort();
}
