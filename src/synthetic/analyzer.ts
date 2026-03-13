/**
 * Spec structure analyzer — detects API anti-patterns from parsed endpoints.
 * Pure function: no I/O, no store access. Returns findings for seed.ts to persist.
 */

import type { ParsedEndpoint, ParsedParameter } from '../spec/spec-types.js'
import {
  MISSING_ERROR_SCHEMA,
  MISSING_DESCRIPTION,
  INCONSISTENT_NAMING,
  PERMISSIVE_SCHEMA,
  MISSING_PAGINATION,
  type CategoryDefinition,
} from '../triage/index.js'

/** A detected anti-pattern finding from spec analysis. */
export interface AnalyzerFinding {
  endpointPath: string
  method: string
  category: CategoryDefinition
  message: string
  confidence: number
}

/**
 * Analyze parsed endpoints for known API anti-patterns.
 * Returns an array of findings — one per detected issue per endpoint.
 */
export function analyzeSpec(endpoints: ParsedEndpoint[]): AnalyzerFinding[] {
  const findings: AnalyzerFinding[] = []

  for (const ep of endpoints) {
    findings.push(...detectMissingErrorSchema(ep))
    findings.push(...detectMissingDescription(ep))
    findings.push(...detectPermissiveSchema(ep))
    findings.push(...detectMissingPagination(ep))
  }

  findings.push(...detectInconsistentNaming(endpoints))

  return findings
}

/** Endpoint has only 2xx responses — no 4xx/5xx error schemas defined. */
function detectMissingErrorSchema(ep: ParsedEndpoint): AnalyzerFinding[] {
  if (!ep.responses || Object.keys(ep.responses).length === 0) return []

  const statusCodes = Object.keys(ep.responses)
  const hasErrorResponse = statusCodes.some((code) => {
    if (code === 'default') return true
    if (/^[45][Xx]{2}$/.test(code)) return true
    const num = parseInt(code, 10)
    return num >= 400 && num < 600
  })

  if (!hasErrorResponse) {
    return [{
      endpointPath: ep.path,
      method: ep.method,
      category: MISSING_ERROR_SCHEMA,
      message: `${ep.method.toUpperCase()} ${ep.path} defines no error response schemas (4xx/5xx). Consumers cannot anticipate error shapes.`,
      confidence: 0.7,
    }]
  }

  return []
}

/** Endpoint has neither summary nor description. */
function detectMissingDescription(ep: ParsedEndpoint): AnalyzerFinding[] {
  if (!ep.summary && !ep.description) {
    return [{
      endpointPath: ep.path,
      method: ep.method,
      category: MISSING_DESCRIPTION,
      message: `${ep.method.toUpperCase()} ${ep.path} has no summary or description. Agents and developers lack context for this endpoint.`,
      confidence: 0.9,
    }]
  }

  return []
}

/** Request body schema uses additionalProperties: true or has no type constraints. */
function detectPermissiveSchema(ep: ParsedEndpoint): AnalyzerFinding[] {
  if (!ep.requestBody) return []

  const body = ep.requestBody as Record<string, unknown>
  const content = body?.['content'] as Record<string, unknown> | undefined
  if (!content) return []

  const results: AnalyzerFinding[] = []

  for (const mediaType of Object.values(content)) {
    const schema = (mediaType as Record<string, unknown>)?.['schema'] as Record<string, unknown> | undefined
    if (!schema) continue

    if (schema['additionalProperties'] === true && !schema['properties']) {
      results.push({
        endpointPath: ep.path,
        method: ep.method,
        category: PERMISSIVE_SCHEMA,
        message: `${ep.method.toUpperCase()} ${ep.path} request body allows additionalProperties with no defined properties. Any payload is accepted.`,
        confidence: 0.8,
      })
      continue
    }

    // Schema with no type and no properties — effectively unconstrained
    if (!schema['type'] && !schema['properties'] && !schema['$ref'] && !schema['allOf'] && !schema['oneOf'] && !schema['anyOf']) {
      results.push({
        endpointPath: ep.path,
        method: ep.method,
        category: PERMISSIVE_SCHEMA,
        message: `${ep.method.toUpperCase()} ${ep.path} request body schema has no type, properties, or composition keywords. The schema is effectively unconstrained.`,
        confidence: 0.6,
      })
    }
  }

  return results
}

const PAGINATION_PARAM_NAMES = new Set([
  'limit', 'offset', 'page', 'page_size', 'pagesize', 'per_page',
  'cursor', 'after', 'before', 'skip', 'take',
])

/** GET endpoint returns array but has no pagination parameters. */
function detectMissingPagination(ep: ParsedEndpoint): AnalyzerFinding[] {
  if (ep.method.toUpperCase() !== 'GET') return []

  // Check if the success response schema is an array
  const isArrayResponse = checkArrayResponse(ep.responses)
  if (!isArrayResponse) return []

  const hasPaginationParam = ep.parameters.some((p: ParsedParameter) =>
    PAGINATION_PARAM_NAMES.has(p.name.toLowerCase()),
  )

  if (!hasPaginationParam) {
    return [{
      endpointPath: ep.path,
      method: ep.method,
      category: MISSING_PAGINATION,
      message: `GET ${ep.path} returns an array but has no pagination parameters (limit, offset, page, cursor, etc.). Results may be unbounded.`,
      confidence: 0.6,
    }]
  }

  return []
}

/** Check if the 200/2xx response schema describes an array. */
function checkArrayResponse(responses: Record<string, unknown>): boolean {
  for (const [code, resp] of Object.entries(responses)) {
    if (code === 'default') continue
    if (/^[45][Xx]{2}$/.test(code)) continue
    const isSuccessRange = /^2[Xx]{2}$/.test(code)
    if (!isSuccessRange) {
      const num = parseInt(code, 10)
      if (isNaN(num)) continue
      if (num < 200 || num >= 300) continue
    }

    const content = (resp as Record<string, unknown>)?.['content'] as Record<string, unknown> | undefined
    if (!content) continue

    for (const mediaType of Object.values(content)) {
      const schema = (mediaType as Record<string, unknown>)?.['schema'] as Record<string, unknown> | undefined
      if (schema?.['type'] === 'array') return true
      if (schema?.['items']) return true
    }
  }
  return false
}

/**
 * Detect inconsistent naming across all endpoints.
 * Checks path segments for mixed camelCase/snake_case.
 */
function detectInconsistentNaming(endpoints: ParsedEndpoint[]): AnalyzerFinding[] {
  if (endpoints.length < 2) return []

  const segments = new Set<string>()
  for (const ep of endpoints) {
    for (const segment of ep.path.split('/').filter(Boolean)) {
      // Skip path parameters like {id}
      if (segment.startsWith('{')) continue
      segments.add(segment)
    }
  }

  const segmentList = [...segments]
  const hasCamelCase = segmentList.some((s) => /[a-z][A-Z]/.test(s))
  const hasSnakeCase = segmentList.some((s) => s.includes('_'))
  const hasKebabCase = segmentList.some((s) => s.includes('-'))

  const conventions = [hasCamelCase, hasSnakeCase, hasKebabCase].filter(Boolean).length
  if (conventions >= 2) {
    return [{
      endpointPath: '*',
      method: '*',
      category: INCONSISTENT_NAMING,
      message: `API path segments use mixed naming conventions (${[
        hasCamelCase && 'camelCase',
        hasSnakeCase && 'snake_case',
        hasKebabCase && 'kebab-case',
      ].filter(Boolean).join(', ')}). Consider standardizing.`,
      confidence: 0.5,
    }]
  }

  return []
}
