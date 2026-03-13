/**
 * Triage classification categories — typed constants with severity and confidence metadata.
 *
 * These are a versioned public API surface. Changing category string values
 * or removing categories is a breaking change.
 */

/** Severity levels for signal classification. */
export type Severity = 'critical' | 'medium' | 'low'

/** Metadata for a classification category. */
export interface CategoryDefinition {
  /** Unique category string used in SignalEntry.category and triage output. */
  readonly category: string
  /** Default severity when this category is first detected. */
  readonly severity: Severity
  /** Human-readable description of what this category represents. */
  readonly description: string
  /**
   * Minimum confidence threshold (0–1) at which this category surfaces in triage output.
   * High-severity categories require higher confidence to avoid false alarms (FR24).
   */
  readonly confidenceThreshold: number
}

// ── Category constants ──────────────────────────────────────────────

export const SCHEMA_MISMATCH: CategoryDefinition = {
  category: 'schema-mismatch',
  severity: 'medium',
  description: 'Live API response does not match the OpenAPI spec schema.',
  confidenceThreshold: 0.5,
}

export const UNEXPECTED_RESPONSE: CategoryDefinition = {
  category: 'unexpected-response',
  severity: 'low',
  description: 'Agent-reported unexpected behavior in API response.',
  confidenceThreshold: 0.3,
}

export const TIMEOUT: CategoryDefinition = {
  category: 'timeout',
  severity: 'medium',
  description: 'API endpoint took longer than expected to respond.',
  confidenceThreshold: 0.5,
}

export const MISSING_ERROR_SCHEMA: CategoryDefinition = {
  category: 'missing-error-schema',
  severity: 'low',
  description: 'Endpoint defines success responses but no error response schemas.',
  confidenceThreshold: 0.3,
}

export const INCONSISTENT_NAMING: CategoryDefinition = {
  category: 'inconsistent-naming',
  severity: 'low',
  description: 'Endpoint or field naming does not follow a consistent convention.',
  confidenceThreshold: 0.3,
}

export const MISSING_DESCRIPTION: CategoryDefinition = {
  category: 'missing-description',
  severity: 'low',
  description: 'Endpoint lacks a summary or description in the spec.',
  confidenceThreshold: 0.3,
}

export const PERMISSIVE_SCHEMA: CategoryDefinition = {
  category: 'permissive-schema',
  severity: 'low',
  description: 'Request schema is overly permissive (e.g., additionalProperties: true with no constraints).',
  confidenceThreshold: 0.3,
}

export const MISSING_PAGINATION: CategoryDefinition = {
  category: 'missing-pagination',
  severity: 'low',
  description: 'List endpoint returns unbounded results with no pagination parameters.',
  confidenceThreshold: 0.3,
}

export const BREAKING_CHANGE: CategoryDefinition = {
  category: 'breaking-change',
  severity: 'critical',
  description: 'Detected change that breaks backward compatibility.',
  confidenceThreshold: 0.8,
}

export const DATA_LOSS: CategoryDefinition = {
  category: 'data-loss',
  severity: 'critical',
  description: 'Potential data loss or corruption detected in API behavior.',
  confidenceThreshold: 0.8,
}

export const DEPRECATION: CategoryDefinition = {
  category: 'deprecation',
  severity: 'medium',
  description: 'Endpoint or version is deprecated and should be migrated.',
  confidenceThreshold: 0.5,
}

export const AGENT_REPORTED: CategoryDefinition = {
  category: 'agent-reported',
  severity: 'low',
  description: 'Generic feedback reported by an agent via the report() tool.',
  confidenceThreshold: 0.3,
}

// ── Registry ────────────────────────────────────────────────────────

/**
 * All category definitions. Add new categories here — the CATEGORIES map
 * and CATEGORY_VALUES array are derived automatically.
 */
const ALL_DEFINITIONS: readonly CategoryDefinition[] = [
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
]

/** All defined categories, keyed by category string. */
export const CATEGORIES: ReadonlyMap<string, CategoryDefinition> = new Map(
  ALL_DEFINITIONS.map((def) => [def.category, def]),
)

/** All valid category string values. */
export const CATEGORY_VALUES: readonly string[] = ALL_DEFINITIONS.map((def) => def.category)

/**
 * Look up category metadata by string value.
 * Returns undefined for unknown categories (e.g., free-form agent-reported categories).
 */
export function getCategoryDefinition(category: string): CategoryDefinition | undefined {
  return CATEGORIES.get(category)
}
