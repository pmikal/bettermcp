import type { FeedbackStore } from './feedback-store.js'
import type { WireLogEntry, QueryFilter, ResolutionHint, PromotionLogEntry, SignalEntry, VersionStateEntry, VersionState } from '../types/store.js'

/**
 * No-op FeedbackStore for degraded mode.
 * Used when the database is corrupted or inaccessible.
 * All write operations silently succeed; all read operations return empty results.
 */
export class NullStore implements FeedbackStore {
  readonly type = 'null' as const
  insert(_entry: WireLogEntry): void {}
  query(_filter: QueryFilter): WireLogEntry[] { return [] }
  getHints(_endpoint: string): ResolutionHint[] { return [] }
  insertSignal(_entry: SignalEntry): void {}
  getSignals(_endpointPath: string): SignalEntry[] { return [] }
  getSignalsBatch(_endpointPaths: string[]): Map<string, SignalEntry[]> { return new Map() }
  getHintsBatch(_endpointPaths: string[]): Map<string, ResolutionHint[]> { return new Map() }
  getAllSignals(): SignalEntry[] { return [] }
  getVersionStates(): VersionStateEntry[] { return [] }
  insertVersionState(_entry: VersionStateEntry): void {}
  updateVersionState(_id: string, _state: VersionState, _updatedAt: string): void {}
  logPromotion(_entry: PromotionLogEntry): void {}
  getPromotionLog(_endpointPath: string): PromotionLogEntry[] { return [] }
  countWireLogs(_filter: QueryFilter): number { return 0 }
  purgeWireLogsOlderThan(_days: number): number { return 0 }
  purgeSignalsOlderThan(_days: number): number { return 0 }
  expireSyntheticSignals(_endpointPathPattern: string): number { return 0 }
  close(): void {}
}
