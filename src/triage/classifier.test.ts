import { describe, it, expect, vi } from 'vitest'
import { classify } from './classifier.js'
import type { FeedbackStore } from '../store/feedback-store.js'
import type { SignalEntry } from '../types/store.js'

function createMockStore(signals: SignalEntry[]): FeedbackStore {
  return {
    insert: vi.fn(),
    query: vi.fn().mockReturnValue([]),
    getHints: vi.fn().mockReturnValue([]),
    insertSignal: vi.fn(),
    getSignals: vi.fn().mockReturnValue([]),
    getAllSignals: vi.fn().mockReturnValue(signals),
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
  }
}

function createSignal(overrides?: Partial<SignalEntry>): SignalEntry {
  return {
    id: 'sig-1',
    endpoint_path: 'GET /products',
    category: 'missing-error-schema',
    severity: 'low',
    confidence: 0.7,
    observation_count: 1,
    first_seen: '2026-01-01T00:00:00.000Z',
    last_seen: '2026-01-01T00:00:00.000Z',
    provenance: 'synthetic',
    message: 'No error schemas',
    suggestion: null,
    expired: false,
    ...overrides,
  }
}

describe('classify', () => {
  it('returns empty report for empty store', () => {
    const store = createMockStore([])
    const report = classify(store)

    expect(report.entries).toEqual([])
    expect(report.totalSignals).toBe(0)
    expect(report.filteredByThreshold).toBe(0)
  })

  it('groups signals by category', () => {
    const signals = [
      createSignal({ id: 's1', endpoint_path: 'GET /a', category: 'missing-error-schema' }),
      createSignal({ id: 's2', endpoint_path: 'GET /b', category: 'missing-error-schema' }),
      createSignal({ id: 's3', endpoint_path: 'GET /c', category: 'missing-description' }),
    ]
    const report = classify(createMockStore(signals))

    expect(report.entries).toHaveLength(2)
    const errorSchema = report.entries.find((e) => e.category === 'missing-error-schema')
    expect(errorSchema).toBeDefined()
    expect(errorSchema!.endpoints).toEqual(['GET /a', 'GET /b'])
    expect(errorSchema!.observationCount).toBe(2)
  })

  it('filters signals below confidence threshold (FR24)', () => {
    // BREAKING_CHANGE has threshold 0.8
    const signals = [
      createSignal({
        id: 's1',
        category: 'breaking-change',
        severity: 'critical',
        confidence: 0.5, // below 0.8 threshold
      }),
    ]
    const report = classify(createMockStore(signals))

    expect(report.entries).toHaveLength(0)
    expect(report.filteredByThreshold).toBe(1)
    expect(report.totalSignals).toBe(1)
  })

  it('surfaces high-severity signals when confidence meets threshold', () => {
    const signals = [
      createSignal({
        id: 's1',
        category: 'breaking-change',
        severity: 'critical',
        confidence: 0.9,
      }),
    ]
    const report = classify(createMockStore(signals))

    expect(report.entries).toHaveLength(1)
    expect(report.entries[0].category).toBe('breaking-change')
    expect(report.entries[0].severity).toBe('critical')
  })

  it('sorts entries by severity then observation count', () => {
    const signals = [
      createSignal({ id: 's1', category: 'missing-error-schema', severity: 'low', confidence: 0.7, observation_count: 5 }),
      createSignal({ id: 's2', category: 'schema-mismatch', severity: 'medium', confidence: 0.7, observation_count: 2 }),
      createSignal({ id: 's3', category: 'breaking-change', severity: 'critical', confidence: 0.9, observation_count: 1 }),
    ]
    const report = classify(createMockStore(signals))

    expect(report.entries[0].severity).toBe('critical')
    expect(report.entries[1].severity).toBe('medium')
    expect(report.entries[2].severity).toBe('low')
  })

  it('uses max confidence across signals in same category', () => {
    const signals = [
      createSignal({ id: 's1', category: 'schema-mismatch', confidence: 0.3 }),
      createSignal({ id: 's2', category: 'schema-mismatch', confidence: 0.8, endpoint_path: 'GET /b' }),
    ]
    const report = classify(createMockStore(signals))

    expect(report.entries).toHaveLength(1)
    expect(report.entries[0].confidence).toBe(0.8)
  })

  it('tracks first_seen and last_seen across signals', () => {
    const signals = [
      createSignal({ id: 's1', first_seen: '2026-01-01T00:00:00.000Z', last_seen: '2026-01-05T00:00:00.000Z' }),
      createSignal({ id: 's2', first_seen: '2025-12-15T00:00:00.000Z', last_seen: '2026-01-10T00:00:00.000Z', endpoint_path: 'GET /b' }),
    ]
    const report = classify(createMockStore(signals))

    expect(report.entries[0].firstSeen).toBe('2025-12-15T00:00:00.000Z')
    expect(report.entries[0].lastSeen).toBe('2026-01-10T00:00:00.000Z')
  })

  it('includes provenance types from all signals in category', () => {
    const signals = [
      createSignal({ id: 's1', provenance: 'synthetic' }),
      createSignal({ id: 's2', provenance: 'agent-reported', endpoint_path: 'GET /b' }),
    ]
    const report = classify(createMockStore(signals))

    expect(report.entries[0].provenance).toContain('synthetic')
    expect(report.entries[0].provenance).toContain('agent-reported')
  })

  it('handles unknown categories with default threshold', () => {
    const signals = [
      createSignal({ id: 's1', category: 'custom-agent-category', confidence: 0.5 }),
    ]
    const report = classify(createMockStore(signals))

    // Default threshold is 0.3, so 0.5 should surface
    expect(report.entries).toHaveLength(1)
    expect(report.entries[0].category).toBe('custom-agent-category')
    expect(report.entries[0].severity).toBe('low')
    expect(report.entries[0].description).toBe('custom-agent-category')
  })

  it('carries confidence and observation count on every entry (FR25)', () => {
    const signals = [
      createSignal({ id: 's1', confidence: 0.75, observation_count: 3 }),
      createSignal({ id: 's2', confidence: 0.6, observation_count: 7, endpoint_path: 'POST /b', category: 'schema-mismatch', severity: 'medium' }),
    ]
    const report = classify(createMockStore(signals))

    for (const entry of report.entries) {
      expect(entry.confidence).toBeGreaterThan(0)
      expect(entry.observationCount).toBeGreaterThan(0)
    }
  })
})
