/**
 * Version lifecycle reporter — reads version states and aggregates wire log data per version.
 */

import type { FeedbackStore } from '../store/feedback-store.js'

/** A single version entry in the version report. */
export interface VersionReportEntry {
  versionSha: string
  state: 'active' | 'deprecated' | 'sunset'
  endpoints: string[]
  lastActivity: string
  requestCount: number
  signalCount: number
}

/** The full version lifecycle report. */
export interface VersionReport {
  entries: VersionReportEntry[]
}

const STATE_PRIORITY: Record<string, number> = { active: 0, deprecated: 1, sunset: 2 }

/**
 * Build a version lifecycle report from the store.
 * Returns an empty report when no version states exist (AC5).
 */
export function buildVersionReport(store: FeedbackStore): VersionReport {
  const versionStates = store.getVersionStates()

  if (versionStates.length === 0) {
    return { entries: [] }
  }

  // Group version states by version_sha
  const grouped = new Map<string, {
    state: 'active' | 'deprecated' | 'sunset'
    endpoints: string[]
    lastActivity: string
  }>()

  for (const vs of versionStates) {
    const existing = grouped.get(vs.version_sha)
    if (existing) {
      existing.endpoints.push(vs.endpoint_path)
      if (vs.updated_at > existing.lastActivity) {
        existing.lastActivity = vs.updated_at
      }
      // Use the most severe state when endpoints disagree (sunset > deprecated > active)
      if ((STATE_PRIORITY[vs.state] ?? 0) > (STATE_PRIORITY[existing.state] ?? 0)) {
        existing.state = vs.state
      }
    } else {
      grouped.set(vs.version_sha, {
        state: vs.state,
        endpoints: [vs.endpoint_path],
        lastActivity: vs.updated_at,
      })
    }
  }

  // For each version, count wire logs and signals
  const entries: VersionReportEntry[] = []

  for (const [versionSha, data] of grouped) {
    let requestCount = 0
    let signalCount = 0

    for (const endpoint of data.endpoints) {
      requestCount += store.countWireLogs({ endpoint_path: endpoint, version_sha: versionSha })

      const signals = store.getSignals(endpoint)
      signalCount += signals.length
    }

    entries.push({
      versionSha,
      state: data.state,
      endpoints: data.endpoints,
      lastActivity: data.lastActivity,
      requestCount,
      signalCount,
    })
  }

  // Sort: active first, then deprecated, then sunset
  entries.sort((a, b) => (STATE_PRIORITY[a.state] ?? 3) - (STATE_PRIORITY[b.state] ?? 3))

  return { entries }
}
