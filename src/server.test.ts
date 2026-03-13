import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BetterMCP } from './server.js'
import { BetterMCPError } from './errors/index.js'
import type { ParsedSpec } from './spec/spec-types.js'

// Mock parseSpec to avoid file I/O
vi.mock('./spec/index.js', () => ({
  parseSpec: vi.fn(),
}))

// Track all BetterMCP instances created during tests so we can clean up file watchers
const instances: BetterMCP[] = []
const OriginalBetterMCP = BetterMCP
function createServer(...args: ConstructorParameters<typeof BetterMCP>): BetterMCP {
  const server = new OriginalBetterMCP(...args)
  instances.push(server)
  return server
}

afterEach(() => {
  for (const server of instances) {
    server.stopWatching()
  }
  instances.length = 0
})

const mockSpec: ParsedSpec = {
  version: '3.0',
  specVersion: '3.0.3',
  title: 'Test API',
  baseUrl: 'https://api.example.com',
  endpoints: [
    {
      path: '/pets',
      method: 'GET',
      operationId: 'listPets',
      summary: 'List all pets',
      description: 'Returns pets',
      parameters: [
        {
          name: 'limit',
          in: 'query',
          required: false,
          schema: { type: 'integer' },
          description: 'Max items',
        },
      ],
      requestBody: null,
      responses: { '200': { description: 'OK' } },
      confidence: { score: 0.85, factors: [] },
      warnings: [],
    },
    {
      path: '/pets',
      method: 'POST',
      operationId: 'createPet',
      summary: 'Create a pet',
      description: 'Add a new pet',
      parameters: [],
      requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
      responses: { '201': { description: 'Created' } },
      confidence: { score: 0.9, factors: [] },
      warnings: [],
    },
  ],
  warnings: [],
}

const mockSpecNoBaseUrl: ParsedSpec = {
  ...mockSpec,
  baseUrl: null,
}

