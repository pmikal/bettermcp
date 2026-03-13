import { describe, it, expect } from 'vitest'
import { validateResponseSchema } from './schema-validator.js'

describe('validateResponseSchema', () => {
  const schema = {
    type: 'object',
    required: ['id', 'name'],
    properties: {
      id: { type: 'integer' },
      name: { type: 'string' },
      email: { type: 'string' },
    },
    additionalProperties: false,
  }

  it('returns valid for a matching response', () => {
    const body = { id: 1, name: 'Alice', email: 'a@b.com' }
    const result = validateResponseSchema(body, schema)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('returns valid when optional fields are omitted', () => {
    const body = { id: 1, name: 'Alice' }
    const result = validateResponseSchema(body, schema)
    expect(result.valid).toBe(true)
  })

  it('detects missing required field', () => {
    const body = { id: 1 }
    const result = validateResponseSchema(body, schema)
    expect(result.valid).toBe(false)
    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors.some((e) => e.includes('name'))).toBe(true)
  })

  it('detects wrong type', () => {
    const body = { id: 'not-a-number', name: 'Alice' }
    const result = validateResponseSchema(body, schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('integer'))).toBe(true)
  })

  it('detects additional properties when not allowed', () => {
    const body = { id: 1, name: 'Alice', unexpected: true }
    const result = validateResponseSchema(body, schema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('additional'))).toBe(true)
  })

  it('validates nested objects', () => {
    const nestedSchema = {
      type: 'object',
      required: ['data'],
      properties: {
        data: {
          type: 'object',
          required: ['value'],
          properties: {
            value: { type: 'number' },
          },
        },
      },
    }
    const invalid = { data: { value: 'not-number' } }
    const result = validateResponseSchema(invalid, nestedSchema)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes('/data/value'))).toBe(true)
  })

  it('validates arrays', () => {
    const arraySchema = {
      type: 'array',
      items: { type: 'string' },
    }
    expect(validateResponseSchema(['a', 'b'], arraySchema).valid).toBe(true)
    expect(validateResponseSchema([1, 2], arraySchema).valid).toBe(false)
  })

  it('collects all errors with allErrors mode', () => {
    const body = { email: 123 } // missing id, missing name, wrong type email
    const result = validateResponseSchema(body, schema)
    expect(result.valid).toBe(false)
    // Should report multiple violations
    expect(result.errors.length).toBeGreaterThan(1)
  })
})
