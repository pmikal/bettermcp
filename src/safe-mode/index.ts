export type { SimConfidence } from './sim-confidence.js'
export type { SimulationResult, SimulateOptions } from './simulator.js'
export { extractResponseSchema, simulateResponse } from './simulator.js'
export type { VariantStrategy } from './variant-strategy.js'
export { firstVariantStrategy } from './variant-strategy.js'

import type { SafeModeConfig } from '../config/schema.js'
import type { FeedbackStore } from '../store/feedback-store.js'
import { matchesTemplatePath } from './path-matcher.js'

const MUTATIVE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function normalizePath(path: string): string {
  // Strip trailing slashes (but keep root /)
  const trimmed = path.replace(/\/+$/, '') || '/'
  return trimmed
}

/**
 * Determines whether a given endpoint should be simulated based on safe-mode config.
 *
 * Resolution order:
 * 1. Promotion log override — if the endpoint has been promoted to live, return false
 * 2. Per-endpoint override (safeMode.endpoints["METHOD /path"])
 * 3. Global mutativeEndpoints setting (applies to POST/PUT/PATCH/DELETE only)
 * 4. Default: live
 */
export function shouldSimulate(
  method: string,
  path: string,
  safeMode?: SafeModeConfig,
  store?: FeedbackStore,
): boolean {
  if (!safeMode) return false

  const key = `${method.toUpperCase()} ${normalizePath(path)}`

  // Check promotion_log for runtime override (immediate effect without restart)
  if (store) {
    const promotions = store.getPromotionLog(key)
    if (promotions.length > 0 && promotions[0]!.to_state === 'live') {
      return false
    }
  }

  // Check per-endpoint override (supports parameterized paths like /orders/{id})
  const upperMethod = method.toUpperCase()
  const normalizedPath = normalizePath(path)
  if (safeMode.endpoints) {
    for (const [configKey, mode] of Object.entries(safeMode.endpoints)) {
      const spaceIdx = configKey.indexOf(' ')
      const configMethod = configKey.slice(0, spaceIdx)
      const configPath = configKey.slice(spaceIdx + 1)
      if (configMethod === upperMethod && matchesTemplatePath(configPath, normalizedPath)) {
        return mode === 'simulate'
      }
    }
  }

  // Check global mutativeEndpoints setting
  if (
    safeMode.mutativeEndpoints === 'simulate' &&
    MUTATIVE_METHODS.has(method.toUpperCase())
  ) {
    return true
  }

  // Default: live
  return false
}
