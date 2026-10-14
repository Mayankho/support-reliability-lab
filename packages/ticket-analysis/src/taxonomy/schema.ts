import { z } from 'zod';

export const RISK_FLAG_CODES = [
  'F-SEC',
  'F-LEG',
  'F-MON',
  'F-CHB',
  'F-ABUSE',
  'F-REG',
  'F-OUT',
  'F-CHURN',
  'F-ENT',
] as const;
export type RiskFlagCode = (typeof RISK_FLAG_CODES)[number];

export const FIX_HOMES = [
  'Code',
  'KB / Docs',
  'Policy',
  'Agent playbook',
  'Route out',
  'Product feedback',
  'None',
] as const;

export const AUTOMATION_TIERS = [
  'A: Automation candidate',
  'B: AI-assisted',
  'C: Human-led',
  'R: Route out',
] as const;

/** The most an automation may do for an issue. None of these permits a protected mutation. */
export const AUTOMATION_SCOPES = [
  'Classify + route',
  'Classify + lookup + safe guidance',
  'Classify + lookup + draft proposal (human approves)',
  'Human only',
] as const;
export type AutomationScope = (typeof AUTOMATION_SCOPES)[number];

export const PRIORITIES = ['P1', 'P2', 'P3', 'P4'] as const;

const text = z.string().min(1).max(600);
const l1Code = z.string().regex(/^[A-Z]{3}$/u);
const l2Code = z.string().regex(/^[A-Z]{3}-\d{2}$/u);
const l3Code = z.string().regex(/^[A-Z]{3}-\d{2}[a-z]$/u);

export const l1DomainSchema = z.strictObject({ code: l1Code, name: text, scope: text });

export const l2IssueSchema = z.strictObject({
  code: l2Code,
  l1Code,
  name: text,
  definition: text,
  useWhen: text,
  notThis: text,
  candidateFixHome: z.enum(FIX_HOMES),
  candidateAutomationTier: z.enum(AUTOMATION_TIERS),
  maxAutomationScope: z.enum(AUTOMATION_SCOPES),
  protectedMutationTypicallyInvolved: z.boolean(),
  candidatePriority: z.enum(PRIORITIES),
  typicalFlags: z.array(z.enum(RISK_FLAG_CODES)).max(RISK_FLAG_CODES.length),
});

export const l3OptionSchema = z.strictObject({
  code: l3Code,
  parentL2: l2Code,
  name: text,
  distinguishingEvidence: text,
  candidateFixHome: z.enum(FIX_HOMES),
});

export const riskFlagSchema = z.strictObject({
  code: z.enum(RISK_FLAG_CODES),
  meaning: text,
  suggestedHandling: text,
});

export const taxonomySchema = z.strictObject({
  taxonomyVersion: z.string().regex(/^[a-z0-9-]+-v\d+\.\d+$/u),
  reviewStatus: z.enum(['draft_not_independently_adjudicated', 'reviewed', 'adjudicated']),
  description: text,
  contents: text,
  metadataInterpretation: text,
  classificationPrinciples: z.strictObject({
    primaryL2: text,
    secondaryL2: text,
    subjectBody: text,
    lastResortTieBreakGroups: z.array(z.array(l1Code).min(1)).min(1),
    riskFlags: text,
    l3: text,
    rootCause: text,
    protectedMutation: text,
    quality: text,
  }),
  l1Domains: z.array(l1DomainSchema).max(100),
  l2Issues: z.array(l2IssueSchema).max(500),
  l3Options: z.array(l3OptionSchema).max(1000),
  riskFlags: z.array(riskFlagSchema).max(RISK_FLAG_CODES.length),
});

export type Taxonomy = z.infer<typeof taxonomySchema>;
export type L1Domain = z.infer<typeof l1DomainSchema>;
export type L2Issue = z.infer<typeof l2IssueSchema>;
export type L3Option = z.infer<typeof l3OptionSchema>;
export type RiskFlag = z.infer<typeof riskFlagSchema>;

export const taxonomyManifestSchema = z.strictObject({
  taxonomyVersion: z.string().min(1).max(100),
  file: z.string().regex(/^[a-z0-9.-]+\.json$/u),
  sha256: z.string().regex(/^[0-9a-f]{64}$/u),
  counts: z.strictObject({
    l1Domains: z.number().int().positive(),
    l2Issues: z.number().int().positive(),
    l3Options: z.number().int().nonnegative(),
    riskFlags: z.number().int().positive(),
  }),
  reviewStatus: z.string().min(1).max(100),
});
export type TaxonomyManifest = z.infer<typeof taxonomyManifestSchema>;
