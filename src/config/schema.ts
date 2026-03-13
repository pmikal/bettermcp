import { z } from 'zod'

const EndpointModeSchema = z.enum(['simulate', 'live'])

const EndpointKeySchema = z.string().regex(
  /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\/\S*$/,
  'Endpoint key must be "METHOD /path" (e.g., "POST /orders")',
)

export const SafeModeConfigSchema = z.object({
  mutativeEndpoints: z.enum(['simulate']).optional(),
  endpoints: z.record(EndpointKeySchema, EndpointModeSchema).optional(),
})

export type SafeModeConfig = z.infer<typeof SafeModeConfigSchema>

export const LoggingConfigSchema = z.object({
  /**
   * When true, skip header redaction so all header values (including credentials)
   * are stored in wire logs. **This only affects header redaction** — body credential
   * patterns are always redacted regardless of this setting.
   *
   * Name is kept as `fullHeaders` for backwards compatibility; it does NOT
   * control body redaction behaviour.
   *
   * WARNING: Do not enable in production — credential headers will be persisted
   * in plain text.
   */
  fullHeaders: z.boolean().optional(),
})

export type LoggingConfig = z.infer<typeof LoggingConfigSchema>

export const RetentionConfigSchema = z.object({
  days: z.number().int().min(1).max(36500).optional(),
})

export type RetentionConfig = z.infer<typeof RetentionConfigSchema>

export const DiscoveryConfigSchema = z.object({
  baseUrl: z.string().url().refine(
    (u) => u.startsWith('https://') || u.startsWith('http://'),
    { message: 'baseUrl must use http or https protocol' },
  ),
  outputPath: z.string().min(1).optional(),
})

export type DiscoveryConfig = z.infer<typeof DiscoveryConfigSchema>

const BetterMCPConfigBaseSchema = z
  .object({
    db: z.string().min(1, 'db path must not be empty'),
    wireLogging: z.boolean(),
    mode: z.enum(['owner', 'proxy']),
    upstream: z.string().url().refine(
      (u) => u.startsWith('https://') || u.startsWith('http://'),
      { message: 'upstream must use http or https protocol' },
    ).optional(),
    hotReload: z.boolean(),
    safeMode: SafeModeConfigSchema.optional(),
    logging: LoggingConfigSchema.optional(),
    retention: RetentionConfigSchema.optional(),
  })
  .strict()

export const BetterMCPConfigSchema = BetterMCPConfigBaseSchema.refine(
  (data) => data.mode !== 'proxy' || !!data.upstream,
  { message: 'upstream URL is required when mode is "proxy"', path: ['upstream'] },
)

export type BetterMCPConfig = z.infer<typeof BetterMCPConfigSchema>

export const UserConfigSchema = BetterMCPConfigBaseSchema.partial().refine(
  (data) => data.mode !== 'proxy' || !data.mode || !!data.upstream,
  { message: 'upstream URL is required when mode is "proxy"', path: ['upstream'] },
)

export type UserConfig = z.input<typeof UserConfigSchema>
