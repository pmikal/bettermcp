import { z } from 'zod'
import { createError } from '../errors/index.js'
import { DEFAULT_CONFIG } from './defaults.js'
import { BetterMCPConfigSchema } from './schema.js'
import type { BetterMCPConfig, UserConfig } from './schema.js'

export type { BetterMCPConfig, UserConfig }
export { DEFAULT_CONFIG, DEFAULT_RETENTION_DAYS } from './defaults.js'

export function resolveConfig(userConfig?: UserConfig): BetterMCPConfig {
  const merged = { ...DEFAULT_CONFIG, ...userConfig }

  const result = BetterMCPConfigSchema.safeParse(merged)
  if (!result.success) {
    const issue = result.error.issues[0]
    if (!issue) {
      throw createError('CONFIG_INVALID', 'unknown validation error')
    }

    if (issue.code === z.ZodIssueCode.unrecognized_keys) {
      const keys = (issue as { keys: string[] }).keys
      throw createError('CONFIG_UNKNOWN_KEY', keys[0] ?? 'unknown')
    }

    const path = issue.path.join('.')
    throw createError('CONFIG_INVALID', `${path}: ${issue.message}`)
  }

  return result.data
}
