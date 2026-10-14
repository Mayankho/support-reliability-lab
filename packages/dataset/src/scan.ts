export type ScanFindingKind =
  'private_key' | 'access_token' | 'email' | 'phone' | 'payment_card' | 'connection_password';

export interface ScanFinding {
  path: string;
  line: number;
  kind: ScanFindingKind;
}

/** Reserved documentation domains (RFC 2606) are allowed in examples. */
const EXAMPLE_EMAIL = /@(?:[a-z0-9-]+\.)*example\.(com|org|net|invalid)$/iu;
/** Local synthetic development credentials used by compose.yaml and test fixtures. */
const KNOWN_LOCAL_PASSWORDS = new Set(['app', '***']);

const PATTERNS: ReadonlyArray<{ kind: ScanFindingKind; pattern: RegExp }> = [
  {
    kind: 'private_key',
    pattern: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/u,
  },
  {
    kind: 'access_token',
    pattern:
      /\b(?:sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{20,})/u,
  },
  {
    kind: 'phone',
    pattern: /(?<![\w.-])(?:\+?1[\s.-])?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\w.-])/u,
  },
];

function luhn(digits: string): boolean {
  let sum = 0;
  for (let index = 0; index < digits.length; index += 1) {
    let digit = Number(digits[digits.length - 1 - index]);
    if (index % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Scans text and returns finding kinds per line. Values are never returned. */
export function scanText(path: string, text: string): ScanFinding[] {
  const findings: ScanFinding[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    const add = (kind: ScanFindingKind) => findings.push({ path, line: index + 1, kind });
    for (const { kind, pattern } of PATTERNS) {
      if (pattern.test(line)) add(kind);
    }
    const withoutUrls = line.replace(/[a-z][a-z0-9+.-]*:\/\/\S+/giu, ' ');
    for (const match of withoutUrls.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu)) {
      if (!EXAMPLE_EMAIL.test(match[0]) && !/^[^@]+@[\d.]+$/u.test(match[0])) add('email');
    }
    for (const match of line.matchAll(/(?<![\d-])(?:\d[ -]?){13,19}(?![\d-])/gu)) {
      const digits = match[0].replace(/[ -]/gu, '');
      if (digits.length >= 13 && digits.length <= 19 && /[ -]/u.test(match[0]) && luhn(digits))
        add('payment_card');
    }
    for (const match of line.matchAll(/postgres(?:ql)?:\/\/[^:/@\s]+:([^@\s]+)@/gu)) {
      if (!KNOWN_LOCAL_PASSWORDS.has(match[1] ?? '')) add('connection_password');
    }
  }
  return findings;
}
