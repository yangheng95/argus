# 2026-06-03 Observability Diagnostic Envelope

## Trigger

Fresh environments can show empty Providers, refresh failures, or model selectors
stuck in loading while the current log surfaces do not identify the failing
route, provider registry source, sidecar log path, or upstream error body. The
investigation below was split across four independent agents:

- Core/server logging and route errors.
- Overlay/Tauri/WebView error visibility.
- Error object serialization across HTTP, server-sent events, sessions, and
  orchestrator artifacts.
- Test and documentation coverage for observability behavior.

This spec is the repair plan. It is not a compatibility layer, a gate, or a
retry policy. It replaces the current fragmented error strings with a single
diagnostic data shape that can be logged, returned over HTTP, emitted over
events, and rendered by the UI.

## Mature Product Baseline

The target shape follows mature observability systems, not project-local
invention:

- OpenTelemetry logs model: log records have timestamps, severity, body,
  attributes, and optional trace/span correlation fields. Exception fields must
  follow the exception semantic conventions when present.
  Source: https://opentelemetry.io/docs/specs/otel/logs/data-model/
- OpenTelemetry exception conventions: exception events carry
  `exception.type`, `exception.message`, `exception.stacktrace`, and
  `exception.escaped` where applicable.
  Source: https://opentelemetry.io/docs/specs/semconv/exceptions/exceptions-logs/
- Datadog log/trace correlation: logs should carry trace ID, span ID, service,
  environment, and version so one failing request can be joined across systems.
  Source:
  https://docs.datadoghq.com/tracing/other_telemetry/connect_logs_and_traces/
- Sentry issue details: actionable error triage depends on stack trace,
  breadcrumbs, tags, and structured contexts; breadcrumbs record the timeline
  leading to an error.
  Sources:
  https://docs.sentry.io/product/issues/issue-details/
  and
  https://docs.sentry.io/platforms/javascript/guides/svelte/enriching-events/breadcrumbs/
- Grafana Loki label guidance: labels must be low-cardinality; dynamic values
  such as trace IDs or request IDs belong in structured metadata or the log
  body, not indexed labels.
  Sources:
  https://grafana.com/docs/loki/latest/get-started/labels/
  and https://grafana.com/docs/loki/latest/best-practices/

Applied to Opencorvus: `service`, `level`, `component`, and coarse `routeGroup`
are labels. `diagnosticID`, request ID, task ID, session ID, provider ID, model
ID, exact path, response body preview, and stack traces are structured fields.

## Evidence From Codebase

### Core/server

| Site | Current behavior | Defect |
|---|---|---|
| `packages/opencorvus/src/server/server.ts:65` | `onError` logs `failed` with `{ error }` only. | No method, path, status, request ID, response error name, directory, or diagnostic ID. |
| `packages/opencorvus/src/server/server.ts:133` | Request log records method/path before `await next()`. | No final status, duration, or error outcome. |
| `packages/opencorvus/src/server/server.ts:138` | `log.time("request")` stops only after `await next()`. | Thrown errors skip the completion log. |
| `packages/opencorvus/src/server/routes/app.ts:340` | `/log/tail` returns empty lines when the log file is absent/unreadable. | Log read failure appears as "no logs". |
| `packages/opencorvus/src/server/routes/provider.ts:91` | `/provider/refresh` returns 200 with `{ ok:false, error }`. | Refresh failures bypass `onError`, status mapping, and request error logs. |
| `packages/opencorvus/src/server/routes/provider.ts:126` | `/provider/hexin/refresh` also catches and returns 200 on failure. | Same bypass, but for model discovery. |
| `packages/opencorvus/src/provider/hexin-discovery.ts:15` | Startup discovery can silently fall back to cache/empty. | UI receives an empty catalog without the upstream cause. |

### Error serialization

