import { readFile } from 'node:fs/promises'
import { validate, dereference } from '@scalar/openapi-parser'
import { createError } from '../errors/index.js'
import { scoreEndpoint } from './confidence.js'
import type {
  ParsedSpec,
  ParsedEndpoint,
  ParsedParameter,
  ParseWarning,
} from './spec-types.js'

async function loadContent(source: string): Promise<string> {
  if (source.startsWith('http://') || source.startsWith('https://')) {
    const res = await fetch(source)
    if (!res.ok) {
      throw createError(
        'SPEC_LOAD_PARSE_FAILURE',
        `Failed to fetch spec from ${source}: ${res.status} ${res.statusText}`,
      )
    }
    return res.text()
  }

  try {
    return await readFile(source, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw createError('SPEC_LOAD_FILE_NOT_FOUND', source, { cause: err })
    }
    throw createError(
      'SPEC_LOAD_PARSE_FAILURE',
      `Failed to read spec file: ${String(err)}`,
      { cause: err },
    )
  }
}

function extractVendorExtensions(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((k) => k.startsWith('x-'))
}

function extractParameters(
  params: unknown[] | undefined,
): ParsedParameter[] {
  if (!Array.isArray(params)) return []
  return params.map((p) => {
    const param = p as Record<string, unknown>
    return {
      name: (param['name'] as string) ?? '',
      in: (param['in'] as ParsedParameter['in']) ?? 'query',
      required: (param['required'] as boolean) ?? false,
      schema: param['schema'] ?? null,
      description: (param['description'] as string) ?? null,
    }
  })
}

export async function parseSpecFromSource(source: string): Promise<ParsedSpec> {
  const content = await loadContent(source)

  // Validate (also detects version)
  const validation = await validate(content)

  // Check version from validation result
  const version = validation.version as string | undefined
  if (!version) {
    throw createError('SPEC_LOAD_PARSE_FAILURE', 'Unable to detect OpenAPI version')
  }
  if (version !== '3.0' && version !== '3.1') {
    // Extract full version string from spec for better error message
    const rawSpec = validation.specification as Record<string, unknown> | undefined
    const fullVersion = (rawSpec?.['openapi'] as string) ?? (rawSpec?.['swagger'] as string) ?? version
    throw createError('SPEC_LOAD_UNSUPPORTED_VERSION', fullVersion)
  }

  if (!validation.valid) {
    const errorMessages = (validation.errors ?? [])
      .slice(0, 5)
      .map((e) => e.message)
      .join('; ')
    throw createError('SPEC_LOAD_PARSE_FAILURE', errorMessages || 'Spec validation failed')
  }

  // Dereference $refs — pass already-parsed object to avoid re-parsing YAML
  const deref = await dereference(validation.specification!)
  const spec = (deref.schema ?? validation.specification) as Record<string, unknown> | undefined
  if (!spec) {
    throw createError('SPEC_LOAD_PARSE_FAILURE', 'Failed to resolve spec after validation')
  }

  // Extract full spec version string
  const specVersionStr = (spec['openapi'] as string) ?? version

  const info = spec['info'] as Record<string, unknown> | undefined
  const title = (info?.['title'] as string) ?? 'Untitled API'
  const paths = spec['paths'] as Record<string, Record<string, unknown>> | undefined

  const globalWarnings: ParseWarning[] = []
  const endpoints: ParsedEndpoint[] = []

  // Collect deref errors as warnings
  if (deref.errors && deref.errors.length > 0) {
    for (const err of deref.errors) {
      globalWarnings.push({
        feature: '$ref-resolution',
        message: err.message,
      })
    }
  }

  // Extract global vendor extensions
  const globalVendorExts = extractVendorExtensions(spec)
  for (const ext of globalVendorExts) {
    globalWarnings.push({
      feature: 'vendor-extension',
      message: `Global vendor extension: ${ext}`,
    })
  }

  if (paths) {
    const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'head', 'options', 'trace']

    for (const [path, pathItem] of Object.entries(paths)) {
      if (!pathItem || typeof pathItem !== 'object') continue

      // Path-level vendor extensions
      const pathVendorExts = extractVendorExtensions(pathItem)
      if (pathVendorExts.length > 0) {
        for (const ext of pathVendorExts) {
          globalWarnings.push({
            endpoint: path,
            feature: 'vendor-extension',
            message: `Path vendor extension on ${path}: ${ext}`,
          })
        }
      }

      // Path-level parameters
      const pathParams = pathItem['parameters'] as unknown[] | undefined

      for (const method of HTTP_METHODS) {
        const operation = pathItem[method] as Record<string, unknown> | undefined
        if (!operation) continue

        const opVendorExts = extractVendorExtensions(operation)
        const allVendorExts = [...pathVendorExts, ...opVendorExts]

        // Merge path-level and operation-level parameters
        const opParams = operation['parameters'] as unknown[] | undefined
        const mergedParams = [...(pathParams ?? []), ...(opParams ?? [])]

        const parameters = extractParameters(mergedParams)
        const requestBody = operation['requestBody'] ?? null
        const responses = (operation['responses'] as Record<string, unknown>) ?? {}

        const { confidence, warnings: epWarnings } = scoreEndpoint({
          path,
          method,
          operationId: (operation['operationId'] as string) ?? null,
          description: (operation['description'] as string) ?? null,
          summary: (operation['summary'] as string) ?? null,
          parameters: parameters.map((p) => ({ schema: p.schema, description: p.description })),
          requestBody,
          responses,
          vendorExtensions: allVendorExts,
        })

        endpoints.push({
          path,
          method: method.toUpperCase(),
          operationId: (operation['operationId'] as string) ?? null,
          summary: (operation['summary'] as string) ?? null,
          description: (operation['description'] as string) ?? null,
          parameters,
          requestBody,
          responses,
          confidence,
          warnings: epWarnings,
        })
      }
    }
  }

  // Extract base URL from servers array, resolving template variables
  const servers = spec['servers'] as
    | Array<{ url?: string; variables?: Record<string, { default?: string }> }>
    | undefined
  let baseUrl = servers?.[0]?.url ?? null
  if (baseUrl && servers?.[0]?.variables) {
    for (const [key, variable] of Object.entries(servers[0].variables)) {
      if (variable.default) {
        baseUrl = baseUrl.replace(`{${key}}`, variable.default)
      }
    }
  }

  return {
    version: version as '3.0' | '3.1',
    specVersion: specVersionStr,
    title,
    baseUrl,
    endpoints,
    warnings: globalWarnings,
  }
}
