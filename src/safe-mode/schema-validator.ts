import Ajv, { type ValidateFunction } from 'ajv'

const ajv = new Ajv({ allErrors: true, strict: false })

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

/** Opaque handle to a pre-compiled Ajv validator. */
export type CompiledValidator = ValidateFunction

/**
 * Pre-compiles a JSON schema into a reusable validator.
 * Call once per schema at startup, then use validateWithCompiled() per request.
 * Only file that imports Ajv.
 */
export function compileResponseSchema(
  schema: Record<string, unknown>,
): CompiledValidator {
  return ajv.compile(schema)
}

/**
 * Validates a response body using a pre-compiled validator.
 * Preferred for hot paths — avoids per-request compilation overhead.
 */
export function validateWithCompiled(
  body: unknown,
  validator: CompiledValidator,
): ValidationResult {
  const valid = validator(body)

  if (valid) {
    return { valid: true, errors: [] }
  }

  const errors = (validator.errors ?? []).map((err) => {
    const path = err.instancePath || '/'
    return `${path} ${err.message ?? 'validation error'}`
  })

  return { valid: false, errors }
}

/**
 * Validates a response body against a JSON schema (compile-per-call).
 * Use for one-off validations. For hot paths, prefer compileResponseSchema + validateWithCompiled.
 */
export function validateResponseSchema(
  body: unknown,
  schema: Record<string, unknown>,
): ValidationResult {
  const validate = ajv.compile(schema)
  return validateWithCompiled(body, validate)
}
