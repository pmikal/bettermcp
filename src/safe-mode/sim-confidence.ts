export type SimConfidence = 'high' | 'reduced' | 'too-complex'

const MAX_POLYMORPHIC_DEPTH = 3
const MAX_TOTAL_DEPTH = 20

/**
 * Assesses the simulation confidence for a given JSON Schema.
 * Returns 'high' for simple schemas, 'reduced' for polymorphic schemas,
 * and 'too-complex' for deeply nested polymorphic schemas.
 */
export function assessSimulationConfidence(schema: unknown): SimConfidence {
  if (!schema || typeof schema !== 'object') return 'high'
  return checkDepth(schema as Record<string, unknown>, 0, 0, new WeakSet())
}

function checkDepth(
  schema: Record<string, unknown>,
  depth: number,
  totalDepth: number,
  visited: WeakSet<object>,
): SimConfidence {
  if (totalDepth >= MAX_TOTAL_DEPTH) return 'too-complex'
  if (visited.has(schema)) return 'too-complex'
  visited.add(schema)

  const isPolymorphic =
    'oneOf' in schema || 'anyOf' in schema || 'allOf' in schema

  if (isPolymorphic) {
    if (depth >= MAX_POLYMORPHIC_DEPTH) {
      return 'too-complex'
    }

    const variants = [
      ...asArray(schema['oneOf']),
      ...asArray(schema['anyOf']),
      ...asArray(schema['allOf']),
    ]

    for (const variant of variants) {
      if (variant && typeof variant === 'object') {
        const result = checkDepth(
          variant as Record<string, unknown>,
          depth + 1,
          totalDepth + 1,
          visited,
        )
        if (result === 'too-complex') return 'too-complex'
      }
    }
    return 'reduced'
  }

  // Check nested properties for polymorphic schemas
  const properties = schema['properties'] as
    | Record<string, unknown>
    | undefined
  if (properties) {
    for (const prop of Object.values(properties)) {
      if (prop && typeof prop === 'object') {
        const result = checkDepth(
          prop as Record<string, unknown>,
          depth,
          totalDepth + 1,
          visited,
        )
        if (result === 'too-complex') return 'too-complex'
        if (result === 'reduced') return 'reduced'
      }
    }
  }

  // Check items for array schemas
  const items = schema['items']
  if (items && typeof items === 'object') {
    const result = checkDepth(
      items as Record<string, unknown>,
      depth,
      totalDepth + 1,
      visited,
    )
    if (result !== 'high') return result
  }

  return 'high'
}

function asArray(val: unknown): unknown[] {
  return Array.isArray(val) ? val : []
}
