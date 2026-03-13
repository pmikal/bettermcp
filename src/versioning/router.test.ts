import { describe, it, expect, vi } from 'vitest'
import { VersionRouter } from './router.js'
import { BetterMCPError } from '../errors/index.js'
import type { ParsedEndpoint } from '../spec/spec-types.js'
import type { FeedbackStore } from '../store/feedback-store.js'

function createEndpoint(overrides?: Partial<ParsedEndpoint>): ParsedEndpoint {
  return {
    path: '/products',
    method: 'GET',
    operationId: 'listProducts',
    summary: 'List products',
    description: null,
    parameters: [],
    requestBody: null,
    responses: {},
    confidence: { score: 0.8, factors: [] },
    warnings: [],
    ...overrides,
  }
}

function createMockStore(): FeedbackStore {
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
  }
}

describe('VersionRouter', () => {
  describe('pin', () => {
    it('registers a version with endpoints', () => {
      const router = new VersionRouter()
      const endpoints = [createEndpoint()]

      router.pin('abc123', endpoints, 'https://api.example.com')

      expect(router.has('abc123')).toBe(true)
      expect(router.size).toBe(1)
    })

    it('persists to store when provided', () => {
      const router = new VersionRouter()
      const store = createMockStore()
      const endpoints = [createEndpoint(), createEndpoint({ path: '/orders', method: 'POST' })]

      router.pin('abc123', endpoints, 'https://api.example.com', store)

      expect(store.insertVersionState).toHaveBeenCalledTimes(2)
      expect(store.insertVersionState).toHaveBeenCalledWith(
        expect.objectContaining({
          version_sha: 'abc123',
          state: 'active',
          endpoint_path: 'GET /products',
        }),
      )
    })

    it('throws CONFIG_INVALID for empty SHA', () => {
      const router = new VersionRouter()
      expect(() => router.pin('', [createEndpoint()], 'https://api.example.com')).toThrow(BetterMCPError)
      try {
        router.pin('', [createEndpoint()], 'https://api.example.com')
      } catch (err) {
        expect((err as BetterMCPError).code).toBe('BMCP010')
      }
    })

    it('throws CONFIG_INVALID for whitespace-only SHA', () => {
      const router = new VersionRouter()
      expect(() => router.pin('   ', [createEndpoint()], 'https://api.example.com')).toThrow(BetterMCPError)
      try {
        router.pin('   ', [createEndpoint()], 'https://api.example.com')
      } catch (err) {
        expect((err as BetterMCPError).code).toBe('BMCP010')
      }
    })

    it('throws CONFIG_INVALID for empty endpoints array', () => {
      const router = new VersionRouter()
      expect(() => router.pin('abc123', [], 'https://api.example.com')).toThrow(BetterMCPError)
      try {
        router.pin('abc123', [], 'https://api.example.com')
      } catch (err) {
        expect((err as BetterMCPError).code).toBe('BMCP010')
      }
    })

    it('sunsets old store rows when overwriting a pinned version', () => {
      const router = new VersionRouter()
      const store = createMockStore()
      vi.mocked(store.getVersionStates).mockReturnValue([
        { id: 'vs-old', endpoint_path: 'GET /products', version_sha: 'abc123', state: 'active', created_at: '', updated_at: '' },
      ])

      router.pin('abc123', [createEndpoint()], 'https://api.example.com', store)
      router.pin('abc123', [createEndpoint({ path: '/orders', method: 'POST' })], 'https://api2.example.com', store)

      expect(store.updateVersionState).toHaveBeenCalledWith('vs-old', 'sunset', expect.any(String))
    })
  })

  describe('route', () => {
    it('routes to the correct endpoint for a pinned version', () => {
      const router = new VersionRouter()
      const endpoints = [
        createEndpoint({ path: '/products', method: 'GET' }),
        createEndpoint({ path: '/orders', method: 'POST' }),
      ]

      router.pin('abc123', endpoints, 'https://api.example.com')
      const result = router.route('abc123', 'POST', '/orders')

      expect(result).not.toBeNull()
      expect(result!.endpoint.path).toBe('/orders')
      expect(result!.endpoint.method).toBe('POST')
      expect(result!.baseUrl).toBe('https://api.example.com')
      expect(result!.versionSha).toBe('abc123')
      expect(result!.state).toBe('active')
    })

    it('routes parameterized paths correctly', () => {
      const router = new VersionRouter()
      const endpoints = [createEndpoint({ path: '/products/{id}', method: 'GET' })]

      router.pin('abc123', endpoints, 'https://api.example.com')
      const result = router.route('abc123', 'GET', '/products/42')

      expect(result).not.toBeNull()
      expect(result!.endpoint.path).toBe('/products/{id}')
    })

    it('throws VERSION_NOT_FOUND for unknown SHA', () => {
      const router = new VersionRouter()
      router.pin('abc123', [createEndpoint()], 'https://api.example.com')

      expect(() => router.route('unknown', 'GET', '/products')).toThrow(BetterMCPError)
      try {
        router.route('unknown', 'GET', '/products')
      } catch (err) {
        const e = err as BetterMCPError
        expect(e.code).toBe('BMCP012')
        expect(e.problem).toContain('unknown')
        expect(e.problem).toContain('abc123')
      }
    })

    it('includes all available versions in error message', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')
      router.pin('v2', [createEndpoint()], 'https://api.example.com')

      try {
        router.route('v3', 'GET', '/products')
      } catch (err) {
        const e = err as BetterMCPError
        expect(e.problem).toContain('v1')
        expect(e.problem).toContain('v2')
      }
    })

    it('routes different versions to different endpoint sets', () => {
      const router = new VersionRouter()
      const v1Endpoints = [createEndpoint({ path: '/products', method: 'GET', summary: 'v1 products' })]
      const v2Endpoints = [createEndpoint({ path: '/products', method: 'GET', summary: 'v2 products' })]

      router.pin('v1', v1Endpoints, 'https://v1.api.com')
      router.pin('v2', v2Endpoints, 'https://v2.api.com')

      const r1 = router.route('v1', 'GET', '/products')
      const r2 = router.route('v2', 'GET', '/products')

      expect(r1!.endpoint.summary).toBe('v1 products')
      expect(r1!.baseUrl).toBe('https://v1.api.com')
      expect(r2!.endpoint.summary).toBe('v2 products')
      expect(r2!.baseUrl).toBe('https://v2.api.com')
    })

    it('returns null when no endpoint matches method+path', () => {
      const router = new VersionRouter()
      router.pin('abc123', [createEndpoint({ path: '/products', method: 'GET' })], 'https://api.example.com')

      const result = router.route('abc123', 'DELETE', '/products')
      expect(result).toBeNull()
    })

    it('serves deprecated versions with deprecation info (AC2)', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')
      router.deprecate('v1', 'v2')

      const result = router.route('v1', 'GET', '/products')

      expect(result).not.toBeNull()
      expect(result!.state).toBe('deprecated')
      expect(result!.deprecationInfo).toBeDefined()
      expect(result!.deprecationInfo!.migrateToSha).toBe('v2')
      expect(result!.deprecationInfo!.deprecatedAt).toBeTruthy()
    })

    it('throws VERSION_SUNSET for sunset versions (AC4)', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')
      router.deprecate('v1', 'v2')
      router.sunset('v1')

      expect(() => router.route('v1', 'GET', '/products')).toThrow(BetterMCPError)
      try {
        router.route('v1', 'GET', '/products')
      } catch (err) {
        const e = err as BetterMCPError
        expect(e.code).toBe('BMCP014')
        expect(e.problem).toContain('v1')
        expect(e.problem).toContain('v2')
      }
    })
  })

  describe('concurrent routing — verifies Map-based isolation across versions', () => {
    it('each version resolves to its own endpoint set under parallel dispatch', async () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint({ summary: 'v1' })], 'https://v1.api.com')
      router.pin('v2', [createEndpoint({ summary: 'v2' })], 'https://v2.api.com')
      router.pin('v3', [createEndpoint({ summary: 'v3' })], 'https://v3.api.com')

      const results = await Promise.all([
        Promise.resolve(router.route('v1', 'GET', '/products')),
        Promise.resolve(router.route('v2', 'GET', '/products')),
        Promise.resolve(router.route('v3', 'GET', '/products')),
        Promise.resolve(router.route('v1', 'GET', '/products')),
        Promise.resolve(router.route('v2', 'GET', '/products')),
      ])

      expect(results[0]!.endpoint.summary).toBe('v1')
      expect(results[1]!.endpoint.summary).toBe('v2')
      expect(results[2]!.endpoint.summary).toBe('v3')
      expect(results[3]!.endpoint.summary).toBe('v1')
      expect(results[4]!.endpoint.summary).toBe('v2')
    })
  })

  describe('setState with lifecycle validation', () => {
    it('rejects setState to deprecated without deprecationInfo (must use deprecate())', () => {
      const router = new VersionRouter()
      router.pin('abc123', [createEndpoint()], 'https://api.example.com')

      expect(() => router.setState('abc123', 'deprecated')).toThrow(BetterMCPError)
      try {
        router.setState('abc123', 'deprecated')
      } catch (err) {
        const e = err as BetterMCPError
        expect(e.code).toBe('BMCP013')
        expect(e.problem).toContain('deprecate()')
      }
    })

    it('allows deprecated → sunset via setState', () => {
      const router = new VersionRouter()
      router.pin('abc123', [createEndpoint()], 'https://api.example.com')
      router.deprecate('abc123', 'v2')

      router.setState('abc123', 'sunset')

      expect(router.getState('abc123')).toBe('sunset')
    })

    it('rejects active → sunset (AC5)', () => {
      const router = new VersionRouter()
      router.pin('abc123', [createEndpoint()], 'https://api.example.com')

      expect(() => router.setState('abc123', 'sunset')).toThrow(BetterMCPError)
      try {
        router.setState('abc123', 'sunset')
      } catch (err) {
        const e = err as BetterMCPError
        expect(e.code).toBe('BMCP013')
      }
    })

    it('rejects sunset → active (AC5)', () => {
      const router = new VersionRouter()
      router.pin('abc123', [createEndpoint()], 'https://api.example.com')
      router.deprecate('abc123', 'v2')
      router.setState('abc123', 'sunset')

      expect(() => router.setState('abc123', 'active')).toThrow(BetterMCPError)
    })

    it('rejects deprecated → active (AC5)', () => {
      const router = new VersionRouter()
      router.pin('abc123', [createEndpoint()], 'https://api.example.com')
      router.deprecate('abc123', 'v2')

      expect(() => router.setState('abc123', 'active')).toThrow(BetterMCPError)
    })

    it('throws for unknown version', () => {
      const router = new VersionRouter()
      expect(() => router.setState('unknown', 'deprecated')).toThrow(BetterMCPError)
    })

    it('persists state change to store', () => {
      const router = new VersionRouter()
      const store = createMockStore()
      vi.mocked(store.getVersionStates).mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'abc123', state: 'deprecated', created_at: '', updated_at: '' },
      ])

      router.pin('abc123', [createEndpoint()], 'https://api.example.com')
      router.deprecate('abc123', 'v2')
      router.setState('abc123', 'sunset', store)

      expect(store.updateVersionState).toHaveBeenCalledWith('vs-1', 'sunset', expect.any(String))
    })
  })

  describe('deprecate', () => {
    it('transitions active → deprecated with migration info (AC1)', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')

      router.deprecate('v1', 'v2')

      expect(router.getState('v1')).toBe('deprecated')
      const info = router.getDeprecationInfo('v1')
      expect(info).toBeDefined()
      expect(info!.migrateToSha).toBe('v2')
      expect(info!.deprecatedAt).toBeTruthy()
    })

    it('includes optional message', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')

      router.deprecate('v1', 'v2', undefined, 'Please migrate by 2026-04-01')

      const info = router.getDeprecationInfo('v1')
      expect(info!.message).toBe('Please migrate by 2026-04-01')
    })

    it('rejects deprecate on already deprecated version', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')
      router.deprecate('v1', 'v2')

      expect(() => router.deprecate('v1', 'v3')).toThrow(BetterMCPError)
    })

    it('rejects empty migrateToSha', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')

      expect(() => router.deprecate('v1', '')).toThrow(BetterMCPError)
      try {
        router.deprecate('v1', '')
      } catch (err) {
        expect((err as BetterMCPError).code).toBe('BMCP010')
      }
    })

    it('rejects whitespace-only migrateToSha', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')

      expect(() => router.deprecate('v1', '   ')).toThrow(BetterMCPError)
    })

    it('persists to store', () => {
      const router = new VersionRouter()
      const store = createMockStore()
      vi.mocked(store.getVersionStates).mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'v1', state: 'active', created_at: '', updated_at: '' },
      ])

      router.pin('v1', [createEndpoint()], 'https://api.example.com')
      router.deprecate('v1', 'v2', store)

      expect(store.updateVersionState).toHaveBeenCalledWith('vs-1', 'deprecated', expect.any(String))
    })

    it('throws for unknown version', () => {
      const router = new VersionRouter()
      expect(() => router.deprecate('unknown', 'v2')).toThrow(BetterMCPError)
    })

    it('uses a single timestamp for deprecationInfo and store update', () => {
      const router = new VersionRouter()
      const store = createMockStore()
      vi.mocked(store.getVersionStates).mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'v1', state: 'active', created_at: '', updated_at: '' },
      ])

      router.pin('v1', [createEndpoint()], 'https://api.example.com')
      router.deprecate('v1', 'v2', store)

      const info = router.getDeprecationInfo('v1')
      const storeCall = vi.mocked(store.updateVersionState).mock.calls[0]
      expect(info!.deprecatedAt).toBe(storeCall![2])
    })
  })

  describe('sunset', () => {
    it('transitions deprecated → sunset (AC3)', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')
      router.deprecate('v1', 'v2')

      router.sunset('v1')

      expect(router.getState('v1')).toBe('sunset')
    })

    it('preserves deprecation info after sunset', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')
      router.deprecate('v1', 'v2')
      router.sunset('v1')

      const info = router.getDeprecationInfo('v1')
      expect(info).toBeDefined()
      expect(info!.migrateToSha).toBe('v2')
    })

    it('rejects sunset on active version (must deprecate first)', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')

      expect(() => router.sunset('v1')).toThrow(BetterMCPError)
    })

    it('persists to store', () => {
      const router = new VersionRouter()
      const store = createMockStore()
      vi.mocked(store.getVersionStates).mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'v1', state: 'deprecated', created_at: '', updated_at: '' },
      ])

      router.pin('v1', [createEndpoint()], 'https://api.example.com')
      router.deprecate('v1', 'v2')
      router.sunset('v1', store)

      expect(store.updateVersionState).toHaveBeenCalledWith('vs-1', 'sunset', expect.any(String))
    })
  })

  describe('concurrent transition safety (AC6)', () => {
    it('all transitions resolve consistently under parallel dispatch', async () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')
      router.pin('v2', [createEndpoint()], 'https://api.example.com')
      router.pin('v3', [createEndpoint()], 'https://api.example.com')

      // All transitions are valid (active → deprecated), dispatched via Promise.all
      await Promise.all([
        Promise.resolve(router.deprecate('v1', 'v-next')),
        Promise.resolve(router.deprecate('v2', 'v-next')),
        Promise.resolve(router.deprecate('v3', 'v-next')),
      ])

      expect(router.getState('v1')).toBe('deprecated')
      expect(router.getState('v2')).toBe('deprecated')
      expect(router.getState('v3')).toBe('deprecated')
    })
  })

  describe('unpin', () => {
    it('removes a deprecated version', () => {
      const router = new VersionRouter()
      router.pin('abc123', [createEndpoint()], 'https://api.example.com')
      router.deprecate('abc123', 'v2')

      const removed = router.unpin('abc123')

      expect(removed).toBe(true)
      expect(router.has('abc123')).toBe(false)
      expect(router.size).toBe(0)
    })

    it('removes a sunset version', () => {
      const router = new VersionRouter()
      router.pin('abc123', [createEndpoint()], 'https://api.example.com')
      router.deprecate('abc123', 'v2')
      router.sunset('abc123')

      const removed = router.unpin('abc123')

      expect(removed).toBe(true)
      expect(router.has('abc123')).toBe(false)
    })

    it('rejects unpin of active version (must deprecate first)', () => {
      const router = new VersionRouter()
      router.pin('abc123', [createEndpoint()], 'https://api.example.com')

      expect(() => router.unpin('abc123')).toThrow(BetterMCPError)
      try {
        router.unpin('abc123')
      } catch (err) {
        const e = err as BetterMCPError
        expect(e.code).toBe('BMCP013')
        expect(e.problem).toContain('deprecate')
      }
    })

    it('returns false for non-existent version', () => {
      const router = new VersionRouter()
      expect(router.unpin('nonexistent')).toBe(false)
    })

    it('updates store state to sunset when provided', () => {
      const router = new VersionRouter()
      const store = createMockStore()
      vi.mocked(store.getVersionStates).mockReturnValue([
        { id: 'vs-1', endpoint_path: 'GET /products', version_sha: 'abc123', state: 'deprecated', created_at: '', updated_at: '' },
      ])

      router.pin('abc123', [createEndpoint()], 'https://api.example.com')
      router.deprecate('abc123', 'v2')
      router.unpin('abc123', store)

      expect(store.updateVersionState).toHaveBeenCalledWith('vs-1', 'sunset', expect.any(String))
    })
  })

  describe('listVersions', () => {
    it('returns info for all pinned versions', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')
      router.pin('v2', [createEndpoint(), createEndpoint({ path: '/orders' })], 'https://api2.example.com')

      const versions = router.listVersions()

      expect(versions).toHaveLength(2)
      expect(versions).toContainEqual(expect.objectContaining({ sha: 'v1', state: 'active', endpointCount: 1 }))
      expect(versions).toContainEqual(expect.objectContaining({ sha: 'v2', state: 'active', endpointCount: 2 }))
    })

    it('includes deprecation info for deprecated versions', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')
      router.deprecate('v1', 'v2')

      const versions = router.listVersions()
      expect(versions[0].deprecationInfo).toBeDefined()
      expect(versions[0].deprecationInfo!.migrateToSha).toBe('v2')
    })

    it('returns empty array when no versions pinned', () => {
      const router = new VersionRouter()
      expect(router.listVersions()).toEqual([])
    })
  })

  describe('getState / getDeprecationInfo', () => {
    it('returns state for pinned version', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')
      expect(router.getState('v1')).toBe('active')
    })

    it('returns undefined for unknown version', () => {
      const router = new VersionRouter()
      expect(router.getState('unknown')).toBeUndefined()
    })

    it('returns undefined deprecation info for active version', () => {
      const router = new VersionRouter()
      router.pin('v1', [createEndpoint()], 'https://api.example.com')
      expect(router.getDeprecationInfo('v1')).toBeUndefined()
    })
  })
})
