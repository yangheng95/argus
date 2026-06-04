# JavaScript / TypeScript SDK

**Package**: `@opencorvus-ai/sdk`
**Source**: `packages/sdk/js/`
**Purpose**: Type-safe TypeScript wrapper over OpenCorvus REST API.

## Install

```bash
bun add @opencorvus-ai/sdk
```

## Two clients

### 1. Connect to a running server

```typescript
import { createOpenCorvusClient } from "@opencorvus-ai/sdk"

const client = createOpenCorvusClient({
  baseUrl: "http://127.0.0.1:7878",
  password: process.env.OPENCORVUS_SERVER_PASSWORD,
})

const { task_id } = await client.task.create({
  request: "Add unit tests for src/foo.ts",
})

for await (const event of client.event.subscribe()) {
  console.log(event.type, event)
}
```

### 2. Embed the server in-process

```typescript
import { createOpenCorvus } from "@opencorvus-ai/sdk"

const { client, server } = await createOpenCorvus({ directory: "/path/to/repo" })
// ... use client
await server.close()
```

Return shape:

```typescript
{ client: OpenCorvusClient, server: { url: string, close: () => void } }
```

## Namespaces

Mirror REST API modules (see [API reference](./api.md)):

| Namespace | Endpoints |
|---|---|
| `client.task.*` | `/task`, `/tasks`, `/task/:id/*` |
| `client.session.*` | `/session/*` |
| `client.goal.*` / `client.run.*` | `/goal/*` / `/run/*` |
| `client.event.subscribe()` | `/event` (SSE) |
| `client.mcp.*` | `/mcp/*` |
| `client.permission.*` | `/permission/*` |
| `client.skill.*` | `/skill/*` |
| `client.executor.*` | `/executor/*` |
| `client.tui.runtime.*` | `/tui/runtime/*` |

## Event subscription

`client.event.subscribe()` returns `AsyncIterable<Event>`, backed by an SSE long-poll. Reconnect uses exponential backoff (up to 60 s).

```typescript
const stream = client.event.subscribe({ signal: abortController.signal })
for await (const event of stream) {
  if (event.type === "task.updated") { /* ... */ }
}
```

Event types: [API reference § SSE event schema](./api.md#sse-event-schema).

## Type generation

SDK types are generated from the OpenAPI schema via [`@hey-api/openapi-ts`](https://github.com/hey-api/openapi-ts). Generated source lives under `packages/sdk/js/src/gen/`. Regenerate:

```bash
bun ./packages/sdk/js/script/build.ts
```

## Versions

Use the package root entrypoint:

```typescript
import { createOpenCorvusClient } from "@opencorvus-ai/sdk"
```

There is no current `@opencorvus-ai/sdk/v2` subpath. Legacy `createOpencode*` exports remain aliases in the root package, but new code should use `createOpenCorvus*`.

## Internals

The SDK layers the generated `@hey-api/openapi-ts` fetch client with generated TypeScript types and SSE helpers. To customize HTTP (proxy, interceptors), pass a custom `fetch` in client config or call the REST API directly; see [API reference](./api.md).
