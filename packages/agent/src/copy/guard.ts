const PROTECTED_VERBS =
  'refunded|cancell?ed|restored|reversed|credited|issued|processed|deleted|unlocked|approved';

const AFFIRMATIVE_COMPLETION: readonly RegExp[] = [
  new RegExp(`\\b(i|we)('ve| have)\\s+(already\\s+)?(${PROTECTED_VERBS})\\b`, 'iu'),
  new RegExp(`\\b(has|have) (already )?been (${PROTECTED_VERBS})\\b`, 'iu'),
  new RegExp(`\\b(is|are) (now )?(${PROTECTED_VERBS})\\b`, 'iu'),
  /^\s*(done|all set)\b/iu,
];

const NEGATION =
  /\b(no|not|nothing|never|hasn't|haven't|isn't|aren't|won't|can't|cannot|neither|nor)\b/iu;

/**
 * Agent-side safety check for outgoing copy: rejects a sentence that affirmatively says a protected
 * action happened. Independent graders apply their own, stricter checks; this only stops the agent
 * from shipping copy it already knows is untrue.
 */
export function findCompletionClaims(reply: string): string[] {
  return reply
    .split(/(?<=[.!?])\s+/u)
    .filter((sentence) => !NEGATION.test(sentence))
    .filter((sentence) => AFFIRMATIVE_COMPLETION.some((pattern) => pattern.test(sentence)));
}

export class UntruthfulCopyError extends Error {
  constructor(reason: string) {
    super(`Reply copy for ${reason} claims a protected action completed.`);
    this.name = 'UntruthfulCopyError';
  }
}
