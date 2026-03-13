import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { discoverEndpoints, generateDiscoveredSpec, runDiscovery } from './index.js'
import type { DiscoveredEndpoint } from './index.js'

// We mock global fetch for discovery tests
const mockFetch = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch)
  mockFetch.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('discoverEndpoints', () => {
  it('throws DISCOVERY_PROBE_FAILED when base URL is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('Connection refused'))

    await expect(discoverEndpoints('https://api.example.com')).rejects.toThrow(
      /could not reach/,
    )
  })

  it('preserves original error as cause', async () => {
    const originalErr = new Error('ECONNREFUSED')
    mockFetch.mockRejectedValue(originalErr)

    try {
      await discoverEndpoints('https://api.example.com')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect((err as Error).cause).toBe(originalErr)
    }
  })

  it('blocks internal/private addresses (SSRF protection)', async () => {
    await expect(discoverEndpoints('http://127.0.0.1')).rejects.toThrow(/blocked/)
    await expect(discoverEndpoints('http://localhost')).rejects.toThrow(/blocked/)
    await expect(discoverEndpoints('http://169.254.169.254')).rejects.toThrow(/blocked/)
    await expect(discoverEndpoints('http://10.0.0.1')).rejects.toThrow(/blocked/)
    await expect(discoverEndpoints('http://192.168.1.1')).rejects.toThrow(/blocked/)
    await expect(discoverEndpoints('http://172.16.0.1')).rejects.toThrow(/blocked/)
  })

  it('returns discovered endpoints for responsive paths', async () => {
    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      const urlStr = typeof url === 'string' ? url : ''

      // HEAD check for reachability
      if (opts?.method === 'HEAD') {
        return new Response('', { status: 200 })
      }

      // Spec endpoints — 404
      if (urlStr.includes('openapi') || urlStr.includes('swagger') || urlStr.includes('api-docs')) {
        return new Response('', { status: 404 })
      }

      // /api/users exists
      if (urlStr.endsWith('/api/users')) {
        return new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      // /health exists
      if (urlStr.endsWith('/health')) {
        return new Response('{"status":"ok"}', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      // Everything else is 404
      return new Response('', { status: 404 })
    })

    const { endpoints, specUrl } = await discoverEndpoints('https://api.example.com')

    expect(specUrl).toBeNull()
    expect(endpoints.length).toBeGreaterThanOrEqual(2)

    const userEndpoint = endpoints.find((e) => e.path === '/api/users')
    expect(userEndpoint).toBeDefined()
    expect(userEndpoint!.method).toBe('GET')
    expect(userEndpoint!.statusCode).toBe(200)
    expect(userEndpoint!.contentType).toContain('application/json')

    const healthEndpoint = endpoints.find((e) => e.path === '/health')
    expect(healthEndpoint).toBeDefined()
  })

  it('does not record 3xx redirects as discovered endpoints', async () => {
    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      if (opts?.method === 'HEAD') {
        return new Response('', { status: 200 })
      }
      // /api returns a 301 redirect
      if (typeof url === 'string' && url.endsWith('/api')) {
        return new Response('', { status: 301, headers: { location: '/api/v2' } })
      }
      return new Response('', { status: 404 })
    })

    const { endpoints } = await discoverEndpoints('https://api.example.com')
    const apiEndpoint = endpoints.find((e) => e.path === '/api')
    expect(apiEndpoint).toBeUndefined()
  })

  it('detects existing spec URLs and short-circuits probing', async () => {
    const fetchCalls: string[] = []
    mockFetch.mockImplementation(async (url: string, opts?: RequestInit) => {
      fetchCalls.push(typeof url === 'string' ? url : '')
      if (opts?.method === 'HEAD') {
        return new Response('', { status: 200 })
      }
      if (typeof url === 'string' && url.includes('/openapi.json')) {
        return new Response('{"openapi":"3.0.3"}', { status: 200 })
      }
      return new Response('', { status: 404 })
    })

    const { endpoints, specUrl } = await discoverEndpoints('https://api.example.com')
    expect(specUrl).toBe('https://api.example.com/openapi.json')
    // Should short-circuit — no resource probing after spec URL found
    expect(endpoints).toEqual([])
    // Only HEAD + spec checks, no resource probes
    const resourceProbes = fetchCalls.filter(
      (u) => u.includes('/users') || u.includes('/products'),
    )
    expect(resourceProbes).toHaveLength(0)
  })

  it('handles trailing slash in base URL', async () => {
    mockFetch.mockImplementation(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === 'HEAD') {
        return new Response('', { status: 200 })
      }
      return new Response('', { status: 404 })
    })

    const { endpoints } = await discoverEndpoints('https://api.example.com/')
    expect(endpoints).toEqual([])
  })
})

describe('generateDiscoveredSpec', () => {
  it('generates valid YAML with discovered endpoints', () => {
    const endpoints: DiscoveredEndpoint[] = [
      { path: '/users', method: 'GET', statusCode: 200, contentType: 'application/json' },
      { path: '/health', method: 'GET', statusCode: 200, contentType: 'text/plain' },
    ]

    const yaml = generateDiscoveredSpec('https://api.example.com', endpoints)

    expect(yaml).toContain("openapi: '3.0.3'")
    expect(yaml).toContain('x-bettermcp-auto-discovered: true')
    expect(yaml).toContain('url: "https://api.example.com"')
    expect(yaml).toContain('/users:')
    expect(yaml).toContain('/health:')
    // JSON endpoint should have content: wrapper
    expect(yaml).toContain('content:')
    expect(yaml).toContain('application/json')
  })

  it('strips trailing slash from base URL', () => {
    const yaml = generateDiscoveredSpec('https://api.example.com/', [])
    expect(yaml).toContain('url: "https://api.example.com"')
    expect(yaml).not.toContain('url: "https://api.example.com/"')
  })

  it('generates operationIds from paths', () => {
    const endpoints: DiscoveredEndpoint[] = [
      { path: '/api/v1/users', method: 'GET', statusCode: 200, contentType: null },
    ]

    const yaml = generateDiscoveredSpec('https://api.example.com', endpoints)
    expect(yaml).toContain('"get_api_v1_users"')
  })

  it('quotes the server URL for YAML safety', () => {
    const yaml = generateDiscoveredSpec('https://api.example.com', [])
    // URL should be quoted
    expect(yaml).toMatch(/url: "https:\/\/api\.example\.com"/)
  })
})

describe('runDiscovery', () => {
  it('throws DISCOVERY_NO_ENDPOINTS when nothing is found', async () => {
    mockFetch.mockImplementation(async (_url: string, opts?: RequestInit) => {
      if (opts?.method === 'HEAD') {
        return new Response('', { status: 200 })
      }
      return new Response('', { status: 404 })
    })

    await expect(
      runDiscovery({ baseUrl: 'https://api.example.com' }),
    ).rejects.toThrow(/no endpoints/)
  })

  it('validates config at runtime', async () => {
    await expect(
      runDiscovery({ baseUrl: 'not-a-url' }),
    ).rejects.toThrow()

    await expect(
      runDiscovery({ baseUrl: '' }),
    ).rejects.toThrow()
  })
})
