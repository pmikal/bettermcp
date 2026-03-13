import { describe, it, expect } from 'vitest'
import { resolveConfig } from './index.js'
import { DEFAULT_CONFIG } from './defaults.js'
import { BetterMCPError } from '../errors/index.js'

describe('resolveConfig', () => {
  it('returns defaults when no config provided', () => {
    const config = resolveConfig()
    expect(config).toEqual(DEFAULT_CONFIG)
    expect(config.db).toBe('./bettermcp.db')
    expect(config.wireLogging).toBe(true)
    expect(config.mode).toBe('owner')
  })

  it('allows overriding db path', () => {
    const config = resolveConfig({ db: './custom/feedback.db' })
    expect(config.db).toBe('./custom/feedback.db')
    expect(config.wireLogging).toBe(true)
    expect(config.mode).toBe('owner')
  })

  it('allows overriding wireLogging', () => {
    const config = resolveConfig({ wireLogging: false })
    expect(config.wireLogging).toBe(false)
  })

  it('defaults hotReload to true', () => {
    const config = resolveConfig()
    expect(config.hotReload).toBe(true)
  })

  it('allows disabling hotReload', () => {
    const config = resolveConfig({ hotReload: false })
    expect(config.hotReload).toBe(false)
  })

  it('allows overriding mode', () => {
    const config = resolveConfig({ mode: 'proxy', upstream: 'https://api.example.com' })
    expect(config.mode).toBe('proxy')
  })

  it('allows overriding multiple fields', () => {
    const config = resolveConfig({
      db: '/tmp/test.db',
      wireLogging: false,
      mode: 'proxy', upstream: 'https://api.example.com',
    })
    expect(config.db).toBe('/tmp/test.db')
    expect(config.wireLogging).toBe(false)
    expect(config.mode).toBe('proxy')
  })

  it('throws BetterMCPError for unknown keys', () => {
    expect(() => resolveConfig({ fooBar: true } as never)).toThrow(BetterMCPError)
    try {
      resolveConfig({ fooBar: true } as never)
    } catch (err) {
      const e = err as BetterMCPError
      expect(e.code).toBe('BMCP011')
      expect(e.problem).toContain('fooBar')
    }
  })

  it('throws BetterMCPError for wrong types', () => {
    expect(() => resolveConfig({ wireLogging: 'yes' } as never)).toThrow(BetterMCPError)
    try {
      resolveConfig({ wireLogging: 'yes' } as never)
    } catch (err) {
      const e = err as BetterMCPError
      expect(e.code).toBe('BMCP010')
      expect(e.problem).toContain('wireLogging')
    }
  })

  it('throws BetterMCPError for invalid mode value', () => {
    expect(() => resolveConfig({ mode: 'invalid' } as never)).toThrow(BetterMCPError)
    try {
      resolveConfig({ mode: 'invalid' } as never)
    } catch (err) {
      const e = err as BetterMCPError
      expect(e.code).toBe('BMCP010')
    }
  })

  it('throws BetterMCPError for proxy mode without upstream', () => {
    expect(() => resolveConfig({ mode: 'proxy' })).toThrow(BetterMCPError)
    try {
      resolveConfig({ mode: 'proxy' })
    } catch (err) {
      const e = err as BetterMCPError
      expect(e.code).toBe('BMCP010')
      expect(e.problem).toContain('upstream')
    }
  })

  it('accepts proxy mode with upstream URL', () => {
    const config = resolveConfig({ mode: 'proxy', upstream: 'https://api.stripe.com' })
    expect(config.mode).toBe('proxy')
    expect(config.upstream).toBe('https://api.stripe.com')
  })

  it('allows owner mode without upstream', () => {
    const config = resolveConfig({ mode: 'owner' })
    expect(config.mode).toBe('owner')
    expect(config.upstream).toBeUndefined()
  })

  it('allows owner mode with optional upstream', () => {
    const config = resolveConfig({ mode: 'owner', upstream: 'https://api.example.com' })
    expect(config.mode).toBe('owner')
    expect(config.upstream).toBe('https://api.example.com')
  })

  it('throws BetterMCPError for invalid upstream URL', () => {
    expect(() => resolveConfig({ mode: 'proxy', upstream: 'not-a-url' })).toThrow(BetterMCPError)
  })

  it('validates DiscoveryConfig baseUrl', async () => {
    const { DiscoveryConfigSchema } = await import('./schema.js')
    const valid = DiscoveryConfigSchema.safeParse({ baseUrl: 'https://api.example.com' })
    expect(valid.success).toBe(true)

    const withOutput = DiscoveryConfigSchema.safeParse({
      baseUrl: 'https://api.example.com',
      outputPath: './my-spec.yaml',
    })
    expect(withOutput.success).toBe(true)

    const invalid = DiscoveryConfigSchema.safeParse({ baseUrl: 'not-a-url' })
    expect(invalid.success).toBe(false)

    const noBase = DiscoveryConfigSchema.safeParse({})
    expect(noBase.success).toBe(false)
  })

  it('throws BetterMCPError for empty db path', () => {
    expect(() => resolveConfig({ db: '' })).toThrow(BetterMCPError)
    try {
      resolveConfig({ db: '' })
    } catch (err) {
      const e = err as BetterMCPError
      expect(e.code).toBe('BMCP010')
      expect(e.problem).toContain('db')
    }
  })
})
