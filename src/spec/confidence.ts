import type { ConfidenceScore, ConfidenceFactor, ParseWarning } from './spec-types.js'

interface EndpointInfo {
  path: string
  method: string
  operationId?: string | null
  description?: string | null
  summary?: string | null
  parameters?: Array<{ schema?: unknown; description?: string | null }>
  requestBody?: unknown | null
  responses?: Record<string, unknown>
  vendorExtensions: string[]
}

const FACTORS: Array<{
  name: string
  weight: number
  check: (ep: EndpointInfo) => boolean
}> = [
  {
    name: 'has-description',
    weight: 0.1,
    check: (ep) => !!(ep.description || ep.summary),
  },
  {
    name: 'has-operation-id',
    weight: 0.1,
    check: (ep) => !!ep.operationId,
  },
  {
    name: 'has-parameter-schemas',
    weight: 0.2,
    check: (ep) => {
      if (!ep.parameters || ep.parameters.length === 0) return true // no params = no issue
      return ep.parameters.every((p) => p.schema != null)
    },
  },
  {
    name: 'has-response-schema',
    weight: 0.3,
    check: (ep) => {
      if (!ep.responses) return false
      const codes = Object.keys(ep.responses)
      if (codes.length === 0) return false
      // Check that at least the primary success response has content
      const successCode = codes.find((c) => c.startsWith('2')) ?? codes[0]
      if (!successCode) return false
      const resp = ep.responses[successCode] as Record<string, unknown> | undefined
      if (!resp) return false
      return resp['content'] != null || resp['schema'] != null
    },
  },
  {
    name: 'has-request-body-schema',
    weight: 0.15,
    check: (ep) => {
      // Only relevant for methods that accept bodies
      if (!['post', 'put', 'patch'].includes(ep.method.toLowerCase())) return true
      if (!ep.requestBody) return false
      const body = ep.requestBody as Record<string, unknown>
      return body['content'] != null || body['schema'] != null
    },
  },
  {
    name: 'no-vendor-extensions',
    weight: 0.15,
    check: (ep) => ep.vendorExtensions.length === 0,
  },
]

export function scoreEndpoint(ep: EndpointInfo): {
  confidence: ConfidenceScore
  warnings: ParseWarning[]
} {
  const factors: ConfidenceFactor[] = []
  const warnings: ParseWarning[] = []
  let score = 0

  for (const factor of FACTORS) {
    const present = factor.check(ep)
    factors.push({ name: factor.name, present, weight: factor.weight })
    if (present) {
      score += factor.weight
    } else {
      warnings.push({
        endpoint: `${ep.method.toUpperCase()} ${ep.path}`,
        feature: factor.name,
        message: `Endpoint missing: ${factor.name.replace(/-/g, ' ')}`,
      })
    }
  }

  return {
    confidence: { score: Math.round(score * 100) / 100, factors },
    warnings,
  }
}
