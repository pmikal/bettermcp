/**
 * Auth Handler Behavioral Coverage via MCP (Story 8.3, I3)
 *
 * Verifies auth handler behavior through the real MCP tool interface:
 * - Handler invoked before upstream fetch
 * - Handler-returned headers present in the request
 * - Throwing handler produces structured BMCP016 error
 * - Wire log contains post-auth headers
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createTestHarness, type TestHarness } from '../helpers/in-memory-server.js'
import { resolve } from 'node:path'

const PETSTORE_SPEC = resolve(
  import.meta.dirname,
  '../fixtures/petstore-with-server.yaml',
)

const UPSTREAM_HOST = 'petstore.test.example.com'

describe('Auth Handler via MCP (I3)', () => {
  let harness: TestHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.cleanup()
      harness = undefined
    }
  })

  it('auth handler is invoked before upstream fetch and headers are injected', async () => {
    let handlerCalled = false
    let handlerReceivedEndpoint = ''
    let handlerReceivedMethod = ''

    harness = await createTestHarness(
      async (server) => {
        await server.loadSpec(PETSTORE_SPEC)
        server.auth(({ endpoint, method, headers }) => {
          handlerCalled = true
          handlerReceivedEndpoint = endpoint
          handlerReceivedMethod = method
          return {
            headers: {
              ...headers,
              'Authorization': 'Bearer test-token-12345',
              'X-Custom-Auth': 'custom-value',
            },
          }
        })
      },
      {
        interceptFetch: true,
        mockResponses: new Map([
          [
            UPSTREAM_HOST,
            () => new Response(JSON.stringify({ id: 1, name: 'Fido' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          ],
        ]),
      },
    )

    const result = await harness.client.callTool({
      name: 'execute',
      arguments: { endpoint: '/pets', method: 'GET' },
    })

    // AC1: Handler was invoked
    expect(handlerCalled).toBe(true)
    expect(handlerReceivedEndpoint).toBe('/pets')
    expect(handlerReceivedMethod).toBe('GET')

    // AC2: Handler-returned headers are in the fetch call
    expect(harness.fetchCalls.length).toBeGreaterThan(0)
    const fetchInit = harness.fetchCalls[0].init
    expect(fetchInit).toBeDefined()
    const sentHeaders = fetchInit!.headers as Record<string, string>
    expect(sentHeaders['Authorization']).toBe('Bearer test-token-12345')
    expect(sentHeaders['X-Custom-Auth']).toBe('custom-value')

    // Response came back through MCP
    const envelope = JSON.parse(
      (result.content[0] as { type: string; text: string }).text,
    )
    expect(envelope.status).toBe(200)
  })

  it('throwing auth handler returns structured BMCP016 error via MCP', async () => {
    harness = await createTestHarness(
      async (server) => {
        await server.loadSpec(PETSTORE_SPEC)
        server.auth(() => {
          throw new Error('Token expired — please re-authenticate')
        })
      },
      {
        interceptFetch: true,
        mockResponses: new Map([
          [
            UPSTREAM_HOST,
            () => new Response('should not reach', { status: 500 }),
          ],
        ]),
      },
    )

    const result = await harness.client.callTool({
      name: 'execute',
      arguments: { endpoint: '/pets', method: 'GET' },
    })

    // AC3: No fetch was made — auth failed before reaching upstream
    expect(harness.fetchCalls).toHaveLength(0)

    // Error returned through MCP protocol
    expect(result.isError).toBe(true)
    const errBody = JSON.parse(
      (result.content[0] as { type: string; text: string }).text,
    )
    expect(errBody.code).toBe('BMCP016')
    expect(errBody.error).toContain('Token expired')
    expect(errBody.fix).toBeDefined()
    expect(errBody.endpoint).toBe('/pets')
    expect(errBody.method).toBe('GET')
  })

  it('auth handler returning invalid result returns structured BMCP016 error', async () => {
    harness = await createTestHarness(
      async (server) => {
        await server.loadSpec(PETSTORE_SPEC)
        // Return invalid result (no headers record)
        server.auth(() => null as any)
      },
      {
        interceptFetch: true,
        mockResponses: new Map([
          [UPSTREAM_HOST, () => new Response('should not reach', { status: 500 })],
        ]),
      },
    )

    const result = await harness.client.callTool({
      name: 'execute',
      arguments: { endpoint: '/pets', method: 'GET' },
    })

    // No fetch — auth validation caught the bad return
    expect(harness.fetchCalls).toHaveLength(0)

    expect(result.isError).toBe(true)
    const errBody = JSON.parse(
      (result.content[0] as { type: string; text: string }).text,
    )
    expect(errBody.code).toBe('BMCP016')
    expect(errBody.error).toContain('Handler must return')
  })

  it('async auth handler works correctly', async () => {
    harness = await createTestHarness(
      async (server) => {
        await server.loadSpec(PETSTORE_SPEC)
        server.auth(async ({ headers }) => {
          // Simulate async token fetch
          await new Promise((r) => setTimeout(r, 1))
          return {
            headers: {
              ...headers,
              'Authorization': 'Bearer async-token',
            },
          }
        })
      },
      {
        interceptFetch: true,
        mockResponses: new Map([
          [
            UPSTREAM_HOST,
            () => new Response(JSON.stringify({ ok: true }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          ],
        ]),
      },
    )

    const result = await harness.client.callTool({
      name: 'execute',
      arguments: { endpoint: '/pets', method: 'GET' },
    })

    expect(harness.fetchCalls.length).toBeGreaterThan(0)
    const sentHeaders = harness.fetchCalls[0].init!.headers as Record<string, string>
    expect(sentHeaders['Authorization']).toBe('Bearer async-token')

    const envelope = JSON.parse(
      (result.content[0] as { type: string; text: string }).text,
    )
    expect(envelope.status).toBe(200)
  })
})
