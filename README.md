# bettermcp

The self-healing API gateway for agents.

---

Point bettermcp at any OpenAPI spec and your entire API surface becomes immediately available to any AI agent. No hand-written tool definitions. No rebuilding. One line:

```typescript
server.loadSpec('./openapi.yaml')
```

What agents do with that access, what they report back, and how the system responds to both, is where it gets interesting.

---

## How it works

bettermcp turns any OpenAPI spec into a three-tool MCP server:

```
search()  — discover endpoints, query health signals, and retrieve resolution hints
execute() — call any endpoint (with optional Safe-Mode), with wire logging on every call
report()  — send structured feedback back to you (agent-initiated or system-observed)
```

Hot reload is built in. No reconnect dance in development, no extra tooling required.

---

## The problems it solves

Agents learn something every time they call your API. Today that signal is lost.

Nothing in the current MCP ecosystem gives an agent a way to report what it observed — whether a schema was ambiguous, whether a call pattern cost three retries, whether a parameter description was unclear. That feedback exists on every invocation and evaporates on every invocation. bettermcp collects it two ways: agent-initiated via `report()`, and system-observed via wire logging on every `execute()` call. Both streams feed the same triage pipeline. Errors accumulate knowledge. Agents can query that knowledge. When an issue gets resolved, the resolution becomes a hint attached to future calls on that endpoint — so agents self-correct before they fail, not after.

SemVer abandons working clients. When you march your data model forward, agents in the field that rely on the old shape either break or get frozen out. bettermcp routes every `execute()` call through a commit SHA, so any version of your API that ever worked is still reachable. Agents discover newer versions through `search()` and migrate on their own schedule.

Agents are unpredictable with mutative actions. A `POST` or `DELETE` in production from an agent you haven't fully validated is a real risk. bettermcp's Safe-Mode intercepts mutative calls and simulates a response based on your schema and historical successful calls, without touching your production database. You test agent workflows against your full API surface before you give them live write access.

The reconnect dance is a real tax. stdio MCP in development means killing the process and reconnecting the client on every code change. bettermcp watches the binary and exec()s itself on change. Zero config, back to work in seconds.

---

## The triage agent

```bash
npx bettermcp triage --db ./feedback.db --github-token $TOKEN
```

Run it against your feedback database and it groups related reports, classifies them automatically — schema problem, missing field, flaky endpoint, auth issue — scores them by frequency and severity, and acts:

```
Agent Feedback — last 24h

  /users/search        64 reports   [schema] parameter "limit" unclear — agents retry-looping
                                    → Opening Issue #87 with suggested schema patch

  /orders/create       27 reports   [missing field] currency — agents hallucinating default
                                    → Opening Issue #88 with suggested schema patch

  /inventory/list       8 reports   [breaking change] response shape changed — 3 pinned versions affected
                                    → Opening Issue #89 with migration guidance
```

Once an issue is resolved, that resolution becomes a hint attached to the endpoint. The next time an agent queries `search("/orders/create")`, it gets the resolution hint alongside the endpoint definition — so it self-corrects before it fails, not after. Agents can also query system health directly:

```
search("diagnose /orders/create")
→ last 24h: 27 reports, classified as missing field
→ resolution hint: always include currency as ISO 4217 string e.g. "USD"
→ current version: d4f9a21, pinned versions: b348c38 (deprecated), a12f445 (sunset)
```

If you own the source code and run this loop regularly, your API improves because agents are using it, not because you remembered to check a feedback form.

---

## Getting started

```bash
npm install bettermcp
```

```typescript
import { BetterMCP } from 'bettermcp'

const server = new BetterMCP({
  name: 'my-server',
  version: '1.0.0',
  safeMode: true,                              // intercept mutative calls in staging
  feedback: { store: 'sqlite', path: './feedback.db' },
  retention: { strategy: 'count', max: 50 },  // or { strategy: 'age', days: 90 }
  hotReload: process.env.NODE_ENV === 'development',
})

server.loadSpec('./openapi.yaml')
server.start()
```

