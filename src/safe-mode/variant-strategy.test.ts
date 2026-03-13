import { describe, it, expect } from 'vitest'
import { firstVariantStrategy } from './variant-strategy.js'

describe('firstVariantStrategy', () => {
  it('returns the first element of the array', () => {
    const variants = [{ type: 'string' }, { type: 'number' }]
    expect(firstVariantStrategy.selectVariant(variants)).toBe(variants[0])
  })

  it('returns undefined for an empty array', () => {
    expect(firstVariantStrategy.selectVariant([])).toBeUndefined()
  })

  it('returns the single element for a one-element array', () => {
    const variants = [{ type: 'boolean' }]
    expect(firstVariantStrategy.selectVariant(variants)).toBe(variants[0])
  })

  it('works with non-object variants', () => {
    expect(firstVariantStrategy.selectVariant(['a', 'b'])).toBe('a')
  })
})
