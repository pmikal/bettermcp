import { describe, it, expect, vi } from 'vitest'
import { seedSyntheticSignals, expireSyntheticSignals, EXPIRY_OBSERVATION_THRESHOLD } from './seed.js'
import { MISSING_ERROR_SCHEMA, MISSING_DESCRIPTION } from '../triage/index.js'
import type { FeedbackStore } from '../store/feedback-store.js'
import type { AnalyzerFinding } from './analyzer.js'

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

function createFinding(overrides?: Partial<AnalyzerFinding>): AnalyzerFinding {
  return {
    endpointPath: '/test',
    method: 'GET',
    category: MISSING_ERROR_SCHEMA,
    message: 'Test finding',
    confidence: 0.7,
    ...overrides,
  }
}

describe('seedSyntheticSignals', () => {
  it('creates SignalEntry with correct shape', () => {
    const store = createMockStore()
    const findings = [createFinding()]

    seedSyntheticSignals(findings, store)

    expect(store.insertSignal).toHaveBeenCalledOnce()
    const signal = vi.mocked(store.insertSignal).mock.calls[0][0]
    expect(signal.endpoint_path).toBe('GET /test')
    expect(signal.category).toBe('missing-error-schema')
    expect(signal.severity).toBe('low')
    expect(signal.confidence).toBe(0.7)
    expect(signal.observation_count).toBe(0)
    expect(signal.provenance).toBe('synthetic')
    expect(signal.expired).toBe(false)
    expect(signal.id).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('returns count of persisted signals', () => {
    const store = createMockStore()
    const findings = [createFinding(), createFinding({ endpointPath: '/other' })]

    const count = seedSyntheticSignals(findings, store)
    expect(count).toBe(2)
  })

  it('continues on store failure and returns partial count', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    let callCount = 0
    const store = createMockStore({
      insertSignal: vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) throw new Error('disk full')
      }),
    })

    const count = seedSyntheticSignals([createFinding(), createFinding()], store)

    expect(count).toBe(1) // second succeeds
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('failed to persist'))
    stderrSpy.mockRestore()
  })

  it('uses category severity from definition', () => {
    const store = createMockStore()
    seedSyntheticSignals([createFinding({ category: MISSING_DESCRIPTION })], store)

    const signal = vi.mocked(store.insertSignal).mock.calls[0][0]
    expect(signal.severity).toBe('low')
    expect(signal.category).toBe('missing-description')
  })
})

describe('expireSyntheticSignals', () => {
  it('expires signals when observation threshold is met', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const mockLogs = Array.from({ length: EXPIRY_OBSERVATION_THRESHOLD }, () => ({}))
    const store = createMockStore({
      query: vi.fn().mockReturnValue(mockLogs),
      expireSyntheticSignals: vi.fn().mockReturnValue(2),
    })

    const expired = expireSyntheticSignals(store, ['/products'])

    expect(store.query).toHaveBeenCalledWith({ endpoint_path: '/products', limit: EXPIRY_OBSERVATION_THRESHOLD })
    expect(store.expireSyntheticSignals).toHaveBeenCalledWith('% /products')
    expect(expired).toBe(2)
    stderrSpy.mockRestore()
  })

  it('does not expire when below threshold', () => {
    const store = createMockStore({
      query: vi.fn().mockReturnValue([{}, {}]),
    })

    const expired = expireSyntheticSignals(store, ['/products'])

    expect(store.expireSyntheticSignals).not.toHaveBeenCalled()
    expect(expired).toBe(0)
  })

  it('escapes SQL LIKE wildcards in endpoint paths', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const mockLogs = Array.from({ length: EXPIRY_OBSERVATION_THRESHOLD }, () => ({}))
    const store = createMockStore({
      query: vi.fn().mockReturnValue(mockLogs),
      expireSyntheticSignals: vi.fn().mockReturnValue(1),
    })

    expireSyntheticSignals(store, ['/user_accounts'])

    expect(store.expireSyntheticSignals).toHaveBeenCalledWith('% /user\\_accounts')
    stderrSpy.mockRestore()
  })

  it('handles multiple endpoints independently', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const store = createMockStore({
      query: vi.fn()
        .mockReturnValueOnce(Array.from({ length: 15 }, () => ({})))
        .mockReturnValueOnce([{}]),
      expireSyntheticSignals: vi.fn().mockReturnValue(1),
    })

    const expired = expireSyntheticSignals(store, ['/high-traffic', '/low-traffic'])

    expect(store.expireSyntheticSignals).toHaveBeenCalledTimes(1)
    expect(store.expireSyntheticSignals).toHaveBeenCalledWith('% /high-traffic')
    expect(expired).toBe(1)
    stderrSpy.mockRestore()
  })
})
