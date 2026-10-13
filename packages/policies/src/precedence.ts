export const POLICY_PRECEDENCE = [
  {
    rank: 1,
    id: 'identity_isolation',
    summary:
      'Unauthenticated callers receive no billing or account detail and no protected change. A mismatched actor and workspace is declined and routed to account security.',
  },
  {
    rank: 2,
    id: 'no_execution',
    summary:
      'Refunds, cancellations, credit restorations, and account changes are proposals only. Nothing in this lab executes them or may claim that it did.',
  },
  {
    rank: 3,
    id: 'escalation',
    summary:
      'Disputes, suspected compromise, annual proration, inconsistent ledgers, unsupported policy, and provider outages go to a specialist.',
  },
  {
    rank: 4,
    id: 'distinct_intents',
    summary:
      'Cancel renewal, refund cash, restore credits, and dispute a generation are different requests and stay distinct.',
  },
  {
    rank: 5,
    id: 'refund_review',
    summary:
      'A fictional 14-day window for settled, undisputed, wholly unused purchased credits can be proposed for human refund review. That proposal is not permission to move money.',
  },
  {
    rank: 6,
    id: 'failure_credit',
    summary:
      'A failed generation with a nonzero credit charge can be proposed for restoration review. A completed generation the customer dislikes is not automatically an error.',
  },
  {
    rank: 7,
    id: 'missing_context',
    summary:
      'Ask one useful clarifying question. Do not invent invoices, balances, policy text, or dates.',
  },
  {
    rank: 8,
    id: 'knowledge_provenance',
    summary:
      'Cite only policy ids and versions present in the supplied documents. A missing or stale document means say so, and escalate when the gap matters.',
  },
] as const;

export type PrecedenceRuleId = (typeof POLICY_PRECEDENCE)[number]['id'];
