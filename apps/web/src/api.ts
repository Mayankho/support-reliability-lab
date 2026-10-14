import { z } from 'zod';

const ratio = z.object({
  numerator: z.number(),
  denominator: z.number(),
  value: z.number().nullable(),
});

export const runSchema = z.object({
  id: z.string(),
  status: z.string(),
  gateStatus: z.string().nullable(),
  errorCode: z.string().nullable(),
  createdAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  baselineRunId: z.string().nullable(),
  agent: z.object({
    version: z.string(),
    sourceHash: z.string(),
    adapterKind: z.string(),
    sourceCommit: z.string().nullable(),
  }),
  dataset: z.object({ version: z.string(), sha256: z.string(), caseCount: z.number() }),
  policySha256: z.string(),
  evaluatorVersion: z.string(),
});

export const runDetailSchema = runSchema.extend({
  summary: z.object({
    totalCases: z.number(),
    completedCases: z.number(),
    executionErrorCases: z.number(),
    casesWithCriticalFailures: z.number(),
    casesWithErrors: z.number(),
    ruleResultRows: z.number(),
  }),
  metrics: z
    .object({
      decisionAccuracy: ratio,
      routeAccuracy: ratio,
      intentAccuracy: ratio,
      mustEscalateRecall: ratio,
      latencyMs: z.object({
        p50: z.number().nullable(),
        p95: z.number().nullable(),
        max: z.number().nullable(),
      }),
      cost: z.object({ totalUsd: z.number().nullable(), source: z.string() }),
    })
    .nullable(),
});

export const runListSchema = z.object({
  items: z.array(runSchema),
  nextCursor: z.string().nullable(),
});

const ruleResult = z.object({
  ruleId: z.string(),
  verdict: z.string(),
  severity: z.string(),
  evidenceCode: z.string(),
  evidence: z.string(),
});

export const caseListSchema = z.object({
  items: z.array(
    z.object({
      caseId: z.string(),
      category: z.string(),
      risk: z.string(),
      status: z.string(),
      failingRules: z.array(
        z.object({ ruleId: z.string(), verdict: z.string(), severity: z.string() }),
      ),
    }),
  ),
  total: z.number(),
  nextCursor: z.string().nullable(),
});

export const caseDetailSchema = z.object({
  runId: z.string(),
  caseId: z.string(),
  category: z.string(),
  risk: z.string(),
  status: z.string(),
  input: z.object({ message: z.string(), account: z.record(z.string(), z.unknown()) }),
  output: z
    .object({
      intent: z.string(),
      decision: z.string(),
      route: z.string(),
      customerReply: z.string(),
      escalationReason: z.string().nullable(),
      policyCitations: z.array(z.object({ id: z.string(), version: z.string() })),
      proposedAction: z.string(),
      requiresExplicitConfirmation: z.boolean(),
      claimsActionCompleted: z.boolean(),
    })
    .nullable(),
  expected: z
    .object({
      intent: z.string(),
      decision: z.string(),
      route: z.string(),
      proposedAction: z.string(),
      mustEscalate: z.boolean(),
    })
    .nullable()
    .optional(),
  executionError: z.string().nullable(),
  durationMs: z.number(),
  rules: z.array(ruleResult),
  suggestedFixLayers: z.array(z.string()),
  traceId: z.string(),
  trace: z.array(
    z.object({
      spanId: z.string(),
      kind: z.string(),
      attributes: z.unknown(),
      occurredAt: z.string(),
    }),
  ),
});

const delta = z.object({
  baseline: z.number().nullable(),
  candidate: z.number().nullable(),
  deltaPp: z.number().nullable(),
});

export const comparisonSchema = z.object({
  baselineRunId: z.string(),
  candidateRunId: z.string(),
  compatible: z.boolean(),
  incompatibilities: z.array(z.string()),
  newCriticalFailures: z.array(z.object({ caseId: z.string(), ruleId: z.string() })),
  newFailures: z.array(z.object({ caseId: z.string(), ruleIds: z.array(z.string()) })),
  fixedCases: z.array(z.string()),
  unchangedFailures: z.array(z.string()),
  executionErrors: z.array(z.string()),
  metricDeltas: z.object({
    decisionAccuracy: delta,
    routeAccuracy: delta,
    intentAccuracy: delta,
    mustEscalateRecall: delta,
  }),
  latency: z.object({
    baselineP95: z.number().nullable(),
    candidateP95: z.number().nullable(),
    ratio: z.number().nullable(),
    comparable: z.boolean(),
  }),
});

export const gateSchema = z.object({
  gateVersion: z.string(),
  generatedAt: z.string(),
  status: z.enum(['PASS', 'BLOCK', 'ERROR']),
  candidateRunId: z.string(),
  baselineRunId: z.string().nullable(),
  agentVersion: z.string(),
  agentSourceHash: z.string(),
  datasetVersion: z.string(),
  datasetSha256: z.string(),
  policySha256: z.string(),
  evaluatorVersion: z.string(),
  caseCount: z.number(),
  blockers: z.array(z.string()),
  warnings: z.array(z.string()),
  metrics: z.record(z.string(), z.number().nullable()),
  denominators: z.record(z.string(), z.number()),
  thresholds: z.record(z.string(), z.number()),
});

export type Run = z.infer<typeof runSchema>;
export type RunDetail = z.infer<typeof runDetailSchema>;
export type CaseList = z.infer<typeof caseListSchema>;
export type CaseDetail = z.infer<typeof caseDetailSchema>;
export type Comparison = z.infer<typeof comparisonSchema>;
export type Gate = z.infer<typeof gateSchema>;

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const TOKEN_KEY = 'srl.apiToken';

export function getToken(): string {
  return sessionStorage.getItem(TOKEN_KEY) ?? '';
}

export function setToken(token: string): void {
  if (token.trim() === '') sessionStorage.removeItem(TOKEN_KEY);
  else sessionStorage.setItem(TOKEN_KEY, token.trim());
}

const errorBody = z.object({ code: z.string(), message: z.string() });

/** Fetches JSON and validates it; the UI never renders an unvalidated response. */
export async function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  const token = getToken();
  const response = await fetch(path, {
    headers: token === '' ? {} : { authorization: `Bearer ${token}` },
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorBody.safeParse(body);
    throw new ApiFailure(
      response.status,
      parsed.success ? parsed.data.code : 'UNKNOWN',
      parsed.success
        ? parsed.data.message
        : `Request failed with status ${String(response.status)}.`,
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiFailure(502, 'INVALID_RESPONSE', 'The API returned data in an unexpected shape.');
  }
  return parsed.data;
}
