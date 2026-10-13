import { createHash } from 'node:crypto';

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

export class PolicyParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyParseError';
  }
}

export interface PolicyDocument {
  id: string;
  version: string;
  title: string;
  text: string;
  sha256: string;
}

export interface SyntheticPolicy {
  id: 'SYN-POLICY-1';
  disclaimer: string;
  globalRules: string;
  globalRulesSha256: string;
  documents: readonly PolicyDocument[];
  sha256: string;
}

const DOCUMENT_TITLES = {
  'KB-SEC-001': 'Account identity and handoff',
  'KB-CANCEL-001': 'Cancellation state',
  'KB-REFUND-001': 'Synthetic refund review',
  'KB-CREDIT-001': 'Purchased vs generated credits',
  'KB-GEN-001': 'Generation state and restoration',
  'KB-PRORATE-001': 'Annual-plan changes',
  'KB-TECH-001': 'Provider outage and generation status',
  'KB-KNOW-001': 'Citation provenance',
} as const;

type DocumentId = keyof typeof DOCUMENT_TITLES;

const BULLET_PATTERN = /^- `([A-Z]+-[A-Z]+-[0-9]{3})@([0-9]+\.[0-9]+\.[0-9]+)`: (.+)$/gm;
const DISCLAIMER = 'No relation to Runway policy. Not valid for real customer support.';

export function parseSyntheticPolicy(markdown: string, fileSha256: string): SyntheticPolicy {
  if (!markdown.includes(DISCLAIMER)) {
    throw new PolicyParseError('Policy text must state that it is not Runway policy.');
  }

  const documents: PolicyDocument[] = [];
  const seen = new Set<string>();
  for (const match of markdown.matchAll(BULLET_PATTERN)) {
    const id = match[1];
    const version = match[2];
    const text = match[3];
    if (id === undefined || version === undefined || text === undefined) {
      throw new PolicyParseError('A policy bullet was incomplete.');
    }
    if (seen.has(id)) {
      throw new PolicyParseError(`Duplicate policy document ${id}.`);
    }
    if (!isDocumentId(id)) {
      throw new PolicyParseError(`Unknown policy document ${id}.`);
    }
    seen.add(id);
    documents.push({
      id,
      version,
      title: DOCUMENT_TITLES[id],
      text,
      sha256: sha256(text),
    });
  }

  const expectedIds = Object.keys(DOCUMENT_TITLES).sort();
  const foundIds = documents.map((document) => document.id).sort();
  if (expectedIds.join() !== foundIds.join()) {
    throw new PolicyParseError('Policy documents do not match the SYN-POLICY-1 registry.');
  }

  const globalMatch = /^\*\*Global hard rules\*\*: (.+)$/m.exec(markdown);
  const globalRules = globalMatch?.[1];
  if (globalRules === undefined) {
    throw new PolicyParseError('Policy text is missing global hard rules.');
  }

  return {
    id: 'SYN-POLICY-1',
    disclaimer: DISCLAIMER,
    globalRules,
    globalRulesSha256: sha256(globalRules),
    documents,
    sha256: fileSha256,
  };
}

function isDocumentId(id: string): id is DocumentId {
  return Object.prototype.hasOwnProperty.call(DOCUMENT_TITLES, id);
}