| Site | Current behavior | Defect |
|---|---|---|
| `packages/util/src/error.ts:60` | `NamedError.toObject()` returns `{ name, data }`. | Cause chain, stack, status, method/path, provider/model, and request ID vanish. |
| `packages/opencorvus/src/server/error.ts:5` | OpenAPI error schemas describe `{ name, data }`. | SDKs cannot carry diagnostic context. |
| `packages/opencorvus/src/session/message.ts:62` | `Message.APIError` has some upstream HTTP fields. | No provider ID, model ID, request ID, path, or cause chain. |
| `packages/opencorvus/src/session/llm.ts:243` | `streamText.onError` publishes `Message.fromError(event.error, { providerID })`. | Model ID and provider request data are known elsewhere but not emitted. |
| `packages/opencorvus/src/session/events.ts:6` | `session.error` schema is tied to assistant error shape. | Cannot carry route, request, provider/model, or source component context. |
| `packages/opencorvus/src/orchestrator/agent.ts:516` | Orchestrator stores only `reason` and `errorName`. | The durable artifact loses the actual upstream failure context. |
| `packages/opencorvus/src/engine/persist.ts:2294` | `orchestrator-stream-error` payload stores a reduced reason/name/session ID. | Root-cause fields are not recoverable later. |

### Overlay/Tauri/WebView

| Site | Current behavior | Defect |
|---|---|---|
| `packages/overlay/src/services/api.ts:284` | `ApiError` stores status/path/body. | No headers, request ID, cause, or normalized envelope. |
| `packages/overlay/src/services/api.ts:297` | `formatApiErrorMessage()` ignores `NamedError.data.message`. | User-facing error can degrade into a JSON blob or generic path/status. |
| `packages/overlay/src/services/api.ts:358` | `apiJsonWithTimeout()` wraps timeout/failure into plain errors. | Structured `ApiError` data can be lost. |
| `packages/overlay/src/services/init.ts:289` | `loadConfigInfo()` writes partial failures to `configLoadErrors`. | The UI barely consumes this store; errors become empty states. |
| `packages/overlay/src/services/init.ts:334` | `loadProviderInfo()` records provider/auth failures similarly. | Provider refresh can show success while reload failed. |
| `packages/overlay/src/components/settings/ProvidersPanel.tsx:104` | Refresh calls `loadProviderInfo()` after POST. | Partial reload failure is not rendered as refresh failure. |
| `packages/overlay/src/components/ExecutorSelector.tsx:248` | Model picker reloads providers but does not show `configLoadErrors`. | Provider API failure becomes "no providers/no models". |
| `packages/overlay/src/main.tsx:1529` | `initApp()` failure is only `console.error`. | Startup failure can leave the UI in a static/empty state. |
| `packages/overlay/src-tauri/src/main.rs:985` | Exited sidecar clears `sidecar_log_path`. | The previous crash log path is discarded. |
| `packages/vscode-extension/src/sidecar/manager.ts:149` | Sidecar stderr goes to OutputChannel. | No stable file path is passed to diagnostics. |
| `packages/overlay/src/components/LogViewer.tsx:67` | LogViewer catches `/log/tail` failure and clears logs. | Log retrieval failure is presented as an empty log. |

### Tests and docs

| Area | Current coverage | Missing coverage |
|---|---|---|
| Server `onError` tests | Status mapping and no-stack response. | Production route logs with path/status/request ID/stack in log. |
| `/log` and `/log/tail` | Mostly indirect stubs. | Contract tests for write, tail, invalid input, and read failure. |
| Provider refresh | Refresh behavior and some provider errors. | Failure logs, HTTP status, upstream body, cache source, proxy/network detail. |
| Overlay `AppLog` | Many tests stub `/log`. | Flush contract and permanent failure behavior. |
| LogViewer helpers | Primitive existence checks. | JSON log parsing, malformed line handling, filtering, copy output. |
| Troubleshooting docs | Mention static/fixed paths. | Actual `Global.Path.log`, `%LOCALAPPDATA%\opencorvus\log`, and `/log/tail`. |

