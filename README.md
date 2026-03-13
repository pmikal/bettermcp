# bettermcp

The self-healing MCP server for OpenAPI-backed agents.

---

Point bettermcp at any OpenAPI spec and your entire API surface becomes immediately available to any AI agent. No hand-written tool definitions. No rebuilding. One line:

```typescript
const server = new BetterMCP()
await server.loadSpec('./openapi.yaml')
await server.start()
```

What agents do with that access, what they report back, and how the system responds to both, is where it gets interesting.

---

## How it works

bettermcp turns any OpenAPI spec into a three-tool MCP server:

```
search()  — discover endpoints, query health signals, and retrieve resolution hints
execute() — call any endpoint (with optional Safe-Mode), with wire logging on every call
report()  — send structured feedback (agent-initiated or system-observed)
```

A `health()` diagnostic tool is also exposed for monitoring server status, spec state, and store health.

Hot reload is built in. Change your OpenAPI spec, the server picks it up. No reconnect dance in development, no extra tooling required.

---

## The problems it solves

Agents learn something every time they call your API. Today that signal is lost.

Nothing in the current MCP ecosystem gives an agent a way to report what it observed — whether a schema was ambiguous, whether a call pattern cost three retries, whether a parameter description was unclear. That feedback exists on every invocation and evaporates on every invocation. bettermcp collects it two ways: agent-initiated via `report()`, and system-observed via wire logging on every `execute()` call. Both streams feed the same triage pipeline. Errors accumulate knowledge. Agents can query that knowledge. When an issue gets resolved, the resolution becomes a hint attached to future calls on that endpoint — so agents self-correct before they fail, not after.

SemVer abandons working clients. When you march your data model forward, agents in the field that rely on the old shape either break or get frozen out. bettermcp pins every API version to a commit SHA and routes `execute()` calls accordingly, so any version of your API that ever worked is still reachable. Agents discover newer versions through `search()` and migrate on their own schedule.

Agents are unpredictable with mutative actions. A `POST` or `DELETE` in production from an agent you haven't fully validated is a real risk. bettermcp's Safe-Mode intercepts mutative calls and returns a schema-valid simulated response, without touching your production API. You test agent workflows against your full API surface before you give them live write access. Then promote endpoints one at a time from the CLI when you're ready.

---

## The triage pipeline

```bash
npx bettermcp triage --db ./bettermcp.db --github
```

Run it against your feedback database and it classifies signals across 12 categories — schema mismatch, unexpected response, timeout, missing error schema, inconsistent naming, missing description, permissive schema, missing pagination, breaking change, data loss, deprecation, and agent-reported. It groups by endpoint, scores by frequency and severity, and can open GitHub issues directly:

```
Triage Classification Report
════════════════════════════════════════

Total signals: 142
Classifications: 5 (1 critical, 2 medium, 2 low)

[CRITICAL] schema-mismatch
  Response field "items" missing from schema definition
  Confidence: 92% | Observations: 64 | Source: wire-log, agent-report
  Endpoints: GET /users/search, GET /users
  First seen: 2026-03-10T14:22:00Z | Last seen: 2026-03-13T09:15:00Z

[MEDIUM] agent-reported
  Parameter "currency" not documented — agents defaulting incorrectly
  Confidence: 78% | Observations: 27 | Source: agent-report
  Endpoints: POST /orders/create
  First seen: 2026-03-11T08:00:00Z | Last seen: 2026-03-13T11:30:00Z

[MEDIUM] breaking-change
  Response shape changed — pinned versions returning unexpected structure
  Confidence: 85% | Observations: 8 | Source: wire-log
  Endpoints: GET /inventory/list
  First seen: 2026-03-12T16:00:00Z | Last seen: 2026-03-13T10:45:00Z
```

Without GitHub CLI auth, `--github` outputs a dry run showing the issues it would create:

```
GitHub Issue Dry Run
════════════════════════════════════════

3 issue(s) would be created:

── Issue 1 ──────────────────────────────────
Title: [bettermcp] CRITICAL: Response field "items" missing from schema definition
Labels: bettermcp, severity:critical, category:schema-mismatch
```

