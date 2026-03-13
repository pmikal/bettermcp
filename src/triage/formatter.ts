/**
 * Terminal output formatter for triage classification reports.
 */

import type { ClassificationReport } from './classifier.js'
import type { VersionReport } from './version-reporter.js'
import type { Severity } from './severity.js'

const SEVERITY_LABELS: Record<Severity, string> = {
  critical: 'CRITICAL',
  medium: 'MEDIUM',
  low: 'LOW',
}

/**
 * Format a classification report for terminal output.
 * Returns the formatted string (does not write to stdout).
 */
export function formatReport(report: ClassificationReport): string {
  if (report.entries.length === 0 && report.totalSignals === 0) {
    return (
      'No feedback data available.\n' +
      'Run the MCP server and generate traffic, or load a spec to generate synthetic signals.\n'
    )
  }

  const lines: string[] = []

  lines.push('Triage Classification Report')
  lines.push('═'.repeat(40))
  lines.push('')

  // Summary
  const bySeverity = { critical: 0, medium: 0, low: 0 }
  for (const entry of report.entries) {
    bySeverity[entry.severity]++
  }

  lines.push(`Total signals: ${report.totalSignals}`)
  lines.push(
    `Classifications: ${report.entries.length} ` +
    `(${bySeverity.critical} critical, ${bySeverity.medium} medium, ${bySeverity.low} low)`,
  )
  if (report.filteredByThreshold > 0) {
    lines.push(`Filtered (below confidence threshold): ${report.filteredByThreshold}`)
  }
  lines.push('')

  if (report.entries.length === 0) {
    lines.push('All signals were below their category confidence thresholds.')
    lines.push('This may indicate early-stage data collection — signals will surface as confidence grows.')
    lines.push('')
  }

  // Entries grouped by severity
  for (const entry of report.entries) {
    const label = SEVERITY_LABELS[entry.severity]
    lines.push(`[${label}] ${entry.category}`)
    lines.push(`  ${entry.description}`)
    lines.push(`  Confidence: ${(entry.confidence * 100).toFixed(0)}% | Observations: ${entry.observationCount} | Source: ${entry.provenance.join(', ')}`)
    lines.push(`  Endpoints: ${entry.endpoints.join(', ')}`)
    lines.push(`  First seen: ${entry.firstSeen} | Last seen: ${entry.lastSeen}`)
    lines.push('')
  }

  return lines.join('\n')
}

const VERSION_STATE_LABELS: Record<string, string> = {
  active: 'ACTIVE',
  deprecated: 'DEPRECATED',
  sunset: 'SUNSET',
}

/**
 * Format a version lifecycle report section for terminal output.
 */
export function formatVersionReport(report: VersionReport): string {
  if (report.entries.length === 0) {
    return (
      'No version pinning configured.\n' +
      'Set up version pinning to track API version lifecycle status.\n'
    )
  }

  const lines: string[] = []

  lines.push('Version Lifecycle Report')
  lines.push('═'.repeat(40))
  lines.push('')

  for (const entry of report.entries) {
    const stateLabel = VERSION_STATE_LABELS[entry.state] ?? entry.state.toUpperCase()
    lines.push(`[${stateLabel}] ${entry.versionSha}`)
    lines.push(`  Endpoints: ${entry.endpoints.join(', ')}`)
    lines.push(`  Requests: ${entry.requestCount} | Signals: ${entry.signalCount}`)
    lines.push(`  Last activity: ${entry.lastActivity}`)
    lines.push('')
  }

  return lines.join('\n')
}
