import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { z } from 'zod'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { resolveConfig, DEFAULT_RETENTION_DAYS } from './config/index.js'
import type { UserConfig, BetterMCPConfig } from './config/schema.js'
import { createError } from './errors/index.js'
import { parseSpec } from './spec/index.js'
import { runDiscovery } from './discovery/index.js'
import type { DiscoveryConfig } from './config/schema.js'
import type { ParsedSpec } from './spec/spec-types.js'
import type { ParsedEndpoint } from './spec/spec-types.js'
import { handleQuery, handleVersionDiscovery } from './search/index.js'
import { VersionRouter } from './versioning/index.js'
import { TranslationRegistry } from './translate/index.js'
import type { TranslationHandlerConfig } from './translate/index.js'
import { shouldSimulate } from './safe-mode/index.js'
import {
  extractResponseSchema,
  simulateResponse,
} from './safe-mode/simulator.js'
import {
  compileResponseSchema,
  validateWithCompiled,
  type CompiledValidator,
} from './safe-mode/schema-validator.js'
import { matchesTemplatePath } from './safe-mode/path-matcher.js'
import { createStore } from './store/index.js'
import type { SignalEntry } from './types/store.js'
import { logWireEntry } from './logging/wire-logger.js'
import { redactBody } from './logging/redactor.js'
import type { RedactOptions } from './logging/redactor.js'
import { SCHEMA_MISMATCH } from './triage/index.js'

/** Rate limit header names to surface in proxy mode (case-insensitive). */
const RATE_LIMIT_HEADERS = new Set([
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'retry-after',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
  'ratelimit-policy',
])

/** Extract rate limit headers from a response headers map. Returns undefined if none found. */
export function extractRateLimits(headers: Record<string, string>): Record<string, string> | undefined {
  const result: Record<string, string> = {}
  let found = false
  for (const [key, value] of Object.entries(headers)) {
    if (RATE_LIMIT_HEADERS.has(key.toLowerCase())) {
      result[key] = value
      found = true
    }
  }
  return found ? result : undefined
}

/**
 * Convert a Fetch API Headers object to a plain record, preserving multi-value
 * headers (e.g., multiple Set-Cookie) by joining them with ", ".
 *
 * The standard `Object.fromEntries(headers.entries())` silently drops duplicate
 * header values. This helper uses `Headers.getSetCookie()` (Node 20+) for
 * Set-Cookie specifically, and falls back to forEach for all others.
 */
function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {}
  headers.forEach((value, key) => {
    if (key in record) {
      record[key] += `, ${value}`
    } else {
      record[key] = value
    }
  })

  // Set-Cookie headers are special — the Fetch spec merges them in entries()
  // but getSetCookie() returns the original values (Node 20+).
  if (typeof headers.getSetCookie === 'function') {
    const cookies = headers.getSetCookie()
    if (cookies.length > 0) {
      record['set-cookie'] = cookies.join(', ')
    }
  }

  return record
}

const FETCH_TIMEOUT_MS = 30_000
const MAX_RESPONSE_BYTES = 10_000_000
const MAX_VALIDATION_RESPONSE_BYTES = 1_000_000
const MAX_VALIDATION_ERRORS = 10

/** Successful result from executeUpstreamFetch. */
interface UpstreamFetchOk {
  ok: true
  response: Response
  responseText: string
  responseHeaders: Record<string, string>
  effectiveHeaders: Record<string, string>
}

/** Auth-error result — structured content to return to the agent. */
interface UpstreamFetchAuthError {
  ok: false
  authError: {
    content: Array<{ type: 'text'; text: string }>
    isError: true
  }
}

/** Truncated result — response body exceeded MAX_RESPONSE_BYTES. */
interface UpstreamFetchTruncated {
  ok: false
  truncated: true
  status: number
}

type UpstreamFetchResult = UpstreamFetchOk | UpstreamFetchAuthError | UpstreamFetchTruncated

/**
 * Read response body with streaming size guard.
 * Protects against oversized chunked/streaming responses that lack Content-Length.
 * Returns null if the response exceeds maxBytes.
 */
