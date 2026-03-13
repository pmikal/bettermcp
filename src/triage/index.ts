export {
  SCHEMA_MISMATCH,
  UNEXPECTED_RESPONSE,
  TIMEOUT,
  MISSING_ERROR_SCHEMA,
  INCONSISTENT_NAMING,
  MISSING_DESCRIPTION,
  PERMISSIVE_SCHEMA,
  MISSING_PAGINATION,
  BREAKING_CHANGE,
  DATA_LOSS,
  DEPRECATION,
  AGENT_REPORTED,
  CATEGORIES,
  CATEGORY_VALUES,
  getCategoryDefinition,
} from './severity.js'

export type { Severity, CategoryDefinition } from './severity.js'

export { classify } from './classifier.js'
export type { ClassificationEntry, ClassificationReport } from './classifier.js'

export { formatReport, formatVersionReport } from './formatter.js'

export { buildVersionReport } from './version-reporter.js'
export type { VersionReportEntry, VersionReport } from './version-reporter.js'

export { formatIssues, formatDryRun } from './issue-formatter.js'
export type { FormattedIssue } from './issue-formatter.js'

export { createGitHubIssues, isGhAvailable } from './github-issues.js'
export type { CreateIssuesResult } from './github-issues.js'
