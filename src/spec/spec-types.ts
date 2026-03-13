export interface ParseWarning {
  endpoint?: string
  feature: string
  message: string
}

export interface ConfidenceScore {
  score: number
  factors: ConfidenceFactor[]
}

export interface ConfidenceFactor {
  name: string
  present: boolean
  weight: number
}

export interface ParsedEndpoint {
  path: string
  method: string
  operationId: string | null
  summary: string | null
  description: string | null
  parameters: ParsedParameter[]
  requestBody: unknown | null
  responses: Record<string, unknown>
  confidence: ConfidenceScore
  warnings: ParseWarning[]
}

export interface ParsedParameter {
  name: string
  in: 'query' | 'path' | 'header' | 'cookie'
  required: boolean
  schema: unknown | null
  description: string | null
}

export interface ParsedSpec {
  version: '3.0' | '3.1'
  specVersion: string
  title: string
  baseUrl: string | null
  endpoints: ParsedEndpoint[]
  warnings: ParseWarning[]
}