## Root Cause

The log system is not merely unstructured. It has four deeper design defects:

1. Error identity is not durable. A thrown error becomes `{ name, data }`, then
   an `ApiError`, then a notification string, then an orchestrator reason. Each
   boundary drops fields.
2. HTTP and event boundaries do not share a diagnostic contract. Server route
   errors, provider refresh failures, session errors, stream errors, and Tauri
   sidecar failures all use different shapes.
3. UI loading and empty states are not connected to the failed operation.
   Provider and model picker failures are recorded in stores or console, then
   rendered as "empty" or "loading".
4. Log retrieval itself can fail silently. When `/log/tail` or LogViewer fails,
   the operator sees no logs instead of a diagnostic error.

The current `orchestrator-stream-error` and related fuse specs also reduce
provider failures to `reason/errorName`. That may explain the task state, but
it cannot explain the root provider, route, HTTP, or sidecar cause. The new
diagnostic envelope must replace that reduced payload as the source of truth.

## Repair Contract

### 1. Introduce one diagnostic envelope

Create a single schema in a shared package, for example
`packages/util/src/diagnostic.ts`:

```ts
export type DiagnosticEnvelope = {
  diagnosticID: string
  time: string
  level: "debug" | "info" | "warn" | "error"
  service: "server" | "overlay" | "tauri" | "vscode-extension" | "llm" | "orchestrator" | "session"
  component: string
  operation?: string
  message: string
  error?: {
    name: string
    message: string
    code?: string
    retryable?: boolean
    stack?: string
    causes?: Array<{ name: string; message: string; code?: string; statusCode?: number }>
  }
  http?: {
    method?: string
    path?: string
    statusCode?: number
    requestID?: string
    responseHeaders?: Record<string, string>
    responseBodyPreview?: string
    responseBodyHash?: string
  }
  correlation?: {
    traceID?: string
    spanID?: string
    taskID?: string
    runID?: string
    sessionID?: string
    messageID?: string
    providerID?: string
    modelID?: string
  }
  files?: {
    serverLogPath?: string
    sidecarLogPath?: string
    sidecarStdoutPath?: string
    sidecarStderrPath?: string
  }
  attributes?: Record<string, unknown>
}
```

Field naming note: ID means identifier. HTTP means Hypertext Transfer Protocol.
LLM means large language model. UI means user interface. SSE means
server-sent events. These abbreviations must be commented when introduced in
code, per project rule 19.

There must be one serializer and one bounded cause-chain extractor. `NamedError`,
HTTP `onError`, session `Message.fromError`, stream transports, overlay
`ApiError`, and orchestrator artifacts must call that serializer instead of
hand-building reduced strings.

### 2. Replace text log lines with JSONL records

`Log.create()` should emit newline-delimited JSON. The JSON body is the
diagnostic envelope plus log attributes. This is a replacement, not a permanent
dual writer. LogViewer should parse JSONL as the server log source and render
raw text only for old files already on disk, if the implementation chooses a
one-time migration tool.

Required route behavior:

- Generate or read `x-opencorvus-request-id` in middleware.
- Return the same request ID in the response header.
- Use `try/catch/finally` around `await next()`.
- Log request start and request finish with method, path, status, duration, and
  diagnostic ID.
- On thrown errors, log an error envelope with exception fields and stop timing
  in `finally`.
- `/log/tail` read failure throws a typed error; it must not return empty lines.

### 3. Stop returning 200 for refresh failures

`/provider/refresh` and `/provider/hexin/refresh` must throw typed
`NamedError` classes on failure, mapped by global `onError` into diagnostic
HTTP responses:

- `ProviderCatalogRefreshError`
- `ProviderModelDiscoveryError`

Responses should carry the diagnostic envelope. The overlay should no longer
parse `{ ok:false }` as a hidden error channel.

