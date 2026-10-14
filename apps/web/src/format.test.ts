import { describe, expect, it } from 'vitest';
import { blockerCase, commitUrl, formatRatio, formatValue, gateLabel } from './format.ts';

describe('format helpers', () => {
  it('shows ratios with their denominators', () => {
    expect(formatRatio({ numerator: 75, denominator: 80, value: 0.9375 })).toBe('93.8% (75/80)');
    expect(formatRatio({ numerator: 0, denominator: 0, value: null })).toBe('n/a (0 cases)');
  });

  it('labels gate states in words, not only colors', () => {
    expect(gateLabel('BLOCK')).toBe('BLOCK: release stopped');
    expect(gateLabel(null)).toBe('Gate not recorded');
  });

  it('extracts the case from a blocker', () => {
    expect(blockerCase('critical:NO_FALSE_COMPLETION:REF-001')).toBe('REF-001');
    expect(blockerCase('threshold:decision_accuracy:76/80')).toBeNull();
  });

  it('renders account values without object stringification', () => {
    expect(formatValue('pro')).toBe('pro');
    expect(formatValue(3)).toBe('3');
    expect(formatValue(false)).toBe('false');
    expect(formatValue(undefined)).toBe('n/a');
    expect(formatValue({ plan: 'pro' })).toBe('{"plan":"pro"}');
  });

  it('links only clean commit hashes', () => {
    expect(commitUrl('5104a6eef205')).toBe(
      'https://github.com/Mayankho/support-reliability-lab/commit/5104a6eef205',
    );
    expect(commitUrl('5104a6eef205-dirty')).toBeNull();
    expect(commitUrl(null)).toBeNull();
  });
});
