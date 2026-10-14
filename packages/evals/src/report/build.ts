import type {
  AccountContext,
  AgentOutput,
  CaseCategory,
  CaseStatus,
  ExpectedBehavior,
  Risk,
  RuleResult,
} from '@srl/contracts';
import { suggestFixLayers } from './fix-layer.ts';
import type { ReportCase, RunReport } from './schema.ts';

export interface ReportCaseInput {
  caseId: string;
  category: CaseCategory;
  risk: Risk;
  status: CaseStatus;
  executionError: string | null;
  durationMs: number;
  costUsd: number | null;
  costSource: ReportCase['costSource'];
  traceId: string | null;
  message: string;
  account: AccountContext;
  expected: ExpectedBehavior;
  output: AgentOutput | null;
  rules: RuleResult[];
}

export interface ReportRunInput {
  run: RunReport['run'];
  agent: RunReport['agent'];
  dataset: RunReport['dataset'];
  policy: RunReport['policy'];
  evaluatorVersion: string;
  config: Record<string, number>;
  cases: readonly ReportCaseInput[];
  now?: Date;
}

const REDACTIONS: ReadonlyArray<[RegExp, string]> = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, '[email]'],
  [
    /\b(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,})/gu,
    '[token]',
  ],
  [/\b(?:\d[ -]?){13,19}\b/gu, '[number]'],
];

/** Defensive redaction for report text. The fixtures are synthetic, but reports should never carry these shapes. */
export function redactForReport(text: string): string {
  return REDACTIONS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}

export function buildRunReport(input: ReportRunInput): RunReport {
  return {
    reportVersion: '1.0',
    generatedAt: (input.now ?? new Date()).toISOString(),
    run: input.run,
    agent: input.agent,
    dataset: input.dataset,
    policy: input.policy,
    evaluatorVersion: input.evaluatorVersion,
    config: input.config,
    cases: [...input.cases]
      .sort((a, b) => a.caseId.localeCompare(b.caseId))
      .map((reportCase) => ({
        caseId: reportCase.caseId,
        category: reportCase.category,
        risk: reportCase.risk,
        status: reportCase.status,
        executionError: reportCase.executionError,
        durationMs: reportCase.durationMs,
        costUsd: reportCase.costUsd,
        costSource: reportCase.costSource,
        traceId: reportCase.traceId,
        input: { message: redactForReport(reportCase.message), account: reportCase.account },
        expected: {
          intent: reportCase.expected.intent,
          decision: reportCase.expected.decision,
          route: reportCase.expected.route,
          proposedAction: reportCase.expected.proposedAction,
          mustEscalate: reportCase.expected.mustEscalate,
          requiredPolicyIds: reportCase.expected.requiredPolicyIds,
        },
        output:
          reportCase.output === null
            ? null
            : {
                ...reportCase.output,
                customerReply: redactForReport(reportCase.output.customerReply),
              },
        rules: reportCase.rules,
        fixLayers: suggestFixLayers(reportCase.rules, reportCase.executionError),
      })),
  };
}
