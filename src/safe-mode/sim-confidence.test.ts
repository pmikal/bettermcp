import { describe, it, expect } from 'vitest'
import { assessSimulationConfidence } from './sim-confidence.js'

describe('assessSimulationConfidence', () => {
  it('returns high for null/undefined schema', () => {
    expect(assessSimulationConfidence(null)).toBe('high')
    expect(assessSimulationConfidence(undefined)).toBe('high')
  })

  it('returns high for a simple object schema', () => {
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        age: { type: 'number' },
      },
    }
    expect(assessSimulationConfidence(schema)).toBe('high')
  })

  it('returns high for a simple array schema', () => {
    const schema = {
      type: 'array',
      items: { type: 'string' },
    }
    expect(assessSimulationConfidence(schema)).toBe('high')
  })

  it('returns reduced for a schema with oneOf at top level', () => {
    const schema = {
      oneOf: [{ type: 'string' }, { type: 'number' }],
    }
    expect(assessSimulationConfidence(schema)).toBe('reduced')
  })

  it('returns reduced for a schema with anyOf at top level', () => {
    const schema = {
      anyOf: [{ type: 'string' }, { type: 'number' }],
    }
    expect(assessSimulationConfidence(schema)).toBe('reduced')
  })

  it('returns reduced for a schema with allOf at top level', () => {
    const schema = {
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } } },
        { type: 'object', properties: { b: { type: 'number' } } },
      ],
    }
    expect(assessSimulationConfidence(schema)).toBe('reduced')
  })

  it('returns reduced for a property with oneOf', () => {
    const schema = {
      type: 'object',
      properties: {
        value: {
          oneOf: [{ type: 'string' }, { type: 'number' }],
        },
      },
    }
    expect(assessSimulationConfidence(schema)).toBe('reduced')
  })

  it('returns too-complex for deeply nested polymorphic schemas', () => {
    // Depth 0 -> 1 -> 2 -> 3 (exceeds MAX_POLYMORPHIC_DEPTH of 3)
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
    expect(assessSimulationConfidence(schema)).toBe('too-complex')
  })

  it('returns reduced for nested polymorphic at allowed depth', () => {
    // Depth 0 -> 1 -> 2 (within MAX_POLYMORPHIC_DEPTH of 3)
    const schema = {
      oneOf: [
        {
          oneOf: [
            {
              oneOf: [{ type: 'string' }],
            },
          ],
        },
      ],
    }
    expect(assessSimulationConfidence(schema)).toBe('reduced')
  })

  it('returns reduced for array items with polymorphic schema', () => {
    const schema = {
      type: 'array',
      items: {
        anyOf: [{ type: 'string' }, { type: 'number' }],
      },
    }
    expect(assessSimulationConfidence(schema)).toBe('reduced')
  })

  it('returns high for a non-object schema', () => {
    expect(assessSimulationConfidence('string')).toBe('high')
    expect(assessSimulationConfidence(42)).toBe('high')
  })

  it('returns too-complex for circular references', () => {
    const schema: Record<string, unknown> = {
      type: 'object',
      properties: {},
    }
    ;(schema['properties'] as Record<string, unknown>)['self'] = schema
    expect(assessSimulationConfidence(schema)).toBe('too-complex')
  })

  it('returns too-complex for deeply nested non-polymorphic schemas', () => {
    // Build a schema with 25 levels of property nesting (exceeds MAX_TOTAL_DEPTH=20)
    let schema: Record<string, unknown> = { type: 'string' }
    for (let i = 0; i < 25; i++) {
      schema = {
        type: 'object',
        properties: { nested: schema },
      }
    }
    expect(assessSimulationConfidence(schema)).toBe('too-complex')
  })
})
