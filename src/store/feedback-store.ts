import type { WireLogEntry, QueryFilter, ResolutionHint, PromotionLogEntry, SignalEntry, VersionStateEntry, VersionState } from '../types/store.js'

export interface FeedbackStore {
  insert(entry: WireLogEntry): void
  query(filter: QueryFilter): WireLogEntry[]
  getHints(endpoint: string): ResolutionHint[]
  insertSignal(entry: SignalEntry): void
  /** Returns active (non-expired) signals for the given endpoint path. */
  getSignals(endpointPath: string): SignalEntry[]
  /** Returns active (non-expired) signals for multiple endpoint paths in a single query. */
  getSignalsBatch(endpointPaths: string[]): Map<string, SignalEntry[]>
  /** Returns resolution hints for multiple endpoint paths in a single query. */
  getHintsBatch(endpointPaths: string[]): Map<string, ResolutionHint[]>
  /** Returns all active (non-expired) signals across all endpoints. */
  getAllSignals(): SignalEntry[]
  /** Returns all version state entries. */
  getVersionStates(): VersionStateEntry[]
  /** Inserts a new version state entry. */
  insertVersionState(entry: VersionStateEntry): void
  /** Updates the state and updated_at of an existing version state entry. */
  updateVersionState(id: string, state: VersionState, updatedAt: string): void
  logPromotion(entry: PromotionLogEntry): void
  getPromotionLog(endpointPath: string): PromotionLogEntry[]
  /** Returns the count of wire_logs matching the given filter without loading rows into memory. */
  countWireLogs(filter: QueryFilter): number
  /** Purges wire_logs older than the given number of days. Other tables are not affected. */
  purgeWireLogsOlderThan(days: number): number
  /** Purges signals whose last_seen is older than the given number of days. Returns count of deleted rows. */
  purgeSignalsOlderThan(days: number): number
  /** Marks synthetic signals as expired for endpoints matching the given path. Uses LIKE match on endpoint_path. */
  expireSyntheticSignals(endpointPathPattern: string): number
  close(): void
}
