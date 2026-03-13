import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, unlinkSync } from 'node:fs'
import { shouldSimulate } from './index.js'
import { promoteEndpoint } from './promote.js'
import type { SafeModeConfig } from '../config/schema.js'
import { NodeStore } from '../store/node-store.js'

describe('shouldSimulate', () => {
  describe('AC4: no config = all live', () => {
    it('returns false when safeMode is undefined', () => {
      expect(shouldSimulate('GET', '/products', undefined)).toBe(false)
    })

    it('returns false when safeMode is empty object', () => {
      expect(shouldSimulate('GET', '/products', {})).toBe(false)
    })

    it('returns false for POST when safeMode is empty', () => {
      expect(shouldSimulate('POST', '/orders', {})).toBe(false)
    })
  })

  describe('AC1: per-endpoint safe-mode', () => {
    const safeMode: SafeModeConfig = {
      endpoints: { 'POST /orders': 'simulate' },
    }

    it('returns true for matched endpoint', () => {
      expect(shouldSimulate('POST', '/orders', safeMode)).toBe(true)
    })

    it('returns false for non-matched endpoint', () => {
      expect(shouldSimulate('GET', '/products', safeMode)).toBe(false)
    })

    it('returns false for same path different method', () => {
      expect(shouldSimulate('GET', '/orders', safeMode)).toBe(false)
    })

    it('is case-insensitive on method', () => {
      expect(shouldSimulate('post', '/orders', safeMode)).toBe(true)
    })
  })

  describe('AC2: global mutativeEndpoints shorthand', () => {
    const safeMode: SafeModeConfig = {
      mutativeEndpoints: 'simulate',
    }

    it('simulates POST', () => {
      expect(shouldSimulate('POST', '/orders', safeMode)).toBe(true)
    })

    it('simulates PUT', () => {
      expect(shouldSimulate('PUT', '/orders/1', safeMode)).toBe(true)
    })

    it('simulates PATCH', () => {
      expect(shouldSimulate('PATCH', '/orders/1', safeMode)).toBe(true)
    })

    it('simulates DELETE', () => {
      expect(shouldSimulate('DELETE', '/orders/1', safeMode)).toBe(true)
    })

    it('passes through GET', () => {
      expect(shouldSimulate('GET', '/products', safeMode)).toBe(false)
    })

    it('passes through HEAD', () => {
      expect(shouldSimulate('HEAD', '/products', safeMode)).toBe(false)
    })

    it('passes through OPTIONS', () => {
      expect(shouldSimulate('OPTIONS', '/products', safeMode)).toBe(false)
    })
  })

  describe('AC3: per-endpoint override trumps global', () => {
    const safeMode: SafeModeConfig = {
      mutativeEndpoints: 'simulate',
      endpoints: { 'POST /orders': 'live' },
    }

    it('POST /orders goes live (per-endpoint override)', () => {
      expect(shouldSimulate('POST', '/orders', safeMode)).toBe(false)
    })

    it('POST /other remains simulated (global)', () => {
      expect(shouldSimulate('POST', '/other', safeMode)).toBe(true)
    })

    it('DELETE /orders remains simulated (no per-endpoint override)', () => {
      expect(shouldSimulate('DELETE', '/orders', safeMode)).toBe(true)
    })

    it('GET /products passes through (not mutative)', () => {
      expect(shouldSimulate('GET', '/products', safeMode)).toBe(false)
    })
  })

  describe('per-endpoint simulate without global setting', () => {
    const safeMode: SafeModeConfig = {
      endpoints: { 'POST /orders': 'simulate' },
    }

    it('POST /orders is simulated (per-endpoint)', () => {
      expect(shouldSimulate('POST', '/orders', safeMode)).toBe(true)
    })

    it('POST /other is live (no global, no per-endpoint)', () => {
      expect(shouldSimulate('POST', '/other', safeMode)).toBe(false)
    })
  })

  describe('promotion_log runtime override', () => {
    const TEST_DB = './test-promote-intercept.db'
    let store: NodeStore | undefined

    afterEach(() => {
      store?.close()
      store = undefined
      if (existsSync(TEST_DB)) unlinkSync(TEST_DB)
      if (existsSync(`${TEST_DB}-wal`)) unlinkSync(`${TEST_DB}-wal`)
      if (existsSync(`${TEST_DB}-shm`)) unlinkSync(`${TEST_DB}-shm`)
    })

    it('returns true before promotion, false after promotion (immediate effect)', () => {
      store = new NodeStore(TEST_DB)
      const safeMode: SafeModeConfig = {
        endpoints: { 'POST /orders': 'simulate' },
      }

      // Before promotion: should simulate
      expect(shouldSimulate('POST', '/orders', safeMode, store)).toBe(true)

      // Promote the endpoint
      const result = promoteEndpoint('POST', '/orders', store, safeMode)
      expect(result.promoted).toBe(true)

      // After promotion: should NOT simulate (goes live immediately)
      expect(shouldSimulate('POST', '/orders', safeMode, store)).toBe(false)
    })

    it('promotion override works with global mutativeEndpoints', () => {
      store = new NodeStore(TEST_DB)
      const safeMode: SafeModeConfig = {
        mutativeEndpoints: 'simulate',
      }

      expect(shouldSimulate('DELETE', '/items/1', safeMode, store)).toBe(true)

      promoteEndpoint('DELETE', '/items/1', store, safeMode)

      expect(shouldSimulate('DELETE', '/items/1', safeMode, store)).toBe(false)
    })

    it('promotion does not affect other endpoints', () => {
      store = new NodeStore(TEST_DB)
      const safeMode: SafeModeConfig = {
        mutativeEndpoints: 'simulate',
      }

      promoteEndpoint('POST', '/orders', store, safeMode)

      // Promoted endpoint goes live
      expect(shouldSimulate('POST', '/orders', safeMode, store)).toBe(false)
      // Other endpoints remain simulated
      expect(shouldSimulate('POST', '/other', safeMode, store)).toBe(true)
    })

    it('without store parameter, shouldSimulate ignores promotions', () => {
      store = new NodeStore(TEST_DB)
      const safeMode: SafeModeConfig = {
        endpoints: { 'POST /orders': 'simulate' },
      }

      promoteEndpoint('POST', '/orders', store, safeMode)

      // Without store: still simulated (config-only check)
      expect(shouldSimulate('POST', '/orders', safeMode)).toBe(true)
      // With store: promoted to live
      expect(shouldSimulate('POST', '/orders', safeMode, store)).toBe(false)
    })
  })

  describe('parameterized path matching', () => {
    it('matches POST /orders/{id} config against POST /orders/123 request', () => {
      const safeMode: SafeModeConfig = {
        endpoints: { 'POST /orders/{id}': 'simulate' },
      }
      expect(shouldSimulate('POST', '/orders/123', safeMode)).toBe(true)
    })

    it('does not match parameterized path with wrong method', () => {
      const safeMode: SafeModeConfig = {
        endpoints: { 'POST /orders/{id}': 'simulate' },
      }
      expect(shouldSimulate('GET', '/orders/123', safeMode)).toBe(false)
    })

    it('matches multi-segment parameterized path', () => {
      const safeMode: SafeModeConfig = {
        endpoints: { 'PUT /users/{userId}/posts/{postId}': 'simulate' },
      }
      expect(shouldSimulate('PUT', '/users/42/posts/99', safeMode)).toBe(true)
    })

    it('per-endpoint parameterized override trumps global', () => {
      const safeMode: SafeModeConfig = {
        mutativeEndpoints: 'simulate',
        endpoints: { 'POST /orders/{id}': 'live' },
      }
      expect(shouldSimulate('POST', '/orders/456', safeMode)).toBe(false)
    })
  })

  describe('path normalization', () => {
    const safeMode: SafeModeConfig = {
      endpoints: { 'POST /orders': 'simulate' },
    }

    it('matches path with trailing slash', () => {
      expect(shouldSimulate('POST', '/orders/', safeMode)).toBe(true)
    })

    it('matches path with multiple trailing slashes', () => {
      expect(shouldSimulate('POST', '/orders///', safeMode)).toBe(true)
    })

    it('preserves root path', () => {
      const rootMode: SafeModeConfig = {
        endpoints: { 'GET /': 'simulate' },
      }
      expect(shouldSimulate('GET', '/', rootMode)).toBe(true)
    })
  })
})
