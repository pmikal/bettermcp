import { generate } from 'json-schema-faker'
import { createError } from '../errors/index.js'
import { assessSimulationConfidence } from './sim-confidence.js'
import type { SimConfidence } from './sim-confidence.js'
import { firstVariantStrategy } from './variant-strategy.js'
import type { VariantStrategy } from './variant-strategy.js'

export interface SimulationResult {
  body: unknown
  confidence: SimConfidence
  warnings: string[]
}

export interface SimulateOptions {
  seed?: number
  variantStrategy?: VariantStrategy
}

/**
 * Extracts the response schema for simulation from the endpoint's responses object.
 * Looks for the first 2xx response with a JSON content schema.
 */
export function extractResponseSchema(
  responses: Record<string, unknown>,
): unknown | null {
  const statusCodes = ['200', '201', '202', '203', '204']
  for (const code of statusCodes) {
    const response = responses[code] as Record<string, unknown> | undefined
    if (!response) continue

    const content = response['content'] as Record<string, unknown> | undefined
    if (!content) continue

    const json = content['application/json'] as
      | Record<string, unknown>
      | undefined
    if (!json) continue

    return json['schema'] ?? null
  }
  return null
}

/**
 * Generates a schema-valid simulated response body.
 * Only file that imports json-schema-faker.
 */
export async function simulateResponse(
  schema: unknown,
  endpointPath: string,
  options: SimulateOptions = {},
): Promise<SimulationResult> {
  if (schema === null || schema === undefined) {
    throw createError(
      'SIMULATE_GENERATION_FAILED',
      `No schema provided for ${endpointPath}`,
    )
  }

  const confidence = assessSimulationConfidence(schema)

  if (confidence === 'too-complex') {
    throw createError('SIMULATE_SCHEMA_TOO_COMPLEX', endpointPath)
  }

  const warnings: string[] = []
  if (confidence === 'reduced') {
    warnings.push(
      `Simulation confidence reduced for ${endpointPath}: polymorphic schema (oneOf/anyOf/allOf)`,
    )
  }

  // Apply variant strategy to simplify polymorphic schemas before generation
  const strategy = options.variantStrategy ?? firstVariantStrategy
  const processedSchema = simplifyPolymorphic(
    schema as Record<string, unknown>,
    strategy,
  )

  let body: unknown
  try {
    body = await generate(processedSchema as Parameters<typeof generate>[0], {
      seed: options.seed ?? 1,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw createError('SIMULATE_GENERATION_FAILED', message, { cause: err })
  }

  return { body, confidence, warnings }
}

/**
 * Simplifies polymorphic schemas by selecting a single variant
 * using the provided strategy, so json-schema-faker gets a cleaner input.
 */
function simplifyPolymorphic(
  schema: Record<string, unknown>,
  strategy: VariantStrategy,
  visited: WeakSet<object> = new WeakSet(),
): Record<string, unknown> {
  if (!schema || typeof schema !== 'object') return schema
  if (visited.has(schema)) return schema
  visited.add(schema)

  const result = { ...schema }

  if (Array.isArray(result['oneOf']) && result['oneOf'].length > 0) {
    const selected = strategy.selectVariant(result['oneOf'])
    delete result['oneOf']
    if (selected && typeof selected === 'object') {
      Object.assign(result, selected)
    }
  }

  if (Array.isArray(result['anyOf']) && result['anyOf'].length > 0) {
    const selected = strategy.selectVariant(result['anyOf'])
    delete result['anyOf']
    if (selected && typeof selected === 'object') {
      Object.assign(result, selected)
    }
  }

  // Merge allOf variants — combine all schemas into the result
  if (Array.isArray(result['allOf']) && result['allOf'].length > 0) {
    const allOfVariants = result['allOf'] as unknown[]
    delete result['allOf']
    for (const variant of allOfVariants) {
      if (variant && typeof variant === 'object') {
        Object.assign(
          result,
          simplifyPolymorphic(
            variant as Record<string, unknown>,
            strategy,
            visited,
          ),
        )
      }
    }
  }

  // Recurse into properties
  if (result['properties'] && typeof result['properties'] === 'object') {
    const props = { ...(result['properties'] as Record<string, unknown>) }
    for (const [key, val] of Object.entries(props)) {
      if (val && typeof val === 'object') {
        props[key] = simplifyPolymorphic(
          val as Record<string, unknown>,
          strategy,
          visited,
        )
      }
    }
    result['properties'] = props
  }

  // Recurse into items
  if (result['items'] && typeof result['items'] === 'object') {
    result['items'] = simplifyPolymorphic(
      result['items'] as Record<string, unknown>,
      strategy,
      visited,
    )
  }

  return result
}