async function readResponseBody(response: Response, maxBytes: number): Promise<string | null> {
  // Fast path: Content-Length header available
  const contentLength = parseInt(response.headers.get('content-length') ?? '0', 10)
  if (contentLength > maxBytes) return null

  const reader = response.body?.getReader()
  if (!reader) {
    // Fallback for environments without ReadableStream (shouldn't happen on Node 20+)
    return response.text()
  }

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    totalBytes += value.byteLength
    if (totalBytes > maxBytes) {
      reader.cancel()
      return null
    }
    chunks.push(value)
  }

  return chunks.length === 1
    ? decoder.decode(chunks[0])
    : decoder.decode(Buffer.concat(chunks))
}

/** Input passed to a custom auth handler before each upstream request. */
export interface AuthRequest {
  endpoint: string
  method: string
  headers: Record<string, string>
}

/**
 * A custom auth handler — receives the request context and returns modified headers.
 * Only the `headers` field from the return value is used; `endpoint` and `method`
 * are provided for context (e.g., path-specific signing) but are not consumed.
 */
export type AuthHandler = (request: AuthRequest) => { headers: Record<string, string> } | Promise<{ headers: Record<string, string> }>

/**
 * Shared upstream fetch logic used by both normal and translation flows.
 * Handles: URL building with SSRF check, query params, auth handler invocation,
 * fetch with timeout, readResponseBody, and size guard.
 */
async function executeUpstreamFetch(opts: {
  baseUrl: string
  endpoint: string
  method: string
  headers: Record<string, string> | undefined
  body: string | undefined
  queryParams: Record<string, string> | undefined
  authHandler: AuthHandler | null
  wireLog: (resp: { status: number; headers: Record<string, string>; body: unknown; mode: 'live' | 'simulated' }, effectiveRequestHeaders?: Record<string, string>) => void
}): Promise<UpstreamFetchResult> {
  const { endpoint, method, queryParams, authHandler, wireLog } = opts

  // Build URL with trailing-slash base so relative paths resolve correctly
  const base = opts.baseUrl.endsWith('/') ? opts.baseUrl : opts.baseUrl + '/'
  const url = new URL(endpoint, base)

  // SSRF protection: verify resolved origin matches spec base URL
  const expectedOrigin = new URL(base).origin
  if (url.origin !== expectedOrigin) {
    throw createError('EXECUTE_ORIGIN_MISMATCH', url.origin, expectedOrigin)
  }

  if (queryParams) {
    for (const [key, value] of Object.entries(queryParams)) {
      url.searchParams.set(key, value)
    }
  }

  // Apply custom auth handler if registered
  let effectiveHeaders = (opts.headers ?? {}) as Record<string, string>
  if (authHandler) {
    try {
      const authResult = await authHandler({ endpoint, method, headers: { ...effectiveHeaders } })
      if (!authResult || typeof authResult.headers !== 'object') {
        const bmcpErr = createError('AUTH_HANDLER_FAILED', 'Handler must return an object with a headers record')
        const errBody = {
          code: bmcpErr.code,
          error: bmcpErr.problem,
          fix: bmcpErr.fix,
          docsUrl: bmcpErr.docsUrl,
          endpoint,
          method,
        }
        wireLog({ status: 0, headers: {}, body: errBody, mode: 'live' })
        return {
          ok: false,
          authError: {
            content: [{ type: 'text' as const, text: JSON.stringify(errBody) }],
            isError: true,
          },
        }
      }
      effectiveHeaders = authResult.headers
    } catch (err) {
      const bmcpErr = createError('AUTH_HANDLER_FAILED', err instanceof Error ? err.message : String(err))
      const errBody = {
        code: bmcpErr.code,
        error: bmcpErr.problem,
        fix: bmcpErr.fix,
        docsUrl: bmcpErr.docsUrl,
        endpoint,
        method,
      }
      wireLog({ status: 0, headers: {}, body: errBody, mode: 'live' })
      return {
        ok: false,
        authError: {
          content: [{ type: 'text' as const, text: JSON.stringify(errBody) }],
          isError: true,
        },
      }
    }
  }

  const fetchOptions: RequestInit = {
    method,
    headers: effectiveHeaders,
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }

  const requestBody = opts.body
  if (requestBody !== undefined && method !== 'GET' && method !== 'HEAD') {
    fetchOptions.body = requestBody
    fetchOptions.headers = {
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    }
  }

  let response: Response
  try {
    response = await fetch(url.toString(), fetchOptions)
  } catch (err) {
    wireLog({ status: 0, headers: {}, body: String(err), mode: 'live' }, effectiveHeaders)
    throw createError('EXECUTE_UPSTREAM_ERROR', String(err), { cause: err })
  }

  // Guard against oversized responses — streaming size check handles
  // both Content-Length and chunked transfer responses
  const responseText = await readResponseBody(response, MAX_RESPONSE_BYTES)
  if (responseText === null) {
    wireLog({
      status: response.status,
      headers: headersToRecord(response.headers),
      body: `[TRUNCATED: exceeded ${MAX_RESPONSE_BYTES} bytes]`,
      mode: 'live',
    }, effectiveHeaders)
    return { ok: false, truncated: true, status: response.status }
  }

  const responseHeaders = headersToRecord(response.headers)
  return { ok: true, response, responseText, responseHeaders, effectiveHeaders }
}