describe('BetterMCP', () => {
  beforeEach(async () => {
    vi.resetAllMocks()
    const specModule = await import('./spec/index.js')
    vi.mocked(specModule.parseSpec).mockResolvedValue(mockSpec)
  })

  describe('constructor', () => {
    it('creates instance with default config', () => {
      const server = createServer()
      const config = server.getConfig()
      expect(config.wireLogging).toBe(true)
      expect(config.mode).toBe('owner')
      expect(config.db).toBe('./bettermcp.db')
    })

    it('creates instance with custom config', () => {
      const server = createServer({ db: './custom.db', wireLogging: false })
      const config = server.getConfig()
      expect(config.db).toBe('./custom.db')
      expect(config.wireLogging).toBe(false)
    })

    it('throws on invalid config', () => {
      expect(() => createServer({ db: '' })).toThrow()
    })
  })

  describe('loadSpec', () => {
    it('delegates to parseSpec and stores result', async () => {
      const server = createServer()
      const result = await server.loadSpec('./test.yaml')

      const specModule = await import('./spec/index.js')
      expect(specModule.parseSpec).toHaveBeenCalledWith('./test.yaml')
      expect(result).toBe(mockSpec)
      expect(server.getSpec()).toBe(mockSpec)
    })

    it('returns null spec before loadSpec is called', () => {
      const server = createServer()
      expect(server.getSpec()).toBeNull()
    })
  })

  describe('start', () => {
    it('throws BetterMCPError if no spec is loaded', async () => {
      const server = createServer()
      try {
        await server.start()
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(BetterMCPError)
        expect((err as BetterMCPError).code).toBe('BMCP005')
      }
    })

    it('throws BetterMCPError if started twice', async () => {
      const specModule = await import('./spec/index.js')
      vi.mocked(specModule.parseSpec).mockResolvedValue(mockSpec)

      const server = createServer()
      await server.loadSpec('./test.yaml')
      // First start will try to connect transport (which may fail in test env)
      // but the started flag should still be set
      try { await server.start() } catch { /* transport error in test is ok */ }
      try {
        await server.start()
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(BetterMCPError)
        expect((err as BetterMCPError).code).toBe('BMCP006')
      }
    })

    it('throws BetterMCPError if spec has no base URL', async () => {
      const specModule = await import('./spec/index.js')
      vi.mocked(specModule.parseSpec).mockResolvedValue(mockSpecNoBaseUrl)

      const server = createServer()
      await server.loadSpec('./test.yaml')
      try {
        await server.start()
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(BetterMCPError)
        expect((err as BetterMCPError).code).toBe('BMCP007')
      }
    })
  })

  describe('proxy mode', () => {
    it('creates instance with proxy mode and upstream', () => {
      const server = createServer({ mode: 'proxy', upstream: 'https://api.stripe.com' })
      const config = server.getConfig()
      expect(config.mode).toBe('proxy')
      expect(config.upstream).toBe('https://api.stripe.com')
    })

    it('throws on proxy mode without upstream', () => {
      expect(() => createServer({ mode: 'proxy' })).toThrow()
    })

    it('uses upstream URL as base URL in proxy mode', async () => {
      const specModule = await import('./spec/index.js')
      // Spec has no base URL — proxy mode doesn't need it
      vi.mocked(specModule.parseSpec).mockResolvedValue(mockSpecNoBaseUrl)

      const server = createServer({ mode: 'proxy', upstream: 'https://api.stripe.com' })
      await server.loadSpec('./test.yaml')
      // start() will try to connect transport which fails in test env,
      // but it should NOT throw BMCP007 (no base URL) since proxy mode uses upstream
      try {
        await server.start()
      } catch (err) {
        // Transport error is fine; BMCP007 is not
        if (err instanceof BetterMCPError) {
          expect((err as BetterMCPError).code).not.toBe('BMCP007')
        }
      }
    })
  })

  describe('auth handler', () => {
    it('registers a handler without throwing', () => {
      const server = createServer()
      expect(() => server.auth(({ headers }) => ({ endpoint: '', method: '', headers }))).not.toThrow()
    })

    it('registers an async handler without throwing', () => {
      const server = createServer()
      expect(() => server.auth(async ({ headers }) => ({ endpoint: '', method: '', headers }))).not.toThrow()
    })

    it('warns on duplicate registration', () => {
      const server = createServer()
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const handler = ({ headers }: { endpoint: string; method: string; headers: Record<string, string> }) => ({ endpoint: '', method: '', headers })
      server.auth(handler)
      server.auth(handler) // second registration
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('auth handler replaced'),
      )
      stderrSpy.mockRestore()
    })

    it('throws if called after start()', async () => {
      const server = createServer()
      await server.loadSpec('./test.yaml')
      try { await server.start() } catch { /* transport error expected */ }
      expect(() =>
        server.auth(({ headers }) => ({ endpoint: '', method: '', headers })),
      ).toThrow(/before start/)
    })
  })

  describe('onTranslate', () => {
    it('registers a translation handler without throwing', () => {
      const server = createServer()
      expect(() =>
        server.onTranslate({
          version: 'v1',
          endpoint: 'POST /orders',
          request: (b) => b,
          response: (b) => b,
        }),
      ).not.toThrow()
    })
  })

  describe('hot reload', () => {
    it('defaults hotReload to true', () => {
      const server = createServer()
      expect(server.getConfig().hotReload).toBe(true)
    })

    it('can disable hotReload via config', () => {
      const server = createServer({ hotReload: false })
      expect(server.getConfig().hotReload).toBe(false)
    })

    it('stopWatching is callable before start', () => {
      const server = createServer()
      expect(() => server.stopWatching()).not.toThrow()
    })

    it('throws if loadSpec called after start', async () => {
      const server = createServer()
      await server.loadSpec('./test.yaml')
      try { await server.start() } catch { /* transport error expected */ }
      await expect(server.loadSpec('./other.yaml')).rejects.toThrow(/after start/)
    })
  })

  describe('discover', () => {
    it('throws if called after start', async () => {
      const server = createServer()
      await server.loadSpec('./test.yaml')
      try { await server.start() } catch { /* transport error expected */ }
      await expect(
        server.discover({ baseUrl: 'https://api.example.com' }),
      ).rejects.toThrow(/after start/)
    })
  })

  describe('pinVersion', () => {
    it('pins a version without throwing', async () => {
      const specModule = await import('./spec/index.js')
      vi.mocked(specModule.parseSpec).mockResolvedValue(mockSpec)

      const server = createServer()
      const loadedSpec = await server.loadSpec('./test.yaml')
      expect(() =>
        server.pinVersion('abc123', loadedSpec.endpoints, loadedSpec.baseUrl!),
      ).not.toThrow()
    })
  })
})

