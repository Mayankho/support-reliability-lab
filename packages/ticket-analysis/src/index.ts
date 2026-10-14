export { detectFlags, type EvidenceOrigin, type FlagResult } from './classify/flags.ts';
export {
  applyIncidentFlags,
  DEFAULT_INCIDENT_SETTINGS,
  detectIncidentCandidates,
  type IncidentCandidate,
  type IncidentSettings,
} from './classify/incident.ts';
export { SUPPORTED_LANGUAGES, type Language } from './classify/lexicon.ts';
export { CLASSIFIER_VERSION, ISSUE_RULES } from './classify/rules.ts';
export { syntheticStateSchema, type SyntheticState } from './classify/state.ts';
export { triageThread, type Evidence, type Triage, type TriageOptions } from './classify/triage.ts';
export {
  labelSetSchema,
  scoreAgreement,
  threadLabelSchema,
  type AgreementReport,
  type LabelSet,
  type Ratio,
} from './evaluate/score.ts';
export { groupThreads, THREAD_ANOMALIES, type Thread, type ThreadAnomaly } from './thread/group.ts';
export {
  LIMITS,
  parseMessages,
  rawMessageSchema,
  type Limits,
  type ParsedMessage,
  type ParseResult,
  type RecordIssue,
} from './thread/parse.ts';
export {
  detectSecrets,
  normalizeText,
  redactForDisplay,
  stripQuotedHistory,
  type SecretKind,
} from './thread/text.ts';
export { buildCoverage, CROSSWALK_DOC, type CoverageBuild } from './crosswalk/coverage.ts';
export { issueCoverage, renderCrosswalk, type IssueCoverage } from './crosswalk/render.ts';
export {
  BOUNDARIES,
  COVERAGE_STATUSES,
  crosswalkSchema,
  type CoverageStatus,
  type Crosswalk,
  type CrosswalkGap,
  type CrosswalkRecord,
} from './crosswalk/schema.ts';
export { validateCrosswalk, type CrosswalkIssue } from './crosswalk/validate.ts';
export { DATA_DIR, loadTaxonomy, readTaxonomy } from './taxonomy/load.ts';
export {
  AUTOMATION_SCOPES,
  RISK_FLAG_CODES,
  taxonomySchema,
  type AutomationScope,
  type L2Issue,
  type RiskFlagCode,
  type Taxonomy,
} from './taxonomy/schema.ts';
export {
  validateTaxonomy,
  type TaxonomyIssue,
  type TaxonomyValidation,
  type ValidatedTaxonomy,
} from './taxonomy/validate.ts';
