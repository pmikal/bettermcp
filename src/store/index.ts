import { NodeStore } from './node-store.js'
import { NullStore } from './null-store.js'

export type { FeedbackStore } from './feedback-store.js'
export { NullStore } from './null-store.js'
export type { WireLogEntry, SignalEntry, QueryFilter, ResolutionHint, PromotionLogEntry } from '../types/store.js'

export function createStore(dbPath: string): import('./feedback-store.js').FeedbackStore {
  try {
    // Runtime detection: Bun exposes globalThis.Bun
    if (typeof globalThis !== 'undefined' && 'Bun' in globalThis) {
      // Lazy require to avoid loading bun:sqlite on Node
      const { BunStore } = require('./bun-store.js') as typeof import('./bun-store.js')
      return new BunStore(dbPath)
    }

    return new NodeStore(dbPath)
  } catch (err) {
    process.stderr.write(
      `[bettermcp] WARNING: Failed to open feedback store at ${dbPath}: ${err}. Running in degraded mode — intelligence features disabled.\n`,
    )
    return new NullStore()
  }
}
