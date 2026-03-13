import { describe, it, expect } from 'vitest'
import { formatReport, formatVersionReport } from './formatter.js'
import type { ClassificationReport } from './classifier.js'

function createReport(overrides?: Partial<ClassificationReport>): ClassificationReport {
  return {
    entries: [],
    totalSignals: 0,
    filteredByThreshold: 0,
    ...overrides,
  }
}

describe('formatReport', () => {
  it('returns helpful message for empty store', () => {
    const output = formatReport(createReport())

    expect(output).toContain('No feedback data available')
    expect(output).toContain('generate traffic')
  })

  it('includes summary counts', () => {
    const output = formatReport(createReport({
      totalSignals: 5,
      entries: [
        {
          category: 'schema-mismatch',
          severity: 'medium',
          description: 'Schema mismatch',
          confidence: 0.8,
          observationCount: 3,
          endpoints: ['GET /products'],
          provenance: ['wire-log'],
          firstSeen: '2026-01-01T00:00:00.000Z',
          lastSeen: '2026-01-05T00:00:00.000Z',
        },
      ],
    }))

    expect(output).toContain('Total signals: 5')
    expect(output).toContain('Classifications: 1')
    expect(output).toContain('0 critical')
    expect(output).toContain('1 medium')
  })

  it('shows filtered count when signals are below threshold', () => {
    const output = formatReport(createReport({
      totalSignals: 3,
      filteredByThreshold: 2,
      entries: [
        {
          category: 'missing-error-schema',
          severity: 'low',
          description: 'Missing error schema',
          confidence: 0.7,
          observationCount: 1,
          endpoints: ['GET /a'],
          provenance: ['synthetic'],
          firstSeen: '2026-01-01T00:00:00.000Z',
          lastSeen: '2026-01-01T00:00:00.000Z',
        },
      ],
    }))

    expect(output).toContain('Filtered (below confidence threshold): 2')
  })

  it('formats entry with severity label, confidence, and observations', () => {
    const output = formatReport(createReport({
      totalSignals: 1,
      entries: [
        {
          category: 'breaking-change',
          severity: 'critical',
          description: 'Breaking change detected',
          confidence: 0.9,
          observationCount: 5,
          endpoints: ['GET /products', 'POST /orders'],
          provenance: ['wire-log', 'agent-reported'],
          firstSeen: '2026-01-01T00:00:00.000Z',
          lastSeen: '2026-01-10T00:00:00.000Z',
        },
      ],
    }))

    expect(output).toContain('[CRITICAL] breaking-change')
    expect(output).toContain('Breaking change detected')
    expect(output).toContain('Confidence: 90%')
    expect(output).toContain('Observations: 5')
    expect(output).toContain('Source: wire-log, agent-reported')
    expect(output).toContain('GET /products, POST /orders')
  })

  it('shows guidance when all signals are filtered by threshold', () => {
    const output = formatReport(createReport({
      totalSignals: 5,
      filteredByThreshold: 5,
      entries: [],
    }))

    expect(output).toContain('All signals were below their category confidence thresholds')
    expect(output).toContain('early-stage data collection')
    expect(output).not.toContain('No feedback data available')
  })

  it('includes report header', () => {
    const output = formatReport(createReport({
      totalSignals: 1,
      entries: [{
        category: 'test',
        severity: 'low',
        description: 'Test',
        confidence: 0.5,
        observationCount: 1,
        endpoints: ['GET /test'],
        provenance: ['synthetic'],
        firstSeen: '2026-01-01T00:00:00.000Z',
        lastSeen: '2026-01-01T00:00:00.000Z',
      }],
    }))

    expect(output).toContain('Triage Classification Report')
  })
})

describe('formatVersionReport', () => {
  it('returns no-versioning message for empty report', () => {
    const output = formatVersionReport({ entries: [] })

    expect(output).toContain('No version pinning configured')
  })

  it('formats version entries with state labels', () => {
    const output = formatVersionReport({
      entries: [
        {
          versionSha: 'abc123',
          state: 'active',
          endpoints: ['GET /products', 'POST /orders'],
          lastActivity: '2026-01-05T00:00:00.000Z',
          requestCount: 42,
          signalCount: 3,
        },
      ],
    })

    expect(output).toContain('Version Lifecycle Report')
    expect(output).toContain('[ACTIVE] abc123')
    expect(output).toContain('GET /products, POST /orders')
    expect(output).toContain('Requests: 42')
    expect(output).toContain('Signals: 3')
  })

  it('shows deprecated and sunset labels', () => {
    const output = formatVersionReport({
      entries: [
        {
          versionSha: 'dep1',
          state: 'deprecated',
          endpoints: ['GET /old'],
          lastActivity: '2026-01-01T00:00:00.000Z',
          requestCount: 0,
          signalCount: 0,
        },
        {
          versionSha: 'sun1',
          state: 'sunset',
          endpoints: ['GET /ancient'],
          lastActivity: '2025-06-01T00:00:00.000Z',
          requestCount: 0,
          signalCount: 0,
        },
      ],
    })

    expect(output).toContain('[DEPRECATED] dep1')
    expect(output).toContain('[SUNSET] sun1')
  })
})