### 4. Make provider discovery source explicit

Hexin and models.dev discovery can use persisted data as the catalog source,
but it must expose:

- source: live, cache, or packaged snapshot.
- cache age and cache path when cache is used.
- upstream URL, status code, error name, and diagnostic ID when live discovery
  fails.

An empty provider/model list is valid only after a successful request that
actually returned empty data. Network, authentication, proxy, registry, and
schema failures must be displayed as failures.

### 5. Preserve envelope across sessions and orchestrator

Assistant message errors, `session.error` events, task cards, and
`orchestrator-stream-error` artifacts should reference the same envelope or
embed the full envelope. They must not copy only `reason`, `name`, or
`data.message`.

Required changes:

- `Message.fromError()` accepts provider ID, model ID, session ID, task ID,
  request ID, and path.
- AI SDK API errors preserve upstream status, headers, body preview/hash,
  retryable flag, provider ID, and model ID.
- `session.error` event schema carries `DiagnosticEnvelope`.
- `tree-writer` keeps the envelope in card state and renders `message` only as
  the compact label.
- Orchestrator artifacts store diagnostic ID plus full envelope fields needed
  for next-wake reasoning.

### 6. Add an overlay diagnostics store and visible consumers

Console logging is not a diagnostic surface. Add a single UI diagnostics store
that records envelopes from:

- `initApp`
- `loadConfigInfo`
- `loadProviderInfo`
- provider refresh
- `loadBoard`
- connection checks
- SSE transport errors
- Tauri sidecar startup and crash paths

Required visible consumers:

- Startup banner or dialog mounted before `initApp()` can fail.
- Config dialog top-level diagnostics strip.
- Providers panel initial load and refresh errors.
- Executor model picker error state.
- Board/task detail error state.
- LogViewer read failure state.
- Connection failure notification including server log and sidecar log paths.

### 7. Preserve sidecar log paths

Tauri already creates sidecar log files, but it clears the previous path when a
child exits. Keep `lastSidecarLogPath` and exit status in server info and
failure notifications. The VS Code extension should write stdout/stderr to
stable files and include their paths in startup errors and diagnostics.

### 8. Keep Loki-style cardinality discipline

Do not turn request IDs, task IDs, session IDs, provider IDs, model IDs, or file
paths into indexed labels. They belong in the JSONL body/structured metadata.
This keeps LogViewer and future log aggregation queryable without exploding
label cardinality.

## Implementation Slices

### Slice A: Diagnostic schema and HTTP boundary

Files:

- `packages/util/src/diagnostic.ts`
- `packages/util/src/error.ts`
- `packages/opencorvus/src/server/server.ts`
- `packages/opencorvus/src/server/error.ts`
- `packages/sdk/openapi.json`
- `packages/sdk/js/src/gen/*`

Tests:

- `packages/util/test/diagnostic.test.ts`
- `packages/opencorvus/test/server/onerror-observability.test.ts`
- `packages/opencorvus/test/server/log-routes.test.ts`

Acceptance:

- A thrown `NamedError` response contains method/path/status/request ID and
  diagnostic ID.
- A thrown plain `Error` response does not leak stack, but the JSONL log does
  include exception type/message/stack.
- Request finish is logged on both success and error.

### Slice B: Provider catalog and model discovery diagnostics

Files:

- `packages/opencorvus/src/server/routes/provider.ts`
- `packages/opencorvus/src/provider/models.ts`
- `packages/opencorvus/src/provider/hexin-discovery.ts`
- `packages/opencorvus/src/provider/provider.ts`
- `packages/overlay/src/components/settings/ProvidersPanel.tsx`
- `packages/overlay/src/components/ExecutorSelector.tsx`

Tests:

