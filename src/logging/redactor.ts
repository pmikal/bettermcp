/**
 * Credential redaction pipeline.
 * Only module that inspects credential-bearing fields.
 * All wire log data passes through here before storage.
 */

/** Headers whose values are always redacted (case-insensitive match). */
const REDACTED_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'proxy-authorization',
])

const REDACTED = '[REDACTED]'

/**
 * Body credential pattern sources.
 * Stored as source+flags so fresh RegExp instances are created per call,
 * avoiding shared lastIndex state from module-level /g regex objects.
 */
const CREDENTIAL_PATTERN_DEFS: Array<{ source: string; flags: string }> = [
  // JWT tokens (header.payload.signature, signature optional for unsigned tokens)
  { source: 'eyJ[A-Za-z0-9_-]{10,}\\.[A-Za-z0-9_-]{10,}(?:\\.[A-Za-z0-9_-]*)?', flags: 'g' },
  // OpenAI / Stripe style: sk-... (at least 20 chars)
  { source: '\\bsk-[A-Za-z0-9]{20,}\\b', flags: 'g' },
  // Stripe live keys
  { source: '\\bsk_live_[A-Za-z0-9]{20,}\\b', flags: 'g' },
  // Generic key_ prefix (at least 16 chars after prefix)
  { source: '\\bkey_[A-Za-z0-9]{16,}\\b', flags: 'g' },
  // Generic token_ prefix (at least 16 chars after prefix)
  { source: '\\btoken_[A-Za-z0-9]{16,}\\b', flags: 'g' },
  // AWS access key IDs
  { source: '\\bAKIA[A-Z0-9]{16}\\b', flags: 'g' },
  // Bearer tokens in body text — match all non-whitespace after Bearer
  { source: '\\bBearer\\s+\\S{20,}', flags: 'g' },
  // GitHub PATs (ghp_, gho_, ghu_, ghs_, ghr_)
  { source: '\\bgh[pousr]_[A-Za-z0-9]{36}\\b', flags: 'g' },
  // Slack tokens (xoxb-, xoxp-, xoxa-, xoxs-)
  { source: '\\bxox[bpas]-[A-Za-z0-9-]{10,}', flags: 'g' },
  // npm tokens
  { source: '\\bnpm_[A-Za-z0-9]{36}\\b', flags: 'g' },
  // Google API keys
  { source: '\\bAIzaSy[A-Za-z0-9_-]{33}\\b', flags: 'g' },
]

export interface RedactOptions {
  /**
   * When true, skip header redaction (explicit opt-in for debugging).
   * Only affects header redaction — body credential patterns are always redacted.
   */
  fullHeaders?: boolean
}

/**
 * Redacts credential-bearing header values.
 * Returns a new object with sensitive values replaced by [REDACTED].
 */
export function redactHeaders(
  headers: Record<string, string>,
  options?: RedactOptions,
): Record<string, string> {
  if (options?.fullHeaders) return { ...headers }

  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key] = REDACTED_HEADERS.has(key.toLowerCase()) ? REDACTED : value
  }
  return result
}

/**
 * Applies credential pattern redaction to a string.
 * Creates fresh RegExp instances per call to avoid shared lastIndex state.
 */
function redactString(str: string): string {
  let result = str
  for (const def of CREDENTIAL_PATTERN_DEFS) {
    result = result.replace(new RegExp(def.source, def.flags), REDACTED)
  }
  return result
}

/**
 * Redacts known credential patterns in a body value.
 * Handles strings directly, and objects/arrays by serializing,
 * redacting, and parsing back — so credentials in nested JSON
 * objects are caught before the store calls JSON.stringify().
 */
export function redactBody(body: unknown): unknown {
  if (typeof body === 'string') {
    return redactString(body)
  }

  // Objects and arrays: serialize → redact → parse back
  if (body != null && typeof body === 'object') {
    try {
      const serialized = JSON.stringify(body)
      const redacted = redactString(serialized)
      // Only parse back if redaction actually changed something
      if (redacted === serialized) return body
      return JSON.parse(redacted)
    } catch {
      // If serialization fails (circular refs, etc.), return as-is
      return body
    }
  }

  return body
}

export interface WireEntryFields {
  request_headers: Record<string, string>
  request_body: unknown
  response_headers: Record<string, string>
  response_body: unknown
}

/**
 * Applies full redaction to a wire log entry's credential-bearing fields.
 * Returns a new object with redacted headers and body content.
 */
export function redactWireEntry<T extends WireEntryFields>(
  entry: T,
  options?: RedactOptions,
): T {
  // Explicit property picks instead of shallow spread to avoid copying
  // unexpected properties or leaking references from the source entry.
  const redacted: WireEntryFields = {
    request_headers: redactHeaders(entry.request_headers ?? {}, options),
    request_body: redactBody(entry.request_body),
    response_headers: redactHeaders(entry.response_headers ?? {}, options),
    response_body: redactBody(entry.response_body),
  }
  return Object.assign({}, entry, redacted) as T
}
