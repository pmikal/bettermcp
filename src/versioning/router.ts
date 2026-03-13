/**
 * VersionRouter — deterministic SHA-to-endpoint routing for pinned API versions.
 *
 * In-memory Map<sha, VersionEntry> provides O(1) lookup.
 * JS Map operations are synchronous, so concurrent async requests
 * cannot interleave with mutations within a single event loop tick (NFR14).
 */

import { randomUUID } from 'node:crypto'
import { createError } from '../errors/index.js'
import { matchesTemplatePath } from '../utils/path-matcher.js'
import { validateTransition } from './lifecycle.js'
import type { DeprecationInfo } from './lifecycle.js'
import type { ParsedEndpoint } from '../spec/spec-types.js'
import type { FeedbackStore } from '../store/feedback-store.js'
import type { VersionState } from '../types/store.js'

export type { VersionState } from '../types/store.js'
export type { DeprecationInfo } from './lifecycle.js'

interface VersionEntry {
  sha: string
  endpoints: ParsedEndpoint[]
  baseUrl: string
  state: VersionState
  deprecationInfo?: DeprecationInfo
}

export interface RouteResult {
  endpoint: ParsedEndpoint
  baseUrl: string
  versionSha: string
  state: VersionState
  deprecationInfo?: DeprecationInfo
}

export interface VersionInfo {
  sha: string
  state: VersionState
  endpointCount: number
  deprecationInfo?: DeprecationInfo
}

export class VersionRouter {
  private versions = new Map<string, VersionEntry>()

  /**
   * Pin a version — register a SHA with its endpoint set and base URL.
   * Overwrites any previously pinned version with the same SHA.
   * Persists to the store if provided (sunsets old rows for this SHA first).
   */
  pin(sha: string, endpoints: ParsedEndpoint[], baseUrl: string, store?: FeedbackStore): void {
    if (!sha || !sha.trim()) {
      throw createError('CONFIG_INVALID', 'Version SHA must be a non-empty string')
    }
    if (endpoints.length === 0) {
      throw createError('CONFIG_INVALID', `Cannot pin version "${sha}" with zero endpoints`)
    }

    const now = new Date().toISOString()

    // If overwriting, clean up old store rows first
    if (store && this.versions.has(sha)) {
      const existingStates = store.getVersionStates()
      for (const vs of existingStates) {
        if (vs.version_sha === sha) {
          store.updateVersionState(vs.id, 'sunset', now)
        }
      }
    }

    this.versions.set(sha, { sha, endpoints, baseUrl, state: 'active' })

    if (store) {
      for (const ep of endpoints) {
        const endpointKey = `${ep.method.toUpperCase()} ${ep.path}`
        store.insertVersionState({
          id: randomUUID(),
          endpoint_path: endpointKey,
          version_sha: sha,
          state: 'active',
          created_at: now,
          updated_at: now,
        })
      }
    }
  }

  /**
   * Route a request to the correct version.
   * Returns the matched endpoint and base URL with lifecycle state.
   * Throws VERSION_NOT_FOUND if SHA is unknown.
   * Throws VERSION_SUNSET if the version has been sunset.
   * Returns null if no endpoint matches the method+path within the version.
   */
  route(sha: string, method: string, path: string): RouteResult | null {
    const entry = this.versions.get(sha)
    if (!entry) {
      const available = [...this.versions.keys()].join(', ')
      throw createError('VERSION_NOT_FOUND', sha, available)
    }

    // Sunset versions refuse to serve — return structured error with migration guidance
    if (entry.state === 'sunset') {
      const migrateToSha = entry.deprecationInfo?.migrateToSha ?? 'unknown'
      throw createError('VERSION_SUNSET', sha, migrateToSha)
    }

    const normalizedPath = path.replace(/\/+$/, '') || '/'
    const matched = entry.endpoints.find(
      (ep) =>
        ep.method.toUpperCase() === method.toUpperCase() &&
        matchesTemplatePath(ep.path, normalizedPath),
    )

    if (!matched) {
      return null
    }

    return {
      endpoint: matched,
      baseUrl: entry.baseUrl,
      versionSha: sha,
      state: entry.state,
      deprecationInfo: entry.deprecationInfo,
    }
  }

