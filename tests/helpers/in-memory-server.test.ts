import { describe, it, expect, afterEach } from 'vitest'
import { createTestHarness, type TestHarness } from './in-memory-server.js'
import { resolve } from 'node:path'

const PETSTORE_SPEC = resolve(
  import.meta.dirname,
  '../fixtures/petstore-with-server.yaml',
)

describe('createTestHarness', () => {
  let harness: TestHarness | undefined

  afterEach(async () => {
    if (harness) {
      await harness.cleanup()
      harness = undefined
    }
  })

  // #8: Use arrayContaining instead of strict equality — don't freeze tool inventory
  it('connects client to server and lists all tools', async () => {
    harness = await createTestHarness(async (server) => {
      await server.loadSpec(PETSTORE_SPEC)
    })

    const { tools } = await harness.client.listTools()
    const toolNames = tools.map((t) => t.name)
    expect(toolNames).toEqual(expect.arrayContaining(['search', 'execute', 'report', 'health']))
    expect(tools.length).toBeGreaterThanOrEqual(4)
  })

  it('client can call search tool and get valid response', async () => {
    harness = await createTestHarness(async (server) => {
      await server.loadSpec(PETSTORE_SPEC)
    })

    const result = await harness.client.callTool({
      name: 'search',
      arguments: { query: 'pets' },
    })

    expect(result.content).toBeDefined()
    expect(Array.isArray(result.content)).toBe(true)
    expect(result.content.length).toBeGreaterThan(0)

    const textContent = result.content[0] as { type: string; text: string }
    expect(textContent.type).toBe('text')
    const parsed = JSON.parse(textContent.text)
    expect(parsed.endpoints).toBeDefined()
    expect(Array.isArray(parsed.endpoints)).toBe(true)
    expect(parsed.endpoints.length).toBeGreaterThan(0)
  })

  it('client can call health tool', async () => {
    harness = await createTestHarness(async (server) => {
      await server.loadSpec(PETSTORE_SPEC)
    })

    const result = await harness.client.callTool({
      name: 'health',
      arguments: {},
    })

    expect(result.content).toBeDefined()
    const textContent = result.content[0] as { type: string; text: string }
    expect(textContent.type).toBe('text')
    const parsed = JSON.parse(textContent.text)
    expect(parsed.status).toBe('ok')
  })

  it('interceptFetch captures outbound calls', async () => {
    harness = await createTestHarness(
      async (server) => {
        await server.loadSpec(PETSTORE_SPEC)
      },
      {
        interceptFetch: true,
        mockResponses: new Map([
          [
            'petstore.test.example.com',
            () =>
              new Response(JSON.stringify([{ id: 1, name: 'Fido' }]), {
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
    expect(harness.fetchCalls[0].url).toContain('petstore.test.example.com')

    expect(result.content).toBeDefined()
    const textContent = result.content[0] as { type: string; text: string }
    expect(textContent.type).toBe('text')
  })

  // #6: cleanup is idempotent — calling twice is safe
  it('cleanup releases all resources and is idempotent', async () => {
    harness = await createTestHarness(async (server) => {
      await server.loadSpec(PETSTORE_SPEC)
    })

    await harness.cleanup()
    await harness.cleanup() // second call is a no-op
    harness = undefined
  })

  // #4: Use try/finally so both harnesses are cleaned up even on failure
  it('multiple harness instances do not interfere', async () => {
    const harness1 = await createTestHarness(async (server) => {
      await server.loadSpec(PETSTORE_SPEC)
    })

    let harness2: TestHarness | undefined
    try {
      harness2 = await createTestHarness(async (server) => {
        await server.loadSpec(PETSTORE_SPEC)
      })

      const [result1, result2] = await Promise.all([
        harness1.client.callTool({ name: 'health', arguments: {} }),
        harness2.client.callTool({ name: 'health', arguments: {} }),
      ])

      expect(result1.content).toBeDefined()
      expect(result2.content).toBeDefined()
    } finally {
      await harness2?.cleanup()
      await harness1.cleanup()
    }
  })
})
