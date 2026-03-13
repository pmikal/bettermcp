import { describe, it, expect } from 'vitest'
import {
  CATEGORIES,
  CATEGORY_VALUES,
  getCategoryDefinition,
  SCHEMA_MISMATCH,
  UNEXPECTED_RESPONSE,
  TIMEOUT,
  MISSING_ERROR_SCHEMA,
  INCONSISTENT_NAMING,
  MISSING_DESCRIPTION,
  PERMISSIVE_SCHEMA,
  MISSING_PAGINATION,
  BREAKING_CHANGE,
  DATA_LOSS,
  DEPRECATION,
  AGENT_REPORTED,
} from './severity.js'
import type { CategoryDefinition, Severity } from './severity.js'

const VALID_SEVERITIES: Severity[] = ['critical', 'medium', 'low']

describe('category definitions', () => {
  it('all categories have required metadata fields', () => {
    for (const [key, def] of CATEGORIES) {
      expect(def.category).toBe(key)
      expect(def.category).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(VALID_SEVERITIES).toContain(def.severity)
      expect(def.description.length).toBeGreaterThan(0)
      expect(def.confidenceThreshold).toBeGreaterThanOrEqual(0)
      expect(def.confidenceThreshold).toBeLessThanOrEqual(1)
    }
  })

  it('category string values are unique', () => {
    const values = CATEGORY_VALUES
    expect(new Set(values).size).toBe(values.length)
  })

  it('contains at least 10 categories', () => {
    expect(CATEGORIES.size).toBeGreaterThanOrEqual(10)
  })

  it('high-severity categories require higher confidence thresholds', () => {
    expect(BREAKING_CHANGE.severity).toBe('critical')
    expect(BREAKING_CHANGE.confidenceThreshold).toBeGreaterThanOrEqual(0.7)

    expect(DATA_LOSS.severity).toBe('critical')
    expect(DATA_LOSS.confidenceThreshold).toBeGreaterThanOrEqual(0.7)
  })

  it('low-severity categories have lower confidence thresholds', () => {
    expect(AGENT_REPORTED.severity).toBe('low')
    expect(AGENT_REPORTED.confidenceThreshold).toBeLessThanOrEqual(0.5)
  })

  it('CATEGORY_VALUES matches CATEGORIES keys', () => {
    expect(CATEGORY_VALUES).toEqual([...CATEGORIES.keys()])
  })

  it('category string values are pinned (public API contract)', () => {
    expect(SCHEMA_MISMATCH.category).toBe('schema-mismatch')
    expect(UNEXPECTED_RESPONSE.category).toBe('unexpected-response')
    expect(TIMEOUT.category).toBe('timeout')
    expect(MISSING_ERROR_SCHEMA.category).toBe('missing-error-schema')
    expect(INCONSISTENT_NAMING.category).toBe('inconsistent-naming')
    expect(MISSING_DESCRIPTION.category).toBe('missing-description')
    expect(PERMISSIVE_SCHEMA.category).toBe('permissive-schema')
    expect(MISSING_PAGINATION.category).toBe('missing-pagination')
    expect(BREAKING_CHANGE.category).toBe('breaking-change')
    expect(DATA_LOSS.category).toBe('data-loss')
    expect(DEPRECATION.category).toBe('deprecation')
    expect(AGENT_REPORTED.category).toBe('agent-reported')
  })
})

describe('getCategoryDefinition', () => {
  it('returns definition for known category', () => {
    const def = getCategoryDefinition('schema-mismatch')
    expect(def).toBe(SCHEMA_MISMATCH)
    expect(def?.severity).toBe('medium')
  })

  it('returns undefined for unknown category', () => {
    expect(getCategoryDefinition('nonexistent')).toBeUndefined()
  })

  it('returns correct definition for each registered category', () => {
    for (const [key, def] of CATEGORIES) {
      expect(getCategoryDefinition(key)).toBe(def)
    }
  })
})