  /**
   * Unpin a version — administrative removal from the router.
   *
   * This is NOT a lifecycle transition — it is a forced removal exempt from
   * the state machine (active → deprecated → sunset). To prevent accidental
   * removal of active versions without migration guidance, only non-active
   * versions (deprecated or sunset) can be unpinned. Active versions must
   * be deprecated first via deprecate().
   *
   * Store rows are marked 'sunset' as cleanup since the version is being removed.
   */
  unpin(sha: string, store?: FeedbackStore): boolean {
    const entry = this.versions.get(sha)
    if (!entry) {
      return false
    }

    // Guard: active versions must go through deprecate() first
    if (entry.state === 'active') {
      throw createError('VERSION_INVALID_TRANSITION', 'active',
        'unpin (deprecate the version first)')
    }

    this.versions.delete(sha)

    // Store cleanup: mark rows as sunset (administrative, not a lifecycle transition)
    if (store) {
      const now = new Date().toISOString()
      const states = store.getVersionStates()
      for (const vs of states) {
        if (vs.version_sha === sha) {
          store.updateVersionState(vs.id, 'sunset', now)
        }
      }
    }

    return true
  }

  /**
   * Update the lifecycle state of a pinned version.
   * Validates that the transition is allowed by the state machine.
   * Throws VERSION_INVALID_TRANSITION for illegal transitions.
   *
   * Note: transitioning to 'deprecated' requires deprecationInfo to be present.
   * Use deprecate() to transition to deprecated with migration metadata.
   */
  setState(sha: string, state: VersionState, store?: FeedbackStore): void {
    const entry = this.versions.get(sha)
    if (!entry) {
      const available = [...this.versions.keys()].join(', ')
      throw createError('VERSION_NOT_FOUND', sha, available)
    }

    validateTransition(entry.state, state)

    // Transitioning to deprecated requires deprecationInfo — use deprecate() instead
    if (state === 'deprecated' && !entry.deprecationInfo) {
      throw createError('VERSION_INVALID_TRANSITION', entry.state,
        'deprecated (use deprecate() to provide migration guidance)')
    }

    const now = new Date().toISOString()
    entry.state = state

    if (store) {
      const states = store.getVersionStates()
      for (const vs of states) {
        if (vs.version_sha === sha) {
          store.updateVersionState(vs.id, state, now)
        }
      }
    }
  }

  /**
   * Deprecate a version — transition from active to deprecated with migration metadata.
   * This is the only way to transition to deprecated state; setState('deprecated')
   * will reject if deprecationInfo is not already set.
   */
  deprecate(sha: string, migrateToSha: string, store?: FeedbackStore, message?: string): void {
    if (!migrateToSha || !migrateToSha.trim()) {
      throw createError('CONFIG_INVALID', 'migrateToSha must be a non-empty version SHA')
    }

    const entry = this.versions.get(sha)
    if (!entry) {
      const available = [...this.versions.keys()].join(', ')
      throw createError('VERSION_NOT_FOUND', sha, available)
    }

    validateTransition(entry.state, 'deprecated')

    const now = new Date().toISOString()
    entry.state = 'deprecated'
    entry.deprecationInfo = {
      migrateToSha,
      deprecatedAt: now,
      message,
    }

    if (store) {
      const states = store.getVersionStates()
      for (const vs of states) {
        if (vs.version_sha === sha) {
          store.updateVersionState(vs.id, 'deprecated', now)
        }
      }
    }
  }

  /**
   * Sunset a version — transition from deprecated to sunset.
   * Convenience method. Preserves existing deprecation info for error messages.
   */
  sunset(sha: string, store?: FeedbackStore): void {
    this.setState(sha, 'sunset', store)
  }

  /**
   * List all registered versions.
   */
  listVersions(): VersionInfo[] {
    return [...this.versions.values()].map((v) => ({
      sha: v.sha,
      state: v.state,
      endpointCount: v.endpoints.length,
      deprecationInfo: v.deprecationInfo,
    }))
  }

  /**
   * Check if a version is registered.
   */
  has(sha: string): boolean {
    return this.versions.has(sha)
  }

  /**
   * Get the number of registered versions.
   */
  get size(): number {
    return this.versions.size
  }

  /**
   * Get the current state of a pinned version.
   */
  getState(sha: string): VersionState | undefined {
    return this.versions.get(sha)?.state
  }

  /**
   * Get the deprecation info for a pinned version, if any.
   */
  getDeprecationInfo(sha: string): DeprecationInfo | undefined {
    return this.versions.get(sha)?.deprecationInfo
  }
}
