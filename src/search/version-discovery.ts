/**
 * Version discovery — extends search with version lifecycle information.
 * Agent-facing: returns version info optimized for automated consumers.
 */

import type { FeedbackStore } from '../store/feedback-store.js'
import type { DeprecationInfo } from '../versioning/lifecycle.js'

const STATE_PRIORITY: Record<string, number> = { active: 0, deprecated: 1, sunset: 2 }
const QUERY_LIMIT = 10_000

export interface VersionDiscoveryResult {
  sha: string
  state: 'active' | 'deprecated' | 'sunset'
  endpoints: string[]
  lastActivity: string
  requestCount: number
  requestCountTruncated: boolean
  signalCount: number
  deprecation?: {
    migrateToSha: string
    deprecatedAt: string
    message?: string
  }
}

/**
 * Discover all pinned versions with their lifecycle state and activity metrics.
 * Returns an empty array when no version states exist.
 *
 * @param store - Feedback store for version states and activity data
 * @param deprecationInfo - Optional map of SHA → DeprecationInfo from the VersionRouter
 */
export function handleVersionDiscovery(
  store: FeedbackStore,
  deprecationInfo?: Map<string, DeprecationInfo>,
): VersionDiscoveryResult[] {
  const versionStates = store.getVersionStates()

  if (versionStates.length === 0) {
    return []
  }

  // Group version states by SHA
  const grouped = new Map<string, {
    state: 'active' | 'deprecated' | 'sunset'
    endpoints: string[]
    lastActivity: string
  }>()

  for (const vs of versionStates) {
    const existing = grouped.get(vs.version_sha)
    if (existing) {
      existing.endpoints.push(vs.endpoint_path)
      // ISO-8601 strings sort lexicographically — all timestamps in the store use this format
      if (vs.updated_at > existing.lastActivity) {
        existing.lastActivity = vs.updated_at
      }
      // Use the most severe state when endpoints disagree (sunset > deprecated > active)
      // Unknown states default to priority 3 (sorted after sunset)
      if ((STATE_PRIORITY[vs.state] ?? 3) > (STATE_PRIORITY[existing.state] ?? 3)) {
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

  // Aggregate activity metrics per version
  const results: VersionDiscoveryResult[] = []

  for (const [sha, data] of grouped) {
    let requestCount = 0
    let requestCountTruncated = false
    let signalCount = 0
    const seenSignalIds = new Set<string>()

    for (const endpoint of data.endpoints) {
      try {
        const logs = store.query({ endpoint_path: endpoint, limit: QUERY_LIMIT })
        if (logs.length >= QUERY_LIMIT) {
          requestCountTruncated = true
        }
        requestCount += logs.filter((l) => l.version_sha === sha).length
        const signals = store.getSignals(endpoint)
        for (const s of signals) {
          if (!seenSignalIds.has(s.id)) {
            seenSignalIds.add(s.id)
            signalCount++
          }
        }
      } catch {
        // Activity metrics are supplementary — degrade gracefully
      }
    }

    const result: VersionDiscoveryResult = {
      sha,
      state: data.state,
      endpoints: data.endpoints,
      lastActivity: data.lastActivity,
      requestCount,
      requestCountTruncated,
      signalCount,
    }

    // Attach deprecation guidance when available (from VersionRouter in-memory state)
    const depInfo = deprecationInfo?.get(sha)
    if (depInfo) {
      result.deprecation = {
        migrateToSha: depInfo.migrateToSha,
        deprecatedAt: depInfo.deprecatedAt,
        message: depInfo.message,
      }
    }

    results.push(result)
  }

  // Sort: active first, then deprecated, then sunset; tiebreak by most recent activity
  results.sort((a, b) =>
    (STATE_PRIORITY[a.state] ?? 3) - (STATE_PRIORITY[b.state] ?? 3)
    || b.lastActivity.localeCompare(a.lastActivity),
  )

  return results
}
