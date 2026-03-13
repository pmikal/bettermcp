import { describe, it, expect, vi } from 'vitest'
import { handleVersionDiscovery } from './version-discovery.js'
import type { FeedbackStore } from '../store/feedback-store.js'
import type { DeprecationInfo } from '../versioning/lifecycle.js'

function createMockStore(overrides?: Partial<FeedbackStore>): FeedbackStore {
  return {
    insert: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    getHints: vi.fn().mockReturnValue([]),
    insertSignal: vi.fn(),
    getSignals: vi.fn().mockReturnValue([]),
    getAllSignals: vi.fn().mockReturnValue([]),
    getVersionStates: vi.fn().mockReturnValue([]),
    insertVersionState: vi.fn(),
    updateVersionState: vi.fn(),
    logPromotion: vi.fn(),
    getPromotionLog: vi.fn().mockReturnValue([]),
    countWireLogs: vi.fn().mockReturnValue(0),
    getSignalsBatch: vi.fn().mockReturnValue(new Map()),
    getHintsBatch: vi.fn().mockReturnValue(new Map()),
    purgeWireLogsOlderThan: vi.fn().mockReturnValue(0),
    expireSyntheticSignals: vi.fn().mockReturnValue(0),
    close: vi.fn(),
    ...overrides,
  }
}

