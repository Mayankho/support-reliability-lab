import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AgentAdapter } from '@srl/contracts';
import { referenceV1 } from './versions/reference-v1.ts';
import { regressionDemoV1 } from './versions/regression-demo-v1.ts';
import { repairedV1 } from './versions/repaired-v1.ts';

export const AGENT_VERSION_IDS = ['reference-v1', 'regression-demo-v1', 'repaired-v1'] as const;
export type AgentVersionId = (typeof AGENT_VERSION_IDS)[number];

export interface AgentVersionInfo {
  version: AgentVersionId;
  adapterKind: 'offline_deterministic';
  description: string;
  sourceFiles: readonly string[];
}

const SHARED_SOURCES = [
  'build-agent.ts',
  'citations.ts',
  'copy/guard.ts',
  'copy/reference.ts',
  'copy/types.ts',
  'plan.ts',
  'signals.ts',
] as const;

export const AGENT_VERSIONS: Readonly<Record<AgentVersionId, AgentVersionInfo>> = {
  'reference-v1': {
    version: 'reference-v1',
    adapterKind: 'offline_deterministic',
    description: 'Baseline rule-based agent following SYN-POLICY-1 precedence.',
    sourceFiles: [...SHARED_SOURCES, 'versions/reference-v1.ts'],
  },
  'regression-demo-v1': {
    version: 'regression-demo-v1',
    adapterKind: 'offline_deterministic',
    description: 'Intentional regression: refund-review reply claims the refund already happened.',
    sourceFiles: [...SHARED_SOURCES, 'copy/regression-demo.ts', 'versions/regression-demo-v1.ts'],
  },
  'repaired-v1': {
    version: 'repaired-v1',
    adapterKind: 'offline_deterministic',
    description: 'Restores truthful refund-review copy and enables the completion-wording guard.',
    sourceFiles: [...SHARED_SOURCES, 'versions/repaired-v1.ts'],
  },
};

const ADAPTERS: Readonly<Record<AgentVersionId, AgentAdapter>> = {
  'reference-v1': referenceV1,
  'regression-demo-v1': regressionDemoV1,
  'repaired-v1': repairedV1,
};

export function isAgentVersionId(value: string): value is AgentVersionId {
  return (AGENT_VERSION_IDS as readonly string[]).includes(value);
}

export function getAgent(version: AgentVersionId): AgentAdapter {
  return ADAPTERS[version];
}

/** SHA-256 over the exact source files that make up a version, so reports pin the code that ran. */
export function agentSourceHash(version: AgentVersionId): string {
  const hash = createHash('sha256');
  for (const file of [...AGENT_VERSIONS[version].sourceFiles].sort()) {
    const contents = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)));
    hash.update(file).update('\0').update(contents).update('\0');
  }
  return hash.digest('hex');
}
