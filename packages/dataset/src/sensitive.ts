export type SensitivePatternKind = 'email' | 'phone' | 'access_token' | 'payment_card';

const PATTERNS: ReadonlyArray<{ kind: SensitivePatternKind; pattern: RegExp }> = [
  { kind: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/u },
  { kind: 'phone', pattern: /(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/u },
  {
    kind: 'access_token',
    pattern:
      /\b(?:sk-[A-Za-z0-9]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/u,
  },
  { kind: 'payment_card', pattern: /\b(?:\d[ -]?){13,19}\b/u },
];

/**
 * Returns the kinds of sensitive-looking values in a line. The matched text itself is never returned.
 */
export function findSensitivePatterns(line: string): SensitivePatternKind[] {
  return PATTERNS.filter(({ pattern }) => pattern.test(line)).map(({ kind }) => kind);
}
