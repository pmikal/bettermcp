export const SCHEMA_DDL = `
CREATE TABLE IF NOT EXISTS wire_logs (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  endpoint_path TEXT NOT NULL,
  method TEXT NOT NULL,
  request_headers TEXT NOT NULL,
  request_body TEXT,
  response_status INTEGER NOT NULL,
  response_headers TEXT NOT NULL,
  response_body TEXT,
  mode TEXT NOT NULL CHECK(mode IN ('live', 'simulated')),
  version_sha TEXT,
  duration_ms INTEGER NOT NULL,
  provenance TEXT NOT NULL DEFAULT 'wire-log'
);

CREATE INDEX IF NOT EXISTS idx_wire_logs_endpoint_path ON wire_logs(endpoint_path);
CREATE INDEX IF NOT EXISTS idx_wire_logs_timestamp ON wire_logs(timestamp);

CREATE TABLE IF NOT EXISTS synthetic_signals (
  id TEXT PRIMARY KEY,
  endpoint_path TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('critical', 'medium', 'low')),
  confidence REAL NOT NULL,
  observation_count INTEGER NOT NULL DEFAULT 1,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  provenance TEXT NOT NULL CHECK(provenance IN ('wire-log', 'synthetic', 'agent-reported')),
  message TEXT NOT NULL,
  suggestion TEXT,
  expired INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_synthetic_signals_endpoint_path ON synthetic_signals(endpoint_path);
CREATE UNIQUE INDEX IF NOT EXISTS idx_synthetic_signals_upsert ON synthetic_signals(endpoint_path, category);

CREATE TABLE IF NOT EXISTS resolution_hints (
  id TEXT PRIMARY KEY,
  endpoint_path TEXT NOT NULL,
  hint TEXT NOT NULL,
  source TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_resolution_hints_endpoint_path ON resolution_hints(endpoint_path);

CREATE TABLE IF NOT EXISTS version_states (
  id TEXT PRIMARY KEY,
  endpoint_path TEXT NOT NULL,
  version_sha TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_version_states_endpoint_path ON version_states(endpoint_path);
CREATE INDEX IF NOT EXISTS idx_version_states_version_sha ON version_states(version_sha);

CREATE TABLE IF NOT EXISTS promotion_log (
  id TEXT PRIMARY KEY,
  endpoint_path TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  promoted_by TEXT NOT NULL,
  promoted_at TEXT NOT NULL,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_promotion_log_endpoint_path ON promotion_log(endpoint_path);
`
