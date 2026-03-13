/**
 * GitHub issue creator — wraps `gh` CLI for issue creation with dedup.
 * Falls back to dry-run output when `gh` is not available.
 */

import { execSync, execFileSync } from 'node:child_process'
import type { FormattedIssue } from './issue-formatter.js'

export interface CreateIssuesResult {
  created: string[]
  skipped: string[]
  dryRun: boolean
}

/**
 * Check if the `gh` CLI is available and authenticated.
 */
export function isGhAvailable(): boolean {
  try {
    execSync('gh auth status', { stdio: 'pipe', timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

/**
 * Normalize a title for dedup comparison: lowercase, collapse whitespace.
 * This prevents duplicates caused by trivial formatting differences
 * (e.g., extra spaces, case changes) while still matching on the full title.
 */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * List existing open issue titles that have the 'bettermcp' label.
 * Returns null if the listing fails — caller should handle dedup bypass.
 * Titles are normalized (lowercased, whitespace-collapsed) for fuzzy dedup.
 */
function listExistingIssueTitles(): Set<string> | null {
  try {
    const output = execFileSync(
      'gh',
      ['issue', 'list', '--label', 'bettermcp', '--state', 'open', '--json', 'title', '--limit', '200'],
      { stdio: 'pipe', timeout: 30_000 },
    ).toString()

    const issues = JSON.parse(output) as Array<{ title: string }>
    return new Set(issues.map((i) => normalizeTitle(i.title)))
  } catch {
    process.stderr.write('[bettermcp] Warning: could not list existing issues — dedup skipped\n')
    return null
  }
}

/**
 * Create a single GitHub issue via `gh` CLI.
 * Uses execFileSync with argument array — no shell interpolation.
 * Returns the issue URL on success, or null on failure.
 */
function createIssue(issue: FormattedIssue): string | null {
  try {
    const args = ['issue', 'create', '--title', issue.title, '--body', issue.body]
    for (const label of issue.labels) {
      args.push('--label', label)
    }
    const output = execFileSync('gh', args, { stdio: 'pipe', timeout: 30_000 }).toString().trim()
    return output
  } catch {
    return null
  }
}

/**
 * Create GitHub issues from formatted issues, skipping duplicates.
 * If `gh` is not available, returns a dry-run result.
 */
export function createGitHubIssues(issues: FormattedIssue[]): CreateIssuesResult {
  if (!isGhAvailable()) {
    return { created: [], skipped: [], dryRun: true }
  }

  const existingTitles = listExistingIssueTitles()
  const created: string[] = []
  const skipped: string[] = []

  for (const issue of issues) {
    if (existingTitles?.has(normalizeTitle(issue.title))) {
      skipped.push(issue.title)
      continue
    }

    const url = createIssue(issue)
    if (url) {
      created.push(url)
    }
  }

  return { created, skipped, dryRun: false }
}
