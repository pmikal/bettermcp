import { randomUUID } from 'node:crypto'
import type { FeedbackStore } from '../store/feedback-store.js'
import type { WireLogEntry } from '../types/store.js'
import { redactWireEntry } from './redactor.js'
import type { RedactOptions } from './redactor.js'

export interface WireLogInput {
  endpoint_path: string
  method: string
  request_headers: Record<string, string>
  request_body: unknown
  response_status: number
  response_headers: Record<string, string>
  response_body: unknown
  mode: 'live' | 'simulated'
  startTime: number
}

/** Max body size (bytes) to store in wire logs. Larger bodies are truncated. */
const MAX_WIRE_LOG_BODY_BYTES = 1_000_000

/**
 * Builds a redacted WireLogEntry and writes it to the store.
 * Non-throwing: catches and logs any store/redaction errors to stderr.
 * Returns the entry ID on success, null on failure.
 */
export function logWireEntry(
  input: WireLogInput,
  store: FeedbackStore,
  redactOptions?: RedactOptions,
): string | null {
  const durationMs = Math.max(0, Date.now() - input.startTime)

  const rawEntry: WireLogEntry = {
    id: randomUUID(),
    timestamp: new Date(input.startTime + durationMs).toISOString(),
    endpoint_path: input.endpoint_path,
    method: input.method,
    request_headers: input.request_headers,
    request_body: truncateBody(input.request_body),
    response_status: input.response_status,
    response_headers: input.response_headers,
    response_body: truncateBody(input.response_body),
    mode: input.mode,
    version_sha: null,
    duration_ms: durationMs,
    provenance: 'wire-log',
  }

  let redacted: WireLogEntry
  try {
    redacted = redactWireEntry(rawEntry, redactOptions)
  } catch (redactErr) {
    process.stderr.write(
      `[bettermcp] wire-log redaction failed: ${redactErr}\n`,
    )
    return null
  }

  try {
    store.insert(redacted)
    return redacted.id
  } catch (err) {
    process.stderr.write(
      `[bettermcp] wire-log write failed: ${err}\n`,
    )
    return null
  }
}

/**
 * Truncates oversized bodies before redaction/storage.
 * Strings are sliced directly; objects are serialized to check size.
 */
function truncateBody(body: unknown): unknown {
  if (typeof body === 'string' && body.length > MAX_WIRE_LOG_BODY_BYTES) {
    return body.slice(0, MAX_WIRE_LOG_BODY_BYTES) + '... [TRUNCATED]'
  }
  if (body != null && typeof body === 'object') {
    try {
      const serialized = JSON.stringify(body)
      if (serialized.length > MAX_WIRE_LOG_BODY_BYTES) {
        return serialized.slice(0, MAX_WIRE_LOG_BODY_BYTES) + '... [TRUNCATED]'
      }
    } catch {
      // Can't measure size — pass through and let redactor handle it
    }
  }
  return body
}
