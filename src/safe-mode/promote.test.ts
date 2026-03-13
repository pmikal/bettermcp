import { describe, it, expect, vi, beforeEach } from 'vitest'
import { promoteEndpoint } from './promote.js'
import type { FeedbackStore } from '../store/feedback-store.js'
import type { SafeModeConfig } from '../config/schema.js'

function mockStore(
  promotionLog: ReturnType<FeedbackStore['getPromotionLog']> = [],
): FeedbackStore {
  return {
    insert: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    getHints: vi.fn().mockReturnValue([]),
    insertSignal: vi.fn(),
    getSignals: vi.fn().mockReturnValue([]),
    getSignalsBatch: vi.fn().mockReturnValue(new Map()),
    getHintsBatch: vi.fn().mockReturnValue(new Map()),
    getAllSignals: vi.fn().mockReturnValue([]),
    getVersionStates: vi.fn().mockReturnValue([]),
    insertVersionState: vi.fn(),
    updateVersionState: vi.fn(),
    logPromotion: vi.fn(),
    getPromotionLog: vi.fn().mockReturnValue(promotionLog),
    countWireLogs: vi.fn().mockReturnValue(0),
    purgeWireLogsOlderThan: vi.fn().mockReturnValue(0),
    expireSyntheticSignals: vi.fn().mockReturnValue(0),
    close: vi.fn(),
  }
}

describe('promoteEndpoint', () => {
  let store: FeedbackStore

  beforeEach(() => {
    store = mockStore()
  })

  it('promotes a simulated endpoint (per-endpoint config)', () => {
    const safeMode: SafeModeConfig = {
      endpoints: { 'POST /orders': 'simulate' },
    }
    const result = promoteEndpoint('POST', '/orders', store, safeMode)
    expect(result.promoted).toBe(true)
    expect(result.alreadyLive).toBe(false)
    expect(result.endpointKey).toBe('POST /orders')
    expect(store.logPromotion).toHaveBeenCalledOnce()
    const entry = (store.logPromotion as ReturnType<typeof vi.fn>).mock
      .calls[0][0]
    expect(entry.endpoint_path).toBe('POST /orders')
    expect(entry.from_state).toBe('simulate')
    expect(entry.to_state).toBe('live')
    expect(entry.promoted_by).toBe('cli')
    expect(entry.id).toMatch(/^promo_/)
  })

  it('promotes a simulated endpoint (global mutativeEndpoints)', () => {
    const safeMode: SafeModeConfig = {
      mutativeEndpoints: 'simulate',
    }
    const result = promoteEndpoint('PUT', '/items/1', store, safeMode)
    expect(result.promoted).toBe(true)
    expect(result.alreadyLive).toBe(false)
  })

  it('returns alreadyLive for a live endpoint (per-endpoint config)', () => {
    const safeMode: SafeModeConfig = {
      endpoints: { 'POST /orders': 'live' },
    }
    const result = promoteEndpoint('POST', '/orders', store, safeMode)
    expect(result.promoted).toBe(false)
    expect(result.alreadyLive).toBe(true)
    expect(store.logPromotion).not.toHaveBeenCalled()
  })

  it('returns alreadyLive with message when no safeMode config exists', () => {
    const result = promoteEndpoint('POST', '/orders', store, undefined)
    expect(result.promoted).toBe(false)
    expect(result.alreadyLive).toBe(true)
    expect(result.message).toContain('Safe-mode is not configured')
    expect(store.logPromotion).not.toHaveBeenCalled()
  })

  it('returns alreadyLive for GET with mutativeEndpoints=simulate', () => {
    const safeMode: SafeModeConfig = {
      mutativeEndpoints: 'simulate',
    }
    const result = promoteEndpoint('GET', '/items', store, safeMode)
    expect(result.promoted).toBe(false)
    expect(result.alreadyLive).toBe(true)
  })

  it('returns alreadyLive for endpoint not in config and not mutative', () => {
    const safeMode: SafeModeConfig = {
      endpoints: { 'POST /other': 'simulate' },
    }
    const result = promoteEndpoint('GET', '/items', store, safeMode)
    expect(result.promoted).toBe(false)
    expect(result.alreadyLive).toBe(true)
  })

  it('throws catalog error for invalid method', () => {
    expect(() =>
      promoteEndpoint('INVALID', '/orders', store, undefined),
    ).toThrow('BMCP022')
  })

  it('throws catalog error for missing path slash', () => {
    expect(() =>
      promoteEndpoint('POST', 'orders', store, undefined),
    ).toThrow('BMCP022')
  })

  it('throws catalog error for query string in path', () => {
    expect(() =>
      promoteEndpoint('POST', '/orders?status=open', store, undefined),
    ).toThrow('BMCP022')
  })

  it('throws catalog error for fragment in path', () => {
    expect(() =>
      promoteEndpoint('POST', '/orders#section', store, undefined),
    ).toThrow('BMCP022')
  })

  it('normalizes method to uppercase', () => {
    const safeMode: SafeModeConfig = {
      endpoints: { 'POST /orders': 'simulate' },
    }
    const result = promoteEndpoint('post', '/orders', store, safeMode)
    expect(result.promoted).toBe(true)
    expect(result.endpointKey).toBe('POST /orders')
  })

  it('normalizes path by stripping trailing slashes', () => {
    const safeMode: SafeModeConfig = {
      endpoints: { 'POST /orders': 'simulate' },
    }
    const result = promoteEndpoint('POST', '/orders/', store, safeMode)
    expect(result.promoted).toBe(true)
    expect(result.endpointKey).toBe('POST /orders')
  })

  it('per-endpoint override takes precedence over mutativeEndpoints', () => {
    const safeMode: SafeModeConfig = {
      mutativeEndpoints: 'simulate',
      endpoints: { 'POST /orders': 'live' },
    }
    const result = promoteEndpoint('POST', '/orders', store, safeMode)
    expect(result.alreadyLive).toBe(true)
  })

  it('is idempotent — returns alreadyLive if already promoted in log', () => {
    const storeWithPromo = mockStore([
      {
        id: 'promo_existing',
        endpoint_path: 'POST /orders',
        from_state: 'simulate',
        to_state: 'live',
        promoted_by: 'cli',
        promoted_at: '2026-03-11T00:00:00.000Z',
        reason: null,
      },
    ])
    const safeMode: SafeModeConfig = {
      endpoints: { 'POST /orders': 'simulate' },
    }
    const result = promoteEndpoint(
      'POST',
      '/orders',
      storeWithPromo,
      safeMode,
    )
    expect(result.promoted).toBe(false)
    expect(result.alreadyLive).toBe(true)
    expect(storeWithPromo.logPromotion).not.toHaveBeenCalled()
  })
})
