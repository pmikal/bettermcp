import { describe, it, expect } from 'vitest'
import { analyzeSpec } from './analyzer.js'
import type { ParsedEndpoint } from '../spec/spec-types.js'
import {
  MISSING_ERROR_SCHEMA,
  MISSING_DESCRIPTION,
  INCONSISTENT_NAMING,
  PERMISSIVE_SCHEMA,
  MISSING_PAGINATION,
} from '../triage/index.js'

function createEndpoint(overrides?: Partial<ParsedEndpoint>): ParsedEndpoint {
  return {
    path: '/test',
    method: 'GET',
    operationId: 'getTest',
    summary: 'Test endpoint',
    description: 'A test endpoint',
    parameters: [],
    requestBody: null,
    responses: {
      '200': { description: 'OK' },
      '400': { description: 'Bad request' },
    },
    confidence: { score: 0.9, factors: [] },
    warnings: [],
    ...overrides,
  }
}

describe('analyzeSpec', () => {
  it('returns empty array for well-defined spec', () => {
    const endpoints = [createEndpoint()]
    const findings = analyzeSpec(endpoints)
    expect(findings).toEqual([])
  })

  it('detects missing error response schemas', () => {
    const ep = createEndpoint({
      path: '/items',
      responses: { '200': { description: 'OK' } },
    })
    const findings = analyzeSpec([ep])

    const match = findings.find((f) => f.category === MISSING_ERROR_SCHEMA)
    expect(match).toBeDefined()
    expect(match!.endpointPath).toBe('/items')
    expect(match!.message).toContain('no error response schemas')
  })

  it('does not flag missing error schema when 4xx/5xx present', () => {
    const ep = createEndpoint({
      responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
    })
    const findings = analyzeSpec([ep])
    expect(findings.find((f) => f.category === MISSING_ERROR_SCHEMA)).toBeUndefined()
  })

  it('does not flag missing error schema when "default" response is present', () => {
    const ep = createEndpoint({
      responses: { '200': { description: 'OK' }, 'default': { description: 'Error' } },
    })
    const findings = analyzeSpec([ep])
    expect(findings.find((f) => f.category === MISSING_ERROR_SCHEMA)).toBeUndefined()
  })

  it('does not flag missing error schema when 4XX/5XX range keys present', () => {
    const ep = createEndpoint({
      responses: { '200': { description: 'OK' }, '4XX': { description: 'Client error' } },
    })
    const findings = analyzeSpec([ep])
    expect(findings.find((f) => f.category === MISSING_ERROR_SCHEMA)).toBeUndefined()
  })

  it('detects missing description', () => {
    const ep = createEndpoint({
      path: '/hidden',
      summary: null,
      description: null,
    })
    const findings = analyzeSpec([ep])

    const match = findings.find((f) => f.category === MISSING_DESCRIPTION)
    expect(match).toBeDefined()
    expect(match!.message).toContain('no summary or description')
  })

  it('does not flag when summary is present', () => {
    const ep = createEndpoint({ summary: 'Has summary', description: null })
    const findings = analyzeSpec([ep])
    expect(findings.find((f) => f.category === MISSING_DESCRIPTION)).toBeUndefined()
  })

  it('detects permissive schema with additionalProperties: true', () => {
    const ep = createEndpoint({
      path: '/data',
      method: 'POST',
      requestBody: {
        content: {
          'application/json': {
            schema: { additionalProperties: true },
          },
        },
      },
    })
    const findings = analyzeSpec([ep])

    const match = findings.find((f) => f.category === PERMISSIVE_SCHEMA)
    expect(match).toBeDefined()
    expect(match!.message).toContain('additionalProperties')
  })

  it('detects unconstrained schema with no type or properties', () => {
    const ep = createEndpoint({
      path: '/open',
      method: 'PUT',
      requestBody: {
        content: {
          'application/json': {
            schema: {},
          },
        },
      },
    })
    const findings = analyzeSpec([ep])

    const match = findings.find((f) => f.category === PERMISSIVE_SCHEMA)
    expect(match).toBeDefined()
    expect(match!.message).toContain('unconstrained')
  })

  it('does not flag schema with defined type', () => {
    const ep = createEndpoint({
      method: 'POST',
      requestBody: {
        content: {
          'application/json': {
            schema: { type: 'object', properties: { name: { type: 'string' } } },
          },
        },
      },
    })
    const findings = analyzeSpec([ep])
    expect(findings.find((f) => f.category === PERMISSIVE_SCHEMA)).toBeUndefined()
  })

  it('detects missing pagination on array GET endpoint', () => {
    const ep = createEndpoint({
      path: '/items',
      method: 'GET',
      parameters: [],
      responses: {
        '200': {
          description: 'OK',
          content: {
            'application/json': {
              schema: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
    })
    const findings = analyzeSpec([ep])

    const match = findings.find((f) => f.category === MISSING_PAGINATION)
    expect(match).toBeDefined()
    expect(match!.message).toContain('no pagination parameters')
  })

  it('does not flag pagination when limit param present', () => {
    const ep = createEndpoint({
      path: '/items',
      method: 'GET',
      parameters: [
        { name: 'limit', in: 'query', required: false, schema: { type: 'integer' }, description: null },
      ],
      responses: {
        '200': {
          description: 'OK',
          content: {
            'application/json': {
              schema: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
    })
    const findings = analyzeSpec([ep])
    expect(findings.find((f) => f.category === MISSING_PAGINATION)).toBeUndefined()
  })

  it('detects missing pagination with 2XX range key response', () => {
    const ep = createEndpoint({
      path: '/items',
      method: 'GET',
      parameters: [],
      responses: {
        '2XX': {
          description: 'OK',
          content: {
            'application/json': {
              schema: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
    })
    const findings = analyzeSpec([ep])
    expect(findings.find((f) => f.category === MISSING_PAGINATION)).toBeDefined()
  })

  it('does not flag pagination on non-GET endpoints', () => {
    const ep = createEndpoint({
      method: 'POST',
      responses: {
        '200': {
          description: 'OK',
          content: {
            'application/json': {
              schema: { type: 'array', items: { type: 'object' } },
            },
          },
        },
      },
    })
    const findings = analyzeSpec([ep])
    expect(findings.find((f) => f.category === MISSING_PAGINATION)).toBeUndefined()
  })

  it('detects inconsistent naming across endpoints', () => {
    const endpoints = [
      createEndpoint({ path: '/user_profiles' }),
      createEndpoint({ path: '/orderItems' }),
    ]
    const findings = analyzeSpec(endpoints)

    const match = findings.find((f) => f.category === INCONSISTENT_NAMING)
    expect(match).toBeDefined()
    expect(match!.message).toContain('mixed naming conventions')
  })

  it('does not flag consistent naming', () => {
    const endpoints = [
      createEndpoint({ path: '/users' }),
      createEndpoint({ path: '/orders' }),
      createEndpoint({ path: '/items' }),
    ]
    const findings = analyzeSpec(endpoints)
    expect(findings.find((f) => f.category === INCONSISTENT_NAMING)).toBeUndefined()
  })

  it('returns multiple findings for an endpoint with multiple issues', () => {
    const ep = createEndpoint({
      path: '/bad',
      summary: null,
      description: null,
      responses: { '200': { description: 'OK' } },
    })
    const findings = analyzeSpec([ep])

    expect(findings.length).toBeGreaterThanOrEqual(2)
    expect(findings.some((f) => f.category === MISSING_ERROR_SCHEMA)).toBe(true)
    expect(findings.some((f) => f.category === MISSING_DESCRIPTION)).toBe(true)
  })

  it('all findings have valid confidence values', () => {
    const ep = createEndpoint({
      path: '/bad',
      summary: null,
      description: null,
      responses: { '200': { description: 'OK' } },
    })
    const findings = analyzeSpec([ep])

    for (const f of findings) {
      expect(f.confidence).toBeGreaterThanOrEqual(0)
      expect(f.confidence).toBeLessThanOrEqual(1)
    }
  })
})
