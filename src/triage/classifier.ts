/**
 * Triage classifier — reads signals from the store and produces a classification report.
 * Groups signals by category, applies confidence thresholds (FR24), and orders by severity.
 */

import type { FeedbackStore } from '../store/feedback-store.js'
import type { SignalEntry } from '../types/store.js'
import { getCategoryDefinition, type Severity } from './severity.js'

/** A single classification entry in the triage report. */
export interface ClassificationEntry {
  category: string
  severity: Severity
  description: string
  confidence: number
  observationCount: number
  endpoints: string[]
  provenance: Array<'wire-log' | 'synthetic' | 'agent-reported'>
  firstSeen: string
  lastSeen: string
}

/** The full triage classification report. */
export interface ClassificationReport {
  entries: ClassificationEntry[]
  totalSignals: number
  filteredByThreshold: number
}

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  medium: 1,
  low: 2,
}

/**
 * Classify all active signals from the store into a triage report.
 * Signals below their category's confidence threshold are filtered out (FR24).
 */
export function classify(store: FeedbackStore): ClassificationReport {
  const signals = store.getAllSignals()

  if (signals.length === 0) {
    return { entries: [], totalSignals: 0, filteredByThreshold: 0 }
  }

  // Group signals by category
  const grouped = new Map<string, SignalEntry[]>()
  for (const signal of signals) {
    const existing = grouped.get(signal.category)
    if (existing) {
      existing.push(signal)
    } else {
      grouped.set(signal.category, [signal])
    }
  }

  const entries: ClassificationEntry[] = []
  let filteredByThreshold = 0

  for (const [category, categorySignals] of grouped) {
    const def = getCategoryDefinition(category)

    // Aggregate across all signals in this category
    const maxConfidence = categorySignals.reduce(
      (max, s) => (s.confidence > max ? s.confidence : max),
      -Infinity,
    )
    const totalObservations = categorySignals.reduce((sum, s) => sum + s.observation_count, 0)
    const endpoints = [...new Set(categorySignals.map((s) => s.endpoint_path))]
    const provenances = [...new Set(categorySignals.map((s) => s.provenance))]
    const firstSeen = categorySignals.reduce(
      (earliest, s) => (s.first_seen < earliest ? s.first_seen : earliest),
      categorySignals[0]!.first_seen,
    )
    const lastSeen = categorySignals.reduce(
      (latest, s) => (s.last_seen > latest ? s.last_seen : latest),
      categorySignals[0]!.last_seen,
    )

    // Apply confidence threshold (FR24)
    const threshold = def?.confidenceThreshold ?? 0.3
    if (maxConfidence < threshold) {
      filteredByThreshold += categorySignals.length
      continue
    }

    entries.push({
      category,
      severity: def?.severity ?? 'low',
      description: def?.description ?? category,
      confidence: maxConfidence,
      observationCount: totalObservations,
      endpoints,
      provenance: provenances,
      firstSeen,
      lastSeen,
    })
  }

  // Sort by severity (critical first), then by observation count descending
  entries.sort((a, b) => {
    const sevDiff = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
    if (sevDiff !== 0) return sevDiff
    return b.observationCount - a.observationCount
  })

  return {
    entries,
    totalSignals: signals.length,
    filteredByThreshold,
  }
}
