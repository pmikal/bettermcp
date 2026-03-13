import { writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { URL } from 'node:url'
import { createError } from '../errors/index.js'
import { DiscoveryConfigSchema } from '../config/schema.js'
import type { DiscoveryConfig } from '../config/schema.js'

const PROBE_TIMEOUT_MS = 5_000
const PROBE_CONCURRENCY = 10
const DEFAULT_OUTPUT_PATH = './discovered-spec.yaml'

/** Common API path prefixes to probe. */
const ROOT_PREFIXES = ['', '/api', '/v1', '/v2', '/api/v1', '/api/v2']

/** Common resource names to probe under each prefix. */
const RESOURCE_NAMES = [
  '/users',
  '/products',
  '/orders',
  '/items',
  '/posts',
  '/comments',
  '/categories',
  '/tags',
  '/accounts',
  '/health',
  '/status',
]

/** Well-known spec/doc endpoints — if found, suggest the developer use those directly. */
const SPEC_ENDPOINTS = ['/openapi.json', '/openapi.yaml', '/swagger.json', '/api-docs']

/** Hostnames/patterns blocked to prevent SSRF against internal services. */
const BLOCKED_HOSTS = new Set([
  'localhost',
  '127.0.0.1',
  '::1',
  '0.0.0.0',
  '169.254.169.254',
  'metadata.google.internal',
])

function isBlockedHost(hostname: string): boolean {
  if (BLOCKED_HOSTS.has(hostname)) return true
  // RFC 1918 private ranges
  if (hostname.startsWith('10.')) return true
  if (hostname.startsWith('192.168.')) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(hostname)) return true
  // Link-local
  if (hostname.startsWith('169.254.')) return true
  // Common internal suffixes
  if (hostname.endsWith('.internal') || hostname.endsWith('.local')) return true
  return false
}

export interface DiscoveredEndpoint {
  path: string
  method: string
  statusCode: number
  contentType: string | null
}

/**
 * Probe a base URL for common API patterns.
 * Only uses GET requests to avoid side effects.
 */
export async function discoverEndpoints(
  baseUrl: string,
): Promise<{ endpoints: DiscoveredEndpoint[]; specUrl: string | null }> {
  const normalizedBase = baseUrl.replace(/\/+$/, '')

  // SSRF protection: block internal/private network addresses
  const parsed = new URL(normalizedBase)
  if (isBlockedHost(parsed.hostname)) {
    throw createError(
      'DISCOVERY_PROBE_FAILED',
      normalizedBase,
      `blocked internal/private address: ${parsed.hostname}`,
    )
  }

  // First, verify the base URL is reachable at all
  try {
    await fetch(normalizedBase, {
      method: 'HEAD',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
  } catch (err) {
    throw createError(
      'DISCOVERY_PROBE_FAILED',
      normalizedBase,
      err instanceof Error ? err.message : String(err),
      { cause: err },
    )
  }

  // Check for existing spec endpoints (parallel)
  let specUrl: string | null = null
  const specResults = await Promise.allSettled(
    SPEC_ENDPOINTS.map(async (specPath) => {
      const res = await fetch(`${normalizedBase}${specPath}`, {
        method: 'GET',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      })
      await res.body?.cancel()
      return { specPath, ok: res.ok }
    }),
  )
  for (const result of specResults) {
    if (result.status === 'fulfilled' && result.value.ok) {
      specUrl = `${normalizedBase}${result.value.specPath}`
      break
    }
  }

  // Short-circuit: if an existing spec URL was found, skip endpoint probing.
  // The caller will be told to use loadSpec() with the discovered URL instead.
  if (specUrl) {
    return { endpoints: [], specUrl }
  }

  // Build list of unique paths to probe
  const pathsToProbe: string[] = []
  const seen = new Set<string>()
  for (const prefix of ROOT_PREFIXES) {
    if (prefix && !seen.has(prefix)) {
      seen.add(prefix)
      pathsToProbe.push(prefix)
    }
    for (const resource of RESOURCE_NAMES) {
      const path = `${prefix}${resource}`
      if (!seen.has(path)) {
        seen.add(path)
        pathsToProbe.push(path)
      }
    }
  }

  // Probe in parallel with concurrency limit
  const endpoints: DiscoveredEndpoint[] = []
  for (let i = 0; i < pathsToProbe.length; i += PROBE_CONCURRENCY) {
    const batch = pathsToProbe.slice(i, i + PROBE_CONCURRENCY)
    const results = await Promise.allSettled(
      batch.map((path) => probePath(normalizedBase, path)),
    )
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value) {
        endpoints.push(result.value)
      }
    }
  }

  return { endpoints, specUrl }
}

