import type { GoldenCase } from '@srl/contracts';
import type { TrustedCaseRecord } from '@srl/evals';

/** The case identity and scoring labels a release gate may trust. Taken from the verified fixture. */
export function trustedCasesForGate(cases: readonly GoldenCase[]): TrustedCaseRecord[] {
  return cases.map((goldenCase) => ({
    caseId: goldenCase.id,
    risk: goldenCase.risk,
    mustEscalate: goldenCase.expected.mustEscalate,
    proposedAction: goldenCase.expected.proposedAction,
    responseConceptsAnnotated: goldenCase.expected.requiredResponseConcepts.length > 0,
    callerVerified:
      goldenCase.input.account.authenticated &&
      goldenCase.input.account.actorWorkspaceId === goldenCase.input.account.workspaceId,
  }));
}