Once an issue is resolved, that resolution becomes a hint attached to the endpoint. The next time an agent calls `search({ query: "/orders/create", includeDiagnostics: true })`, it gets resolution hints and diagnostic signals alongside the endpoint definition — so it self-corrects before it fails, not after.

If you own the source code and run this loop regularly, your API improves because agents are using it, not because you remembered to check a feedback form.

---

## Getting started

```bash
npm install bettermcp
```

```typescript
import { BetterMCP } from 'bettermcp'

const server = new BetterMCP({
  db: './bettermcp.db',                        // SQLite for feedback, signals, wire logs
  safeMode: {
    mutativeEndpoints: 'simulate',             // intercept POST/PUT/PATCH/DELETE
  },
  retention: { days: 90 },                     // wire log retention
  hotReload: true,                             // watch spec file for changes (default)
})

await server.loadSpec('./openapi.yaml')
await server.start()
```

Or scaffold a project from scratch:

```bash
npx bettermcp init my-project
cd my-project && npm install && npm start
```

---

## Commit-pinned versioning — the part people ask about

An agent calling `execute({ endpoint: '/users/search', method: 'GET', version: 'b348c38' })` gets that exact version of the API forever, regardless of what main looks like today.

Three questions come up every time:

**Where are old versions stored?** In your running server, as pinned endpoint sets — not rebuilt binaries, not separate deployments. You register a version with a commit SHA and a set of endpoint definitions, the router keeps all pinned versions in memory. Active versions serve requests normally. Deprecated versions continue serving but include migration guidance. Sunset versions return a structured BMCP014 error with the migration target rather than silently failing.

**Are binaries rebuilt per commit?** No. The version map is built at startup from whatever versions are pinned in the running process.

**What about database migrations?** This is the hard part, and where the theoretical foundation actually matters. bettermcp's versioning is built on forward computability from database research: structure your schema changes as additive transformations — new columns, new tables, materialized views over old shapes — and any query expressible against an old schema stays expressible against the new one. The honest tradeoff: strictly additive schemas accumulate over time, which means column bloat in a fast-moving codebase. That's a real cost and worth going in with eyes open.

For destructive migrations that can't be avoided, bettermcp provides Translation Handlers.

---

## Version lifecycle

```typescript
// Pin a version with its endpoint definitions
server.pinVersion('d4f9a21', endpoints, 'https://api.example.com/v2')

// Later: deprecate with migration guidance
server.deprecateVersion('b348c38', 'd4f9a21', 'Profile merged into User')

// Later: sunset (returns BMCP014 error to agents still using it)
server.sunsetVersion('b348c38')
```

Agents discover version status through `search({ includeVersions: true })` and can see which versions are active, deprecated, or sunset — along with migration targets.

---

## Translation Handlers

When you have to make a breaking schema change — merging tables, renaming fields, restructuring a response — Translation Handlers keep pinned agent clients alive without maintaining two separate codebases.

```typescript
// A legacy agent is pinned to commit b348c38, which had a flat user response.
// You've since restructured with nested metadata.
// These handlers translate the request and response shapes.

server.onTranslate({
  version: 'b348c38',
  endpoint: 'PATCH /users/update',
  request: (legacyBody) => ({
    user_metadata: {
      bio: legacyBody.biography,
      theme: legacyBody.ui_preference,
    },
    id: legacyBody.user_id,
  }),
  response: (currentBody) => ({
    biography: currentBody.user_metadata.bio,
    ui_preference: currentBody.user_metadata.theme,
    user_id: currentBody.id,
  }),
})
```

If no translation handler is registered for a sunset version, bettermcp returns a structured BMCP014 error with the migration target, so the agent can re-orient. It doesn't fail silently.

---

## Safe-Mode

Safe-Mode intercepts mutative endpoints and returns schema-valid simulated responses without hitting your upstream API.

```typescript
const server = new BetterMCP({
  safeMode: {
    mutativeEndpoints: 'simulate',              // simulate all POST/PUT/PATCH/DELETE
    endpoints: {
      'POST /orders': 'live',                   // except this one — already validated
      'DELETE /users/{id}': 'simulate',         // explicitly simulate even if global is off
    },
  },
})
```

When you're confident an endpoint is safe, promote it from the CLI without restarting:

