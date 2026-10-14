export interface RatioLike {
  numerator: number;
  denominator: number;
  value: number | null;
}

export function formatRatio(ratio: RatioLike): string {
  return ratio.value === null
    ? 'n/a (0 cases)'
    : `${(ratio.value * 100).toFixed(1)}% (${String(ratio.numerator)}/${String(ratio.denominator)})`;
}

export function formatMs(value: number | null): string {
  return value === null ? 'n/a' : `${value.toFixed(2)} ms`;
}

export function formatDate(iso: string | null): string {
  return iso === null ? 'n/a' : new Date(iso).toLocaleString();
}

export function formatValue(value: unknown): string {
  if (value === undefined || value === null) return 'n/a';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function shortHash(hash: string, length = 12): string {
  return hash.slice(0, length);
}

/** Extracts the case ID from a blocker such as `critical:NO_FALSE_COMPLETION:REF-001`. */
export function blockerCase(blocker: string): string | null {
  return /:([A-Z]{2,5}-\d{3})$/u.exec(blocker)?.[1] ?? null;
}

export function gateLabel(status: string | null): string {
  switch (status) {
    case 'PASS':
      return 'PASS: release allowed';
    case 'BLOCK':
      return 'BLOCK: release stopped';
    case 'ERROR':
      return 'ERROR: evidence incomplete';
    default:
      return 'Gate not recorded';
  }
}

const COMMIT = /^[0-9a-f]{7,40}$/u;

/** Links to the source commit only when it is a clean commit hash. */
export function commitUrl(commit: string | null): string | null {
  return commit !== null && COMMIT.test(commit)
    ? `https://github.com/Mayankho/support-reliability-lab/commit/${commit}`
    : null;
}
