import { z } from 'zod';
import {
  accountContextSchema,
  adapterKindSchema,
  agentOutputSchema,
  caseCategorySchema,
  caseStatusSchema,
  decisionSchema,
  gateStatusSchema,
  intentSchema,
  proposedActionSchema,
  riskSchema,
  routeSchema,
  ruleResultSchema,
} from '@srl/contracts';

export const FIX_LAYERS = [
  'application_code',
  'agent_routing',
  'prompt',
  'knowledge_base',
  'policy',
  'tool_integration',
  'data_quality',
  'evaluator_bug',
] as const;

export const fixLayerSchema = z.enum(FIX_LAYERS);

const sha = z.string().regex(/^[a-f0-9]{64}$/u);

export const reportCaseSchema = z
  .object({
    caseId: z.string().min(1),
    category: caseCategorySchema,
    risk: riskSchema,
    status: caseStatusSchema,
    executionError: z.string().nullable(),
    durationMs: z.number().nonnegative(),
    costUsd: z.number().nonnegative().nullable(),
    costSource: z.enum(['offline_zero', 'model_reported', 'unavailable']),
    traceId: z.string().nullable(),
    input: z.object({ message: z.string(), account: accountContextSchema }).strict(),
    expected: z
      .object({
        intent: intentSchema,
        decision: decisionSchema,
        route: routeSchema,
        proposedAction: proposedActionSchema,
        mustEscalate: z.boolean(),
        requiredPolicyIds: z.array(z.string()),
      })
      .strict(),
    output: agentOutputSchema.nullable(),
    rules: z.array(ruleResultSchema),
    fixLayers: z.array(fixLayerSchema),
  })
  .strict();

export const runReportSchema = z
  .object({
    reportVersion: z.literal('1.0'),
    generatedAt: z.iso.datetime(),
    run: z
      .object({
        id: z.string().min(1),
        status: z.enum(['queued', 'running', 'completed', 'errored', 'cancelled']),
        errorCode: z.string().nullable(),
        startedAt: z.iso.datetime().nullable(),
        finishedAt: z.iso.datetime().nullable(),
      })
      .strict(),
    agent: z
      .object({
        version: z.string().min(1),
        sourceHash: sha,
        adapterKind: adapterKindSchema,
        sourceCommit: z.string().nullable(),
      })
      .strict(),
    dataset: z
      .object({
        version: z.string().min(1),
        sha256: sha,
        caseCount: z.number().int().positive(),
        reviewStatus: z.string(),
      })
      .strict(),
    policy: z.object({ id: z.string().min(1), sha256: sha }).strict(),
    evaluatorVersion: z.string().min(1),
    config: z.record(z.string(), z.number()),
    cases: z.array(reportCaseSchema),
  })
  .strict();

export type FixLayer = z.infer<typeof fixLayerSchema>;
export type ReportCase = z.infer<typeof reportCaseSchema>;
export type RunReport = z.infer<typeof runReportSchema>;

export const gateArtifactSchema = z
  .object({
    gateVersion: z.literal('1.0'),
    generatedAt: z.iso.datetime(),
    status: gateStatusSchema,
    candidateRunId: z.string(),
    baselineRunId: z.string().nullable(),
    agentVersion: z.string(),
    agentSourceHash: sha,
    datasetVersion: z.string(),
    datasetSha256: sha,
    policySha256: sha,
    evaluatorVersion: z.string(),
    caseCount: z.number().int(),
    blockers: z.array(z.string()),
    warnings: z.array(z.string()),
    metrics: z.record(z.string(), z.number().nullable()),
    denominators: z.record(z.string(), z.number().int()),
    thresholds: z.record(z.string(), z.number()),
    comparison: z.unknown().nullable(),
  })
  .strict();

export type GateArtifact = z.infer<typeof gateArtifactSchema>;