export class BetterMCP {
  private config: BetterMCPConfig
  private spec: ParsedSpec | null = null
  private started = false
  private router = new VersionRouter()
  private translations = new TranslationRegistry()
  private authHandler: AuthHandler | null = null
  private specPath: string | null = null
  private watcher: FSWatcher | null = null
  private debounceTimer: ReturnType<typeof setTimeout> | null = null

  constructor(userConfig?: UserConfig) {
    this.config = resolveConfig(userConfig)
  }

  async loadSpec(path: string): Promise<ParsedSpec> {
    if (this.started) {
      throw new Error('loadSpec() cannot be called after start() — edit the spec file to trigger hot reload')
    }
    this.specPath = path
    this.spec = await parseSpec(path)
    return this.spec
  }

  async start(options?: { transport?: Transport }): Promise<void> {
    if (!this.spec) {
      throw createError('SERVER_NO_SPEC')
    }

    if (this.started) {
      throw createError('SERVER_ALREADY_STARTED')
    }
    this.started = true

    // In proxy mode, fullHeaders is forcibly disabled — credential passthrough
    // requires redaction to guarantee zero credential persistence (FR38, NFR7)
    if (this.config.mode === 'proxy' && this.config.logging?.fullHeaders) {
      this.config = {
        ...this.config,
        logging: { ...this.config.logging, fullHeaders: false },
      }
      process.stderr.write(
        '[bettermcp] WARNING: logging.fullHeaders is ignored in proxy mode — credential redaction is mandatory.\n',
      )
    } else if (this.config.logging?.fullHeaders) {
      process.stderr.write(
        '[bettermcp] WARNING: logging.fullHeaders is enabled — credential headers will NOT be redacted. Do not use in production.\n',
      )
    }

    const server = new McpServer({
      name: 'bettermcp',
      version: '0.0.1',
    })

    // Mutable state object — closures reference state.* so hot reload can update
    // spec, baseUrl, and validatorCache without re-registering MCP tools.
    const state = {
      spec: this.spec,
      baseUrl: this.resolveBaseUrl(),
      validatorCache: new Map<string, CompiledValidator>(),
    }

    const config = this.config
    const store = createStore(config.db)
    const redactOptions: RedactOptions | undefined = config.logging?.fullHeaders
      ? { fullHeaders: true }
      : undefined

    // Run retention purge at startup
    const retentionDays = config.retention?.days ?? DEFAULT_RETENTION_DAYS
    try {
      const purged = store.purgeWireLogsOlderThan(retentionDays)
      if (purged > 0) {
        process.stderr.write(
          `[bettermcp] purged ${purged} wire log entries older than ${retentionDays} days\n`,
        )
      }
      const purgedSignals = store.purgeSignalsOlderThan(retentionDays)
      if (purgedSignals > 0) {
        process.stderr.write(
          `[bettermcp] purged ${purgedSignals} signals older than ${retentionDays} days\n`,
        )
      }
    } catch (err) {
      process.stderr.write(
        `[bettermcp] retention purge failed: ${err}\n`,
      )
    }

    // Pre-compile response schema validators at startup
    const buildValidatorCache = (endpoints: ParsedEndpoint[]) => {
      const cache = new Map<string, CompiledValidator>()
      for (const ep of endpoints) {
        const schema = ep.responses
          ? extractResponseSchema(ep.responses as Record<string, unknown>)
          : null
        if (schema && typeof schema === 'object') {
          const key = `${ep.method.toUpperCase()} ${ep.path}`
          cache.set(key, compileResponseSchema(schema as Record<string, unknown>))
        }
      }
      return cache
    }
    state.validatorCache = buildValidatorCache(state.spec.endpoints)

    server.registerTool('search', {
      description:
        'Search for API endpoints by keyword. Returns matching endpoints with their schemas, parameters, and descriptions. Set includeDiagnostics to true to also receive known issues, signals, and resolution hints for each endpoint. Set includeVersions to true to discover pinned API versions with lifecycle state and activity metrics.',
      inputSchema: {
        query: z.string().describe('Search query to match against endpoints'),
        includeDiagnostics: z.boolean().optional().default(false).describe('Include diagnostic signals and resolution hints for matching endpoints'),
        includeVersions: z.boolean().optional().default(false).describe('Include pinned API versions with lifecycle state and activity metrics'),
        limit: z.number().int().min(1).max(200).optional().describe('Maximum number of results to return (default 50)'),
      },
    }, async ({ query, includeDiagnostics, includeVersions, limit }) => {
      const results = handleQuery(query, state.spec.endpoints, {
        includeDiagnostics,
        store: includeDiagnostics ? store : undefined,
        limit,
      })

      // Always return a consistent object shape — avoids polymorphic responses
      const response: Record<string, unknown> = { endpoints: results }

      if (includeVersions) {
        response.versions = handleVersionDiscovery(store)
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }],
      }
    })

    // Capture router, translations, and auth handler for closures
    const router = this.router
    const translations = this.translations
    const authHandler = this.authHandler

    server.registerTool('execute', {
      description:
        'Execute an API call to an upstream endpoint. Forwards the request and returns the response. Optionally target a specific pinned version — translation handlers are applied if registered.',
      inputSchema: {
        endpoint: z.string().describe('The API endpoint path (e.g., /products)'),
        method: z
          .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
          .describe('HTTP method'),
        headers: z
          .record(z.string(), z.string())
          .optional()
          .describe('Optional HTTP headers'),
        body: z.string().optional().describe('Optional JSON request body'),
        queryParams: z
          .record(z.string(), z.string())
          .optional()
          .describe('Optional query parameters'),
        version: z
          .string()
          .optional()
          .describe('Optional version SHA to target. Translation handlers are applied if registered; sunset versions without handlers return structured errors.'),
      },
    }, async ({ endpoint, method, headers, body, queryParams, version }) => {
      const startTime = Date.now()

      // Wire log helper — deduplicates the common fields across all return paths.
      // effectiveRequestHeaders allows callers to pass post-auth headers so wire
      // logs reflect what was actually sent upstream (and auth-added headers pass
      // through the redaction pipeline).
      const wireLog = (resp: {
        status: number
        headers: Record<string, string>
        body: unknown
        mode: 'live' | 'simulated'
      }, effectiveRequestHeaders?: Record<string, string>) => {
        if (!config.wireLogging) return
        logWireEntry({
          endpoint_path: endpoint,
          method,
          request_headers: effectiveRequestHeaders ?? headers ?? {},
          request_body: body ?? null,
          response_status: resp.status,
          response_headers: resp.headers,
          response_body: resp.body,
          mode: resp.mode,
          startTime,
        }, store, redactOptions)
      }

      // Version-targeted request handling
      if (version) {
        const handler = translations.lookup(version, method, endpoint)

        if (handler) {
          // Translation flow: transform request → fetch current API → transform response
          process.stderr.write(
            `[bettermcp] translate: ${method} ${endpoint} (version ${version})\n`,
          )

          let translatedBody = body
          if (handler.request) {
            try {
              const parsed = body ? JSON.parse(body) : undefined
              const transformed = await handler.request(parsed)
              if (transformed !== undefined) {
                translatedBody = JSON.stringify(transformed)
              }
              // else: handler returned undefined — keep original body
            } catch (err) {
              const errBody = {
                translated: true,
                version,
                endpoint,
                method,
                error: `Request translation failed: ${err instanceof Error ? err.message : String(err)}`,
              }
              wireLog({ status: 400, headers: {}, body: errBody, mode: 'live' })
              return {
                content: [{ type: 'text' as const, text: JSON.stringify(errBody) }],
                isError: true,
              }
            }
          }

          // Execute against current API using shared fetch logic
          const tFetchResult = await executeUpstreamFetch({
            baseUrl: state.baseUrl,
            endpoint,
            method,
            headers,
            body: translatedBody,
            queryParams,
            authHandler,
            wireLog,
          })

          // Auth error — return structured error directly
          if ('authError' in tFetchResult) {
            return tFetchResult.authError
          }

          // Truncated — response too large
          if ('truncated' in tFetchResult) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    status: tFetchResult.status,
                    error: `Response too large (exceeded ${MAX_RESPONSE_BYTES} bytes)`,
                    translated: true,
                    version,
                  }),
                },
              ],
            }
          }

          const { response: tResponse, responseText: tResponseText, responseHeaders: tResponseHeaders, effectiveHeaders: tAuthHeaders } = tFetchResult

          // Transform response if handler has a response function
          let finalResponseBody: string = tResponseText
          if (handler.response) {
            try {
              const parsed = JSON.parse(tResponseText)
              const transformed = await handler.response(parsed)
              if (transformed !== undefined) {
                finalResponseBody = JSON.stringify(transformed)
              }
              // else: handler returned undefined — keep original response
            } catch (err) {
              process.stderr.write(
                `[bettermcp] response translation failed: ${err instanceof Error ? err.message : String(err)}\n`,
              )
              // Fall back to raw response
            }
          }

          // Schema mismatch detection is intentionally omitted for translated responses.
          // Translated responses use the OLD version's schema, not the current spec's schema,
          // so validating against the current spec would produce false positives.

          wireLog({
            status: tResponse.status,
            headers: tResponseHeaders,
            body: finalResponseBody,
            mode: 'live',
          }, tAuthHeaders)

          const translatedResponseBody: Record<string, unknown> = {
            status: tResponse.status,
            statusText: tResponse.statusText,
            headers: tResponseHeaders,
            body: finalResponseBody,
            translated: true,
            version,
          }

          // In proxy mode, surface rate limit headers for translated responses too (FR39)
          if (config.mode === 'proxy') {
            const rateLimits = extractRateLimits(tResponseHeaders)
            if (rateLimits) {
              translatedResponseBody.rateLimits = rateLimits
            }
          }

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(translatedResponseBody, null, 2),
              },
            ],
            ...(tResponse.status >= 400 && { isError: true }),
          }
        }

        // No translation handler for this method+path — check version state
        const versionState = router.getState(version)
        if (versionState === undefined && !translations.hasAnyHandler(version)) {
          const available = router.listVersions().map((v) => v.sha).join(', ')
          throw createError('VERSION_NOT_FOUND', version, available)
        }
        if (versionState === 'sunset') {
          const depInfo = router.getDeprecationInfo(version)
          throw createError('VERSION_SUNSET', version, depInfo?.migrateToSha ?? 'unknown')
        }
        // Active/deprecated without handler — fall through to normal execute
      }

      // Safe-mode intercept: return schema-valid simulated response
      // Proxy mode skips simulation — all requests are forwarded to upstream
      if (config.mode !== 'proxy' && shouldSimulate(method, endpoint, config.safeMode, store)) {
        process.stderr.write(
          `[bettermcp] safe-mode: simulated ${method} ${endpoint}\n`,
        )

        // Look up endpoint's response schema from parsed spec
        const normalizedEndpoint =
          endpoint.replace(/\/+$/, '') || '/'
        const matchedEndpoint = findEndpoint(state.spec.endpoints, method, normalizedEndpoint)

        const responseSchema = matchedEndpoint?.responses
          ? extractResponseSchema(
              matchedEndpoint.responses as Record<string, unknown>,
            )
          : null

        if (responseSchema) {
          try {
            const result = await simulateResponse(
              responseSchema,
              endpoint,
            )

            const simBody = {
              simulated: true,
              endpoint,
              method,
              confidence: result.confidence,
              warnings: result.warnings,
              body: result.body,
            }

            // Wire log the simulated response
            wireLog({ status: 200, headers: {}, body: simBody, mode: 'simulated' })

            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(simBody, null, 2),
                },
              ],
            }
          } catch (err) {
            const errBody = {
              simulated: true,
              endpoint,
              method,
              error: err instanceof Error ? err.message : String(err),
            }

            wireLog({ status: 500, headers: {}, body: errBody, mode: 'simulated' })

            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify(errBody),
                },
              ],
              isError: true,
            }
          }
        }

        // No response schema found — return metadata-only simulation
        const noSchemaBody = {
          simulated: true,
          endpoint,
          method,
          message:
            'Simulated (no response schema found for schema-valid generation)',
        }

        wireLog({ status: 200, headers: {}, body: noSchemaBody, mode: 'simulated' })

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(noSchemaBody),
            },
          ],
        }
      }

      // Execute upstream request using shared fetch logic
      const fetchResult = await executeUpstreamFetch({
        baseUrl: state.baseUrl,
        endpoint,
        method,
        headers,
        body,
        queryParams,
        authHandler,
        wireLog,
      })

      // Auth error — return structured error directly
      if ('authError' in fetchResult) {
        return fetchResult.authError
      }

      // Truncated — response too large
      if ('truncated' in fetchResult) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                status: fetchResult.status,
                error: `Response too large (exceeded ${MAX_RESPONSE_BYTES} bytes)`,
              }),
            },
          ],
        }
      }

      const { response, responseText, responseHeaders, effectiveHeaders: authHeaders } = fetchResult

      // Wire log the live response
      wireLog({ status: response.status, headers: responseHeaders, body: responseText, mode: 'live' }, authHeaders)

      // Schema mismatch detection (non-blocking): validate live 2xx response against spec schema
      // Skipped in proxy mode — specs for third-party APIs are often stale/minimal,
      // producing false-positive mismatch signals
      if (
        config.mode !== 'proxy' &&
        response.status >= 200 &&
        response.status < 300 &&
        responseText.length <= MAX_VALIDATION_RESPONSE_BYTES
      ) {
        const normalizedLivePath = endpoint.replace(/\/+$/, '') || '/'
        const liveMatchedEndpoint = findEndpoint(state.spec.endpoints, method, normalizedLivePath)

        if (liveMatchedEndpoint) {
          const cacheKey = `${liveMatchedEndpoint.method.toUpperCase()} ${liveMatchedEndpoint.path}`
          const validator = state.validatorCache.get(cacheKey)

          if (validator) {
            let parsed: unknown
            try {
              parsed = JSON.parse(responseText)
            } catch {
              parsed = undefined
            }

            if (parsed !== undefined) {
              const validation = validateWithCompiled(parsed, validator)
              if (!validation.valid) {
                const errorSummary = validation.errors.slice(0, MAX_VALIDATION_ERRORS).join('; ')
                  + (validation.errors.length > MAX_VALIDATION_ERRORS
                    ? ` ... and ${validation.errors.length - MAX_VALIDATION_ERRORS} more`
                    : '')

                const now = new Date().toISOString()
                const signal: SignalEntry = {
                  id: randomUUID(),
                  endpoint_path: `${method.toUpperCase()} ${normalizedLivePath}`,
                  category: SCHEMA_MISMATCH.category,
                  severity: 'medium',
                  confidence: 1,
                  observation_count: 1,
                  first_seen: now,
                  last_seen: now,
                  provenance: 'wire-log',
                  message: `Schema mismatch: ${errorSummary}`,
                  suggestion: categorizeMismatchSuggestion(errorSummary),
                  expired: false,
                }

                try {
                  store.insertSignal(signal)
                } catch (dbErr) {
                  process.stderr.write(
                    `[bettermcp] failed to persist schema-mismatch signal: ${dbErr}\n`,
                  )
                }

                process.stderr.write(
                  `[bettermcp] schema-mismatch: ${method} ${endpoint} — ${errorSummary}\n`,
                )
              }
            }
          }
        }
      }

      const responseBody: Record<string, unknown> = {
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        body: responseText,
      }

      // In proxy mode, surface rate limit headers as top-level metadata (FR39)
      if (config.mode === 'proxy') {
        const rateLimits = extractRateLimits(responseHeaders)
        if (rateLimits) {
          responseBody.rateLimits = rateLimits
        }
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(responseBody, null, 2),
          },
        ],
      }
    })

    server.registerTool('report', {
      description:
        'Report an observation about an API endpoint. Used for agent feedback on endpoint behavior. Provide the optional method parameter (e.g., GET) so the signal is stored as "METHOD /path" for accurate diagnostic correlation with search results.',
      inputSchema: {
        endpoint: z.string().min(1).max(500).describe('The API endpoint path'),
        method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']).optional().describe('HTTP method of the endpoint (e.g., GET). When provided, the endpoint path is stored as "METHOD /path" for better diagnostic correlation'),
        category: z.string().min(1).max(100).describe('Category of the observation (e.g., unexpected-response, timeout, schema-mismatch)'),
        message: z.string().min(1).max(4096).describe('Description of the observed behavior'),
      },
    }, async ({ endpoint: ep, method: reportMethod, category: rawCategory, message: msg }) => {
      const category = rawCategory.trim().toLowerCase()
      const now = new Date().toISOString()
      const redacted = redactBody(msg)
      const redactedMessage = typeof redacted === 'string' ? redacted : String(redacted)

      const endpointPath = reportMethod ? `${reportMethod} ${ep}` : ep

      const signal: SignalEntry = {
        id: randomUUID(),
        endpoint_path: endpointPath,
        category,
        severity: 'low',
        confidence: 1,
        observation_count: 1,
        first_seen: now,
        last_seen: now,
        provenance: 'agent-reported',
        message: redactedMessage,
        suggestion: null,
        expired: false,
      }

      try {
        store.insertSignal(signal)
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                status: 'received',
                stored: true,
                endpoint: ep,
                category,
              }),
            },
          ],
        }
      } catch (err) {
        process.stderr.write(
          `[bettermcp] report write failed: ${err}\n`,
        )
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({
                status: 'received',
                stored: false,
                endpoint: ep,
                category,
                error: 'Failed to persist feedback',
              }),
            },
          ],
        }
      }
    })

    server.registerTool('health', {
      description:
        'Health check for deployment monitoring. Returns server status, spec load state, and feedback store health.',
      inputSchema: {},
    }, async () => {
      const storeStatus = 'type' in store && store.type === 'null' ? 'degraded' : 'healthy'
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({
              status: 'ok',
              // Always true: start() requires a loaded spec before reaching this point
              specLoaded: true,
              store: storeStatus,
            }),
          },
        ],
      }
    })

    // Hot reload: watch spec file for changes and re-parse on modification.
    // Tool closures reference state.* so updated spec/baseUrl/validatorCache
    // take effect on next tool invocation without re-registering tools.
    if (config.hotReload && this.specPath) {
      const specPath = this.specPath

      const reloadSpec = async () => {
        try {
          const newSpec = await parseSpec(specPath)
          if (config.mode !== 'proxy' && !newSpec.baseUrl) {
            process.stderr.write(
              `[bettermcp] hot reload warning: reloaded spec has no baseUrl — retaining previous (${state.baseUrl})\n`,
            )
          }
          state.spec = newSpec
          state.baseUrl = config.mode === 'proxy'
            ? config.upstream!
            : (newSpec.baseUrl ?? state.baseUrl)
          state.validatorCache = buildValidatorCache(newSpec.endpoints)
          this.spec = newSpec
          process.stderr.write(
            `[bettermcp] spec reloaded: ${newSpec.endpoints.length} endpoints\n`,
          )
        } catch (err) {
          process.stderr.write(
            `[bettermcp] hot reload failed: ${err instanceof Error ? err.message : String(err)}\n`,
          )
        }
      }

      const startWatcher = () => {
        try {
          this.watcher = watch(specPath, (eventType) => {
            if (eventType === 'rename') {
              // Inode replaced (atomic save) — re-create watcher after brief delay
              this.watcher?.close()
              this.watcher = null
              setTimeout(() => startWatcher(), 100)
            }
            if (this.debounceTimer) clearTimeout(this.debounceTimer)
            this.debounceTimer = setTimeout(() => reloadSpec(), 300)
          })
        } catch {
          // File may not exist in test environments — hot reload is best-effort
          process.stderr.write(
            `[bettermcp] hot reload: could not watch ${specPath} — file watcher not started\n`,
          )
        }
      }
      startWatcher()
    }

    const transport = options?.transport ?? new StdioServerTransport()
    await server.connect(transport)
  }

  /**
   * Register a custom auth handler. The handler receives the endpoint, method,
   * and headers before each upstream request and can add/modify headers
   * (e.g., Authorization, X-API-Key, HMAC signatures).
   *
   * If the handler throws, a structured error (BMCP016) is returned to the
   * agent and the upstream API is never called with incomplete auth.
   */
  auth(handler: AuthHandler): void {
    if (this.started) {
      throw new Error('auth() must be called before start() — the server is already running')
    }
    if (this.authHandler !== null) {
      process.stderr.write('[bettermcp] warning: auth handler replaced — only one handler is active at a time\n')
    }
    this.authHandler = handler
  }

  /**
   * Register a translation handler for a versioned endpoint.
   * Handlers transform legacy request/response shapes to the current API version.
   */
  onTranslate(config: TranslationHandlerConfig): void {
    this.translations.registerHandler(config)
  }

  /**
   * Pin a version — register a SHA with its endpoint set and base URL.
   */
  pinVersion(sha: string, endpoints: ParsedEndpoint[], versionBaseUrl: string): void {
    this.router.pin(sha, endpoints, versionBaseUrl)
  }

  /**
   * Deprecate a version with migration guidance.
   */
  deprecateVersion(sha: string, migrateToSha: string, message?: string): void {
    this.router.deprecate(sha, migrateToSha, undefined, message)
  }

  /**
   * Sunset a version — marks it as end-of-life.
   */
  sunsetVersion(sha: string): void {
    this.router.sunset(sha)
  }

  /** Stop the file watcher if hot reload is active. */
  stopWatching(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  /**
   * Auto-discover endpoints from a base URL and generate a minimal OpenAPI spec.
   * The generated spec is written to disk and loaded automatically.
   */
  async discover(config: DiscoveryConfig): Promise<ParsedSpec> {
    if (this.started) {
      throw new Error('discover() cannot be called after start()')
    }

    process.stderr.write(`[bettermcp] auto-discovery: probing ${config.baseUrl}...\n`)

    const result = await runDiscovery(config)

    // Spec URL found — load the existing spec directly instead of the generated one
    if (result.specUrl && !result.outputPath) {
      process.stderr.write(
        `[bettermcp] auto-discovery: found existing spec at ${result.specUrl} — loading directly\n`,
      )
      return this.loadSpec(result.specUrl)
    }

    process.stderr.write(
      `[bettermcp] auto-discovery: found ${result.endpointCount} endpoints, spec written to ${result.outputPath}\n`,
    )

    if (result.specUrl) {
      process.stderr.write(
        `[bettermcp] auto-discovery: also found existing spec at ${result.specUrl} — consider using loadSpec() with that URL instead\n`,
      )
    }

    return this.loadSpec(result.outputPath!)
  }

  getConfig(): BetterMCPConfig {
    return this.config
  }

  getSpec(): ParsedSpec | null {
    return this.spec
  }

  private resolveBaseUrl(): string {
    // In proxy mode, use the configured upstream URL instead of the spec's base URL.
    // Schema validation guarantees upstream is set when mode is 'proxy'.
    if (this.config.mode === 'proxy') {
      return this.config.upstream!
    }

    if (!this.spec) {
      throw createError('SERVER_NO_SPEC')
    }
    if (!this.spec.baseUrl) {
      throw createError('SERVER_NO_BASE_URL')
    }
    return this.spec.baseUrl
  }
}

