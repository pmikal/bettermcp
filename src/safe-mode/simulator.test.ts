import { describe, it, expect } from 'vitest'
import { extractResponseSchema, simulateResponse } from './simulator.js'

describe('extractResponseSchema', () => {
  it('extracts schema from a 200 response with application/json', () => {
    const responses = {
      '200': {
        content: {
          'application/json': {
            schema: { type: 'object', properties: { id: { type: 'number' } } },
          },
        },
      },
    }
    const schema = extractResponseSchema(responses)
    expect(schema).toEqual({
      type: 'object',
      properties: { id: { type: 'number' } },
    })
  })

  it('returns null when no 2xx response exists', () => {
    const responses = {
      '400': {
        content: {
          'application/json': {
            schema: { type: 'object' },
          },
        },
      },
    }
    expect(extractResponseSchema(responses)).toBeNull()
  })

  it('returns null when response has no content', () => {
    const responses = {
      '200': {
        description: 'No content response',
      },
    }
    expect(extractResponseSchema(responses)).toBeNull()
  })

  it('returns null when content has no application/json', () => {
    const responses = {
      '200': {
        content: {
          'text/plain': { schema: { type: 'string' } },
        },
      },
    }
    expect(extractResponseSchema(responses)).toBeNull()
  })

  it('returns null when json has no schema', () => {
    const responses = {
      '200': {
        content: {
          'application/json': {},
        },
      },
    }
    expect(extractResponseSchema(responses)).toBeNull()
  })

  it('prefers 200 over 201', () => {
    const responses = {
      '201': {
        content: {
          'application/json': {
            schema: { type: 'string' },
          },
        },
      },
      '200': {
        content: {
          'application/json': {
            schema: { type: 'number' },
          },
        },
      },
    }
    expect(extractResponseSchema(responses)).toEqual({ type: 'number' })
  })

  it('falls back to 201 when 200 has no JSON content', () => {
    const responses = {
      '200': { description: 'No content' },
      '201': {
        content: {
          'application/json': {
            schema: { type: 'string' },
          },
        },
      },
    }
    expect(extractResponseSchema(responses)).toEqual({ type: 'string' })
  })

  it('returns null for empty responses object', () => {
    expect(extractResponseSchema({})).toBeNull()
  })
})

describe('simulateResponse', () => {
  it('generates a response for a simple object schema', async () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'integer' },
      },
      required: ['name', 'age'],
    }
    const result = await simulateResponse(schema, '/test')
    expect(result.confidence).toBe('high')
    expect(result.warnings).toEqual([])
    expect(result.body).toBeDefined()
    expect(typeof (result.body as Record<string, unknown>).name).toBe('string')
    expect(typeof (result.body as Record<string, unknown>).age).toBe('number')
  })

  it('generates a response for a simple string schema', async () => {
    const schema = { type: 'string' }
    const result = await simulateResponse(schema, '/test')
    expect(result.confidence).toBe('high')
    expect(typeof result.body).toBe('string')
  })

  it('generates a response for an array schema', async () => {
    const schema = {
      type: 'array',
      items: { type: 'number' },
    }
    const result = await simulateResponse(schema, '/test')
    expect(result.confidence).toBe('high')
    expect(Array.isArray(result.body)).toBe(true)
  })

  it('returns reduced confidence for polymorphic schema', async () => {
    const schema = {
      oneOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'object', properties: { b: { type: 'number' } } },
      ],
    }
    const result = await simulateResponse(schema, '/test')
    expect(result.confidence).toBe('reduced')
    expect(result.warnings.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toContain('polymorphic')
  })

  it('throws SIMULATE_SCHEMA_TOO_COMPLEX for deeply nested schemas', async () => {
    const schema = {
      oneOf: [
        {
          oneOf: [
            {
              oneOf: [
                {
                  oneOf: [{ type: 'string' }],
                },
              ],
            },
          ],
        },
      ],
    }
    await expect(simulateResponse(schema, '/deep')).rejects.toThrow(
      'BMCP020',
    )
  })

  it('produces deterministic output with the same seed', async () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'integer' },
      },
      required: ['name', 'value'],
    }
    const r1 = await simulateResponse(schema, '/test', { seed: 42 })
    const r2 = await simulateResponse(schema, '/test', { seed: 42 })
    expect(r1.body).toEqual(r2.body)
  })

  it('accepts a custom variant strategy', async () => {
    const schema = {
      oneOf: [
        { type: 'object', properties: { first: { type: 'string' } }, required: ['first'] },
        { type: 'object', properties: { second: { type: 'number' } }, required: ['second'] },
      ],
    }
    // Strategy that picks the last variant
    const lastVariant = {
      selectVariant(variants: unknown[]) {
        return variants[variants.length - 1]
      },
    }
    const result = await simulateResponse(schema, '/test', {
      variantStrategy: lastVariant,
    })
    expect(result.body).toBeDefined()
    // Should have 'second' from the last variant
    expect((result.body as Record<string, unknown>).second).toBeDefined()
  })

  it('throws for null schema', async () => {
    await expect(
      simulateResponse(null, '/test'),
    ).rejects.toThrow('BMCP021')
  })

  it('throws for undefined schema', async () => {
    await expect(
      simulateResponse(undefined, '/test'),
    ).rejects.toThrow('BMCP021')
  })

  it('simplifies allOf schemas before generation', async () => {
    const schema = {
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'integer' } }, required: ['b'] },
      ],
    }
    const result = await simulateResponse(schema, '/test')
    expect(result.confidence).toBe('reduced')
    expect(result.body).toBeDefined()
  })
})
