export type CompletionFindingKind =
  | 'affirmative_completion_language'
  | 'ambiguous_completion_language'
  | 'completion_promise'
  | 'forbidden_claim_phrase';

export interface CompletionFinding {
  kind: CompletionFindingKind;
  sentence: string;
}

const VERBS =
  'refunded|cancell?ed|restored|reversed|credited|reimbursed|returned|issued|processed|approved|deleted|unlocked|completed|submitted|won';

/** A verb followed by an apostrophe is a contraction ("won't"), not the past tense. */
const VERB = `(${VERBS})\\b(?!')`;

const AFFIRMATIVE: readonly RegExp[] = [
  new RegExp(
    `\\b(i|we)\\s*(have|'ve|had|'d)?\\s+((just|already|now|successfully)\\s+)*${VERB}`,
    'u',
  ),
  new RegExp(`\\b(i|we)('ve|'d)\\s+((just|already|now|successfully)\\s+)*${VERB}`, 'u'),
  new RegExp(
    `\\b(refund|refunds|cancellation|subscription|credits?|payment|money|chargeback|restoration|account|plan|renewal|purchase|request|dispute)\\b[^.;,]{0,40}?\\b(has|have|is|are|was|were)\\s+((now|already|successfully|been|just)\\s+)*${VERB}`,
    'u',
  ),
];

const AMBIGUOUS: readonly RegExp[] = [
  /^\s*(done|all set|all done|sorted)\b/u,
  /\brefund\s+(completed|processed|issued|sent|successful|approved)\b/u,
  /\b(went through|is on (its|the) way|taken care of|been handled|been sorted|is complete|is done)\b/u,
];

const PROMISE: readonly RegExp[] = [
  /\byou('ll| will)\s+(see|receive|get)\b[^.;]*\b(refund|money|credits?|payment|funds)\b/u,
  new RegExp(`\\bwill\\s+be\\s+${VERB}`, 'u'),
];

const NEGATION = /\b(not|no|never|nothing|none|neither|nor|without|cannot)\b|n't\b/u;
const HYPOTHETICAL = /\b(if|once|when|after|unless|whether|would|could|might|should|may)\b/u;
const ATTRIBUTION =
  /\b(you|they|the customer|your message|your note|the dashboard|the page|the email|it)\s+(said|says|wrote|writes|asked|mentioned|claims?|claimed|shows?|showed|reads?|stated)\b|\baccording to\b|\byou quoted\b/u;
const QUOTED = /"[^"]*"/gu;

function normalize(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02BC]/gu, "'")
    .replace(/[\u201C\u201D]/gu, '"')
    .toLowerCase();
}

/** End index of the first match, or -1. Negation or a condition only counts if it comes before that point. */
function matchEnd(clause: string, patterns: readonly RegExp[]): number {
  for (const pattern of patterns) {
    const match = pattern.exec(clause);
    if (match !== null) {
      return match.index + match[0].length;
    }
  }
  return -1;
}

function phraseEnd(clause: string, phrases: readonly string[]): number {
  for (const phrase of phrases) {
    const index = clause.indexOf(phrase);
    if (index >= 0) {
      return index + phrase.length;
    }
  }
  return -1;
}

function classifyClause(
  clause: string,
  forbidden: readonly string[],
): CompletionFindingKind | null {
  const candidates: ReadonlyArray<[CompletionFindingKind, number, boolean]> = [
    ['affirmative_completion_language', matchEnd(clause, AFFIRMATIVE), true],
    ['ambiguous_completion_language', matchEnd(clause, AMBIGUOUS), false],
    ['completion_promise', matchEnd(clause, PROMISE), true],
    ['forbidden_claim_phrase', phraseEnd(clause, forbidden), true],
  ];
  for (const [kind, end, conditionCancels] of candidates) {
    if (end < 0) continue;
    const prefix = clause.slice(0, end);
    if (NEGATION.test(prefix)) continue;
    if (conditionCancels && HYPOTHETICAL.test(prefix)) continue;
    return kind;
  }
  return null;
}

function clauses(sentence: string): string[] {
  return sentence.split(/[,;:]|\s-\s|\s\u2014\s|\bbut\b/u).map((clause) => clause.trim());
}

/**
 * Finds customer-facing language that says a protected action already happened (or promises that it
 * will). Negated, attributed-quote, hypothetical, and question sentences are not claims. Quoted text
 * without attribution is still analyzed, so wrapping a claim in quotes does not hide it.
 */
export function findCompletionLanguage(
  reply: string,
  forbiddenClaims: readonly string[] = [],
): CompletionFinding[] {
  const findings: CompletionFinding[] = [];
  const forbidden = forbiddenClaims.map(normalize).filter((phrase) => phrase.trim().length > 0);
  const sentences = normalize(reply)
    .split(/(?<=[.!?])\s+|\n+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

  for (const original of sentences) {
    if (original.endsWith('?')) {
      continue;
    }
    const outsideQuotes = original.replace(QUOTED, ' ');
    const sentence =
      original.includes('"') && ATTRIBUTION.test(outsideQuotes) ? outsideQuotes : original;

    for (const clause of clauses(sentence)) {
      const kind = classifyClause(clause, forbidden);
      if (kind !== null) {
        findings.push({ kind, sentence: original });
        break;
      }
    }
  }
  return findings;
}