/**
 * Finds a matching endpoint using path template matching.
 * Supports parameterized paths like /users/{id}.
 */
function findEndpoint(
  endpoints: ParsedEndpoint[],
  method: string,
  requestPath: string,
): ParsedEndpoint | undefined {
  return endpoints.find(
    (ep) =>
      ep.method.toUpperCase() === method.toUpperCase() &&
      matchesTemplatePath(ep.path, requestPath),
  )
}

/**
 * Returns a specific suggestion based on the type of schema mismatch.
 * Ajv error messages follow predictable patterns that let us differentiate
 * between missing fields, type mismatches, and extra properties.
 */
function categorizeMismatchSuggestion(errorSummary: string): string {
  const lower = errorSummary.toLowerCase()

  if (lower.includes('must have required property')) {
    return 'The API response is missing required fields. Add the missing properties to the response, or mark them as optional in the OpenAPI spec.'
  }

  if (lower.includes('must not have additional properties')) {
    return 'The API response contains fields not declared in the spec. Add the extra properties to the OpenAPI spec schema, or set additionalProperties: true.'
  }

  if (/must be (string|number|integer|boolean|array|object|null)/.test(lower)) {
    return 'A field in the API response has a different type than the spec declares. Update the type in the OpenAPI spec, or fix the upstream API to return the correct type.'
  }

  if (lower.includes('must match pattern')) {
    return 'A string field does not match the pattern constraint in the spec. Update the pattern in the OpenAPI spec, or fix the upstream API response.'
  }

  if (lower.includes('must be >=') || lower.includes('must be <=') || lower.includes('must be >') || lower.includes('must be <')) {
    return 'A numeric field violates a min/max constraint in the spec. Update the numeric bounds in the OpenAPI spec, or fix the upstream API response.'
  }

  // Fallback for error patterns that don't fit the categories above
  return 'Update the OpenAPI spec to match the actual API response, or fix the upstream API.'
}
