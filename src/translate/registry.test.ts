import { describe, it, expect } from 'vitest'
import { TranslationRegistry } from './registry.js'
import { BetterMCPError } from '../errors/index.js'

describe('TranslationRegistry', () => {
  it('registers and looks up a handler', () => {
    const registry = new TranslationRegistry()
    const reqFn = (body: unknown) => body
    const resFn = (body: unknown) => body

    registry.registerHandler({
      version: 'v1',
      endpoint: 'POST /orders',
      request: reqFn,
      response: resFn,
    })

    const match = registry.lookup('v1', 'POST', '/orders')
    expect(match).not.toBeNull()
    expect(match!.request).toBe(reqFn)
    expect(match!.response).toBe(resFn)
  })

  it('returns null for non-matching version', () => {
    const registry = new TranslationRegistry()
    registry.registerHandler({
      version: 'v1',
      endpoint: 'POST /orders',
      request: (b) => b,
    })

    expect(registry.lookup('v2', 'POST', '/orders')).toBeNull()
  })

  it('returns null for non-matching method', () => {
    const registry = new TranslationRegistry()
    registry.registerHandler({
      version: 'v1',
      endpoint: 'POST /orders',
      request: (b) => b,
    })

    expect(registry.lookup('v1', 'GET', '/orders')).toBeNull()
  })

  it('returns null for non-matching path', () => {
    const registry = new TranslationRegistry()
    registry.registerHandler({
      version: 'v1',
      endpoint: 'POST /orders',
      request: (b) => b,
    })

    expect(registry.lookup('v1', 'POST', '/products')).toBeNull()
  })

  it('matches path templates', () => {
    const registry = new TranslationRegistry()
    registry.registerHandler({
      version: 'v1',
      endpoint: 'GET /users/{id}',
      request: (b) => b,
    })

    const match = registry.lookup('v1', 'GET', '/users/123')
    expect(match).not.toBeNull()
  })

  it('overwrites existing handler for same version + endpoint', () => {
    const registry = new TranslationRegistry()
    const firstFn = (body: unknown) => ({ first: true, ...body as object })
    const secondFn = (body: unknown) => ({ second: true, ...body as object })

    registry.registerHandler({ version: 'v1', endpoint: 'POST /orders', request: firstFn })
    registry.registerHandler({ version: 'v1', endpoint: 'POST /orders', request: secondFn })

    expect(registry.size).toBe(1)
    const match = registry.lookup('v1', 'POST', '/orders')
    expect(match!.request).toBe(secondFn)
  })

  it('supports multiple handlers for same version, different endpoints', () => {
    const registry = new TranslationRegistry()
    registry.registerHandler({ version: 'v1', endpoint: 'POST /orders', request: (b) => b })
    registry.registerHandler({ version: 'v1', endpoint: 'GET /products', request: (b) => b })

    expect(registry.size).toBe(2)
    expect(registry.lookup('v1', 'POST', '/orders')).not.toBeNull()
    expect(registry.lookup('v1', 'GET', '/products')).not.toBeNull()
  })

  it('supports multiple handlers for different versions, same endpoint', () => {
    const registry = new TranslationRegistry()
    registry.registerHandler({ version: 'v1', endpoint: 'POST /orders', request: (b) => b })
    registry.registerHandler({ version: 'v2', endpoint: 'POST /orders', request: (b) => b })

    expect(registry.size).toBe(2)
    expect(registry.lookup('v1', 'POST', '/orders')).not.toBeNull()
    expect(registry.lookup('v2', 'POST', '/orders')).not.toBeNull()
  })

  it('handles handlers with only request transform', () => {
    const registry = new TranslationRegistry()
    registry.registerHandler({ version: 'v1', endpoint: 'POST /orders', request: (b) => b })

    const match = registry.lookup('v1', 'POST', '/orders')
    expect(match!.request).toBeDefined()
    expect(match!.response).toBeUndefined()
  })

  it('handles handlers with only response transform', () => {
    const registry = new TranslationRegistry()
    registry.registerHandler({ version: 'v1', endpoint: 'GET /products', response: (b) => b })

    const match = registry.lookup('v1', 'GET', '/products')
    expect(match!.request).toBeUndefined()
    expect(match!.response).toBeDefined()
  })

  it('normalizes method to uppercase for lookup', () => {
    const registry = new TranslationRegistry()
    registry.registerHandler({ version: 'v1', endpoint: 'post /orders', request: (b) => b })

    expect(registry.lookup('v1', 'POST', '/orders')).not.toBeNull()
    expect(registry.lookup('v1', 'post', '/orders')).not.toBeNull()
  })

  it('strips trailing slashes from request path', () => {
    const registry = new TranslationRegistry()
    registry.registerHandler({ version: 'v1', endpoint: 'GET /products', request: (b) => b })

    expect(registry.lookup('v1', 'GET', '/products/')).not.toBeNull()
  })

  it('hasAnyHandler returns true when handlers exist', () => {
    const registry = new TranslationRegistry()
    registry.registerHandler({ version: 'v1', endpoint: 'POST /orders', request: (b) => b })

    expect(registry.hasAnyHandler('v1')).toBe(true)
    expect(registry.hasAnyHandler('v2')).toBe(false)
  })

  it('tracks size correctly', () => {
    const registry = new TranslationRegistry()
    expect(registry.size).toBe(0)

    registry.registerHandler({ version: 'v1', endpoint: 'POST /orders', request: (b) => b })
    expect(registry.size).toBe(1)

    registry.registerHandler({ version: 'v1', endpoint: 'GET /products', request: (b) => b })
    expect(registry.size).toBe(2)
  })

  it('throws CONFIG_INVALID for empty version', () => {
    const registry = new TranslationRegistry()
    expect(() =>
      registry.registerHandler({ version: '', endpoint: 'POST /orders', request: (b) => b }),
    ).toThrow(BetterMCPError)
  })

  it('throws CONFIG_INVALID for invalid endpoint format', () => {
    const registry = new TranslationRegistry()
    expect(() =>
      registry.registerHandler({ version: 'v1', endpoint: '/orders', request: (b) => b }),
    ).toThrow(BetterMCPError)
  })

  it('throws CONFIG_INVALID for endpoint path not starting with /', () => {
    const registry = new TranslationRegistry()
    expect(() =>
      registry.registerHandler({ version: 'v1', endpoint: 'POST orders', request: (b) => b }),
    ).toThrow(BetterMCPError)
  })
})
