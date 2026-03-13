import { describe, it, expect } from 'vitest'
import { NullStore } from './store/null-store.js'

/**
 * Tests for the health tool response logic.
 * The handler is inline in server.ts, so we replicate the logic here
 * to unit test the store status derivation.
 * TODO: Replace with integration test when MCP tool handler testability is addressed — see [Story 1.4] action item.
 */

class MockStore {}

function buildHealthResponse(store: object, specLoaded: boolean) {
  const storeStatus = 'type' in store && store.type === 'null' ? 'degraded' : 'healthy'
  return {
    status: 'ok',
    specLoaded,
    store: storeStatus,
  }
}

describe('health tool', () => {
  it('returns healthy state with normal store', () => {
    const result = buildHealthResponse(new MockStore(), true)

    expect(result.status).toBe('ok')
    expect(result.specLoaded).toBe(true)
    expect(result.store).toBe('healthy')
  })

  it('returns degraded state with NullStore', () => {
    const result = buildHealthResponse(new NullStore(), true)

    expect(result.status).toBe('ok')
    expect(result.specLoaded).toBe(true)
    expect(result.store).toBe('degraded')
  })

  it('reflects specLoaded as false when spec is not loaded', () => {
    const result = buildHealthResponse(new MockStore(), false)
    expect(result.specLoaded).toBe(false)
  })
})
