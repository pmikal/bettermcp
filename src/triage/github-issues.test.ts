import { describe, it, expect, vi, beforeEach } from 'vitest'
import { isGhAvailable, createGitHubIssues, normalizeTitle } from './github-issues.js'
import type { FormattedIssue } from './issue-formatter.js'

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
  execFileSync: vi.fn(),
}))

import { execSync, execFileSync } from 'node:child_process'

const mockExecSync = vi.mocked(execSync)
const mockExecFileSync = vi.mocked(execFileSync)

function createIssue(overrides?: Partial<FormattedIssue>): FormattedIssue {
  return {
    title: '[bettermcp] MEDIUM: Schema mismatch detected',
    body: '## Schema mismatch\n**Category:** `schema-mismatch`',
    labels: ['bettermcp', 'severity:medium', 'category:schema-mismatch'],
    ...overrides,
  }
}

describe('normalizeTitle', () => {
  it('lowercases and collapses whitespace', () => {
    expect(normalizeTitle('[BetterMCP]  MEDIUM:  Schema Mismatch')).toBe(
      '[bettermcp] medium: schema mismatch',
    )
  })

  it('trims leading and trailing whitespace', () => {
    expect(normalizeTitle('  hello world  ')).toBe('hello world')
  })

  it('returns empty string for whitespace-only input', () => {
    expect(normalizeTitle('   ')).toBe('')
  })
})

describe('isGhAvailable', () => {
  beforeEach(() => {
    mockExecSync.mockReset()
    mockExecFileSync.mockReset()
  })

  it('returns true when gh auth status succeeds', () => {
    mockExecSync.mockReturnValue(Buffer.from(''))

    expect(isGhAvailable()).toBe(true)
    expect(mockExecSync).toHaveBeenCalledWith('gh auth status', expect.any(Object))
  })

  it('returns false when gh auth status fails', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not authenticated') })

    expect(isGhAvailable()).toBe(false)
  })
})

describe('createGitHubIssues', () => {
  beforeEach(() => {
    mockExecSync.mockReset()
    mockExecFileSync.mockReset()
  })

  it('returns dry-run result when gh is not available', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found') })

    const result = createGitHubIssues([createIssue()])

    expect(result.dryRun).toBe(true)
    expect(result.created).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('skips issues that already exist', () => {
    const existingTitle = '[bettermcp] MEDIUM: Schema mismatch detected'
    mockExecSync.mockReturnValue(Buffer.from(''))
    mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argArr = args as string[]
      if (argArr[0] === 'issue' && argArr[1] === 'list') {
        return Buffer.from(JSON.stringify([{ title: existingTitle }]))
      }
      return Buffer.from('')
    })

    const result = createGitHubIssues([createIssue({ title: existingTitle })])

    expect(result.skipped).toEqual([existingTitle])
    expect(result.created).toEqual([])
  })

  it('creates issues that do not exist yet via execFileSync', () => {
    const issueUrl = 'https://github.com/owner/repo/issues/42'
    mockExecSync.mockReturnValue(Buffer.from(''))
    mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argArr = args as string[]
      if (argArr[0] === 'issue' && argArr[1] === 'list') return Buffer.from('[]')
      if (argArr[0] === 'issue' && argArr[1] === 'create') return Buffer.from(issueUrl)
      return Buffer.from('')
    })

    const result = createGitHubIssues([createIssue()])

    expect(result.created).toEqual([issueUrl])
    expect(result.dryRun).toBe(false)
  })

  it('skips issues with case/whitespace differences via normalized dedup', () => {
    // Existing issue has slightly different casing/spacing
    const existingTitle = '[BetterMCP]  MEDIUM:  Schema mismatch detected'
    const newTitle = '[bettermcp] MEDIUM: Schema mismatch detected'
    mockExecSync.mockReturnValue(Buffer.from(''))
    mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argArr = args as string[]
      if (argArr[0] === 'issue' && argArr[1] === 'list') {
        return Buffer.from(JSON.stringify([{ title: existingTitle }]))
      }
      return Buffer.from('')
    })

    const result = createGitHubIssues([createIssue({ title: newTitle })])

    expect(result.skipped).toEqual([newTitle])
    expect(result.created).toEqual([])
  })

  it('warns on stderr when issue listing fails and proceeds without dedup', () => {
    const issueUrl = 'https://github.com/owner/repo/issues/99'
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    mockExecSync.mockReturnValue(Buffer.from(''))
    mockExecFileSync.mockImplementation((_cmd: unknown, args: unknown) => {
      const argArr = args as string[]
      if (argArr[0] === 'issue' && argArr[1] === 'list') throw new Error('network error')
      if (argArr[0] === 'issue' && argArr[1] === 'create') return Buffer.from(issueUrl)
      return Buffer.from('')
    })

    const result = createGitHubIssues([createIssue()])

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('could not list existing issues'))
    expect(result.created).toEqual([issueUrl])

    stderrSpy.mockRestore()
  })
})