- `packages/opencorvus/test/provider/models-dev-observability.test.ts`
- `packages/opencorvus/test/provider/hexin-discovery-observability.test.ts`
- `packages/overlay/test/providers-panel-diagnostics.test.tsx`
- `packages/overlay/test/executor-selector-diagnostics.test.tsx`

Acceptance:

- Refresh failure is non-2xx and carries a diagnostic envelope.
- Startup discovery with cache exposes cache source and live failure diagnostic.
- Startup discovery without usable data produces a visible discovery error, not
  an empty provider list.
- Model picker shows the failing route and diagnostic ID instead of loading
  forever or saying no models.

### Slice C: Overlay API, startup, and UI diagnostics

Files:

- `packages/overlay/src/services/api.ts`
- `packages/overlay/src/services/init.ts`
- `packages/overlay/src/services/connection.ts`
- `packages/overlay/src/store/app.ts`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/components/LogViewer.tsx`
- `packages/overlay/src/utils/log.ts`

Tests:

- `packages/overlay/test/api-error.test.ts`
- `packages/overlay/test/app-log-flush.test.ts`
- `packages/overlay/test/log-utils.test.ts`
- `packages/overlay/test/startup-diagnostics.test.tsx`
- `packages/overlay/test/log-viewer-diagnostics.test.tsx`

Acceptance:

- `ApiError` preserves the envelope, headers, status, path, and readable
  `data.message`.
- `apiJsonWithTimeout()` does not erase structured errors.
- `initApp()` failures are visible in the UI and in AppLog.
- `/log/tail` failure renders a diagnostic error, not "no logs".

### Slice D: Session, SSE, and orchestrator propagation

Files:

- `packages/opencorvus/src/session/message.ts`
- `packages/opencorvus/src/session/events.ts`
- `packages/opencorvus/src/session/llm.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/engine/persist.ts`
- `packages/overlay/src/services/sse.ts`
- `packages/overlay/src/services/tauri-transport.ts`
- `packages/overlay/src/services/tree-writer.ts`
- `packages/vscode-extension/src/transport/bridge.ts`

Tests:

- `packages/opencorvus/test/session/message.test.ts`
- `packages/opencorvus/test/session/llm-streamtext-source.test.ts`
- `packages/opencorvus/test/orchestrator/session-hard-error.test.ts`
- `packages/overlay/test/tree-writer-hierarchy.test.ts`
- `packages/vscode-extension/test/bridge-sse.test.ts`

Acceptance:

- Provider stream errors preserve provider/model/status/body/request ID.
- SSE non-2xx errors read response bodies and emit diagnostic envelopes.
- Orchestrator artifacts include diagnostic context, not only reason/name.
- Task cards store the envelope while showing a compact message.

### Slice E: Sidecar paths and docs

Files:

- `packages/overlay/src-tauri/src/main.rs`
- `packages/vscode-extension/src/sidecar/manager.ts`
- `packages/vscode-extension/src/extension.ts`
- `docs/product/en/operations/troubleshooting.md`
- `docs/product/zh-CN/operations/troubleshooting.md`

Tests:

- Tauri Rust test for preserving previous sidecar log path after crash.
- VS Code sidecar manager test for stable stdout/stderr files.
- Docs check after troubleshooting updates.

Acceptance:

- Managed sidecar failures show current and previous sidecar log paths.
- VS Code extension sidecar startup errors include stdout/stderr file paths.
- Troubleshooting docs name the actual log directory and `/log/tail` workflow.

## Non-Goals

- No retry gate, route bypass, or state-machine fix.
- No hidden UI-only message fork.
- No second legacy error source kept indefinitely.
- No high-cardinality labels for request/task/session/provider/model IDs.
- No empty-provider fallback for failed network/auth/schema discovery.

## Immediate Priority

The next code change should be Slice A plus the provider refresh part of Slice B.
That creates the diagnostic source of truth at the server boundary and fixes
the current Providers/model-selector class of failures first. Overlay rendering
then consumes the same envelope instead of inventing local error shapes.
