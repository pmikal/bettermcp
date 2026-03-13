export interface WireLogEntry {
  id: string
  timestamp: string
  endpoint_path: string
  method: string
  request_headers: Record<string, string>
  request_body: unknown
  response_status: number
  response_headers: Record<string, string>
  response_body: unknown
  mode: 'live' | 'simulated'
  version_sha: string | null
  duration_ms: number
  provenance: 'wire-log'
}

export interface SignalEntry {
  id: string
  endpoint_path: string
  category: string
  severity: 'critical' | 'medium' | 'low'
  confidence: number
  observation_count: number
  first_seen: string
  last_seen: string
  provenance: 'wire-log' | 'synthetic' | 'agent-reported'
  message: string
  suggestion: string | null
  expired: boolean
}

export interface ResolutionHint {
  id: string
  endpoint_path: string
  hint: string
  source: string
  created_at: string
}

export interface QueryFilter {
  endpoint_path?: string
  mode?: 'live' | 'simulated'
  version_sha?: string
  limit?: number
}

export type VersionState = 'active' | 'deprecated' | 'sunset'

export interface VersionStateEntry {
  id: string
  endpoint_path: string
  version_sha: string
  state: 'active' | 'deprecated' | 'sunset'
  created_at: string
  updated_at: string
}

export interface PromotionLogEntry {
  id: string
  endpoint_path: string
  from_state: 'simulate' | 'live'
  to_state: 'simulate' | 'live'
  promoted_by: string
  promoted_at: string
  reason: string | null
}
