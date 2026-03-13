// bun:sqlite implementation of FeedbackStore
// This file is only loaded when running on Bun runtime.
// It wraps bun:sqlite's API to expose the same synchronous interface as NodeStore.

import { createError } from '../errors/index.js'
import type { FeedbackStore } from './feedback-store.js'
import { SCHEMA_DDL } from './schema.js'
import type { WireLogEntry, QueryFilter, ResolutionHint, PromotionLogEntry, SignalEntry, VersionStateEntry, VersionState } from '../types/store.js'

interface BunDatabase {
  exec(sql: string): void
  prepare(sql: string): {
    run(...params: unknown[]): void
    all(...params: unknown[]): Array<Record<string, unknown>>
  }
  close(): void
}

export class BunStore implements FeedbackStore {
  private db: BunDatabase

  constructor(dbPath: string) {
    try {
      // Dynamic require resolved at runtime by Bun
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('bun:sqlite') as { Database: new (path: string) => BunDatabase }
      this.db = new mod.Database(dbPath)
    } catch (err) {
      throw createError('CONFIG_INVALID', `Failed to open database at ${dbPath}: ${String(err)}`, {
        cause: err,
      })
    }
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(SCHEMA_DDL)
  }

  insert(entry: WireLogEntry): void {
    const stmt = this.db.prepare(`
      INSERT INTO wire_logs (id, timestamp, endpoint_path, method, request_headers, request_body,
        response_status, response_headers, response_body, mode, version_sha, duration_ms, provenance)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      entry.id,
      entry.timestamp,
      entry.endpoint_path,
      entry.method,
      JSON.stringify(entry.request_headers),
      entry.request_body != null ? JSON.stringify(entry.request_body) : null,
      entry.response_status,
      JSON.stringify(entry.response_headers),
      entry.response_body != null ? JSON.stringify(entry.response_body) : null,
      entry.mode,
      entry.version_sha,
      entry.duration_ms,
      entry.provenance,
    )
  }

  query(filter: QueryFilter): WireLogEntry[] {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter.endpoint_path) {
      conditions.push('endpoint_path = ?')
      params.push(filter.endpoint_path)
    }
    if (filter.mode) {
      conditions.push('mode = ?')
      params.push(filter.mode)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    if (filter.limit != null) {
      params.push(Number(filter.limit))
    }
    const limitClause = filter.limit != null ? 'LIMIT ?' : ''

    const rows = this.db
      .prepare(`SELECT * FROM wire_logs ${where} ORDER BY timestamp DESC ${limitClause}`)
      .all(...params)

    return rows.map((row: Record<string, unknown>) => ({
      id: row['id'] as string,
      timestamp: row['timestamp'] as string,
      endpoint_path: row['endpoint_path'] as string,
      method: row['method'] as string,
      request_headers: JSON.parse(row['request_headers'] as string) as Record<string, string>,
      request_body: row['request_body'] != null ? JSON.parse(row['request_body'] as string) : null,
      response_status: row['response_status'] as number,
      response_headers: JSON.parse(row['response_headers'] as string) as Record<string, string>,
      response_body: row['response_body'] != null ? JSON.parse(row['response_body'] as string) : null,
      mode: row['mode'] as 'live' | 'simulated',
      version_sha: (row['version_sha'] as string) ?? null,
      duration_ms: row['duration_ms'] as number,
      provenance: 'wire-log' as const,
    }))
  }

  getHints(endpoint: string): ResolutionHint[] {
    const rows = this.db
      .prepare('SELECT * FROM resolution_hints WHERE endpoint_path = ? ORDER BY created_at DESC')
      .all(endpoint)

    return rows.map((row: Record<string, unknown>) => ({
      id: row['id'] as string,
      endpoint_path: row['endpoint_path'] as string,
      hint: row['hint'] as string,
      source: row['source'] as string,
      created_at: row['created_at'] as string,
    }))
  }

  insertSignal(entry: SignalEntry): void {
    this.db
      .prepare(
        `INSERT INTO synthetic_signals (id, endpoint_path, category, severity, confidence,
          observation_count, first_seen, last_seen, provenance, message, suggestion, expired)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint_path, category) DO UPDATE SET
           observation_count = observation_count + 1,
           last_seen = excluded.last_seen,
           message = excluded.message,
           confidence = excluded.confidence,
           suggestion = excluded.suggestion`,
      )
      .run(
        entry.id,
        entry.endpoint_path,
        entry.category,
        entry.severity,
        entry.confidence,
        entry.observation_count,
        entry.first_seen,
        entry.last_seen,
        entry.provenance,
        entry.message,
        entry.suggestion,
        entry.expired ? 1 : 0,
      )

    // Enforce per-endpoint cap of 100 signals
    const SIGNAL_CAP = 100
    const rows = this.db
      .prepare('SELECT COUNT(*) as count FROM synthetic_signals WHERE endpoint_path = ?')
      .all(entry.endpoint_path)
    const count = (rows[0] as Record<string, unknown>)?.['count'] as number ?? 0
    if (count > SIGNAL_CAP) {
      this.db
        .prepare(
          `DELETE FROM synthetic_signals WHERE id IN (
            SELECT id FROM synthetic_signals
            WHERE endpoint_path = ?
            ORDER BY last_seen ASC
            LIMIT ?
          )`,
        )
        .run(entry.endpoint_path, count - SIGNAL_CAP)
    }
  }

  getSignals(endpointPath: string): SignalEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM synthetic_signals
         WHERE endpoint_path = ? AND expired = 0
         ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END, last_seen DESC`,
      )
      .all(endpointPath)

