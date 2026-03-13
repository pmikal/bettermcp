import { randomUUID } from 'node:crypto'
import type { FeedbackStore } from '../store/feedback-store.js'
import type { SafeModeConfig } from '../config/schema.js'
import { createError } from '../errors/index.js'

const ENDPOINT_KEY_RE =
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/[^\s?#]*$/

export interface PromoteResult {
  promoted: boolean
  alreadyLive: boolean
  endpointKey: string
  message?: string
}

/**
 * Promotes an endpoint from simulate to live mode.
 * Logs the transition to the promotion_log table.
 * Returns alreadyLive: true if the endpoint is not currently simulated.
 */
export function promoteEndpoint(
  method: string,
  path: string,
  store: FeedbackStore,
  safeMode?: SafeModeConfig,
): PromoteResult {
  // Reject query strings and fragments
  if (path.includes('?') || path.includes('#')) {
    throw createError(
      'PROMOTE_INVALID_ENDPOINT',
      `${method.toUpperCase()} ${path}`,
    )
  }

  // Normalize path (strip trailing slashes, match shouldSimulate behavior)
  const normalizedPath = path.replace(/\/+$/, '') || '/'
  const endpointKey = `${method.toUpperCase()} ${normalizedPath}`

  if (!ENDPOINT_KEY_RE.test(endpointKey)) {
    throw createError('PROMOTE_INVALID_ENDPOINT', endpointKey)
  }

  // Warn if safe-mode is not configured
  if (!safeMode) {
    return {
      promoted: false,
      alreadyLive: true,
      endpointKey,
      message:
        'Safe-mode is not configured. All endpoints default to live.',
    }
  }

  // Idempotency: check if already promoted in the log
  const existing = store.getPromotionLog(endpointKey)
  if (existing.length > 0 && existing[0]!.to_state === 'live') {
    return { promoted: false, alreadyLive: true, endpointKey }
  }

  // Check if the endpoint is currently configured as simulate
  const endpointMode = safeMode.endpoints?.[endpointKey]
  const isMutative = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(
    method.toUpperCase(),
  )
  const isSimulated =
    endpointMode === 'simulate' ||
    (endpointMode === undefined &&
      safeMode.mutativeEndpoints === 'simulate' &&
      isMutative)

  if (!isSimulated) {
    return { promoted: false, alreadyLive: true, endpointKey }
  }

  store.logPromotion({
    id: `promo_${randomUUID()}`,
    endpoint_path: endpointKey,
    from_state: 'simulate',
    to_state: 'live',
    promoted_by: 'cli',
    promoted_at: new Date().toISOString(),
    reason: null,
  })

  return { promoted: true, alreadyLive: false, endpointKey }
}