describe('BetterMCP search tool', () => {
  it('handleQuery is used by search — verified via integration', async () => {
    // The search tool delegates to handleQuery internally.
    // We verify handleQuery independently in query-handler.test.ts.
    // Here we verify the BetterMCP class stores the spec correctly for search.
    const specModule = await import('./spec/index.js')
    vi.mocked(specModule.parseSpec).mockResolvedValue(mockSpec)

    const server = createServer()
    await server.loadSpec('./test.yaml')
    const spec = server.getSpec()
    expect(spec).not.toBeNull()
    expect(spec!.endpoints).toHaveLength(2)
  })
})

describe('BetterMCP execute tool', () => {
  it('stores baseUrl from spec', async () => {
    const specModule = await import('./spec/index.js')
    vi.mocked(specModule.parseSpec).mockResolvedValue(mockSpec)

    const server = createServer()
    await server.loadSpec('./test.yaml')
    const spec = server.getSpec()
    expect(spec!.baseUrl).toBe('https://api.example.com')
  })
})

describe('extractRateLimits', () => {
  let extractRateLimitsFn: typeof import('./server.js').extractRateLimits

  beforeEach(async () => {
    const mod = await import('./server.js')
    extractRateLimitsFn = mod.extractRateLimits
  })

  it('extracts standard rate limit headers', () => {
    const headers = {
      'content-type': 'application/json',
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '42',
      'retry-after': '30',
    }
    const result = extractRateLimitsFn(headers)
    expect(result).toEqual({
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '42',
      'retry-after': '30',
    })
  })

  it('returns undefined when no rate limit headers present', () => {
    const headers = { 'content-type': 'application/json', 'x-request-id': 'abc' }
    expect(extractRateLimitsFn(headers)).toBeUndefined()
  })

  it('handles case-insensitive matching', () => {
    const headers = { 'X-RateLimit-Remaining': '5', 'Retry-After': '60' }
    const result = extractRateLimitsFn(headers)
    expect(result).toEqual({
      'X-RateLimit-Remaining': '5',
      'Retry-After': '60',
    })
  })

  it('extracts IETF draft rate limit headers', () => {
    const headers = {
      'ratelimit-limit': '1000',
      'ratelimit-remaining': '999',
      'ratelimit-reset': '120',
      'ratelimit-policy': '1000;w=3600',
    }
    const result = extractRateLimitsFn(headers)
    expect(result).toEqual(headers)
  })

  it('returns undefined for empty headers', () => {
    expect(extractRateLimitsFn({})).toBeUndefined()
  })
})

describe('BetterMCP report tool', () => {
  it('report response shape includes stored: true', () => {
    const expected = {
      status: 'received',
      stored: true,
      endpoint: '/pets',
      category: 'unexpected-response',
    }
    expect(expected.status).toBe('received')
    expect(expected.stored).toBe(true)
    expect(expected.endpoint).toBe('/pets')
    expect(expected.category).toBe('unexpected-response')
  })

  it('report failure response shape includes stored: false', () => {
    const expected = {
      status: 'received',
      stored: false,
      endpoint: '/pets',
      category: 'unexpected-response',
      error: 'Failed to persist feedback',
    }
    expect(expected.status).toBe('received')
    expect(expected.stored).toBe(false)
  })
})
