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
