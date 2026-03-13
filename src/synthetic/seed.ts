/**
 * Converts analyzer findings to SignalEntry records and persists them to the store.
 */

import { randomUUID } from 'node:crypto'
import type { FeedbackStore } from '../store/feedback-store.js'
import type { SignalEntry } from '../types/store.js'
import type { AnalyzerFinding } from './analyzer.js'

/**
 * Seed synthetic signals into the store from analyzer findings.
 * Each finding becomes a SignalEntry with provenance 'synthetic' and observation_count 0.
 * Returns the number of signals persisted.
 */
export function seedSyntheticSignals(
  findings: AnalyzerFinding[],
  store: FeedbackStore,
): number {
  const now = new Date().toISOString()
  let count = 0

  for (const finding of findings) {
    const signal: SignalEntry = {
      id: randomUUID(),
      endpoint_path: `${finding.method.toUpperCase()} ${finding.endpointPath}`,
      category: finding.category.category,
      severity: finding.category.severity,
      confidence: finding.confidence,
      observation_count: 0,
      first_seen: now,
      last_seen: now,
      provenance: 'synthetic',
      message: finding.message,
      suggestion: null,
      expired: false,
    }

    try {
      store.insertSignal(signal)
      count++
    } catch (err) {
      process.stderr.write(
        `[bettermcp] failed to persist synthetic signal for ${finding.endpointPath}: ${err}\n`,
      )
    }
  }

  return count
}

/** Threshold of real wire log observations before synthetic signals expire. */
export const EXPIRY_OBSERVATION_THRESHOLD = 10

/** Escape SQL LIKE wildcard characters so they match literally. */
function escapeLike(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}

/**
 * Expire synthetic signals for endpoints that have enough real wire log observations.
 * For each unique endpoint path, counts wire_logs and expires synthetic signals
 * when the threshold is met.
 * Returns the total number of signals expired.
 */
export function expireSyntheticSignals(
  store: FeedbackStore,
  endpointPaths: string[],
): number {
  let total = 0

  for (const path of endpointPaths) {
    const logs = store.query({ endpoint_path: path, limit: EXPIRY_OBSERVATION_THRESHOLD })
    if (logs.length >= EXPIRY_OBSERVATION_THRESHOLD) {
      // Expire synthetic signals matching any method for this path
      // Signals are stored as "METHOD /path", so use LIKE pattern "% /path"
      const escaped = escapeLike(path)
      const expired = store.expireSyntheticSignals(`% ${escaped}`)
      if (expired > 0) {
        process.stderr.write(
          `[bettermcp] expired ${expired} synthetic signal(s) for ${path} (${logs.length} real observations)\n`,
        )
      }
      total += expired
    }
  }

  return total
}
