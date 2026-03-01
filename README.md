# harper-kb

Knowledge base for [Harper](https://harper.fast/), built on Harper, with MCP server integration.

A Harper plugin that provides searchable, scoped knowledge entries with vector embeddings for semantic search. Exposes a REST API and MCP endpoint.

## Consumers

- **Support team** — finding solutions, patterns, gotchas, customer edge cases
- **DX lab "Harper expert"** — backing knowledge for the AI expert role in Gas Town labs
- **Claude Code / IDE assistants** — Harper context via MCP without per-project CLAUDE.md files
- **Any MCP client** — Cursor, VS Code + Copilot, JetBrains, ChatGPT, Gemini, etc.

## Quick Start

### Prerequisites

- [Harper](https://harper.fast/) >= 4.7.0
- Node.js >= 22

### Install

```bash
npm install harper-kb
```

### Configure

Add to your application's `config.yaml`:

```yaml
'harper-kb':
  package: 'harper-kb'
  embeddingModel: nomic-embed-text # default
```

### Run

```bash
harperdb dev .
```

## Embeddings

Vector embeddings for semantic search run locally on CPU using [Nomic](https://huggingface.co/nomic-ai) embedding models via llama.cpp. Two backends are supported:

| Backend                                                                        | Install                              | Use case                                 |
| ------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------- |
| [harper-fabric-embeddings](https://github.com/heskew/harper-fabric-embeddings) | Optional dependency (auto-installed) | Production on Fabric (linux-x64, ~19 MB) |
| [node-llama-cpp](https://github.com/withcatai/node-llama-cpp)                  | `npm install node-llama-cpp`         | Local development on any platform        |

The plugin tries `harper-fabric-embeddings` first and falls back to `node-llama-cpp`. If neither is available, semantic search is skipped and keyword search still works.

### Models

| Config key                   | Model                                                                                        | Parameters | Dimensions |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ---------- | ---------- |
| `nomic-embed-text` (default) | [nomic-embed-text-v1.5-GGUF](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF)     | 137M       | 768        |
| `nomic-embed-text-v2-moe`    | [nomic-embed-text-v2-moe-GGUF](https://huggingface.co/nomic-ai/nomic-embed-text-v2-moe-GGUF) | 475M (MoE) | 768        |

```yaml
'harper-kb':
  package: 'harper-kb'
  embeddingModel: nomic-embed-text # v1.5 (default)
  # embeddingModel: nomic-embed-text-v2-moe  # v2 MoE — better quality, larger
```

## Architecture

```
harper-kb
├── src/
│   ├── index.ts              ← plugin entry: handleApplication()
│   ├── hooks.ts              ← extensibility hooks (onAccessCheck, loginPath)
│   ├── http-utils.ts         ← request body reading, header helpers
│   ├── types.ts              ← shared types + Harper global declarations
│   ├── core/                 ← shared logic
│   │   ├── embeddings.ts     ← model download, init, vector generation
│   │   ├── entries.ts        ← CRUD + relationship management
│   │   ├── history.ts        ← edit history audit log
│   │   ├── knowledge-base.ts ← KB registry (multi-tenant)
│   │   ├── search.ts         ← keyword / semantic / hybrid search
│   │   ├── tags.ts           ← tag registry with counts
│   │   ├── triage.ts         ← webhook intake queue
│   │   └── webhook-endpoints.ts ← webhook secret management
│   ├── resources/            ← REST Resource classes
│   │   ├── HistoryResource.ts
│   │   ├── KnowledgeBaseResource.ts
│   │   ├── KnowledgeEntryResource.ts
│   │   ├── MeResource.ts
│   │   ├── QueryLogResource.ts
│   │   ├── ServiceKeyResource.ts
│   │   ├── TagResource.ts
│   │   ├── TriageResource.ts
│   │   └── WebhookEndpointResource.ts
│   ├── mcp/                  ← MCP server (JSON-RPC over HTTP)
│   │   ├── protocol.ts       ← JSON-RPC dispatcher
│   │   ├── server.ts         ← HTTP middleware (auth, KB scoping)
│   │   └── tools.ts          ← tool definitions + handlers
│   ├── oauth/                ← OAuth 2.1 authorization server
│   │   ├── authorize.ts
│   │   ├── init.ts
│   │   ├── keys.ts
│   │   ├── metadata.ts
│   │   ├── middleware.ts
│   │   ├── register.ts
│   │   ├── token.ts
│   │   └── validate.ts
│   └── webhooks/             ← webhook intake (GitHub)
│       ├── github.ts
│       ├── middleware.ts
│       └── types.ts
├── schema/
│   ├── knowledge.graphql     ← table definitions (database: "kb")
│   └── oauth.graphql         ← OAuth tables
├── config.yaml
├── package.json
└── test/
```

Both REST and MCP run in the Harper process, both call the same core functions with zero overhead.

## REST API

| Endpoint                | Method          | Auth       | Description               |
| ----------------------- | --------------- | ---------- | ------------------------- |
| `/KnowledgeBase/`       | GET             | Public     | List knowledge bases      |
| `/KnowledgeBase/<id>`   | GET             | Public     | Get KB by ID              |
| `/KnowledgeBase/`       | POST/PUT/DELETE | Team       | Manage knowledge bases    |
| `/Knowledge/<id>`       | GET             | Public     | Get entry by ID           |
| `/Knowledge/?query=...` | GET             | Public     | Search entries            |
| `/Knowledge/`           | POST            | Required   | Create entry              |
| `/Knowledge/<id>`       | PUT             | Required   | Update entry              |
| `/Knowledge/<id>`       | DELETE          | Team       | Deprecate entry           |
| `/KnowledgeTag/`        | GET             | Public     | List all tags             |
| `/Triage/`              | GET             | Team       | List pending triage items |
| `/Triage/`              | POST            | Service/AI | Submit triage item        |
| `/Triage/<id>`          | PUT             | Team       | Process triage item       |
| `/QueryLog/`            | GET             | Team       | Search analytics          |
| `/ServiceKey/`          | GET/POST/DELETE | Team       | API key management        |
| `/WebhookEndpoint/`     | GET/POST/DELETE | Team       | Webhook endpoint secrets  |
| `/History/<entryId>`    | GET             | Public     | Edit history for an entry |
| `/Me/`                  | GET             | Public     | Current user/session info |

### Search Parameters

```
GET /Knowledge/?query=MQTT+auth&tags=mqtt,config&limit=10&mode=keyword&context={"harper":"5.0","storageEngine":"lmdb"}
```

- `query` — search text (required)
- `tags` — comma-separated tag filter
- `limit` — max results (default 10)
- `mode` — `keyword`, `semantic`, or `hybrid` (default)
- `context` — JSON applicability context for result boosting

## MCP Endpoint

Each knowledge base gets its own MCP endpoint at `/mcp/<kbId>`. Connect any MCP-compatible client:

```json
{
	"mcpServers": {
		"harper-kb": {
			"url": "https://kb.harper.fast:9926/mcp/my-kb-id"
		}
	}
}
```

### Tools

| Tool                  | Description                                                       |
| --------------------- | ----------------------------------------------------------------- |
| `knowledge_search`    | Search with keyword/semantic/hybrid modes + applicability context |
| `knowledge_add`       | Add a new entry (auto-tagged `ai-generated`)                      |
| `knowledge_get`       | Get entry by ID with full relationship chain                      |
| `knowledge_update`    | Update an entry with edit history tracking                        |
| `knowledge_related`   | Find related entries (explicit + semantic similarity)             |
| `knowledge_list_tags` | List all tags with counts                                         |
| `knowledge_triage`    | Submit to triage queue for review                                 |
| `knowledge_history`   | Get edit history for an entry (who changed what, when, why)       |
| `knowledge_reindex`   | Backfill missing embeddings                                       |
| `knowledge_link`      | Create related/sibling relationships between entries              |

## Schema

Tables in the `kb` database:

- **KnowledgeBase** — KB registry (multi-tenant)
- **KnowledgeEntry** — core entries with HNSW vector index, `@relationship` directives for supersession/siblings/related, `@createdTime`/`@updatedTime`
- **KnowledgeEntryEdit** — append-only edit history audit log
- **TriageItem** — webhook intake queue (7-day TTL)
- **KnowledgeTag** — tag name as primary key with entry counts
- **QueryLog** — search analytics (30-day TTL)
- **ServiceKey** — API keys with scrypt-hashed secrets
- **WebhookEndpoint** — per-KB webhook secrets
- **WebhookDelivery** — delivery ID dedup across workers (1-hour TTL)
- **OAuthClient** — dynamic client registrations (RFC 7591)
- **OAuthCode** — authorization codes (5-minute TTL)
- **OAuthRefreshToken** — refresh tokens (30-day TTL)
- **OAuthSigningKey** — RSA key pair for JWT signing

### Applicability Scoping

Entries carry an `appliesTo` scope:

```json
{
	"harper": ">=4.0 <5.0",
	"storageEngine": "lmdb",
	"node": ">=22",
	"platform": "linux"
}
```

Search results are boosted or demoted (never hidden) based on the caller's context.

### Entry Relationships

- **Supersedes** — "This replaces that for newer versions"
- **Siblings** — "Same topic, different config" (e.g., LMDB vs RocksDB behavior)
- **Related** — loose "see also" association

## Auth Model

| Role              | Read | Write                        | Review | Manage |
| ----------------- | ---- | ---------------------------- | ------ | ------ |
| `team`            | Yes  | Yes                          | Yes    | Yes    |
| `ai_agent`        | Yes  | Yes (flagged `ai-generated`) | No     | No     |
| `service_account` | Yes  | Triage queue only            | No     | No     |

MCP uses OAuth 2.1 with PKCE for authentication. MCP clients discover auth requirements via `/.well-known/oauth-protected-resource`, register dynamically, and authenticate through a browser-based login flow (GitHub OAuth primary, Harper credentials fallback). The web UI uses GitHub OAuth via `@harperfast/oauth` with Harper credentials as fallback.

## Development

```bash
# Build
npm run build

# Run tests (414 tests)
npm test

# Test with coverage
npm run test:coverage

# Watch mode
npm run dev

# For local semantic search, install node-llama-cpp
npm install node-llama-cpp
```

### Testing

Tests use Node.js built-in test runner (`node:test`) with mock Harper globals (in-memory tables). Tests run against compiled output in `dist/`.

```bash
npm test
```

## Fabric Deployment

For deploying to Harper Fabric, `harper-fabric-embeddings` is installed automatically as an optional dependency — no node-llama-cpp trimming or special build steps needed.

```dockerfile
# Dockerfile.build
FROM --platform=linux/amd64 node:22-slim AS build
WORKDIR /build

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Remove harperdb (provided by Fabric runtime)
RUN rm -rf node_modules/harperdb node_modules/.bin/harperdb

COPY config.yaml ./
COPY .env ./

FROM --platform=linux/amd64 node:22-slim AS package
WORKDIR /out
COPY --from=build /build /out/app
RUN tar czf /out/app.tar.gz -C /out app
```

## License

MIT
