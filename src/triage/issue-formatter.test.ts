import { describe, it, expect } from 'vitest'
import { formatIssues, formatDryRun } from './issue-formatter.js'
import type { ClassificationEntry } from './classifier.js'

function createEntry(overrides?: Partial<ClassificationEntry>): ClassificationEntry {
  return {
    category: 'schema-mismatch',
    severity: 'medium',
    description: 'Schema mismatch detected',
    confidence: 0.8,
    observationCount: 3,
    endpoints: ['GET /products'],
    provenance: ['wire-log'],
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-05T00:00:00.000Z',
    ...overrides,
  }
}

describe('formatIssues', () => {
  it('creates one issue per classification entry', () => {
    const entries = [createEntry(), createEntry({ category: 'timeout', description: 'Timeout detected' })]
    const issues = formatIssues(entries)

    expect(issues).toHaveLength(2)
  })

  it('generates title with severity and description', () => {
    const issues = formatIssues([createEntry({ severity: 'critical', description: 'Breaking change detected' })])

    expect(issues[0].title).toBe('[bettermcp] CRITICAL: Breaking change detected')
  })

  it('includes category, endpoints, and timeline in body', () => {
    const issues = formatIssues([createEntry({
      endpoints: ['GET /products', 'POST /orders'],
      firstSeen: '2026-01-01T00:00:00.000Z',
      lastSeen: '2026-01-10T00:00:00.000Z',
    })])
    const body = issues[0].body

    expect(body).toContain('`schema-mismatch`')
    expect(body).toContain('`GET /products`')
    expect(body).toContain('`POST /orders`')
    expect(body).toContain('2026-01-01')
    expect(body).toContain('2026-01-10')
  })

  it('includes confidence and observation count in body', () => {
    const issues = formatIssues([createEntry({ confidence: 0.9, observationCount: 7 })])
    const body = issues[0].body

    expect(body).toContain('90%')
    expect(body).toContain('7')
  })

  it('generates labels with bettermcp prefix, severity, and category', () => {
    const issues = formatIssues([createEntry()])

    expect(issues[0].labels).toContain('bettermcp')
    expect(issues[0].labels).toContain('severity:medium')
    expect(issues[0].labels).toContain('category:schema-mismatch')
  })
})

describe('formatDryRun', () => {
  it('returns message when no issues to create', () => {
    const output = formatDryRun([])

    expect(output).toContain('No issues to create')
  })

  it('formats all issues with titles and bodies', () => {
    const issues = formatIssues([
      createEntry(),
      createEntry({ category: 'timeout', description: 'Timeout detected' }),
    ])
    const output = formatDryRun(issues)

    expect(output).toContain('2 issue(s) would be created')
    expect(output).toContain('Issue 1')
    expect(output).toContain('Issue 2')
    expect(output).toContain('Schema mismatch detected')
    expect(output).toContain('Timeout detected')
  })

  it('includes GitHub CLI setup instructions', () => {
    const issues = formatIssues([createEntry()])
    const output = formatDryRun(issues)

    expect(output).toContain('gh auth login')
    expect(output).toContain('cli.github.com')
  })
})
