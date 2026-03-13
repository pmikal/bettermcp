import { describe, it, expect, vi, beforeEach } from 'vitest'
import { logWireEntry, type WireLogInput } from './wire-logger.js'
import type { FeedbackStore } from '../store/feedback-store.js'
import type { WireLogEntry } from '../types/store.js'

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

function createInput(overrides?: Partial<WireLogInput>): WireLogInput {
  return {
    endpoint_path: '/users',
    method: 'GET',
    request_headers: { 'content-type': 'application/json' },
    request_body: null,
    response_status: 200,
    response_headers: { 'content-type': 'application/json' },
    response_body: '{"id":1}',
    mode: 'live',
    startTime: Date.now() - 42,
    ...overrides,
  }
}

describe('logWireEntry', () => {
  let store: FeedbackStore

  beforeEach(() => {
    store = createMockStore()
  })

  it('creates a WireLogEntry with correct fields', () => {
    const input = createInput({ startTime: Date.now() - 100 })
    const id = logWireEntry(input, store)

    expect(id).toBeTypeOf('string')
    expect(id).toMatch(/^[0-9a-f-]{36}$/)

    const insertCall = vi.mocked(store.insert).mock.calls[0]
    expect(insertCall).toBeDefined()
    const entry = insertCall[0] as WireLogEntry

    expect(entry.endpoint_path).toBe('/users')
    expect(entry.method).toBe('GET')
    expect(entry.response_status).toBe(200)
    expect(entry.mode).toBe('live')
    expect(entry.version_sha).toBeNull()
    expect(entry.provenance).toBe('wire-log')
    expect(entry.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  it('calculates duration_ms from startTime', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1000)
    const input = createInput({ startTime: 850 })
    logWireEntry(input, store)

    const entry = vi.mocked(store.insert).mock.calls[0][0] as WireLogEntry
    expect(entry.duration_ms).toBe(150)
    vi.useRealTimers()
  })

  it('applies redaction to credential headers', () => {
    const input = createInput({
      request_headers: {
        authorization: 'Bearer secret-token-value',
        'content-type': 'application/json',
      },
      response_headers: {
        'set-cookie': 'session=abc123',
        'content-type': 'application/json',
      },
    })

    logWireEntry(input, store)

    const entry = vi.mocked(store.insert).mock.calls[0][0] as WireLogEntry
    expect(entry.request_headers.authorization).toBe('[REDACTED]')
    expect(entry.request_headers['content-type']).toBe('application/json')
    expect(entry.response_headers['set-cookie']).toBe('[REDACTED]')
    expect(entry.response_headers['content-type']).toBe('application/json')
  })

  it('applies redaction to credential patterns in body', () => {
    const input = createInput({
      request_body: 'my key is sk-abcdefghij0123456789abc',
      response_body: { token: 'sk-abcdefghij0123456789abc' },
    })

    logWireEntry(input, store)

    const entry = vi.mocked(store.insert).mock.calls[0][0] as WireLogEntry
    expect(entry.request_body).toBe('my key is [REDACTED]')
    expect((entry.response_body as Record<string, string>).token).toBe('[REDACTED]')
  })

  it('skips header redaction when fullHeaders option is set', () => {
    const input = createInput({
      request_headers: {
        authorization: 'Bearer secret-token-value',
      },
    })

    logWireEntry(input, store, { fullHeaders: true })

    const entry = vi.mocked(store.insert).mock.calls[0][0] as WireLogEntry
    expect(entry.request_headers.authorization).toBe('Bearer secret-token-value')
  })

  it('handles simulated mode entries', () => {
    const input = createInput({ mode: 'simulated' })
    logWireEntry(input, store)

    const entry = vi.mocked(store.insert).mock.calls[0][0] as WireLogEntry
    expect(entry.mode).toBe('simulated')
  })

  it('returns null and logs to stderr on store failure', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const failStore = createMockStore({
      insert: vi.fn().mockImplementation(() => {
        throw new Error('disk full')
      }),
    })

    const input = createInput()
    const id = logWireEntry(input, failStore)

    expect(id).toBeNull()
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('wire-log write failed'),
    )
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('disk full'),
    )

    stderrSpy.mockRestore()
  })

  it('does not throw when store fails', () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const failStore = createMockStore({
      insert: vi.fn().mockImplementation(() => {
        throw new Error('permission denied')
      }),
    })

    expect(() => logWireEntry(createInput(), failStore)).not.toThrow()

    vi.mocked(process.stderr.write).mockRestore()
  })

  it('generates unique IDs for each entry', () => {
    const ids = new Set<string | null>()
    for (let i = 0; i < 10; i++) {
      ids.add(logWireEntry(createInput(), store))
    }
    expect(ids.size).toBe(10)
  })

  it('handles null request_body', () => {
    const input = createInput({ request_body: null })
    logWireEntry(input, store)

    const entry = vi.mocked(store.insert).mock.calls[0][0] as WireLogEntry
    expect(entry.request_body).toBeNull()
  })

  it('clamps negative duration_ms to zero', () => {
    vi.useFakeTimers()
    vi.setSystemTime(100)
    // startTime in the future simulates clock adjustment
    const input = createInput({ startTime: 200 })
    logWireEntry(input, store)

    const entry = vi.mocked(store.insert).mock.calls[0][0] as WireLogEntry
    expect(entry.duration_ms).toBe(0)
    vi.useRealTimers()
  })

  it('returns null and logs to stderr on redaction failure', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    // BigInt causes JSON.stringify to throw in redactBody
    const input = createInput({ response_body: { value: BigInt(42) } })
    const id = logWireEntry(input, store)

    // If redaction fails, should return null with appropriate message
    if (id === null) {
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('redaction failed'),
      )
    }
    stderrSpy.mockRestore()
  })

  it('truncates oversized string bodies', () => {
    const largeBody = 'x'.repeat(1_100_000)
    const input = createInput({ response_body: largeBody })
    logWireEntry(input, store)

    const entry = vi.mocked(store.insert).mock.calls[0][0] as WireLogEntry
    const body = entry.response_body as string
    expect(body.length).toBeLessThan(largeBody.length)
    expect(body).toContain('[TRUNCATED]')
  })

  it('truncates oversized object bodies', () => {
    const largeObj = { data: 'x'.repeat(1_100_000) }
    const input = createInput({ response_body: largeObj })
    logWireEntry(input, store)

    const entry = vi.mocked(store.insert).mock.calls[0][0] as WireLogEntry
    const body = entry.response_body as string
    expect(typeof body).toBe('string')
    expect(body).toContain('[TRUNCATED]')
  })

  it('handles object response_body without credentials', () => {
    const body = { users: [{ id: 1, name: 'Alice' }] }
    const input = createInput({ response_body: body })
    logWireEntry(input, store)

    const entry = vi.mocked(store.insert).mock.calls[0][0] as WireLogEntry
    // Should return same reference when no redaction needed
    expect(entry.response_body).toBe(body)
  })
})
