import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, unlinkSync } from 'node:fs'
import { NodeStore } from './node-store.js'
import type { WireLogEntry, SignalEntry } from '../types/store.js'

const TEST_DB = './test-node-store.db'

function makeEntry(overrides: Partial<WireLogEntry> = {}): WireLogEntry {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    endpoint_path: '/pets/list',
    method: 'GET',
    request_headers: { authorization: '[REDACTED]' },
    request_body: null,
    response_status: 200,
    response_headers: { 'content-type': 'application/json' },
    response_body: { pets: [] },
    mode: 'live',
    version_sha: null,
    duration_ms: 42,
    provenance: 'wire-log',
    ...overrides,
  }
}

describe('NodeStore', () => {
  let store: NodeStore | undefined

  afterEach(() => {
    store?.close()
    store = undefined
    if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
    if (existsSync(`${TEST_DB}-wal`)) unlinkSync(`${TEST_DB}-wal`)
    if (existsSync(`${TEST_DB}-shm`)) unlinkSync(`${TEST_DB}-shm`)
  })

  it('creates database and schema on construction', () => {
    store = new NodeStore(TEST_DB)
    expect(existsSync(TEST_DB)).toBe(true)
  })

  it('insert and query in same synchronous block (AC6)', () => {
    store = new NodeStore(TEST_DB)
    const entry = makeEntry({ id: 'sync-test-1' })

    // Insert and immediately query — no await, same sync block
    store.insert(entry)
    const results = store.query({ endpoint_path: '/pets/list' })

    expect(results).toHaveLength(1)
    expect(results[0]!.id).toBe('sync-test-1')
    expect(results[0]!.endpoint_path).toBe('/pets/list')
    expect(results[0]!.method).toBe('GET')
    expect(results[0]!.response_status).toBe(200)
    expect(results[0]!.mode).toBe('live')
    expect(results[0]!.provenance).toBe('wire-log')
  })

  it('roundtrips JSON fields correctly', () => {
    store = new NodeStore(TEST_DB)
    const entry = makeEntry({
      request_headers: { 'x-api-key': '[REDACTED]', accept: 'application/json' },
      response_body: { data: [1, 2, 3], nested: { key: 'value' } },
    })

    store.insert(entry)
    const results = store.query({})

    expect(results[0]!.request_headers).toEqual({
      'x-api-key': '[REDACTED]',
      accept: 'application/json',
    })
    expect(results[0]!.response_body).toEqual({
      data: [1, 2, 3],
      nested: { key: 'value' },
    })
  })

  it('filters by endpoint_path', () => {
    store = new NodeStore(TEST_DB)
    store.insert(makeEntry({ id: 'a', endpoint_path: '/pets/list' }))
    store.insert(makeEntry({ id: 'b', endpoint_path: '/users/me' }))
    store.insert(makeEntry({ id: 'c', endpoint_path: '/pets/list' }))

    const results = store.query({ endpoint_path: '/pets/list' })
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.endpoint_path === '/pets/list')).toBe(true)
  })

  it('filters by mode', () => {
    store = new NodeStore(TEST_DB)
    store.insert(makeEntry({ id: 'a', mode: 'live' }))
    store.insert(makeEntry({ id: 'b', mode: 'simulated' }))

    const results = store.query({ mode: 'simulated' })
    expect(results).toHaveLength(1)
    expect(results[0]!.mode).toBe('simulated')
  })

  it('respects query limit', () => {
    store = new NodeStore(TEST_DB)
    for (let i = 0; i < 5; i++) {
      store.insert(makeEntry({ id: `limit-${i}` }))
    }

    const results = store.query({ limit: 2 })
    expect(results).toHaveLength(2)
  })

  it('returns empty array for getHints with no data', () => {
    store = new NodeStore(TEST_DB)
    const hints = store.getHints('/pets/list')
    expect(hints).toEqual([])
  })

  it('handles null request_body and response_body', () => {
    store = new NodeStore(TEST_DB)
    const entry = makeEntry({ request_body: null, response_body: null })

    store.insert(entry)
    const results = store.query({})

    expect(results[0]!.request_body).toBeNull()
    expect(results[0]!.response_body).toBeNull()
  })

  it('logPromotion inserts and getPromotionLog retrieves', () => {
    store = new NodeStore(TEST_DB)
    store.logPromotion({
      id: 'promo-1',
      endpoint_path: 'POST /orders',
      from_state: 'simulate',
      to_state: 'live',
      promoted_by: 'cli',
      promoted_at: '2026-03-11T00:00:00.000Z',
      reason: null,
    })

    const log = store.getPromotionLog('POST /orders')
    expect(log).toHaveLength(1)
    expect(log[0]!.id).toBe('promo-1')
    expect(log[0]!.from_state).toBe('simulate')
    expect(log[0]!.to_state).toBe('live')
    expect(log[0]!.promoted_by).toBe('cli')
  })

  it('getPromotionLog returns empty array for unknown endpoint', () => {
    store = new NodeStore(TEST_DB)
    const log = store.getPromotionLog('GET /unknown')
    expect(log).toEqual([])
  })

  it('insertSignal persists a SignalEntry and can be read back', () => {
    store = new NodeStore(TEST_DB)
    const now = new Date().toISOString()
    const signal: SignalEntry = {
      id: 'sig-1',
      endpoint_path: 'GET /pets',
      category: 'schema-mismatch',
      severity: 'medium',
      confidence: 1,
      observation_count: 1,
      first_seen: now,
      last_seen: now,
      provenance: 'wire-log',
      message: 'Schema mismatch: /name must be string',
      suggestion: 'Update the OpenAPI spec.',
      expired: false,
    }

    store.insertSignal(signal)

    // Verify the row was actually persisted
    const rows = (store as unknown as { db: import('better-sqlite3').Database }).db
      .prepare('SELECT * FROM synthetic_signals WHERE endpoint_path = ?')
      .all('GET /pets') as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]!['id']).toBe('sig-1')
    expect(rows[0]!['category']).toBe('schema-mismatch')
    expect(rows[0]!['severity']).toBe('medium')
    expect(rows[0]!['observation_count']).toBe(1)
    expect(rows[0]!['message']).toBe('Schema mismatch: /name must be string')
    expect(rows[0]!['suggestion']).toBe('Update the OpenAPI spec.')
    expect(rows[0]!['expired']).toBe(0) // boolean → integer
  })

  it('insertSignal upserts on duplicate endpoint_path + category', () => {
    store = new NodeStore(TEST_DB)
    const t1 = '2026-03-01T00:00:00.000Z'
    const t2 = '2026-03-11T00:00:00.000Z'

    store.insertSignal({
      id: 'sig-first',
      endpoint_path: 'GET /pets',
      category: 'schema-mismatch',
      severity: 'medium',
      confidence: 1,
      observation_count: 1,
      first_seen: t1,
      last_seen: t1,
      provenance: 'wire-log',
      message: 'Schema mismatch: /name must be string',
      suggestion: 'Update spec.',
      expired: false,
    })

    store.insertSignal({
      id: 'sig-second',
      endpoint_path: 'GET /pets',
      category: 'schema-mismatch',
      severity: 'medium',
      confidence: 1,
      observation_count: 1,
      first_seen: t2,
      last_seen: t2,
      provenance: 'wire-log',
      message: 'Schema mismatch: /name must be integer',
      suggestion: 'Fix upstream.',
      expired: false,
    })

    // Should have one row with observation_count incremented
    const rows = (store as unknown as { db: import('better-sqlite3').Database }).db
      .prepare('SELECT * FROM synthetic_signals WHERE endpoint_path = ?')
      .all('GET /pets') as Array<Record<string, unknown>>

    expect(rows).toHaveLength(1)
    expect(rows[0]!['observation_count']).toBe(2)
    expect(rows[0]!['first_seen']).toBe(t1) // preserved from first insert
    expect(rows[0]!['last_seen']).toBe(t2) // updated to latest
    expect(rows[0]!['message']).toBe('Schema mismatch: /name must be integer') // updated
  })

  it('getPromotionLog returns entries ordered by promoted_at DESC', () => {
    store = new NodeStore(TEST_DB)
    store.logPromotion({
      id: 'promo-old',
      endpoint_path: 'POST /orders',
      from_state: 'simulate',
      to_state: 'live',
      promoted_by: 'cli',
      promoted_at: '2026-01-01T00:00:00.000Z',
      reason: null,
    })
    store.logPromotion({
      id: 'promo-new',
      endpoint_path: 'POST /orders',
      from_state: 'live',
      to_state: 'simulate',
      promoted_by: 'cli',
      promoted_at: '2026-03-11T00:00:00.000Z',
      reason: 'rollback',
    })

    const log = store.getPromotionLog('POST /orders')
    expect(log).toHaveLength(2)
    expect(log[0]!.id).toBe('promo-new')
    expect(log[0]!.reason).toBe('rollback')
    expect(log[1]!.id).toBe('promo-old')
  })
})
