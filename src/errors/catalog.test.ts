import { describe, it, expect } from 'vitest'
import { BetterMCPError, createError } from './index.js'
import { ErrorCatalog } from './catalog.js'
import type { ErrorCode } from './catalog.js'

describe('BetterMCPError', () => {
  it('has code, problem, fix, and docsUrl fields', () => {
    const error = createError('SPEC_LOAD_FILE_NOT_FOUND', './missing.yaml')

    expect(error).toBeInstanceOf(BetterMCPError)
    expect(error).toBeInstanceOf(Error)
    expect(error.code).toBe('BMCP001')
    expect(error.problem).toBe('OpenAPI spec file not found: ./missing.yaml')
    expect(error.fix).toBe(
      'Verify the file path passed to loadSpec() exists and is readable'
    )
    expect(error.docsUrl).toBe('https://bettermcp.dev/errors/BMCP001')
    expect(error.name).toBe('BetterMCPError')
  })

  it('interpolates detail parameters into problem string', () => {
    const error = createError('SPEC_LOAD_UNSUPPORTED_SECURITY', 'x-custom-jwt')
    expect(error.problem).toBe('Unsupported security scheme: x-custom-jwt')
  })

  it('interpolates version parameter', () => {
    const error = createError('SPEC_LOAD_UNSUPPORTED_VERSION', '2.0')
    expect(error.problem).toContain('2.0')
    expect(error.problem).toContain('bettermcp supports OpenAPI 3.0 and 3.1')
  })

  it('constructs docsUrl from docsPath', () => {
    const error = createError('CONFIG_INVALID', 'missing required field "db"')
    expect(error.docsUrl).toBe('https://bettermcp.dev/errors/BMCP010')
  })

  it('creates PROXY_NO_UPSTREAM error', () => {
    const error = createError('PROXY_NO_UPSTREAM')
    expect(error.code).toBe('BMCP015')
    expect(error.problem).toContain('upstream')
    expect(error.fix).toContain('upstream')
  })

  it('creates AUTH_HANDLER_FAILED error', () => {
    const error = createError('AUTH_HANDLER_FAILED', 'Token expired')
    expect(error.code).toBe('BMCP016')
    expect(error.problem).toContain('Token expired')
    expect(error.fix).toContain('auth handler')
  })

  it('sets Error.message to formatted string', () => {
    const error = createError('CONFIG_UNKNOWN_KEY', 'fooBar')
    expect(error.message).toBe('[BMCP011] Unknown configuration key: "fooBar"')
  })

  it('chains underlying error via cause option', () => {
    const underlying = new Error('ENOENT: no such file')
    const error = createError('SPEC_LOAD_FILE_NOT_FOUND', './missing.yaml', {
      cause: underlying,
    })
    expect(error.cause).toBe(underlying)
    expect(error.problem).toBe('OpenAPI spec file not found: ./missing.yaml')
  })

  it('leaves cause undefined when not provided', () => {
    const error = createError('SPEC_LOAD_FILE_NOT_FOUND', './missing.yaml')
    expect(error.cause).toBeUndefined()
  })
})

describe('ErrorCatalog completeness', () => {
  const catalogKeys = Object.keys(ErrorCatalog) as ErrorCode[]

  it('every catalog entry has required fields', () => {
    for (const key of catalogKeys) {
      const entry = ErrorCatalog[key]
      expect(entry.code).toMatch(/^BMCP\d{3}$/)
      expect(typeof entry.problem).toBe('function')
      expect(typeof entry.fix).toBe('string')
      expect(entry.fix.length).toBeGreaterThan(0)
      expect(entry.docsPath).toMatch(/^\/errors\/BMCP\d{3}$/)
    }
  })

  it('every catalog entry produces a valid BetterMCPError', () => {
    for (const key of catalogKeys) {
      const error = createError(key, 'test-detail')
      expect(error).toBeInstanceOf(BetterMCPError)
      expect(error.code).toBeTruthy()
      expect(error.problem).toBeTruthy()
      expect(error.fix).toBeTruthy()
      expect(error.docsUrl).toBeTruthy()
    }
  })

  it('no duplicate error codes', () => {
    const codes = catalogKeys.map((key) => ErrorCatalog[key].code)
    const uniqueCodes = new Set(codes)
    expect(uniqueCodes.size).toBe(codes.length)
  })
})
