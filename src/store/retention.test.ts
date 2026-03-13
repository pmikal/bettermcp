import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { NodeStore } from './node-store.js'
import { NullStore } from './null-store.js'
import { createStore } from './index.js'
import type { WireLogEntry, SignalEntry } from '../types/store.js'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'

function createEntry(overrides?: Partial<WireLogEntry>): WireLogEntry {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    endpoint_path: '/test',
    method: 'GET',
    request_headers: {},
    request_body: null,
    response_status: 200,
    response_headers: {},
    response_body: null,
    mode: 'live',
    version_sha: null,
    duration_ms: 42,
    provenance: 'wire-log',
    ...overrides,
  }
}

function createOldEntry(daysAgo: number): WireLogEntry {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
  return createEntry({ timestamp: date.toISOString() })
}

describe('NodeStore.purgeWireLogsOlderThan', () => {
  let store: NodeStore
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `bettermcp-retention-test-${randomUUID()}.db`)
    store = new NodeStore(dbPath)
  })

  afterEach(() => {
    store.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('deletes entries older than specified days', () => {
    store.insert(createOldEntry(100))
    store.insert(createOldEntry(50))
    store.insert(createEntry()) // recent

    const purged = store.purgeWireLogsOlderThan(30)

    expect(purged).toBe(2)
    const remaining = store.query({})
    expect(remaining).toHaveLength(1)
  })

  it('keeps entries within retention window', () => {
    store.insert(createOldEntry(10))
    store.insert(createOldEntry(20))
    store.insert(createEntry())

    const purged = store.purgeWireLogsOlderThan(30)

    expect(purged).toBe(0)
    const remaining = store.query({})
    expect(remaining).toHaveLength(3)
  })

  it('returns 0 when no entries to purge', () => {
    const purged = store.purgeWireLogsOlderThan(90)
    expect(purged).toBe(0)
  })

  it('purges with default 90 day window', () => {
    store.insert(createOldEntry(100))
    store.insert(createOldEntry(91))
    store.insert(createOldEntry(89))

    const purged = store.purgeWireLogsOlderThan(90)

    expect(purged).toBe(2)
    const remaining = store.query({})
    expect(remaining).toHaveLength(1)
  })

  it('keeps entry exactly at the cutoff boundary (strict less-than)', () => {
    // Freeze time so entry timestamp and cutoff are computed at the same instant
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-15T12:00:00.000Z'))

    const exactCutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    store.insert(createEntry({ timestamp: exactCutoff.toISOString() })) // exactly at boundary
    store.insert(createEntry({ timestamp: new Date(exactCutoff.getTime() - 86400000).toISOString() })) // 1 day past
    store.insert(createEntry({ timestamp: new Date(exactCutoff.getTime() + 86400000).toISOString() })) // 1 day within

    const purged = store.purgeWireLogsOlderThan(30)

    // Strict < means the entry at exactly the cutoff is kept
    expect(purged).toBe(1)
    const remaining = store.query({})
    expect(remaining).toHaveLength(2)

    vi.useRealTimers()
  })

  it('returns 0 when days < 1 (guard against full wipe)', () => {
    store.insert(createEntry())
    store.insert(createEntry())

    expect(store.purgeWireLogsOlderThan(0)).toBe(0)
    expect(store.purgeWireLogsOlderThan(-1)).toBe(0)
    expect(store.query({})).toHaveLength(2)
  })
})

function createSignal(overrides?: Partial<SignalEntry>): SignalEntry {
  return {
    id: randomUUID(),
    endpoint_path: 'GET /test',
    category: `cat-${randomUUID()}`,
    severity: 'low',
    confidence: 1,
    observation_count: 1,
    first_seen: new Date().toISOString(),
    last_seen: new Date().toISOString(),
    provenance: 'agent-reported',
    message: 'test signal',
    suggestion: null,
    expired: false,
    ...overrides,
  }
}

function createOldSignal(daysAgo: number, overrides?: Partial<SignalEntry>): SignalEntry {
  const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
  return createSignal({ first_seen: date.toISOString(), last_seen: date.toISOString(), ...overrides })
}

describe('NodeStore.purgeSignalsOlderThan', () => {
  let store: NodeStore
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `bettermcp-signal-purge-test-${randomUUID()}.db`)
    store = new NodeStore(dbPath)
  })

  afterEach(() => {
    store.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('deletes signals older than specified days', () => {
    store.insertSignal(createOldSignal(100))
    store.insertSignal(createOldSignal(50))
    store.insertSignal(createSignal()) // recent

    const purged = store.purgeSignalsOlderThan(30)

    expect(purged).toBe(2)
    const remaining = store.getAllSignals()
    expect(remaining).toHaveLength(1)
  })

  it('keeps signals within retention window', () => {
    store.insertSignal(createOldSignal(10))
    store.insertSignal(createOldSignal(20))
    store.insertSignal(createSignal())

    const purged = store.purgeSignalsOlderThan(30)

    expect(purged).toBe(0)
    const remaining = store.getAllSignals()
    expect(remaining).toHaveLength(3)
  })

  it('returns 0 when no signals to purge', () => {
    const purged = store.purgeSignalsOlderThan(90)
    expect(purged).toBe(0)
  })

  it('returns 0 when days < 1 (guard against full wipe)', () => {
    store.insertSignal(createSignal())

    expect(store.purgeSignalsOlderThan(0)).toBe(0)
    expect(store.purgeSignalsOlderThan(-1)).toBe(0)
    expect(store.getAllSignals()).toHaveLength(1)
  })

  it('purges global signals (wildcard endpoint_path)', () => {
    store.insertSignal(createOldSignal(100, { endpoint_path: '* *' }))
    store.insertSignal(createSignal({ endpoint_path: '* *' })) // recent global

    const purged = store.purgeSignalsOlderThan(30)

    expect(purged).toBe(1)
    const remaining = store.getAllSignals()
    expect(remaining).toHaveLength(1)
  })
})

