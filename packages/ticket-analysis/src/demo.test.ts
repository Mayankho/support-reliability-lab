import { describe, expect, it } from 'vitest';
import { runTicketDemo } from './demo.ts';

const result = runTicketDemo();
const find = (id: string) => result.artifact.threads.find((t) => t.threadId === id);

describe('ticket triage demo', () => {
  it('passes its own leak check', () => {
    expect(result.leaks).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('rejects the malformed record and reports grouping anomalies', () => {
    expect(result.artifact.parse.rejected).toEqual([
      { index: 40, code: 'UNKNOWN_AUTHOR_ROLE', field: 'author.type' },
    ]);
    expect(find('demo-t10')?.anomalies).toContain('input_out_of_order');
    expect(find('demo-t17')?.anomalies).toContain('duplicate_ticket_id');
  });

  it('shows opposite primary issues for the same failed-job facts', () => {
    expect([find('demo-t01')?.primaryL2, find('demo-t02')?.primaryL2]).toEqual([
      'CRD-01',
      'PRC-01',
    ]);
  });

  it('separates what the customer reported from trusted synthetic state', () => {
    expect(find('demo-t01')?.confirmedL3).toBe('CRD-01a');
    expect(find('demo-t03')?.confirmedL3).toBeNull();
    expect(find('demo-t03')?.safeReasonCodes).toContain('customer_report_contradicts_state');
  });

  it('flags the outage cluster but not the lone report', () => {
    const outages = result.artifact.threads.filter((t) => t.flags.some((f) => f.code === 'F-OUT'));
    expect(outages.map((t) => t.threadId)).toEqual([
      'demo-t28',
      'demo-t29',
      'demo-t30',
      'demo-t31',
      'demo-t32',
    ]);
    expect(find('demo-t33')?.flags).toEqual([]);
  });

  it('reports agreement with explicit denominators and the label status', () => {
    const { agreement } = result.artifact;
    expect(agreement.labelStatus).toBe('author_labeled_development_set');
    expect(agreement.threads).toBe(33);
    expect(agreement.exactPrimary.denominator).toBe(30);
    expect(agreement.abstention.expected).toBe(3);
    expect(result.lines.join('\n')).toMatch(/consistency, not accuracy/u);
  });
});
