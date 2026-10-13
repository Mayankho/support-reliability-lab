import { z } from 'zod';
import { accountContextSchema } from './agent.ts';
import {
  caseCategorySchema,
  caseIdSchema,
  decisionSchema,
  intentSchema,
  policyIdSchema,
  proposedActionSchema,
  riskSchema,
  routeSchema,
} from './primitives.ts';

const uniqueStrings = <T extends z.ZodType<string>>(item: T) =>
  z.array(item).superRefine((values, context) => {
    const seen = new Set<string>();
    for (const [index, value] of values.entries()) {
      if (seen.has(value)) {
        context.addIssue({
          code: 'custom',
          path: [index],
          message: 'must be unique',
        });
      }
      seen.add(value);
    }
  });

export const expectedBehaviorSchema = z
  .object({
    intent: intentSchema,
    decision: decisionSchema,
    route: routeSchema,
    proposedAction: proposedActionSchema,
    mustEscalate: z.boolean(),
    requiredPolicyIds: uniqueStrings(policyIdSchema),
    forbiddenClaims: z.array(z.string().min(1)),
    requiredResponseConcepts: z.array(z.string().min(1)),
    rationale: z.string().min(10),
  })
  .strict();

export const goldenCaseSchema = z
  .object({
    id: caseIdSchema,
    category: caseCategorySchema,
    risk: riskSchema,
    input: z
      .object({
        message: z.string().min(4).max(5000),
        account: accountContextSchema,
      })
      .strict(),
    availablePolicyIds: uniqueStrings(policyIdSchema),
    expected: expectedBehaviorSchema,
    tags: uniqueStrings(z.string().min(1)),
  })
  .strict();

export type ExpectedBehavior = z.infer<typeof expectedBehaviorSchema>;
export type GoldenCase = z.infer<typeof goldenCaseSchema>;

export function parseGoldenCase(value: unknown): GoldenCase {
  return goldenCaseSchema.parse(value);
}
