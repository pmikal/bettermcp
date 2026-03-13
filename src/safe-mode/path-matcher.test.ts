import { describe, it, expect } from 'vitest'
import { matchesTemplatePath, compilePathMatchers, findMatchingPath } from './path-matcher.js'

describe('matchesTemplatePath', () => {
  it('matches exact static paths', () => {
    expect(matchesTemplatePath('/pets', '/pets')).toBe(true)
  })

  it('rejects non-matching static paths', () => {
    expect(matchesTemplatePath('/pets', '/users')).toBe(false)
  })

  it('matches single parameterized segment', () => {
    expect(matchesTemplatePath('/pets/{petId}', '/pets/42')).toBe(true)
    expect(matchesTemplatePath('/pets/{petId}', '/pets/abc')).toBe(true)
  })

  it('rejects extra segments', () => {
    expect(matchesTemplatePath('/pets/{petId}', '/pets/42/extra')).toBe(false)
  })

  it('rejects missing segments', () => {
    expect(matchesTemplatePath('/pets/{petId}', '/pets')).toBe(false)
  })

  it('matches multiple parameterized segments', () => {
    expect(matchesTemplatePath('/users/{userId}/posts/{postId}', '/users/1/posts/99')).toBe(true)
  })

  it('rejects partial match with different prefix', () => {
    expect(matchesTemplatePath('/users/{id}', '/admins/1')).toBe(false)
  })

  it('matches root path', () => {
    expect(matchesTemplatePath('/', '/')).toBe(true)
  })

  it('handles regex-special characters in static segments', () => {
    expect(matchesTemplatePath('/api/v1.0/items', '/api/v1.0/items')).toBe(true)
    // The dot should be literal, not a regex wildcard
    expect(matchesTemplatePath('/api/v1.0/items', '/api/v1X0/items')).toBe(false)
  })
})

describe('compilePathMatchers + findMatchingPath', () => {
  it('finds matching spec path from compiled matchers', () => {
    const matchers = compilePathMatchers(['/pets', '/pets/{petId}', '/users/{userId}/posts'])
    expect(findMatchingPath(matchers, '/pets')).toBe('/pets')
    expect(findMatchingPath(matchers, '/pets/42')).toBe('/pets/{petId}')
    expect(findMatchingPath(matchers, '/users/1/posts')).toBe('/users/{userId}/posts')
  })

  it('returns null for unmatched path', () => {
    const matchers = compilePathMatchers(['/pets', '/pets/{petId}'])
    expect(findMatchingPath(matchers, '/orders')).toBeNull()
  })
})