describe('NodeStore.insertSignal per-endpoint cap', () => {
  let store: NodeStore
  let dbPath: string

  beforeEach(() => {
    dbPath = path.join(os.tmpdir(), `bettermcp-signal-cap-test-${randomUUID()}.db`)
    store = new NodeStore(dbPath)
  })

  afterEach(() => {
    store.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })

  it('caps signals at 100 per endpoint, removing oldest by last_seen', () => {
    const endpoint = 'GET /capped'
    // Insert 102 signals with unique categories and sequential last_seen timestamps
    for (let i = 0; i < 102; i++) {
      const date = new Date(Date.now() - (102 - i) * 1000) // oldest first
      store.insertSignal(createSignal({
        endpoint_path: endpoint,
        category: `category-${i}`,
        last_seen: date.toISOString(),
        first_seen: date.toISOString(),
      }))
    }

    const signals = store.getSignals(endpoint)
    expect(signals).toHaveLength(100)

    // The two oldest (category-0, category-1) should have been evicted
    const categories = signals.map(s => s.category)
    expect(categories).not.toContain('category-0')
    expect(categories).not.toContain('category-1')
    expect(categories).toContain('category-2')
    expect(categories).toContain('category-101')
  })

  it('does not affect signals on other endpoints', () => {
    const endpointA = 'GET /a'
    const endpointB = 'GET /b'

    // Insert 5 signals for endpoint B
    for (let i = 0; i < 5; i++) {
      store.insertSignal(createSignal({ endpoint_path: endpointB, category: `b-cat-${i}` }))
    }

    // Insert 101 signals for endpoint A (triggers cap)
    for (let i = 0; i < 101; i++) {
      const date = new Date(Date.now() - (101 - i) * 1000)
      store.insertSignal(createSignal({
        endpoint_path: endpointA,
        category: `a-cat-${i}`,
        last_seen: date.toISOString(),
        first_seen: date.toISOString(),
      }))
    }

    expect(store.getSignals(endpointA)).toHaveLength(100)
    expect(store.getSignals(endpointB)).toHaveLength(5) // untouched
  })
})

describe('NullStore', () => {
  it('implements all FeedbackStore methods as no-ops', () => {
    const store = new NullStore()

    // Write operations should not throw
    expect(() => store.insert(createEntry())).not.toThrow()
    expect(() => store.insertSignal({
      id: randomUUID(),
      endpoint_path: '/test',
      category: 'test',
      severity: 'low',
      confidence: 1,
      observation_count: 1,
      first_seen: new Date().toISOString(),
      last_seen: new Date().toISOString(),
      provenance: 'agent-reported',
      message: 'test',
      suggestion: null,
      expired: false,
    })).not.toThrow()
    expect(() => store.logPromotion({
      id: randomUUID(),
      endpoint_path: '/test',
      from_state: 'simulate',
      to_state: 'live',
      promoted_by: 'test',
      promoted_at: new Date().toISOString(),
      reason: null,
    })).not.toThrow()
    expect(() => store.close()).not.toThrow()

    // Read operations should return empty
    expect(store.query({})).toEqual([])
    expect(store.getHints('/test')).toEqual([])
    expect(store.getSignals('GET /test')).toEqual([])
    expect(store.getAllSignals()).toEqual([])
    expect(store.getVersionStates()).toEqual([])
    expect(() => store.insertVersionState({
      id: 'vs-1',
      endpoint_path: 'GET /test',
      version_sha: 'abc123',
      state: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })).not.toThrow()
    expect(() => store.updateVersionState('vs-1', 'deprecated', new Date().toISOString())).not.toThrow()
    expect(store.getPromotionLog('/test')).toEqual([])
    expect(store.countWireLogs({})).toBe(0)
    expect(store.getSignalsBatch([])).toEqual(new Map())
    expect(store.getHintsBatch([])).toEqual(new Map())
    expect(store.purgeWireLogsOlderThan(90)).toBe(0)
    expect(store.purgeSignalsOlderThan(90)).toBe(0)
    expect(store.expireSyntheticSignals('%')).toBe(0)
  })
})

describe('createStore degraded mode', () => {
  it('returns NullStore when database cannot be opened', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)

    // Use a path that cannot be created (directory doesn't exist)
    const store = createStore('/nonexistent/deeply/nested/path/test.db')

    expect(store).toBeInstanceOf(NullStore)
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('degraded mode'),
    )

    stderrSpy.mockRestore()
    store.close()
  })

  it('creates new database when file does not exist', () => {
    const dbPath = path.join(os.tmpdir(), `bettermcp-create-test-${randomUUID()}.db`)

    const store = createStore(dbPath)

    // Should not be NullStore — should create the file
    expect(store).not.toBeInstanceOf(NullStore)
    expect(fs.existsSync(dbPath)).toBe(true)

    store.close()
    try { fs.unlinkSync(dbPath) } catch {}
  })
})
