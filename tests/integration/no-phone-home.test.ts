/**
 * Full Lifecycle No-Phone-Home Integration Test (Story 8.2, NFR11)
 *
 * Verifies that bettermcp makes zero outbound network calls to any host
 * other than the configured upstream API during a complete lifecycle:
 *
 *   loadSpec → start → search → execute → report
 *
 * This extends the initialization-only coverage in src/no-phone-home.test.ts
 * by exercising tool handlers through the real MCP protocol layer via
 * in-memory transport.
 *
 * The test intercepts globalThis.fetch and asserts that every captured call
 * targets the configured upstream URL. Any call to an unexpected host fails
 * the test with a clear diagnostic message.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { createTestHarness, type TestHarness } from '../helpers/in-memory-server.js'
import { resolve } from 'node:path'

const PETSTORE_SPEC = resolve(
  import.meta.dirname,
  '../fixtures/petstore-with-server.yaml',
)

const UPSTREAM_HOST = 'petstore.test.example.com'

describe('Full Lifecycle No-Phone-Home (NFR11)', () => {
  let harness: TestHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.cleanup()
      harness = undefined
    }
  })

  function assertOnlyUpstreamCalls() {
    for (const call of harness!.fetchCalls) {
      const url = new URL(call.url)
      expect(
        url.hostname,
        `Unexpected outbound call to ${url.hostname} (full URL: ${call.url}). ` +
        `Only calls to ${UPSTREAM_HOST} are allowed.`,
      ).toBe(UPSTREAM_HOST)
    }
  }

  it('search makes zero outbound fetch calls', async () => {
    harness = await createTestHarness(
      async (server) => { await server.loadSpec(PETSTORE_SPEC) },
      { interceptFetch: true },
    )

    await harness.client.callTool({
      name: 'search',
      arguments: { query: 'pets' },
    })

    expect(harness.fetchCalls).toHaveLength(0)
  })

  it('execute calls only the configured upstream', async () => {
    harness = await createTestHarness(
      async (server) => { await server.loadSpec(PETSTORE_SPEC) },
      {
        interceptFetch: true,
        mockResponses: new Map([
          [
            UPSTREAM_HOST,
            () => new Response(JSON.stringify([{ id: 1, name: 'Fido' }]), {
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

    // At least one fetch call was made
    expect(harness.fetchCalls.length).toBeGreaterThan(0)

    // Every call targets the upstream — no telemetry, analytics, or other hosts
    assertOnlyUpstreamCalls()

    // Response came back through MCP correctly
    const textContent = result.content[0] as { type: string; text: string }
    expect(textContent.type).toBe('text')
    const envelope = JSON.parse(textContent.text)
    expect(envelope.status).toBe(200)
    const body = JSON.parse(envelope.body)
    expect(body).toEqual([{ id: 1, name: 'Fido' }])
  })

  it('report makes zero outbound fetch calls', async () => {
    harness = await createTestHarness(
      async (server) => { await server.loadSpec(PETSTORE_SPEC) },
      { interceptFetch: true },
    )

    await harness.client.callTool({
      name: 'report',
      arguments: {
        endpoint: '/pets',
        category: 'schema_mismatch',
        message: 'Response missing required field',
      },
    })

    expect(harness.fetchCalls).toHaveLength(0)
  })

  it('health makes zero outbound fetch calls', async () => {
    harness = await createTestHarness(
      async (server) => { await server.loadSpec(PETSTORE_SPEC) },
      { interceptFetch: true },
    )

    await harness.client.callTool({
      name: 'health',
      arguments: {},
    })

    expect(harness.fetchCalls).toHaveLength(0)
  })

  it('full lifecycle: search → execute → report — only upstream calls', async () => {
    harness = await createTestHarness(
      async (server) => { await server.loadSpec(PETSTORE_SPEC) },
      {
        interceptFetch: true,
        mockResponses: new Map([
          [
            UPSTREAM_HOST,
            () => new Response(JSON.stringify({ id: 1, name: 'Fido', tag: 'dog' }), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            }),
          ],
        ]),
      },
    )

    // 1. Search — no fetch
    const searchResult = await harness.client.callTool({
      name: 'search',
      arguments: { query: 'pets' },
    })
    expect(harness.fetchCalls).toHaveLength(0)
    const endpoints = JSON.parse(
      (searchResult.content[0] as { text: string }).text,
    ).endpoints
    expect(endpoints.length).toBeGreaterThan(0)

    // 2. Execute — one fetch to upstream only
    const execResult = await harness.client.callTool({
      name: 'execute',
      arguments: { endpoint: '/pets/1', method: 'GET' },
    })
    expect(harness.fetchCalls.length).toBeGreaterThan(0)
    assertOnlyUpstreamCalls()

    const execEnvelope = JSON.parse(
      (execResult.content[0] as { text: string }).text,
    )
    expect(execEnvelope.status).toBe(200)
    const execBody = JSON.parse(execEnvelope.body)
    expect(execBody.name).toBe('Fido')

    const fetchCountAfterExecute = harness.fetchCalls.length

    // 3. Report — no additional fetch
    await harness.client.callTool({
      name: 'report',
      arguments: {
        endpoint: '/pets/1',
        category: 'schema_mismatch',
        message: 'tag field not in spec',
        method: 'GET',
      },
    })
    expect(harness.fetchCalls).toHaveLength(fetchCountAfterExecute)

    // Final assertion: every fetch call in the entire lifecycle hit only the upstream
    assertOnlyUpstreamCalls()
  })
})
