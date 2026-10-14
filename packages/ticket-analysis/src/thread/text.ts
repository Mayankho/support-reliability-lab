/** Lowercases and folds quotes and whitespace so rules match regardless of formatting. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc`]/gu, "'")
    .replace(/[\u201c\u201d]/gu, '"')
    .toLowerCase()
    .replace(/\s+/gu, ' ')
    .trim();
}

const HISTORY_HEADERS = [
  /^\s*on .{1,200} wrote:\s*$/iu,
  /^\s*el .{1,200} escribió:\s*$/iu,
  /^\s*le .{1,200} a écrit\s*:\s*$/iu,
  /^\s*am .{1,200} schrieb .{0,200}:\s*$/iu,
  /^\s*-{2,}\s*(?:original message|forwarded message|mensaje original|message d'origine|ursprüngliche nachricht)\s*-{2,}\s*$/iu,
];
const SIGNATURE = [/^\s*--\s*$/u, /^\s*sent from my \S+/iu];

/**
 * Splits a customer message into the part written now and quoted history. Quoted lines, reply
 * headers and everything after them, and signatures are history: never the customer's current need.
 */
export function stripQuotedHistory(body: string): { current: string; removedHistory: boolean } {
  const kept: string[] = [];
  let removedHistory = false;
  for (const line of body.split(/\r?\n/u)) {
    if (/^\s*>/u.test(line)) {
      removedHistory = true;
      continue;
    }
    if (HISTORY_HEADERS.some((pattern) => pattern.test(line))) {
      removedHistory = true;
      break;
    }
    if (SIGNATURE.some((pattern) => pattern.test(line))) break;
    kept.push(line);
  }
  return { current: kept.join('\n').trim(), removedHistory };
}

export type SecretKind = 'api_key' | 'access_token' | 'password' | 'payment_card';

interface Span {
  kind: SecretKind;
  start: number;
  end: number;
}

const SECRET_PATTERNS: ReadonlyArray<{ kind: SecretKind; pattern: RegExp; group?: number }> = [
  { kind: 'api_key', pattern: /\b[a-z]{2,10}_(?:live|test|prod)_[A-Za-z0-9]{16,}\b/gu },
  { kind: 'api_key', pattern: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/gu },
  { kind: 'api_key', pattern: /\bkey_[A-Za-z0-9]{16,}\b/gu },
  {
    kind: 'api_key',
    pattern: /\b(?:api[ _-]?key|secret|token)\b\s*(?:is|:|=)\s*["']?([A-Za-z0-9._-]{12,})/giu,
    group: 1,
  },
  {
    kind: 'access_token',
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/gu,
  },
  { kind: 'access_token', pattern: /\bbearer\s+([A-Za-z0-9._-]{16,})/giu, group: 1 },
  {
    kind: 'password',
    pattern:
      /\b(?:password|passcode|contraseña|mot de passe|passwort)\b\s*(?:is|es|est|ist|:|=)\s*["']?(\S{4,})/giu,
    group: 1,
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

function secretSpans(text: string): Span[] {
  const spans: Span[] = [];
  for (const { kind, pattern, group } of SECRET_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      const value = group === undefined ? match[0] : match[group];
      if (value === undefined) continue;
      const start = match.index + match[0].lastIndexOf(value);
      spans.push({ kind, start, end: start + value.length });
    }
  }
  for (const match of text.matchAll(/(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/gu)) {
    const digits = match[0].replace(/[ -]/gu, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
      spans.push({ kind: 'payment_card', start: match.index, end: match.index + match[0].length });
    }
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged.at(-1);
    if (last !== undefined && span.start < last.end) {
      last.end = Math.max(last.end, span.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}

/** The secret-like values themselves. Only for leak self-checks; never print or store the result. */
export function secretValues(text: string): string[] {
  return secretSpans(text).map((span) => text.slice(span.start, span.end));
}

/** Kinds of secret-like values present. The values themselves are never returned. */
export function detectSecrets(text: string): SecretKind[] {
  return [...new Set(secretSpans(text).map((span) => span.kind))].sort();
}

/** Replaces secret-like values and email addresses with typed placeholders. */
export function redactForDisplay(text: string): string {
  let result = text;
  for (const span of secretSpans(text).reverse()) {
    result = `${result.slice(0, span.start)}[redacted:${span.kind}]${result.slice(span.end)}`;
  }
  return result.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/gu, '[redacted:email]');
}
