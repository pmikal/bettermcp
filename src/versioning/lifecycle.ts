/**
 * Version lifecycle state machine — enforces formally correct transitions.
 *
 * Valid transitions (unidirectional):
 *   active → deprecated → sunset
 *
 * No reverse transitions. No skipping states.
 */

import { createError } from '../errors/index.js'
import type { VersionState } from '../types/store.js'

/**
 * Set of valid (from, to) transitions.
 * Stored as "from:to" strings for O(1) lookup.
 */
const VALID_TRANSITIONS = new Set<string>([
  'active:deprecated',
  'deprecated:sunset',
])

/**
 * Validates a state transition. Throws VERSION_INVALID_TRANSITION if invalid.
 */
export function validateTransition(from: VersionState, to: VersionState): void {
  if (!VALID_TRANSITIONS.has(`${from}:${to}`)) {
    throw createError('VERSION_INVALID_TRANSITION', from, to)
  }
}

/**
 * Metadata attached when a version is deprecated.
 * Provides migration guidance for agents.
 */
export interface DeprecationInfo {
  /** SHA of the version agents should migrate to. */
  migrateToSha: string
  /** ISO timestamp when the version was deprecated. */
  deprecatedAt: string
  /** Optional human-readable migration message. */
  message?: string
}
