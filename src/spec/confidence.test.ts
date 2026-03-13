import { describe, it, expect } from 'vitest'
import { scoreEndpoint } from './confidence.js'

describe('scoreEndpoint', () => {
  it('gives perfect score for a fully documented endpoint', () => {
    const { confidence, warnings } = scoreEndpoint({
      path: '/pets',
      method: 'get',
      operationId: 'listPets',
      description: 'List all pets',
      summary: 'List pets',
      parameters: [{ schema: { type: 'integer' }, description: 'Limit' }],
      requestBody: null,
      responses: {
        '200': {
          content: { 'application/json': { schema: { type: 'array' } } },
        },
      },
      vendorExtensions: [],
    })

    expect(confidence.score).toBe(1)
    expect(warnings).toHaveLength(0)
    expect(confidence.factors.every((f) => f.present)).toBe(true)
  })

  it('deducts for missing description', () => {
    const { confidence, warnings } = scoreEndpoint({
      path: '/pets',
      method: 'get',
      operationId: 'listPets',
      description: null,
      summary: null,
      parameters: [],
      requestBody: null,
      responses: {
        '200': { content: { 'application/json': { schema: {} } } },
      },
      vendorExtensions: [],
    })

    expect(confidence.score).toBeLessThan(1)
    const descFactor = confidence.factors.find((f) => f.name === 'has-description')
    expect(descFactor?.present).toBe(false)
    expect(warnings.some((w) => w.feature === 'has-description')).toBe(true)
  })

  it('deducts for missing operation id', () => {
    const { confidence } = scoreEndpoint({
      path: '/pets',
      method: 'get',
      operationId: null,
      description: 'desc',
      parameters: [],
      requestBody: null,
      responses: {
        '200': { content: { 'application/json': { schema: {} } } },
      },
      vendorExtensions: [],
    })

    const opIdFactor = confidence.factors.find((f) => f.name === 'has-operation-id')
    expect(opIdFactor?.present).toBe(false)
  })

  it('deducts for parameters without schemas', () => {
    const { confidence } = scoreEndpoint({
      path: '/pets',
      method: 'get',
      operationId: 'listPets',
      description: 'desc',
      parameters: [{ schema: undefined, description: 'no schema' }],
      requestBody: null,
      responses: {
        '200': { content: { 'application/json': { schema: {} } } },
      },
      vendorExtensions: [],
    })

    const paramFactor = confidence.factors.find((f) => f.name === 'has-parameter-schemas')
    expect(paramFactor?.present).toBe(false)
  })

  it('deducts for missing response schema', () => {
    const { confidence } = scoreEndpoint({
      path: '/pets',
      method: 'get',
      operationId: 'listPets',
      description: 'desc',
      parameters: [],
      requestBody: null,
      responses: {
        '200': { description: 'OK' },
      },
      vendorExtensions: [],
    })

    const respFactor = confidence.factors.find((f) => f.name === 'has-response-schema')
    expect(respFactor?.present).toBe(false)
  })

  it('deducts for missing request body on POST', () => {
    const { confidence } = scoreEndpoint({
      path: '/pets',
      method: 'post',
      operationId: 'createPet',
      description: 'desc',
      parameters: [],
      requestBody: null,
      responses: {
        '201': { content: { 'application/json': { schema: {} } } },
      },
      vendorExtensions: [],
    })

    const bodyFactor = confidence.factors.find((f) => f.name === 'has-request-body-schema')
    expect(bodyFactor?.present).toBe(false)
  })

  it('does not deduct for missing request body on GET', () => {
    const { confidence } = scoreEndpoint({
      path: '/pets',
      method: 'get',
      operationId: 'listPets',
      description: 'desc',
      parameters: [],
      requestBody: null,
      responses: {
        '200': { content: { 'application/json': { schema: {} } } },
      },
      vendorExtensions: [],
    })

    const bodyFactor = confidence.factors.find((f) => f.name === 'has-request-body-schema')
    expect(bodyFactor?.present).toBe(true)
  })

  it('deducts for vendor extensions', () => {
    const { confidence, warnings } = scoreEndpoint({
      path: '/health',
      method: 'get',
      operationId: 'health',
      description: 'desc',
      parameters: [],
      requestBody: null,
      responses: {
        '200': { content: { 'application/json': { schema: {} } } },
      },
      vendorExtensions: ['x-internal'],
    })

    const vendorFactor = confidence.factors.find((f) => f.name === 'no-vendor-extensions')
    expect(vendorFactor?.present).toBe(false)
    expect(warnings.some((w) => w.feature === 'no-vendor-extensions')).toBe(true)
  })

  it('includes endpoint name in warnings', () => {
    const { warnings } = scoreEndpoint({
      path: '/users',
      method: 'get',
      operationId: null,
      description: null,
      parameters: [],
      requestBody: null,
      responses: {},
      vendorExtensions: [],
    })

    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0]!.endpoint).toBe('GET /users')
  })

  it('score is between 0 and 1', () => {
    // Worst case: nothing present
    const { confidence } = scoreEndpoint({
      path: '/x',
      method: 'post',
      operationId: null,
      description: null,
      parameters: [{ schema: undefined, description: null }],
      requestBody: null,
      responses: {},
      vendorExtensions: ['x-foo'],
    })

    expect(confidence.score).toBeGreaterThanOrEqual(0)
    expect(confidence.score).toBeLessThanOrEqual(1)
  })
})
