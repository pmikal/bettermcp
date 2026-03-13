import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { BetterMCP } from '../../src/server.js'
import type { UserConfig } from '../../src/config/schema.js'

export interface FetchCall {
  url: string
  method?: string
  headers?: Record<string, string>
  init?: RequestInit
}

export interface TestHarnessOptions {
  config?: UserConfig
  interceptFetch?: boolean
  mockResponses?: Map<string, () => Response>
}

export interface TestHarness {
  client: Client
  server: BetterMCP
  fetchCalls: FetchCall[]
  cleanup: () => Promise<void>
}

/**
 * Creates a BetterMCP server connected to an MCP client via in-memory transport.
 * The `setup` callback runs before start() — use it to call loadSpec(), auth(), etc.
 *
 * Defaults to in-memory SQLite (`:memory:`) and hotReload: false to avoid
 * file descriptor leaks and file watcher noise in tests.
 */
export async function createTestHarness(
  setup: (server: BetterMCP) => Promise<void>,
  options?: TestHarnessOptions,
): Promise<TestHarness> {
  // #2: Default to :memory: to avoid shared SQLite file conflicts between instances
  const config: UserConfig = {
    hotReload: false,
    db: ':memory:',
    ...options?.config,
  }

  const server = new BetterMCP(config)
  await setup(server)

  const fetchCalls: FetchCall[] = []
  let originalFetch: typeof globalThis.fetch | undefined
  // #3: Track the mock function so we can verify identity on restore
  let mockFn: typeof globalThis.fetch | undefined

  if (options?.interceptFetch) {
    originalFetch = globalThis.fetch
    const mockResponses = options.mockResponses
    // #7: Capture Request object metadata (method, headers) into FetchCall
    mockFn = async (input: string | URL | Request, init?: RequestInit) => {
      const call: FetchCall = { url: '' }

      if (typeof input === 'string') {
        call.url = input
      } else if (input instanceof URL) {
        call.url = input.toString()
      } else {
        // Request object — extract metadata that would otherwise be lost
        call.url = input.url
        call.method = input.method
        const hdrs: Record<string, string> = {}
        input.headers.forEach((v, k) => { hdrs[k] = v })
        if (Object.keys(hdrs).length > 0) call.headers = hdrs
      }

      if (init) {
        call.init = init
        if (init.method) call.method = init.method
      }

      fetchCalls.push(call)

      if (mockResponses) {
        for (const [pattern, factory] of mockResponses) {
          if (call.url.includes(pattern)) {
            return factory()
          }
        }
      }

      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    globalThis.fetch = mockFn
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  // #5: If initialization partially succeeds then fails, clean up before re-throwing
  let client: Client | undefined
  try {
    await server.start({ transport: serverTransport })
    client = new Client({ name: 'test-client', version: '1.0.0' })
    await client.connect(clientTransport)
  } catch (err) {
    try { await serverTransport.close() } catch { /* best-effort */ }
    try { await clientTransport.close() } catch { /* best-effort */ }
    server.stopWatching()
    // #3: Restore fetch only if it's still our mock
    if (originalFetch && mockFn && globalThis.fetch === mockFn) {
      globalThis.fetch = originalFetch
    }
    throw err
  }

  // #6: Idempotent cleanup — safe to call multiple times
  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    try { await client!.close() } catch { /* best-effort */ }
    try { await clientTransport.close() } catch { /* best-effort */ }
    try { await serverTransport.close() } catch { /* best-effort */ }
    server.stopWatching()
    // #3: Only restore fetch if globalThis.fetch is still our mock
    if (originalFetch && mockFn && globalThis.fetch === mockFn) {
      globalThis.fetch = originalFetch
    }
  }

  return { client: client!, server, fetchCalls, cleanup }
}