describe('handleVersionDiscovery', () => {
  it('returns empty array when no version states exist', () => {
    const store = createMockStore()
    expect(handleVersionDiscovery(store)).toEqual([])
  })

  it('returns a single version with activity metrics', () => {
    const store = createMockStore({
      getVersionStates: vi.fn().mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'abc123', state: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-03-01T00:00:00Z' },
      ]),
      query: vi.fn().mockReturnValue([
        { version_sha: 'abc123' },
        { version_sha: 'abc123' },
        { version_sha: 'other' },
      ]),
      getSignals: vi.fn().mockReturnValue([{ id: 'sig-1' }]),
    })

    const results = handleVersionDiscovery(store)

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({
      sha: 'abc123',
      state: 'active',
      endpoints: ['GET /products'],
      lastActivity: '2026-03-01T00:00:00Z',
      requestCount: 2,
      requestCountTruncated: false,
      signalCount: 1,
    })

    expect(store.query).toHaveBeenCalledWith({ endpoint_path: 'GET /products', limit: 10_000 })
    expect(store.getSignals).toHaveBeenCalledWith('GET /products')
  })

  it('groups multiple endpoints under the same version SHA', () => {
    const store = createMockStore({
      getVersionStates: vi.fn().mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'abc123', state: 'active', created_at: '', updated_at: '2026-01-01T00:00:00Z' },
        { id: 'vs-2', endpoint_path: 'POST /orders', version_sha: 'abc123', state: 'active', created_at: '', updated_at: '2026-02-01T00:00:00Z' },
      ]),
    })

    const results = handleVersionDiscovery(store)

    expect(results).toHaveLength(1)
    expect(results[0].endpoints).toEqual(['GET /products', 'POST /orders'])
    expect(results[0].lastActivity).toBe('2026-02-01T00:00:00Z')
    expect(results[0].requestCountTruncated).toBe(false)
  })

  it('returns multiple versions sorted by state priority', () => {
    const store = createMockStore({
      getVersionStates: vi.fn().mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'sunset-v', state: 'sunset', created_at: '', updated_at: '2026-01-01T00:00:00Z' },
        { id: 'vs-2', endpoint_path: 'GET /products', version_sha: 'active-v', state: 'active', created_at: '', updated_at: '2026-03-01T00:00:00Z' },
        { id: 'vs-3', endpoint_path: 'GET /products', version_sha: 'deprecated-v', state: 'deprecated', created_at: '', updated_at: '2026-02-01T00:00:00Z' },
      ]),
    })

    const results = handleVersionDiscovery(store)

    expect(results).toHaveLength(3)
    expect(results[0].sha).toBe('active-v')
    expect(results[1].sha).toBe('deprecated-v')
    expect(results[2].sha).toBe('sunset-v')
  })

  it('uses most severe state when endpoints disagree', () => {
    const store = createMockStore({
      getVersionStates: vi.fn().mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'abc123', state: 'active', created_at: '', updated_at: '' },
        { id: 'vs-2', endpoint_path: 'POST /orders', version_sha: 'abc123', state: 'deprecated', created_at: '', updated_at: '' },
      ]),
    })

    const results = handleVersionDiscovery(store)

    expect(results[0].state).toBe('deprecated')
  })

  it('gracefully degrades when store query throws', () => {
    const store = createMockStore({
      getVersionStates: vi.fn().mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'abc123', state: 'active', created_at: '', updated_at: '2026-01-01T00:00:00Z' },
      ]),
      query: vi.fn().mockImplementation(() => { throw new Error('db error') }),
      getSignals: vi.fn().mockImplementation(() => { throw new Error('db error') }),
    })

    const results = handleVersionDiscovery(store)

    expect(results).toHaveLength(1)
    expect(results[0].requestCount).toBe(0)
    expect(results[0].signalCount).toBe(0)
    expect(results[0].requestCountTruncated).toBe(false)
  })

  it('counts only wire logs matching the version SHA', () => {
    const store = createMockStore({
      getVersionStates: vi.fn().mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'v1', state: 'active', created_at: '', updated_at: '' },
      ]),
      query: vi.fn().mockReturnValue([
        { version_sha: 'v1' },
        { version_sha: 'v2' },
        { version_sha: 'v1' },
        { version_sha: null },
      ]),
    })

    const results = handleVersionDiscovery(store)

    expect(results[0].requestCount).toBe(2)
    expect(store.query).toHaveBeenCalledWith({ endpoint_path: 'GET /products', limit: 10_000 })
  })

  it('sets requestCountTruncated when query hits the limit', () => {
    const logsAtLimit = Array.from({ length: 10_000 }, () => ({ version_sha: 'v1' }))
    const store = createMockStore({
      getVersionStates: vi.fn().mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'v1', state: 'active', created_at: '', updated_at: '' },
      ]),
      query: vi.fn().mockReturnValue(logsAtLimit),
    })

    const results = handleVersionDiscovery(store)

    expect(results[0].requestCountTruncated).toBe(true)
    expect(results[0].requestCount).toBe(10_000)
  })

  it('attaches deprecation guidance when provided', () => {
    const store = createMockStore({
      getVersionStates: vi.fn().mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'old-v', state: 'deprecated', created_at: '', updated_at: '2026-02-01T00:00:00Z' },
      ]),
    })

    const deprecationInfo = new Map<string, DeprecationInfo>([
      ['old-v', { migrateToSha: 'new-v', deprecatedAt: '2026-01-15T00:00:00Z', message: 'Use v2 API' }],
    ])

    const results = handleVersionDiscovery(store, deprecationInfo)

    expect(results[0].deprecation).toEqual({
      migrateToSha: 'new-v',
      deprecatedAt: '2026-01-15T00:00:00Z',
      message: 'Use v2 API',
    })
  })

  it('omits deprecation field when no info is available', () => {
    const store = createMockStore({
      getVersionStates: vi.fn().mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'abc123', state: 'active', created_at: '', updated_at: '' },
      ]),
    })

    const results = handleVersionDiscovery(store)

    expect(results[0].deprecation).toBeUndefined()
  })

  it('deduplicates signals across shared endpoints', () => {
    const store = createMockStore({
      getVersionStates: vi.fn().mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'abc123', state: 'active', created_at: '', updated_at: '' },
        { id: 'vs-2', endpoint_path: 'POST /orders', version_sha: 'abc123', state: 'active', created_at: '', updated_at: '' },
      ]),
      getSignals: vi.fn()
        .mockReturnValueOnce([{ id: 'sig-1' }, { id: 'sig-2' }])
        .mockReturnValueOnce([{ id: 'sig-2' }, { id: 'sig-3' }]),
    })

    const results = handleVersionDiscovery(store)

    // sig-2 appears in both endpoints but should only be counted once
    expect(results[0].signalCount).toBe(3)
  })

  it('sorts versions with same state by most recent activity', () => {
    const store = createMockStore({
      getVersionStates: vi.fn().mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'older-v', state: 'active', created_at: '', updated_at: '2026-01-01T00:00:00Z' },
        { id: 'vs-2', endpoint_path: 'GET /products', version_sha: 'newer-v', state: 'active', created_at: '', updated_at: '2026-03-01T00:00:00Z' },
      ]),
    })

    const results = handleVersionDiscovery(store)

    expect(results).toHaveLength(2)
    expect(results[0].sha).toBe('newer-v')
    expect(results[1].sha).toBe('older-v')
  })
})