    return rows.map((row: Record<string, unknown>) => ({
      id: row['id'] as string,
      endpoint_path: row['endpoint_path'] as string,
      category: row['category'] as string,
      severity: row['severity'] as 'critical' | 'medium' | 'low',
      confidence: row['confidence'] as number,
      observation_count: row['observation_count'] as number,
      first_seen: row['first_seen'] as string,
      last_seen: row['last_seen'] as string,
      provenance: row['provenance'] as 'wire-log' | 'synthetic' | 'agent-reported',
      message: row['message'] as string,
      suggestion: (row['suggestion'] as string) ?? null,
      expired: (row['expired'] as number) === 1,
    }))
  }

  getSignalsBatch(endpointPaths: string[]): Map<string, SignalEntry[]> {
    const result = new Map<string, SignalEntry[]>()
    if (endpointPaths.length === 0) return result

    const placeholders = endpointPaths.map(() => '?').join(', ')
    const rows = this.db
      .prepare(
        `SELECT * FROM synthetic_signals
         WHERE endpoint_path IN (${placeholders}) AND expired = 0
         ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END, last_seen DESC`,
      )
      .all(...endpointPaths)

    for (const row of rows as Array<Record<string, unknown>>) {
      const ep = row['endpoint_path'] as string
      const entry: SignalEntry = {
        id: row['id'] as string,
        endpoint_path: ep,
        category: row['category'] as string,
        severity: row['severity'] as 'critical' | 'medium' | 'low',
        confidence: row['confidence'] as number,
        observation_count: row['observation_count'] as number,
        first_seen: row['first_seen'] as string,
        last_seen: row['last_seen'] as string,
        provenance: row['provenance'] as 'wire-log' | 'synthetic' | 'agent-reported',
        message: row['message'] as string,
        suggestion: (row['suggestion'] as string) ?? null,
        expired: (row['expired'] as number) === 1,
      }
      const list = result.get(ep)
      if (list) {
        list.push(entry)
      } else {
        result.set(ep, [entry])
      }
    }

    return result
  }

  getHintsBatch(endpointPaths: string[]): Map<string, ResolutionHint[]> {
    const result = new Map<string, ResolutionHint[]>()
    if (endpointPaths.length === 0) return result

    const placeholders = endpointPaths.map(() => '?').join(', ')
    const rows = this.db
      .prepare(
        `SELECT * FROM resolution_hints WHERE endpoint_path IN (${placeholders}) ORDER BY created_at DESC`,
      )
      .all(...endpointPaths)

    for (const row of rows as Array<Record<string, unknown>>) {
      const ep = row['endpoint_path'] as string
      const entry: ResolutionHint = {
        id: row['id'] as string,
        endpoint_path: ep,
        hint: row['hint'] as string,
        source: row['source'] as string,
        created_at: row['created_at'] as string,
      }
      const list = result.get(ep)
      if (list) {
        list.push(entry)
      } else {
        result.set(ep, [entry])
      }
    }

    return result
  }

  getAllSignals(): SignalEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM synthetic_signals
         WHERE expired = 0`,
      )
      .all()

    return rows.map((row: Record<string, unknown>) => ({
      id: row['id'] as string,
      endpoint_path: row['endpoint_path'] as string,
      category: row['category'] as string,
      severity: row['severity'] as 'critical' | 'medium' | 'low',
      confidence: row['confidence'] as number,
      observation_count: row['observation_count'] as number,
      first_seen: row['first_seen'] as string,
      last_seen: row['last_seen'] as string,
      provenance: row['provenance'] as 'wire-log' | 'synthetic' | 'agent-reported',
      message: row['message'] as string,
      suggestion: (row['suggestion'] as string) ?? null,
      expired: (row['expired'] as number) === 1,
    }))
  }

  getVersionStates(): VersionStateEntry[] {
    const rows = this.db
      .prepare('SELECT * FROM version_states ORDER BY updated_at DESC')
      .all()

    return rows.map((row: Record<string, unknown>) => ({
      id: row['id'] as string,
      endpoint_path: row['endpoint_path'] as string,
      version_sha: row['version_sha'] as string,
      state: row['state'] as 'active' | 'deprecated' | 'sunset',
      created_at: row['created_at'] as string,
      updated_at: row['updated_at'] as string,
    }))
  }

  insertVersionState(entry: VersionStateEntry): void {
    this.db
      .prepare(
        `INSERT INTO version_states (id, endpoint_path, version_sha, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(entry.id, entry.endpoint_path, entry.version_sha, entry.state, entry.created_at, entry.updated_at)
  }

  updateVersionState(id: string, state: VersionState, updatedAt: string): void {
    this.db
      .prepare('UPDATE version_states SET state = ?, updated_at = ? WHERE id = ?')
      .run(state, updatedAt, id)
  }

  logPromotion(entry: PromotionLogEntry): void {
    this.db
      .prepare(
        `INSERT INTO promotion_log (id, endpoint_path, from_state, to_state, promoted_by, promoted_at, reason)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.endpoint_path,
        entry.from_state,
        entry.to_state,
        entry.promoted_by,
        entry.promoted_at,
        entry.reason,
      )
  }

  getPromotionLog(endpointPath: string): PromotionLogEntry[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM promotion_log WHERE endpoint_path = ? ORDER BY promoted_at DESC',
      )
      .all(endpointPath)

    return rows.map((row: Record<string, unknown>) => ({
      id: row['id'] as string,
      endpoint_path: row['endpoint_path'] as string,
      from_state: row['from_state'] as 'simulate' | 'live',
      to_state: row['to_state'] as 'simulate' | 'live',
      promoted_by: row['promoted_by'] as string,
      promoted_at: row['promoted_at'] as string,
      reason: (row['reason'] as string) ?? null,
    }))
  }

  countWireLogs(filter: QueryFilter): number {
    const conditions: string[] = []
    const params: unknown[] = []

    if (filter.endpoint_path) {
      conditions.push('endpoint_path = ?')
      params.push(filter.endpoint_path)
    }
    if (filter.mode) {
      conditions.push('mode = ?')
      params.push(filter.mode)
    }
    if (filter.version_sha) {
      conditions.push('version_sha = ?')
      params.push(filter.version_sha)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = this.db
      .prepare(`SELECT COUNT(*) as count FROM wire_logs ${where}`)
      .all(...params)

    return (rows[0] as Record<string, unknown>)?.['count'] as number ?? 0
  }

  /** Purges wire_logs older than the given number of days. Other tables are not affected. */
  purgeWireLogsOlderThan(days: number): number {
    if (days < 1) return 0
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    // Wrap in transaction so count matches actual deletions
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const rows = this.db
        .prepare('SELECT COUNT(*) as count FROM wire_logs WHERE timestamp < ?')
        .all(cutoff)
      const count = (rows[0] as Record<string, unknown>)?.['count'] as number ?? 0
      if (count > 0) {
        this.db.prepare('DELETE FROM wire_logs WHERE timestamp < ?').run(cutoff)
      }
      this.db.exec('COMMIT')
      return count
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  purgeSignalsOlderThan(days: number): number {
    if (days < 1) return 0
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const rows = this.db
        .prepare('SELECT COUNT(*) as count FROM synthetic_signals WHERE last_seen < ?')
        .all(cutoff)
      const count = (rows[0] as Record<string, unknown>)?.['count'] as number ?? 0
      if (count > 0) {
        this.db.prepare('DELETE FROM synthetic_signals WHERE last_seen < ?').run(cutoff)
      }
      this.db.exec('COMMIT')
      return count
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  expireSyntheticSignals(endpointPathPattern: string): number {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const rows = this.db
        .prepare(
          `SELECT COUNT(*) as count FROM synthetic_signals
           WHERE endpoint_path LIKE ? ESCAPE '\\' AND provenance = 'synthetic' AND expired = 0`,
        )
        .all(endpointPathPattern)
      const count = (rows[0] as Record<string, unknown>)?.['count'] as number ?? 0
      if (count > 0) {
        this.db
          .prepare(
            `UPDATE synthetic_signals SET expired = 1
             WHERE endpoint_path LIKE ? ESCAPE '\\' AND provenance = 'synthetic' AND expired = 0`,
          )
          .run(endpointPathPattern)
      }
      this.db.exec('COMMIT')
      return count
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  close(): void {
    this.db.close()
  }
}
