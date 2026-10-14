import type { AccountContext } from '@srl/contracts';
import type { Plan, ReasonCode, REASONS } from '../plan.ts';

export interface ReplyContext {
  plan: Plan;
  account: AccountContext;
  citedDocIds: readonly string[];
}

export type ReplyCopy = { readonly [R in ReasonCode]: (context: ReplyContext) => string };

export type EscalationReasonCode = {
  [R in ReasonCode]: (typeof REASONS)[R] extends 'escalate' ? R : never;
}[ReasonCode];
