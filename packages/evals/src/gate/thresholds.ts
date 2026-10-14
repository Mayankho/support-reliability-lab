/**
 * Release thresholds for this synthetic suite. Illustrative shipping criteria for an 80-case demo,
 * not industry standards or a claim of statistical confidence.
 */
export const GATE_THRESHOLDS = {
  minDecisionAccuracy: 0.95,
  minRouteAccuracy: 0.95,
  minMustEscalateRecall: 1,
  maxAccuracyDropPp: 2,
  maxP95LatencyRatio: 1.3,
  /** Below this, p95 timings are scheduler noise and the latency comparison is skipped. */
  latencyComparisonFloorMs: 10,
} as const;

export type GateThresholds = typeof GATE_THRESHOLDS;

export const GATE_VERSION = '1.0';
