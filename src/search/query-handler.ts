import type { ParsedEndpoint } from '../spec/spec-types.js'
import type { FeedbackStore } from '../store/feedback-store.js'

export interface DiagnosticEntry {
  category: string
  severity: 'critical' | 'medium' | 'low'
  confidence: number
  observationCount: number
  provenance: 'wire-log' | 'synthetic' | 'agent-reported'
  message: string
  suggestion: string | null
}

export interface HintEntry {
  hint: string
  source: string
  createdAt: string
}

export interface SearchResult {
  path: string
  method: string
  operationId: string | null
  summary: string | null
  description: string | null
  parameters: Array<{
    name: string
    in: string
    required: boolean
    description: string | null
  }>
  confidence: number
  diagnostics?: DiagnosticEntry[]
  hints?: HintEntry[]
}

/**
 * Options for search query behavior.
 * When `includeDiagnostics` is true, `store` must also be provided —
 * diagnostics are silently omitted if store is missing.
 */
export interface SearchOptions {
  includeDiagnostics?: boolean
  store?: FeedbackStore
  limit?: number
}

const DEFAULT_SEARCH_LIMIT = 50

/**
 * Check if a term matches on a word boundary within the searchable text.
 * Both the term and the searchable text are split into words (on non-word
 * characters), then we check if any searchable word starts with any term
 * word. This avoids false positives like "get" matching "budget" while
 * still matching "get" against "GET" or "getPet", and handles path-like
 * terms such as "/products" by extracting "products".
 */
function matchesWordBoundary(term: string, searchable: string): boolean {
  const termWords = term.split(/\W+/).filter(Boolean)
  const searchWords = searchable.split(/\W+/).filter(Boolean)
  return termWords.some((tw) =>
    searchWords.some((sw) => sw.startsWith(tw)),
  )
}

export function handleQuery(
  query: string,
  endpoints: ParsedEndpoint[],
  options?: SearchOptions,
): SearchResult[] {
  const limit = options?.limit ?? DEFAULT_SEARCH_LIMIT
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (terms.length === 0) {
    // Return endpoints up to the limit when query is empty
    const matched = endpoints.slice(0, limit)
    return attachDiagnostics(matched, options)
  }

  const scored: Array<{ endpoint: ParsedEndpoint; relevance: number }> = []

  for (const ep of endpoints) {
    let relevance = 0
    const searchable = [
      ep.path,
      ep.method,
      ep.operationId ?? '',
      ep.summary ?? '',
      ep.description ?? '',
    ]
      .join(' ')
      .toLowerCase()

    for (const term of terms) {
      if (matchesWordBoundary(term, searchable)) {
        relevance += 1
      }
    }

    if (relevance > 0) {
      scored.push({ endpoint: ep, relevance })
    }
  }

  const matched = scored
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit)
    .map(({ endpoint }) => endpoint)

  return attachDiagnostics(matched, options)
}

function toSearchResult(ep: ParsedEndpoint): SearchResult {
  return {
    path: ep.path,
    method: ep.method,
    operationId: ep.operationId,
    summary: ep.summary,
    description: ep.description,
    parameters: ep.parameters.map((p) => ({
      name: p.name,
      in: p.in,
      required: p.required,
      description: p.description,
    })),
    confidence: ep.confidence.score,
  }
}

/**
 * Attach diagnostics and hints to search results using batch store queries
 * instead of issuing per-endpoint queries (N+1 elimination).
 */
function attachDiagnostics(
  matched: ParsedEndpoint[],
  options?: SearchOptions,
): SearchResult[] {
  const results = matched.map((ep) => toSearchResult(ep))

  if (!options?.includeDiagnostics || !options.store) {
    return results
  }

  const endpointKeys = matched.map((ep) => `${ep.method.toUpperCase()} ${ep.path}`)

  try {
    const signalsMap = options.store.getSignalsBatch(endpointKeys)
    const hintsMap = options.store.getHintsBatch(endpointKeys)

    for (let i = 0; i < results.length; i++) {
      const key = endpointKeys[i]!
      const signals = signalsMap.get(key)
      if (signals && signals.length > 0) {
        results[i]!.diagnostics = signals.map((s) => ({
          category: s.category,
          severity: s.severity,
          confidence: s.confidence,
          observationCount: s.observation_count,
          provenance: s.provenance,
          message: s.message,
          suggestion: s.suggestion,
        }))
      }

      const hints = hintsMap.get(key)
      if (hints && hints.length > 0) {
        results[i]!.hints = hints.map((h) => ({
          hint: h.hint,
          source: h.source,
          createdAt: h.created_at,
        }))
      }
    }
  } catch {
    // Diagnostics are supplementary — degrade gracefully
  }

  return results
}
