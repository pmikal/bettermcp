/**
 * Translation handler registry — stores and looks up request/response
 * transformation handlers for versioned API endpoints.
 *
 * Handlers map legacy request/response shapes to the current API version,
 * enabling backward compatibility for agents using old versions.
 */

import { createError } from '../errors/index.js'
import { matchesTemplatePath } from '../utils/path-matcher.js'

/**
 * Developer-facing configuration for registering a translation handler.
 * The `endpoint` field uses "METHOD /path" format (e.g., "POST /orders").
 */
export interface TranslationHandlerConfig {
  version: string
  endpoint: string
  request?: (body: unknown) => unknown | Promise<unknown>
  response?: (body: unknown) => unknown | Promise<unknown>
}

interface StoredHandler {
  version: string
  method: string
  path: string
  request?: (body: unknown) => unknown | Promise<unknown>
  response?: (body: unknown) => unknown | Promise<unknown>
}

/**
 * Result from a handler lookup — contains the transform functions.
 */
export interface TranslationMatch {
  request?: (body: unknown) => unknown | Promise<unknown>
  response?: (body: unknown) => unknown | Promise<unknown>
}

export class TranslationRegistry {
  private handlers: StoredHandler[] = []

  /**
   * Register a translation handler for a version + endpoint combination.
   * Overwrites any previously registered handler for the same version + endpoint.
   */
  registerHandler(config: TranslationHandlerConfig): void {
    if (!config.version || !config.version.trim()) {
      throw createError('CONFIG_INVALID', 'Translation handler version must be a non-empty string')
    }

    const parts = config.endpoint.trim().split(/\s+/)
    if (parts.length !== 2) {
      throw createError(
        'CONFIG_INVALID',
        `Invalid endpoint format: "${config.endpoint}". Expected "METHOD /path" (e.g., "POST /orders")`,
      )
    }

    const method = parts[0]!.toUpperCase()
    const rawPath = parts[1]!

    if (!rawPath.startsWith('/')) {
      throw createError(
        'CONFIG_INVALID',
        `Invalid endpoint path: "${rawPath}". Path must start with "/"`,
      )
    }

    // Normalize path: strip trailing slashes (consistent with lookup normalization)
    const path = rawPath.replace(/\/+$/, '') || '/'

    // Overwrite existing handler for same version + method + path
    this.handlers = this.handlers.filter(
      (h) => !(h.version === config.version && h.method === method && h.path === path),
    )

    this.handlers.push({
      version: config.version,
      method,
      path,
      request: config.request,
      response: config.response,
    })
  }

  /**
   * Look up a translation handler for a version + method + path.
   * Uses path template matching (e.g., /users/{id} matches /users/123).
   * Returns null if no handler is registered.
   */
  lookup(version: string, method: string, requestPath: string): TranslationMatch | null {
    const normalizedPath = requestPath.replace(/\/+$/, '') || '/'
    const handler = this.handlers.find(
      (h) =>
        h.version === version &&
        h.method === method.toUpperCase() &&
        matchesTemplatePath(h.path, normalizedPath),
    )

    if (!handler) return null

    return {
      request: handler.request,
      response: handler.response,
    }
  }

  /**
   * Check if any translation handlers are registered for a version.
   * Note: this checks for ANY handler on the version, regardless of method+path.
   */
  hasAnyHandler(version: string): boolean {
    return this.handlers.some((h) => h.version === version)
  }

  /**
   * Get the number of registered handlers.
   */
  get size(): number {
    return this.handlers.length
  }
}
