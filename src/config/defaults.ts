import type { BetterMCPConfig } from './schema.js'

export const DEFAULT_DB_PATH = './bettermcp.db'
export const DEFAULT_RETENTION_DAYS = 90

export const DEFAULT_CONFIG: BetterMCPConfig = {
  db: DEFAULT_DB_PATH,
  wireLogging: true,
  mode: 'owner',
  // Hot reload is enabled by default for developer experience.
  // Production/containerized deployments should set hotReload: false explicitly
  // to avoid unnecessary file watcher overhead and stderr noise.
  hotReload: true,
}
