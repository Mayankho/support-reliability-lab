import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { RULE_IDS, RULE_VERDICTS, CASE_STATUSES, accountContextSchema } from '@srl/contracts';
import { listTraceEvents, loadCaseInputs, loadCaseLabels, loadRunResults, type Db } from '@srl/db';
import { redactForReport, suggestFixLayers } from '@srl/evals';
import { canSeeExpected } from '../auth.ts';
import { requireDb } from '../context.ts';
import { notFound } from '../errors.ts';
import { decodeCursor, encodeCursor, limitSchema } from '../pagination.ts';
import { loadOwnedRun } from './runs.ts';

const listQuerySchema = z
  .object({
    limit: limitSchema,
    cursor: z.string().max(512).optional(),
    status: z.enum(CASE_STATUSES).optional(),
    verdict: z.enum(RULE_VERDICTS).optional(),
    rule: z.enum(RULE_IDS).optional(),
  })
  .strict();
const cursorSchema = z.object({ after: z.string().regex(/^[A-Z]{2,5}-\d{3}$/u) }).strict();
const caseKeySchema = z.string().regex(/^[A-Z]{2,5}-\d{3}$/u);
const storedInputSchema = z.object({ message: z.string(), account: accountContextSchema }).strict();

export function registerCaseRoutes(app: FastifyInstance, db: Db | undefined): void {
  app.get('/api/v1/evaluation-runs/:runId/cases', async (request) => {
    const database = requireDb(db);
    const query = listQuerySchema.parse(request.query);
    const run = await loadOwnedRun(
      database,
      request,
      (request.params as { runId?: unknown }).runId,
    );
    const after =
      query.cursor === undefined ? null : decodeCursor(query.cursor, cursorSchema).after;

    const matching = (await loadRunResults(database, run.id)).filter((result) => {
      if (query.status !== undefined && result.status !== query.status) return false;
      if (query.rule !== undefined || query.verdict !== undefined) {
        return result.rules.some(
          (rule) =>
            (query.rule === undefined || rule.ruleId === query.rule) &&
            (query.verdict === undefined || rule.verdict === query.verdict),
        );
      }
      return true;
    });
    const page = matching
      .filter((result) => after === null || result.caseKey > after)
      .slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map((result) => ({
        caseId: result.caseKey,
        category: result.category,
        risk: result.risk,
        status: result.status,
        executionError: result.executionError,
        durationMs: result.durationMs,
        failingRules: result.rules
          .filter((rule) => rule.verdict === 'fail' || rule.verdict === 'error')
          .map((rule) => ({ ruleId: rule.ruleId, verdict: rule.verdict, severity: rule.severity })),
      })),
      total: matching.length,
      nextCursor:
        last !== undefined && matching.some((result) => result.caseKey > last.caseKey)
          ? encodeCursor({ after: last.caseKey })
          : null,
    };
  });

  app.get('/api/v1/evaluation-runs/:runId/cases/:caseId', async (request) => {
    const database = requireDb(db);
    const params = request.params as { runId?: unknown; caseId?: unknown };
    const run = await loadOwnedRun(database, request, params.runId);
    const caseKey = caseKeySchema.safeParse(params.caseId);
    if (!caseKey.success) throw notFound();

    const result = (await loadRunResults(database, run.id)).find(
      (candidate) => candidate.caseKey === caseKey.data,
    );
    if (result === undefined) throw notFound();
    const input = (await loadCaseInputs(database, run.datasetId)).find(
      (row) => row.caseId === result.caseId,
    );
    if (input === undefined) throw notFound();
    const parsedInput = storedInputSchema.parse(input.input);
    const traces = await listTraceEvents(database, run.id, result.caseId);
    const expected = canSeeExpected(request.principal)
      ? ((await loadCaseLabels(database, run.datasetId)).get(result.caseId) ?? null)
      : undefined;

    return {
      ...(expected === undefined ? {} : { expected }),
      runId: run.id,
      caseId: result.caseKey,
      category: result.category,
      risk: result.risk,
      status: result.status,
      input: { message: redactForReport(parsedInput.message), account: parsedInput.account },
      output: result.output,
      executionError: result.executionError,
      durationMs: result.durationMs,
      rules: result.rules,
      suggestedFixLayers: suggestFixLayers(result.rules, result.executionError),
      traceId: result.traceId,
      trace: traces.map((event) => ({
        spanId: event.spanId,
        kind: event.kind,
        attributes: event.redactedAttributesJson,
        occurredAt: event.occurredAt.toISOString(),
      })),
    };
  });
}
