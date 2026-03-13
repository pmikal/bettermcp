import { describe, it, expect } from 'vitest'
import { validateTransition } from './lifecycle.js'
import { BetterMCPError } from '../errors/index.js'

describe('validateTransition', () => {
  describe('valid transitions', () => {
    it('allows active → deprecated', () => {
      expect(() => validateTransition('active', 'deprecated')).not.toThrow()
    })

    it('allows deprecated → sunset', () => {
      expect(() => validateTransition('deprecated', 'sunset')).not.toThrow()
    })
  })

  describe('invalid transitions', () => {
    it('rejects active → sunset (skipping deprecated)', () => {
      expect(() => validateTransition('active', 'sunset')).toThrow(BetterMCPError)
      try {
        validateTransition('active', 'sunset')
      } catch (err) {
        const e = err as BetterMCPError
        expect(e.code).toBe('BMCP013')
        expect(e.problem).toContain('active')
        expect(e.problem).toContain('sunset')
      }
    })

    it('rejects sunset → active (reverse transition)', () => {
      expect(() => validateTransition('sunset', 'active')).toThrow(BetterMCPError)
    })

    it('rejects sunset → deprecated (reverse transition)', () => {
      expect(() => validateTransition('sunset', 'deprecated')).toThrow(BetterMCPError)
    })

    it('rejects deprecated → active (reverse transition)', () => {
      expect(() => validateTransition('deprecated', 'active')).toThrow(BetterMCPError)
    })

    it('rejects active → active (no-op transition)', () => {
      expect(() => validateTransition('active', 'active')).toThrow(BetterMCPError)
    })

    it('rejects deprecated → deprecated (no-op transition)', () => {
      expect(() => validateTransition('deprecated', 'deprecated')).toThrow(BetterMCPError)
    })

    it('rejects sunset → sunset (no-op transition)', () => {
      expect(() => validateTransition('sunset', 'sunset')).toThrow(BetterMCPError)
    })
  })
})
