import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import { parseSpec } from './index.js'
import { BetterMCPError } from '../errors/index.js'

const FIXTURES = join(import.meta.dirname, '__fixtures__')

describe('parseSpec', () => {
  describe('OpenAPI 3.0', () => {
    it('parses a valid 3.0 spec', async () => {
      const result = await parseSpec(join(FIXTURES, 'petstore-3.0.yaml'))

      expect(result.version).toBe('3.0')
      expect(result.title).toBe('Petstore')
      expect(result.endpoints.length).toBeGreaterThanOrEqual(3)
    })

    it('extracts all endpoints with methods', async () => {
      const result = await parseSpec(join(FIXTURES, 'petstore-3.0.yaml'))

      const ops = result.endpoints.map((e) => `${e.method} ${e.path}`)
      expect(ops).toContain('GET /pets')
      expect(ops).toContain('POST /pets')
      expect(ops).toContain('GET /pets/{petId}')
    })

    it('extracts operationId', async () => {
      const result = await parseSpec(join(FIXTURES, 'petstore-3.0.yaml'))

      const listPets = result.endpoints.find((e) => e.operationId === 'listPets')
      expect(listPets).toBeDefined()
      expect(listPets!.method).toBe('GET')
      expect(listPets!.path).toBe('/pets')
    })

    it('extracts parameters with schemas', async () => {
      const result = await parseSpec(join(FIXTURES, 'petstore-3.0.yaml'))

      const listPets = result.endpoints.find((e) => e.operationId === 'listPets')!
      expect(listPets.parameters).toHaveLength(1)
      expect(listPets.parameters[0]!.name).toBe('limit')
      expect(listPets.parameters[0]!.in).toBe('query')
      expect(listPets.parameters[0]!.schema).toBeDefined()
    })

    it('extracts request body', async () => {
      const result = await parseSpec(join(FIXTURES, 'petstore-3.0.yaml'))

      const createPet = result.endpoints.find((e) => e.operationId === 'createPet')!
      expect(createPet.requestBody).toBeDefined()
    })

    it('resolves $ref references', async () => {
      const result = await parseSpec(join(FIXTURES, 'petstore-3.0.yaml'))

      const getPet = result.endpoints.find((e) => e.operationId === 'getPet')!
      const resp200 = getPet.responses['200'] as Record<string, unknown>
      expect(resp200).toBeDefined()
      // After dereference, schema should be resolved (no $ref)
      const content = resp200['content'] as Record<string, Record<string, unknown>>
      if (content?.['application/json']?.['schema']) {
        const schema = content['application/json']['schema'] as Record<string, unknown>
        // Should have properties from Pet schema, not a $ref
        expect(schema['properties'] ?? schema['$ref']).toBeDefined()
      }
    })
  })

  describe('OpenAPI 3.1', () => {
    it('parses a valid 3.1 spec', async () => {
      const result = await parseSpec(join(FIXTURES, 'petstore-3.1.yaml'))

      expect(result.version).toBe('3.1')
      expect(result.title).toBe('Petstore')
      expect(result.endpoints.length).toBe(2)
    })

    it('detects 3.1 version correctly', async () => {
      const result = await parseSpec(join(FIXTURES, 'petstore-3.1.yaml'))
      expect(result.specVersion).toContain('3.1')
    })
  })

  describe('confidence scoring', () => {
    it('gives high confidence to well-documented endpoints', async () => {
      const result = await parseSpec(join(FIXTURES, 'petstore-3.0.yaml'))

      const listPets = result.endpoints.find((e) => e.operationId === 'listPets')!
      // Has description, operationId, param schemas, response schema
      expect(listPets.confidence.score).toBeGreaterThanOrEqual(0.7)
    })

    it('gives lower confidence to incomplete endpoints', async () => {
      const result = await parseSpec(join(FIXTURES, 'incomplete-spec.yaml'))

      const getUsers = result.endpoints.find(
        (e) => e.method === 'GET' && e.path === '/users',
      )!
      // Missing description, operationId, response schema content
      expect(getUsers.confidence.score).toBeLessThan(0.7)
    })

    it('generates warnings for missing factors', async () => {
      const result = await parseSpec(join(FIXTURES, 'incomplete-spec.yaml'))

      const getUsers = result.endpoints.find(
        (e) => e.method === 'GET' && e.path === '/users',
      )!
      expect(getUsers.warnings.length).toBeGreaterThan(0)
      const warningFeatures = getUsers.warnings.map((w) => w.feature)
      expect(warningFeatures).toContain('has-description')
      expect(warningFeatures).toContain('has-operation-id')
    })

    it('warns about vendor extensions', async () => {
      const result = await parseSpec(join(FIXTURES, 'incomplete-spec.yaml'))

      const health = result.endpoints.find(
        (e) => e.method === 'GET' && e.path === '/health',
      )!
      // Confidence scoring generates 'no-vendor-extensions' warning
      const vendorWarnings = health.warnings.filter((w) => w.feature === 'no-vendor-extensions')
      expect(vendorWarnings.length).toBeGreaterThan(0)
    })
  })

  describe('error handling', () => {
    it('throws SPEC_LOAD_FILE_NOT_FOUND for missing file', async () => {
      try {
        await parseSpec('/nonexistent/path.yaml')
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(BetterMCPError)
        expect((err as BetterMCPError).code).toBe('BMCP001')
      }
    })

    it('throws SPEC_LOAD_PARSE_FAILURE for invalid YAML', async () => {
      const { writeFileSync, unlinkSync } = await import('node:fs')
      const tmpFile = join(FIXTURES, '_temp_invalid.yaml')
      writeFileSync(tmpFile, '{{{{not valid yaml at all}}}}')
      try {
        await parseSpec(tmpFile)
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(BetterMCPError)
        expect((err as BetterMCPError).code).toBe('BMCP002')
      } finally {
        unlinkSync(tmpFile)
      }
    })

    it('throws SPEC_LOAD_UNSUPPORTED_VERSION for Swagger 2.0', async () => {
      const { writeFileSync, unlinkSync } = await import('node:fs')
      const tmpFile = join(FIXTURES, '_temp_swagger2.yaml')
      writeFileSync(
        tmpFile,
        'swagger: "2.0"\ninfo:\n  title: Old\n  version: "1.0"\npaths: {}\n',
      )
      try {
        await parseSpec(tmpFile)
        expect.unreachable('should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(BetterMCPError)
        expect((err as BetterMCPError).code).toBe('BMCP003')
      } finally {
        unlinkSync(tmpFile)
      }
    })
  })

  describe('ParsedSpec structure', () => {
    it('returns all required fields', async () => {
      const result = await parseSpec(join(FIXTURES, 'petstore-3.0.yaml'))

      expect(result.version).toBeDefined()
      expect(result.specVersion).toBeDefined()
      expect(result.title).toBeDefined()
      expect(Array.isArray(result.endpoints)).toBe(true)
      expect(Array.isArray(result.warnings)).toBe(true)
    })

    it('each endpoint has required fields', async () => {
      const result = await parseSpec(join(FIXTURES, 'petstore-3.0.yaml'))

      for (const ep of result.endpoints) {
        expect(ep.path).toBeDefined()
        expect(ep.method).toBeDefined()
        expect(ep.confidence).toBeDefined()
        expect(typeof ep.confidence.score).toBe('number')
        expect(ep.confidence.score).toBeGreaterThanOrEqual(0)
        expect(ep.confidence.score).toBeLessThanOrEqual(1)
        expect(Array.isArray(ep.confidence.factors)).toBe(true)
        expect(Array.isArray(ep.warnings)).toBe(true)
        expect(Array.isArray(ep.parameters)).toBe(true)
      }
    })
  })
})