---

## Commit-pinned versioning — the part people ask about

An agent calling `execute("/api/b348c38/users/search")` gets that exact version of the handler forever, regardless of what main looks like today.

Three questions come up every time:

Where are old handlers stored? In your codebase, as registered versioned functions — not rebuilt binaries, not separate deployments. You tag a handler with a commit SHA when you register it, the router keeps all tagged versions in memory, and you control retention by count or age. Active versions serve requests normally. Deprecated versions continue serving but return a `x-bettermcp-deprecated` header with a migration hint. Sunset versions return a structured error with the same migration hint rather than silently failing.

Are binaries rebuilt per commit? No. The version map is built at startup from whatever handlers are registered in the running process.

What about database migrations? This is the hard part, and where the theoretical foundation actually matters. bettermcp's versioning is built on forward computability from database research: structure your schema changes as additive transformations — new columns, new tables, materialized views over old shapes — and any query expressible against an old schema stays expressible against the new one. The honest tradeoff: strictly additive schemas accumulate over time, which means column bloat in a fast-moving codebase. That's a real cost and worth going in with eyes open.

For destructive migrations that can't be avoided, bettermcp provides Translation Handlers.

---

## Translation Handlers

When you have to make a breaking schema change — merging tables, renaming fields, restructuring a response — Translation Handlers keep pinned agent clients alive without maintaining two separate codebases.

```typescript
// A legacy agent is pinned to commit b348c38, which had a flat /update-profile endpoint.
// You've since merged Profile into User with a nested structure.
// This handler intercepts the old call shape and maps it forward.

server.onTranslate({
  version: 'b348c38',
  path: '/update-profile',
  handler: (legacyRequest) => {
    return {
      path: '/v2/users/update',
      method: 'PATCH',
      body: {
        user_metadata: {
          bio: legacyRequest.body.biography,
          theme: legacyRequest.body.ui_preference,
        },
        id: legacyRequest.body.user_id,
      },
    }
  },
})
```

If no translation handler is registered for a sunset version, bettermcp returns a structured error with the current version's OpenAPI definition, so the agent can re-orient. It doesn't fail silently.

---

## Security

bettermcp makes **zero outbound network calls** except to the upstream API you configure.

No telemetry. No analytics. No update checks. No DNS lookups to unknown hosts. Every byte that leaves your machine goes to the API URL you specified — nothing else.

This isn't a policy statement — it's a tested guarantee. The test suite includes a dedicated network audit (`src/no-phone-home.test.ts`) that intercepts all `fetch()` calls during server initialization and configuration, verifying that no unauthorized destinations are contacted. The only code path that intentionally calls `fetch()` is the `execute()` tool handler, which forwards exclusively to the upstream API you configured. If bettermcp ever phones home, that test fails.

In **proxy mode**, credential handling adds an additional layer (verified in `redactor.test.ts` and `server.test.ts`):

- Agent-supplied credentials (e.g., `Authorization` headers) are passed through to the upstream API per-request only — zero credential material is persisted to wire logs, the feedback store, or any storage path.
- `logging.fullHeaders` is forcibly disabled in proxy mode. You cannot accidentally log credentials.
- Response bodies are scrubbed for credential patterns (JWT, API keys, Bearer tokens) before wire log storage. The agent receives the raw response; scrubbing only applies to what's stored.

---

## Why now

SemVer was designed for a world where humans write clients and humans decide when to upgrade. That assumption is breaking down. The MCP ecosystem is young enough that the right conventions aren't locked in yet — which means there's still time to build them in at the foundation rather than bolt them on later. bettermcp is that attempt.

What are we missing? `report()` is open.

---

## Contributing

bettermcp is maintained by Tony Hansmann and Philip Mikal. We're building it on the side, with AI tooling, and keeping the scope tight. If you've hit a rough edge in the MCP ecosystem that belongs here, open an issue or send a pull request.

MIT License.