```bash
npx bettermcp promote POST /orders
# Promoted POST /orders from simulate → live.
```

The `execute()` response includes a `simulated: true` flag and a confidence score so the agent knows it's working with synthetic data.

---

## Proxy mode

In proxy mode, bettermcp forwards all requests to an upstream API you specify. Useful when you don't own the API but want feedback collection, wire logging, and safe-mode in front of a third-party service.

```typescript
const server = new BetterMCP({
  mode: 'proxy',
  upstream: 'https://api.example.com',
})
```

Proxy mode enforces credential safety: `fullHeaders` logging is forcibly disabled, and all credential patterns are scrubbed from wire logs before storage. Rate limit headers from the upstream are extracted and surfaced in the `execute()` response.

---

## Custom auth handlers

Register an auth handler to inject credentials into upstream requests. The handler runs before every `execute()` call.

```typescript
server.auth((request) => {
  return {
    headers: {
      'Authorization': `Bearer ${getToken()}`,
      'X-Request-ID': crypto.randomUUID(),
    },
  }
})
```

Auth handlers can be async. If a handler throws, bettermcp returns a structured BMCP016 error — no partial request reaches the upstream.

---

## Auto-discovery

Don't have an OpenAPI spec? bettermcp can probe a base URL and generate one:

```typescript
await server.discover({
  baseUrl: 'https://api.example.com',
  outputPath: './discovered-spec.yaml',
})
```

Discovery checks for existing specs at well-known paths (`/openapi.json`, `/swagger.json`, `/api-docs`), then probes common API patterns. SSRF protection blocks internal/private addresses.

---

## Security

bettermcp makes **zero outbound network calls** except to the upstream API you configure.

No telemetry. No analytics. No update checks. No DNS lookups to unknown hosts. Every byte that leaves your machine goes to the API URL you specified — nothing else.

This isn't a policy statement — it's a tested guarantee. The test suite includes dedicated network audits (`src/no-phone-home.test.ts` and `tests/integration/no-phone-home.test.ts`) that intercept all `fetch()` calls during initialization, configuration, search, execute, report, and health — verifying that no unauthorized destinations are contacted. The only code path that calls `fetch()` is `execute()`, which forwards exclusively to the upstream API you configured. If bettermcp ever phones home, those tests fail.

**Credential redaction** is always on:

- Headers: Authorization, Cookie, Set-Cookie, X-API-Key, X-Auth-Token, Proxy-Authorization → `[REDACTED]`
- Bodies: JWT tokens, API keys (sk-*, key_*), Bearer tokens, GitHub PATs, Slack tokens, AWS access keys, npm tokens — all scrubbed before wire log storage
- The agent receives raw responses; redaction only applies to what's persisted
- In proxy mode, `fullHeaders` logging is forcibly disabled — you cannot accidentally log credentials

---

## Error catalog

bettermcp uses structured errors with machine-readable codes (BMCP001–BMCP022). Every error includes the code, a human-readable message, and context. Agents can pattern-match on codes to decide whether to retry, fall back, or escalate.

Key codes: BMCP005 (no spec loaded), BMCP008 (origin mismatch), BMCP009 (upstream error), BMCP012 (version not found), BMCP014 (version sunset), BMCP016 (auth handler failed).

---

## Why now

SemVer was designed for a world where humans write clients and humans decide when to upgrade. That assumption is breaking down. The MCP ecosystem is young enough that the right conventions aren't locked in yet — which means there's still time to build them in at the foundation rather than bolt them on later. bettermcp is that attempt.

What are we missing? `report()` is open. If your agents are hitting something we haven't accounted for — a pattern that doesn't classify well, a workflow that safe-mode handles badly, a versioning edge case — that's exactly the kind of signal we built `report()` to carry. Use it. The feedback loop works the same way for the project as it does for your API.

For bug reports, feature requests, or pull requests: [github.com/pmikal/bettermcp](https://github.com/pmikal/bettermcp).

---

## Contributing

bettermcp is maintained by Tony Hansmann and Philip Mikal. We're building it on the side, with AI tooling, and keeping the scope tight. If you've hit a rough edge in the MCP ecosystem that belongs here, open an issue or send a pull request.

MIT License.
