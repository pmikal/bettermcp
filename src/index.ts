// bettermcp — Public API exports

export { BetterMCP } from './server.js'
export type { AuthRequest, AuthHandler } from './server.js'

export { BetterMCPError, createError } from './errors/index.js'
export type { ErrorCode, CatalogEntry } from './errors/catalog.js'

export { resolveConfig, DEFAULT_CONFIG } from './config/index.js'
export { DiscoveryConfigSchema } from './config/schema.js'
export type { BetterMCPConfig, UserConfig, SafeModeConfig, DiscoveryConfig } from './config/schema.js'

export { createStore } from './store/index.js'
export type { FeedbackStore } from './store/feedback-store.js'
export type { WireLogEntry, SignalEntry, QueryFilter, ResolutionHint, PromotionLogEntry } from './types/store.js'

export type {
  ParsedSpec,
  ParsedEndpoint,
  ParsedParameter,
  ParseWarning,
  ConfidenceScore,
  ConfidenceFactor,
} from './spec/index.js'

export {
  CATEGORIES,
  CATEGORY_VALUES,
  getCategoryDefinition,
  SCHEMA_MISMATCH,
  UNEXPECTED_RESPONSE,
  TIMEOUT,
  MISSING_ERROR_SCHEMA,
  INCONSISTENT_NAMING,
  MISSING_DESCRIPTION,
  PERMISSIVE_SCHEMA,
  MISSING_PAGINATION,
  BREAKING_CHANGE,
  DATA_LOSS,
  DEPRECATION,
  AGENT_REPORTED,
} from './triage/index.js'

export type { Severity, CategoryDefinition } from './triage/index.js'
