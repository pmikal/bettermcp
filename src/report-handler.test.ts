import { describe, it, expect, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { redactBody } from './logging/redactor.js'
import type { SignalEntry } from './types/store.js'
import type { FeedbackStore } from './store/feedback-store.js'

/**
 * Tests for the report() tool handler logic.
 * The handler is inline in server.ts, so we replicate the logic here
 * to unit test signal creation, redaction, and store interaction.
 */

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

/**
 * Replicates the report handler logic from server.ts.
 * TODO: Extract handler into a shared function — see action item [Story 1.4]
 * for MCP tool handler testability.
 */
function handleReport(
  ep: string,
  category: string,
  msg: string,
  store: FeedbackStore,
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS',
): { status: string; stored: boolean; endpoint: string; category: string; error?: string } {
  const now = new Date().toISOString()
  const redacted = redactBody(msg)
  const redactedMessage = typeof redacted === 'string' ? redacted : String(redacted)

  const endpointPath = method ? `${method} ${ep}` : ep

  const signal: SignalEntry = {
    id: randomUUID(),
    endpoint_path: endpointPath,
    category,
    severity: 'low',
    confidence: 1,
    observation_count: 1,
    first_seen: now,
    last_seen: now,
    provenance: 'agent-reported',
    message: redactedMessage,
    suggestion: null,
    expired: false,
  }

  try {
    store.insertSignal(signal)
    return { status: 'received', stored: true, endpoint: ep, category }
  } catch {
    return { status: 'received', stored: false, endpoint: ep, category, error: 'Failed to persist feedback' }
  }
}

describe('report handler', () => {
  it('creates a SignalEntry with agent-reported provenance', () => {
    const store = createMockStore()
    handleReport('/products', 'unexpected-response', 'Price field is string', store)

    expect(store.insertSignal).toHaveBeenCalledOnce()
    const signal = vi.mocked(store.insertSignal).mock.calls[0][0]
    expect(signal.endpoint_path).toBe('/products')
    expect(signal.category).toBe('unexpected-response')
    expect(signal.provenance).toBe('agent-reported')
    expect(signal.severity).toBe('low')
    expect(signal.confidence).toBe(1)
    expect(signal.observation_count).toBe(1)
    expect(signal.message).toBe('Price field is string')
    expect(signal.suggestion).toBeNull()
    expect(signal.expired).toBe(false)
    expect(signal.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(signal.first_seen).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(signal.last_seen).toBe(signal.first_seen)
  })

  it('returns stored: true on success', () => {
    const store = createMockStore()
    const result = handleReport('/products', 'timeout', 'Took 30s', store)

    expect(result.status).toBe('received')
    expect(result.stored).toBe(true)
    expect(result.endpoint).toBe('/products')
    expect(result.category).toBe('timeout')
  })

  it('returns stored: false on store failure without throwing', () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const store = createMockStore({
      insertSignal: vi.fn().mockImplementation(() => {
        throw new Error('disk full')
      }),
    })

    const result = handleReport('/products', 'error', 'Something broke', store)

    expect(result.status).toBe('received')
    expect(result.stored).toBe(false)
    expect(result.error).toBe('Failed to persist feedback')
    stderrSpy.mockRestore()
  })

  it('redacts credential patterns in message before storage', () => {
    const store = createMockStore()
    handleReport(
      '/auth',
      'unexpected-response',
      'Got error with token sk-abcdefghij0123456789abc in response',
      store,
    )

    const signal = vi.mocked(store.insertSignal).mock.calls[0][0]
    expect(signal.message).not.toContain('sk-abcdefghij0123456789abc')
    expect(signal.message).toContain('[REDACTED]')
    expect(signal.message).toContain('Got error with token')
  })

  it('redacts JWT tokens in message', () => {
    const store = createMockStore()
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature'
    handleReport('/api', 'error', `Auth failed: ${jwt}`, store)

    const signal = vi.mocked(store.insertSignal).mock.calls[0][0]
    expect(signal.message).not.toContain('eyJ')
    expect(signal.message).toContain('[REDACTED]')
  })

  it('redacts Bearer tokens in message', () => {
    const store = createMockStore()
    handleReport(
      '/api',
      'auth-issue',
      'Authorization: Bearer abc123def456ghi789jkl012mno345',
      store,
    )

    const signal = vi.mocked(store.insertSignal).mock.calls[0][0]
    expect(signal.message).toContain('[REDACTED]')
    expect(signal.message).not.toContain('abc123def456ghi789jkl012mno345')
  })

  it('passes through messages without credentials unchanged', () => {
    const store = createMockStore()
    const msg = 'Field "price" returned as string instead of number'
    handleReport('/products', 'unexpected-response', msg, store)

    const signal = vi.mocked(store.insertSignal).mock.calls[0][0]
    expect(signal.message).toBe(msg)
  })

  it('stores endpoint_path with method prefix when method is provided', () => {
    const store = createMockStore()
    handleReport('/products', 'unexpected-response', 'Price field is string', store, 'GET')

    const signal = vi.mocked(store.insertSignal).mock.calls[0][0]
    expect(signal.endpoint_path).toBe('GET /products')
  })

  it('stores endpoint_path as raw path when method is not provided', () => {
    const store = createMockStore()
    handleReport('/products', 'unexpected-response', 'Price field is string', store)

    const signal = vi.mocked(store.insertSignal).mock.calls[0][0]
    expect(signal.endpoint_path).toBe('/products')
  })

  it('persists signal with unique ID for each call', () => {
    const store = createMockStore()
    for (let i = 0; i < 10; i++) {
      handleReport('/ep', 'cat', `msg ${i}`, store)
    }
    const ids = vi.mocked(store.insertSignal).mock.calls.map(
      (call) => call[0].id,
    )
    expect(new Set(ids).size).toBe(10)
  })
})
