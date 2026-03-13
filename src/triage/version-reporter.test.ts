import { describe, it, expect, vi } from 'vitest'
import { buildVersionReport } from './version-reporter.js'
import type { FeedbackStore } from '../store/feedback-store.js'
import type { VersionStateEntry } from '../types/store.js'

function createMockStore(
  versionStates: VersionStateEntry[],
  overrides?: Partial<FeedbackStore>,
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
    getVersionStates: vi.fn().mockReturnValue(versionStates),
    insertVersionState: vi.fn(),
    updateVersionState: vi.fn(),
    logPromotion: vi.fn(),
    getPromotionLog: vi.fn().mockReturnValue([]),
    countWireLogs: vi.fn().mockReturnValue(0),
    purgeWireLogsOlderThan: vi.fn().mockReturnValue(0),
    expireSyntheticSignals: vi.fn().mockReturnValue(0),
    close: vi.fn(),
    ...overrides,
  }
}

function createVersionState(overrides?: Partial<VersionStateEntry>): VersionStateEntry {
  return {
    id: 'vs-1',
    endpoint_path: 'GET /products',
    version_sha: 'abc123',
    state: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-05T00:00:00.000Z',
    ...overrides,
  }
}

describe('buildVersionReport', () => {
  it('returns empty report when no version states exist (AC5)', () => {
    const store = createMockStore([])
    const report = buildVersionReport(store)

    expect(report.entries).toEqual([])
  })

  it('groups endpoints by version SHA', () => {
    const store = createMockStore([
      createVersionState({ id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'abc123' }),
      createVersionState({ id: 'vs-2', endpoint_path: 'POST /orders', version_sha: 'abc123' }),
    ])
    const report = buildVersionReport(store)

    expect(report.entries).toHaveLength(1)
    expect(report.entries[0].versionSha).toBe('abc123')
    expect(report.entries[0].endpoints).toEqual(['GET /products', 'POST /orders'])
  })

  it('separates different version SHAs into entries', () => {
    const store = createMockStore([
      createVersionState({ id: 'vs-1', version_sha: 'abc123', state: 'active' }),
      createVersionState({ id: 'vs-2', version_sha: 'def456', state: 'deprecated', endpoint_path: 'POST /orders' }),
    ])
    const report = buildVersionReport(store)

    expect(report.entries).toHaveLength(2)
  })

  it('sorts by state: active first, deprecated second, sunset last', () => {
    const store = createMockStore([
      createVersionState({ id: 'vs-1', version_sha: 'sunset1', state: 'sunset' }),
      createVersionState({ id: 'vs-2', version_sha: 'active1', state: 'active', endpoint_path: 'POST /a' }),
      createVersionState({ id: 'vs-3', version_sha: 'deprecated1', state: 'deprecated', endpoint_path: 'GET /b' }),
    ])
    const report = buildVersionReport(store)

    expect(report.entries[0].state).toBe('active')
    expect(report.entries[1].state).toBe('deprecated')
    expect(report.entries[2].state).toBe('sunset')
  })

  it('uses latest updated_at as lastActivity across grouped endpoints', () => {
    const store = createMockStore([
      createVersionState({ id: 'vs-1', version_sha: 'abc123', updated_at: '2026-01-01T00:00:00.000Z' }),
      createVersionState({ id: 'vs-2', version_sha: 'abc123', endpoint_path: 'POST /orders', updated_at: '2026-01-10T00:00:00.000Z' }),
    ])
    const report = buildVersionReport(store)

    expect(report.entries[0].lastActivity).toBe('2026-01-10T00:00:00.000Z')
  })

  it('counts wire logs matching version SHA', () => {
    const store = createMockStore(
      [createVersionState({ version_sha: 'abc123' })],
      {
        countWireLogs: vi.fn().mockReturnValue(2),
      },
    )
    const report = buildVersionReport(store)

    expect(report.entries[0].requestCount).toBe(2)
    expect(store.countWireLogs).toHaveBeenCalledWith({ endpoint_path: 'GET /products', version_sha: 'abc123' })
  })

  it('uses most severe state when endpoints disagree for same version', () => {
    const store = createMockStore([
      createVersionState({ id: 'vs-1', version_sha: 'abc123', state: 'active', endpoint_path: 'GET /products' }),
      createVersionState({ id: 'vs-2', version_sha: 'abc123', state: 'deprecated', endpoint_path: 'POST /orders' }),
    ])
    const report = buildVersionReport(store)

    expect(report.entries).toHaveLength(1)
    expect(report.entries[0].state).toBe('deprecated')
  })

  it('counts signals per endpoint', () => {
    const store = createMockStore(
      [createVersionState({ version_sha: 'abc123' })],
      {
        getSignals: vi.fn().mockReturnValue([
          { id: 's1' },
          { id: 's2' },
        ]),
      },
    )
    const report = buildVersionReport(store)

    expect(report.entries[0].signalCount).toBe(2)
  })
})
