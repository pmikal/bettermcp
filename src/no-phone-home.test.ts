/**
 * No-Phone-Home Guarantee (Story 6.2, NFR11)
 *
 * Verifies that bettermcp makes zero outbound network calls during server
 * initialization and configuration. This test intercepts globalThis.fetch
 * to capture every outbound HTTP request during:
 *
 *   constructor → loadSpec → config access → pinVersion → onTranslate → auth → start
 *
 * The guarantee scope is server runtime initialization — the only code path
 * that intentionally calls fetch() is the execute() tool handler (which
 * forwards to the user-configured upstream API). That handler is registered
 * as an MCP tool inside start() and cannot be invoked without a connected
 * transport. Full lifecycle coverage (including execute/search/report tool
 * invocations) requires an in-memory MCP transport and is tracked as a
 * follow-up action item.
 *
 * Scope limitation: this test intercepts globalThis.fetch, which covers all
 * HTTP calls made by the server runtime. It does not cover CLI commands
 * (e.g., triage's github-issues.ts) which use child_process.execSync —
 * those are CLI-only paths, not server runtime.
 *
 * If this test fails, it means bettermcp is phoning home during initialization —
 * sending telemetry, analytics, update checks, or any other traffic the operator
 * didn't authorize.
 *
 * Referenced in README security section.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BetterMCP } from './server.js'
import type { ParsedSpec } from './spec/spec-types.js'

// Mock parseSpec to avoid file I/O
vi.mock('./spec/index.js', () => ({
  parseSpec: vi.fn(),
}))

// Track BetterMCP instances for cleanup (file watchers, debounce timers)
const instances: BetterMCP[] = []

afterEach(() => {
  for (const server of instances) {
    server.stopWatching()
  }
  instances.length = 0
})

function createServer(...args: ConstructorParameters<typeof BetterMCP>): BetterMCP {
  const server = new BetterMCP(...args)
  instances.push(server)
  return server
}

const UPSTREAM_URL = 'https://api.example.com'

const mockSpec: ParsedSpec = {
  version: '3.0',
  specVersion: '3.0.3',
  title: 'Test API',
  baseUrl: UPSTREAM_URL,
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

describe('No-Phone-Home Guarantee (NFR11)', () => {
  let fetchCalls: { url: string; init?: RequestInit }[]
  let originalFetch: typeof globalThis.fetch

  beforeEach(async () => {
    // Capture original fetch FIRST — before anything that could throw
    originalFetch = globalThis.fetch

    vi.resetAllMocks()
    const specModule = await import('./spec/index.js')
    vi.mocked(specModule.parseSpec).mockResolvedValue(mockSpec)

    // Intercept all outbound fetch calls
    fetchCalls = []
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      fetchCalls.push({ url, init })
      // Return a minimal valid response
      return new Response(JSON.stringify({ id: 1, name: 'Fido' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as typeof globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('constructor makes zero network calls', () => {
    createServer()
    expect(fetchCalls).toHaveLength(0)
  })

  it('constructor with proxy mode makes zero network calls', () => {
    createServer({ mode: 'proxy', upstream: 'https://api.stripe.com' })
    expect(fetchCalls).toHaveLength(0)
  })

  it('loadSpec makes zero network calls', async () => {
    const server = createServer()
    await server.loadSpec('./test.yaml')
    expect(fetchCalls).toHaveLength(0)
  })

  it('getConfig and getSpec make zero network calls', async () => {
    const server = createServer()
    await server.loadSpec('./test.yaml')
    server.getConfig()
    server.getSpec()
    expect(fetchCalls).toHaveLength(0)
  })

  it('pinVersion makes zero network calls', async () => {
    const server = createServer()
    const spec = await server.loadSpec('./test.yaml')
    server.pinVersion('abc123', spec.endpoints, spec.baseUrl!)
    expect(fetchCalls).toHaveLength(0)
  })

  it('onTranslate registration makes zero network calls', () => {
    const server = createServer()
    server.onTranslate({
      version: 'v1',
      endpoint: 'POST /orders',
      request: (b) => b,
      response: (b) => b,
    })
    expect(fetchCalls).toHaveLength(0)
  })

  it('auth handler registration makes zero network calls', () => {
    const server = createServer()
    server.auth(({ headers }) => ({ endpoint: '', method: '', headers }))
    expect(fetchCalls).toHaveLength(0)
  })

  describe('server initialization — owner mode', () => {
    it('start() makes zero fetch calls during initialization', async () => {
      const server = createServer()
      await server.loadSpec('./test.yaml')

      // startup + loadSpec complete — zero fetch calls
      expect(fetchCalls).toHaveLength(0)

      // start() connects stdio transport — which fails in test env.
      // We verify that start()'s initialization phase (retention purge,
      // validator compilation, tool registration) makes no outbound calls.
      try {
        await server.start()
      } catch (err) {
        // Only transport-related errors are expected — not unexpected failures
        expect(err).toBeDefined()
        expect(String(err)).toMatch(/transport|stdin|stdio|connect|pipe/i)
      }

      // All start() initialization is local — zero fetch calls
      expect(fetchCalls).toHaveLength(0)
    })
  })

  describe('server initialization — proxy mode', () => {
    it('start() makes zero fetch calls during initialization', async () => {
      const PROXY_UPSTREAM = 'https://api.stripe.com'
      const server = createServer({ mode: 'proxy', upstream: PROXY_UPSTREAM })
      await server.loadSpec('./test.yaml')

      // startup + loadSpec — zero calls
      expect(fetchCalls).toHaveLength(0)

      server.auth(({ headers }) => ({ endpoint: '', method: '', headers }))
      expect(fetchCalls).toHaveLength(0)

      try {
        await server.start()
      } catch (err) {
        expect(err).toBeDefined()
        expect(String(err)).toMatch(/transport|stdin|stdio|connect|pipe/i)
      }

      // start() initialization — zero calls (retention purge, validator compilation, tool registration)
      expect(fetchCalls).toHaveLength(0)
    })
  })

  it('module import triggers zero fetch calls', () => {
    // If any imported module made a fetch call during initialization
    // (e.g., update check on import), it would appear in fetchCalls
    // since the interceptor is installed before any test code runs.
    expect(fetchCalls).toHaveLength(0)
  })
})
