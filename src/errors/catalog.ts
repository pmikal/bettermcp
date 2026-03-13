const DOCS_BASE_URL = 'https://bettermcp.dev'

export interface CatalogEntry {
  readonly code: string
  readonly problem: (...args: string[]) => string
  readonly fix: string
  readonly docsPath: string
}

export const ErrorCatalog = {
  SPEC_LOAD_FILE_NOT_FOUND: {
    code: 'BMCP001',
    problem: (path: string) => `OpenAPI spec file not found: ${path}`,
    fix: 'Verify the file path passed to loadSpec() exists and is readable',
    docsPath: '/errors/BMCP001',
  },
  SPEC_LOAD_PARSE_FAILURE: {
    code: 'BMCP002',
    problem: (detail: string) => `Failed to parse OpenAPI spec: ${detail}`,
    fix: 'Validate your OpenAPI spec with an online validator and fix any syntax errors',
    docsPath: '/errors/BMCP002',
  },
  SPEC_LOAD_UNSUPPORTED_VERSION: {
    code: 'BMCP003',
    problem: (version: string) =>
      `Unsupported OpenAPI version: ${version}. bettermcp supports OpenAPI 3.0 and 3.1`,
    fix: 'Convert your spec to OpenAPI 3.0 or 3.1 format',
    docsPath: '/errors/BMCP003',
  },
  SPEC_LOAD_UNSUPPORTED_SECURITY: {
    code: 'BMCP004',
    problem: (scheme: string) => `Unsupported security scheme: ${scheme}`,
    fix: 'Configure a custom auth handler via server.auth() or use standard Bearer auth',
    docsPath: '/errors/BMCP004',
  },
  // BMCP005-009 reserved for future spec-loading errors
  SERVER_NO_SPEC: {
    code: 'BMCP005',
    problem: () => 'No spec loaded. Call loadSpec() before start()',
    fix: 'Call server.loadSpec(path) with a valid OpenAPI spec before calling server.start()',
    docsPath: '/errors/BMCP005',
  },
  SERVER_ALREADY_STARTED: {
    code: 'BMCP006',
    problem: () => 'Server has already been started',
    fix: 'Only call server.start() once per BetterMCP instance',
    docsPath: '/errors/BMCP006',
  },
  SERVER_NO_BASE_URL: {
    code: 'BMCP007',
    problem: () =>
      'Spec has no servers[].url defined — cannot determine base URL for execute tool',
    fix: 'Add a servers entry to your OpenAPI spec, or use a spec that includes server URLs',
    docsPath: '/errors/BMCP007',
  },
  EXECUTE_ORIGIN_MISMATCH: {
    code: 'BMCP008',
    problem: (resolved: string, expected: string) =>
      `Resolved URL origin ${resolved} does not match spec base URL origin ${expected}`,
    fix: 'Use a relative path for the endpoint parameter (e.g., /products), not an absolute URL',
    docsPath: '/errors/BMCP008',
  },
  EXECUTE_UPSTREAM_ERROR: {
    code: 'BMCP009',
    problem: (detail: string) => `Upstream API request failed: ${detail}`,
    fix: 'Check that the upstream API is reachable and the endpoint path is correct',
    docsPath: '/errors/BMCP009',
  },
  VERSION_NOT_FOUND: {
    code: 'BMCP012',
    problem: (sha: string, available: string) =>
      `Version "${sha}" is not registered. Available versions: ${available || 'none'}`,
    fix: 'Pin the version before routing to it, or use one of the available version SHAs',
    docsPath: '/errors/BMCP012',
  },
  VERSION_INVALID_TRANSITION: {
    code: 'BMCP013',
    problem: (from: string, to: string) =>
      `Invalid version state transition: ${from} → ${to}. Valid transitions: active → deprecated, deprecated → sunset`,
    fix: 'Follow the version lifecycle: active → deprecated → sunset. Versions cannot skip states or transition backwards',
    docsPath: '/errors/BMCP013',
  },
  VERSION_SUNSET: {
    code: 'BMCP014',
    problem: (sha: string, migrateToSha: string) =>
      `Version "${sha}" has been sunset. Migrate to version "${migrateToSha}"`,
    fix: 'Use the suggested migration target version SHA, or call search() to discover available versions',
    docsPath: '/errors/BMCP014',
  },
  PROXY_NO_UPSTREAM: {
    code: 'BMCP015',
    problem: () => 'Proxy mode requires an upstream URL. Set the "upstream" config field',
    fix: 'Add upstream: "https://api.example.com" to your BetterMCP configuration when using mode: "proxy"',
    docsPath: '/errors/BMCP015',
  },
  AUTH_HANDLER_FAILED: {
    code: 'BMCP016',
    problem: (detail: string) => `Custom auth handler failed: ${detail}`,
    fix: 'Check your auth handler for errors. The handler must return an AuthRequest object with a headers record',
    docsPath: '/errors/BMCP016',
  },
  DISCOVERY_NO_ENDPOINTS: {
    code: 'BMCP017',
    problem: (baseUrl: string) =>
      `Auto-discovery found no endpoints at ${baseUrl}`,
    fix: 'Verify the base URL is correct and the API is running. Consider providing a manual OpenAPI spec instead',
    docsPath: '/errors/BMCP017',
  },
  DISCOVERY_PROBE_FAILED: {
    code: 'BMCP018',
    problem: (baseUrl: string, detail: string) =>
      `Auto-discovery could not reach ${baseUrl}: ${detail}`,
    fix: 'Check that the base URL is reachable and responds to HTTP requests',
    docsPath: '/errors/BMCP018',
  },
  // BMCP019 reserved for future discovery errors
  SIMULATE_SCHEMA_TOO_COMPLEX: {
    code: 'BMCP020',
    problem: (endpoint: string) =>
      `Schema too complex to simulate reliably for endpoint: ${endpoint}`,
    fix: 'Simplify the response schema or switch the endpoint to live mode',
    docsPath: '/errors/BMCP020',
  },
  SIMULATE_GENERATION_FAILED: {
    code: 'BMCP021',
    problem: (detail: string) => `Response simulation failed: ${detail}`,
    fix: 'Check the endpoint response schema for unsupported features or malformed definitions',
    docsPath: '/errors/BMCP021',
  },
  PROMOTE_INVALID_ENDPOINT: {
    code: 'BMCP022',
    problem: (key: string) =>
      `Invalid endpoint key for promotion: "${key}"`,
    fix: 'Use the format "METHOD /path" (e.g., "POST /orders"). Path must start with / and must not contain query strings or fragments.',
    docsPath: '/errors/BMCP022',
  },
  CONFIG_INVALID: {
    code: 'BMCP010',
    problem: (detail: string) => `Invalid configuration: ${detail}`,
    fix: 'Check the configuration object against the BetterMCPConfig type definition',
    docsPath: '/errors/BMCP010',
  },
  CONFIG_UNKNOWN_KEY: {
    code: 'BMCP011',
    problem: (key: string) => `Unknown configuration key: "${key}"`,
    fix: 'Remove the unrecognized key or check for typos in your configuration',
    docsPath: '/errors/BMCP011',
  },
} as const satisfies Record<string, CatalogEntry>

export type ErrorCode = keyof typeof ErrorCatalog

export function getDocsUrl(docsPath: string): string {
  return `${DOCS_BASE_URL}${docsPath}`
}