async function probePath(
  baseUrl: string,
  path: string,
): Promise<DiscoveredEndpoint | null> {
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'GET',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })

    const contentType = res.headers.get('content-type')
    // Always consume the body to release the connection
    await res.body?.cancel()

    // Only record 2xx responses — 3xx redirects may land on login pages
    if (res.status >= 200 && res.status < 300) {
      return {
        path,
        method: 'GET',
        statusCode: res.status,
        contentType,
      }
    }

    return null
  } catch {
    // Timeout or network error — skip this path
    return null
  }
}

/** Escape a string for safe YAML interpolation. */
function yamlQuote(s: string): string {
  return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/**
 * Generate a minimal OpenAPI 3.0 spec YAML from discovered endpoints.
 */
export function generateDiscoveredSpec(
  baseUrl: string,
  endpoints: DiscoveredEndpoint[],
): string {
  const normalizedBase = baseUrl.replace(/\/+$/, '')

  const pathEntries = endpoints
    .map((ep) => {
      const method = ep.method.toLowerCase()
      const isJson = ep.contentType?.includes('application/json') ?? false
      const responseContent = isJson
        ? `\n          content:\n            application/json:\n              schema:\n                type: object`
        : ''
      const opId = `${method}_${ep.path.replace(/^\/+/, '').replace(/\//g, '_')}`

      return `  ${ep.path}:
    ${method}:
      summary: ${yamlQuote(`Auto-discovered ${method.toUpperCase()} ${ep.path}`)}
      operationId: ${yamlQuote(opId)}
      responses:
        '${ep.statusCode}':
          description: ${yamlQuote(`Discovered response (status ${ep.statusCode})`)}${responseContent}`
    })
    .join('\n')

  return `# Auto-generated by bettermcp auto-discovery
# Edit this file to add schemas, parameters, and descriptions for better confidence scores.
openapi: '3.0.3'
info:
  title: "Auto-discovered API"
  version: "0.0.1"
  x-bettermcp-auto-discovered: true
servers:
  - url: ${yamlQuote(normalizedBase)}
paths:
${pathEntries}
`
}

/**
 * Run auto-discovery: probe base URL, generate spec, write to file, return the output path.
 */
export async function runDiscovery(config: DiscoveryConfig): Promise<{
  outputPath: string | null
  endpointCount: number
  specUrl: string | null
}> {
  // Runtime validation — enforces URL format and protocol
  const parsed = DiscoveryConfigSchema.parse(config)
  const outputPath = parsed.outputPath ?? DEFAULT_OUTPUT_PATH

  const { endpoints, specUrl } = await discoverEndpoints(parsed.baseUrl)

  // Spec URL found — short-circuit without probing or writing
  if (specUrl && endpoints.length === 0) {
    return { outputPath: null, endpointCount: 0, specUrl }
  }

  if (endpoints.length === 0) {
    throw createError('DISCOVERY_NO_ENDPOINTS', parsed.baseUrl)
  }

  const specYaml = generateDiscoveredSpec(parsed.baseUrl, endpoints)

  // Ensure parent directories exist before writing
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, specYaml, 'utf-8')

  return { outputPath, endpointCount: endpoints.length, specUrl }
}
