# Runtime Memory Retention Hardening - 2026-06-14

## Trigger

Task `tsk_ec2751690001KrOsfI2g4rMIhD` exposed a severe runtime retention
profile while serving `/home/yangheng/economy_2` through OpenCorvus on port
`7879`.

Read-only inspection and three independent agents agreed on the main shape:

- `127.0.0.1:7879` is owned by the OpenCorvus Bun serve process.
- The serve process RSS was about `10.4GB`, with private anonymous memory
  dominating the footprint.
- A short sample window did not prove continuing monotonic growth.
- Many browser MCP stdio sidecars, browser sidecars, and Chromium processes
  were still alive.
- `.opencorvus/runtime` and task trace artifacts were large enough to amplify
  prompt assembly, task archive, search, and debug surfaces.
- The `world-economy` React page did not contain a leak large enough to explain
  the process-level footprint.

This spec targets runtime retention, sidecar lifecycle, and artifact growth. It
does not prescribe deleting current user data as part of the fix.

Glossary used below:

- RSS: resident set size, the process memory currently resident in RAM.
- PID: operating system process id.
- MCP: Model Context Protocol.
- TTL: time to live.
- P0/P1/P2: priority levels, with P0 requiring the first implementation pass.

## Evidence

| Area              | Evidence                                                                                                                                                                                                                                                           | Decision                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Serve memory      | `bun --cwd packages/opencorvus ./src/index.ts serve --project-dir /home/yangheng/myhexin-local/opecorvus --hostname 127.0.0.1 --port 7879` had about `10.4GB` RSS and private dirty memory.                                                                        | Treat as P0 runtime retention. Add observability before relying on restart.                                      |
| Browser sidecars  | Multiple `/tmp/opencorvus-browser-mcp-node/stdio.mjs` Node processes and `src/mcp/browser/node-stdio.ts` Bun wrappers remained alive for hours. Other browser sidecar paths such as browser preview live sessions use the same Playwright/Chromium resource class. | Add owner-bound lifecycle, idle reaping, and terminal cleanup for all long-lived browser sidecars, not only MCP. |
| Trace             | `packages/opencorvus/src/trace/index.ts` defaults trace on, serializes full payloads, and writes each event to both a session/domain file and task rollup.                                                                                                         | Bound trace payloads and stop duplicating unbounded event bodies.                                                |
| Runtime artifacts | `/home/yangheng/economy_2/.opencorvus/runtime` was about `1.2G`; a goal worktree contained nested `.opencorvus/runtime` artifacts.                                                                                                                                 | Runtime paths must be hard-filtered in archive/copy/staging paths, not only ignored by Git.                      |
| Task archive      | `packages/opencorvus/src/engine/task-project-archive.ts` uses `git ls-files --cached --others --exclude-standard` without a second internal-runtime filter.                                                                                                        | Filter with `ProjectRuntimePaths.isInternalRuntimeRelativePath` before archiving.                                |
| Frontend page     | `world-economy` listener/observer code has cleanup; map construction is memoized derived state.                                                                                                                                                                    | Do not spend the first fix cycle on page code.                                                                   |
| UI showcase       | `loadResources`, chart demos, and demo timers have bounded-browser cleanup gaps.                                                                                                                                                                                   | Track separately as frontend hygiene; not the 10GB root cause.                                                   |

## Evidence Boundaries

The evidence supports two related but distinct risks:

| Risk                              | Supported by                                                                                                                                                                                                                                                               | What it does not prove                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Serve-process object retention    | Port `7879` was held by the Bun serve process; that process alone had about `10.4GB` RSS, high-water RSS about `10.7GB`, and private anonymous memory dominating the footprint. File descriptor and thread counts were not high enough to explain it as a descriptor leak. | It does not identify the exact retained object graph. Heap/external metrics and snapshots are still required.                                  |
| Sidecar/process lifecycle leakage | Many long-lived browser MCP wrappers, Node bundles, and Chromium processes were present. Their memory is process-level resource pressure and may also keep serve-side client objects alive.                                                                                | It does not by itself explain the parent Bun process RSS. Parent-process retention and child-process accumulation must be measured separately. |
| Runtime artifact amplification    | `.opencorvus/runtime` and trace artifacts were large, and nested runtime artifacts appeared in a goal worktree.                                                                                                                                                            | Disk size is not memory by itself; it becomes a memory risk when archive, prompt, trace, debug, or search surfaces load it eagerly.            |

Follow-up measurement must record the sample time, command, PID tree, parent
RSS/private dirty memory, sidecar/Chromium process counts, and sidecar/Chromium
aggregate RSS. Required commands for a reproducible capture include:

- `ss -ltnp '( sport = :7879 )'`;
- `ps -eo pid,ppid,pgid,sid,stat,rss,vsz,etime,cmd --sort=-rss`;
- `/proc/<serve-pid>/status` and `/proc/<serve-pid>/smaps_rollup`;
- `pstree -ap <serve-pid>` when available;
- `du -sh .opencorvus/runtime` and largest runtime file listing.

## Related Specs

This spec is not a rollback of earlier memory work. It narrows the next residual
risk after prior fixes:

- `specs/new-arch/2026-06-09-serve-memory-retention-p0.md` addressed earlier
  serve memory retention paths such as board cache / live replay pressure.
- `specs/new-arch/2026-06-10-serve-sse-abort-closewait-fix.md` addressed SSE
  abort / close-wait behavior.
- This spec focuses on remaining trace payload, browser sidecar lifecycle,
  runtime artifact, archive, and ownership cleanup boundaries.

## Priority

| Priority | Scope                                                                                                  | Reason                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| P0       | Runtime metrics, trace bounds, execution-flow archive bounds, browser sidecar owner/transport shutdown | These directly address the `7879` parent RSS investigation and the largest unbounded paths. |
| P1       | Runtime path hard filter, nested runtime artifact prevention, ownership cleanup candidate visibility   | These prevent repeated amplification across worktrees, archives, and future runs.           |
| P2       | UI showcase cleanup, demo timers, frontend hygiene                                                     | Worth fixing, but not explanatory for `7879` parent-process RSS.                            |

## Implementation Checkpoint

Checkpoint after first implementation pass:

| Area                                    | Status                                                                                                                                                                                                                                        | Evidence                                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Runtime process metrics                 | Implemented for `serve` process memory only. The sampler is configurable, unref'd, and stopped by `server.stop()`. It intentionally does not import browser session modules by default because those modules install process signal handlers. | `packages/opencorvus/src/runtime/memory-metrics.ts`; `packages/opencorvus/test/runtime/memory-metrics.test.ts`.           |
| Trace payload bounds                    | Implemented default `data:` URL redaction, event byte budget, content-hash payload blobs, single-blob quota, and per-task blob quota. `readTaskEvents` remains lazy and does not expand blobs.                                                | `packages/opencorvus/src/trace/index.ts`; `packages/opencorvus/test/session/trace-task-rollup.test.ts`.                   |
| Task project archive source filter      | Implemented `ProjectRuntimePaths.isSourceArchiveAllowed()` as a delegating helper and applied it to `task-project-archive` Git candidates.                                                                                                    | `packages/opencorvus/src/project/runtime-paths.ts`; `packages/opencorvus/src/engine/task-project-archive.ts`.             |
| Task archive execution-flow bounds      | Implemented bounded JSON export for interactions, artifacts, protocol events, trace, and transcript.                                                                                                                                          | `packages/opencorvus/src/engine/task-project-archive.ts`; `packages/opencorvus/test/server/task-project-archive.test.ts`. |
| Browser MCP stdio server cleanup        | Implemented stdio transport `onclose` cleanup using existing browser session shutdown primitives.                                                                                                                                             | `packages/opencorvus/src/mcp/browser/index.ts`; `packages/opencorvus/src/mcp/browser/sessions.ts`.                        |
| Browser MCP node launcher process group | Implemented non-Windows detached process group, stdin-close/SIGINT/SIGTERM termination, and SIGKILL escalation for the Node sidecar tree.                                                                                                     | `packages/opencorvus/src/mcp/browser/node-launcher.ts`; `packages/opencorvus/test/mcp/browser-node-launcher.test.ts`.     |

The checkpoint is intentionally not the full acceptance bar. It reduces the
largest unbounded trace/archive paths and one observed stdio sidecar leak path,
but it does not yet prove end-to-end browser process counts return to baseline
under load.

Second implementation pass checkpoint:

| Area                           | Status                                                                                                                                                                                                                       | Evidence                                                                                                                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Metrics registry               | Implemented provider registry with unregister support and per-provider failure isolation. Trace, host MCP, and browser preview live now publish in-memory snapshots.                                                         | `packages/opencorvus/src/runtime/memory-metrics.ts`; `packages/opencorvus/test/runtime/memory-metrics.test.ts`.                                                                                   |
| Host MCP lifecycle             | Implemented connection records that own both MCP `Client` and transport. Replacement, disconnect, failed tool listing, failed local startup, failed remote transport attempts, and state disposal close the owned transport. | `packages/opencorvus/src/mcp/index.ts`; `packages/opencorvus/test/mcp/host-connection-lifecycle.test.ts`.                                                                                         |
| Browser preview live lifecycle | Implemented owner metadata, activity timestamps, preview metrics, non-Windows detached process groups, and process-tree termination for close/force-kill.                                                                    | `packages/opencorvus/src/browser-preview/live.ts`; `packages/opencorvus/test/browser-preview/live-lifecycle.test.ts`.                                                                             |
| Runtime filter expansion       | Implemented `isSourceEnumerationAllowed()` and applied it to workspace export, acceptance package-root discovery, acceptance surface detection, and project-gate workspace export comparison.                                | `packages/opencorvus/src/project/runtime-paths.ts`; `packages/opencorvus/test/engine/workspace-export-runtime-filter.test.ts`; `packages/opencorvus/test/acceptance/runtime-path-filter.test.ts`. |
| Ownership candidate visibility | Implemented read-only `GET /project/current/cleanup-candidates` exposing ownership orphans and current-project WorktreeGC candidates without mutation.                                                                       | `packages/opencorvus/src/server/routes/project.ts`; `packages/opencorvus/test/server/project-routes.test.ts`.                                                                                     |

Remaining acceptance gap: a fresh-process load benchmark still needs to prove
that browser MCP, browser preview live, and Chromium descendant counts return
to baseline after deterministic load and idle cleanup. The current service must
not be used for that benchmark.

## Non-Goals

- Do not add a hidden restart-on-memory workaround as the primary fix.
- Do not delete existing `.opencorvus/runtime` directories automatically during
  normal serve startup.
- Do not turn off trace entirely; preserve debuggability with bounded payloads.
- Do not change `world-economy` feature code as part of the runtime fix.
- Do not introduce one-off cleanup scripts as the only protection. The fix must
  live in runtime lifecycle and data-path contracts.

## Required Invariants

- Every long-lived process spawned by OpenCorvus has a parent owner, task/session
  owner when applicable, and a terminal cleanup path.
- Every runtime-owned artifact path is excluded from source archive, goal
  worktree staging, build acceptance diffs, and prompt file sweeps by code-level
  checks.
- Trace writes are bounded by event size and are safe for multimodal payloads.
- Task/session debug surfaces read large trace/diff artifacts by tail, summary,
  index, or blob reference, never by unconditional full in-memory load.
- Runtime observability can prove whether a fix reduces RSS, heap, external
  memory, sidecar count, and artifact growth.

## Call Point Sweep

| Surface                                                                        | Current behavior                                                                                                                                                       | Decision                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/trace/index.ts`                                       | Trace is enabled by default. `recordLLMRequest` can preserve full messages and tools. `append` stringifies a whole event and writes it to both bucket and task rollup. | Add a payload budget, attachment redaction by default, blob sidecar storage for large payloads, and rollup summary/index mode.                                                                                                                        |
| `AgentTrace.readTaskEvents` / `readSessionEvents`                              | Reads a fixed tail and parses JSONL events into arrays.                                                                                                                | Keep tail reads, but ensure oversized payload references remain lazy and are not expanded by default.                                                                                                                                                 |
| `packages/opencorvus/src/mcp/browser/node-launcher.ts`                         | Spawns browser MCP node with inherited stdio and waits for exit.                                                                                                       | Register child process ownership and kill child tree when owner task/session/server lifecycle ends.                                                                                                                                                   |
| `packages/opencorvus/src/mcp/browser/sessions.ts`                              | Already has idle expiry for sessions/profiles and SIGINT/SIGTERM cleanup.                                                                                              | Reuse the existing cleanup primitives; add metrics and close hooks where they are missing instead of duplicating idle-reap logic.                                                                                                                     |
| `packages/opencorvus/src/mcp/browser/index.ts`                                 | Stdio server creates a server/transport and relies on process lifetime. HTTP closes per request transport/server on response close.                                    | Wire stdio transport close to the existing browser cleanup path. Do not treat one HTTP response close as a global browser-session shutdown; HTTP cleanup may close browser sessions only when the transport owns an explicit session-scoped resource. |
| `packages/opencorvus/src/mcp/index.ts`                                         | Local MCP clients are started from host-side `StdioClientTransport` with stderr capture.                                                                               | Bind the host MCP client lifecycle to sidecar ownership and dispose semantics; sidecar ownership is project-scoped unless a task/session-exclusive owner is recorded.                                                                                 |
| `packages/opencorvus/src/browser-preview/live.ts`                              | Runs a long-lived browser preview live sidecar with command/response state.                                                                                            | Apply the same owner-bound shutdown, idle timeout, stderr cap, and metrics contract used for browser MCP sidecars.                                                                                                                                    |
| `packages/opencorvus/src/browser/runtime/node-executor.ts`                     | One-shot node sidecars kill process groups on timeout/abort because non-Windows spawns are detached.                                                                   | Keep as reference behavior, but explicitly add process-group semantics to browser MCP launcher before relying on `kill(-pid)`.                                                                                                                        |
| `packages/opencorvus/src/engine/task-project-archive.ts`                       | Archives Git-included files.                                                                                                                                           | Filter internal runtime paths before adding files and before reporting file count.                                                                                                                                                                    |
| `packages/opencorvus/src/engine/task-project-archive.ts::collectExecutionFlow` | Adds task, board, runs, interactions, artifacts, protocol events, trace, and transcript JSON to the zip.                                                               | Bound execution-flow JSON and ensure `trace.json` exports summaries/references, not expanded trace blobs.                                                                                                                                             |
| Worktree copy/staging/export paths                                             | Some paths already call `ProjectRuntimePaths.isInternalRuntimeRelativePath`; not every archive/copy path does.                                                         | Centralize an internal-runtime file filter helper and reuse it in archive, export, acceptance diff, and staging flows.                                                                                                                                |
| Task runtime materialization                                                   | `TaskRuntimeMaterializer.materializeFrontendDesign` intentionally copies explicitly named task runtime evidence into a worktree view.                                  | Preserve explicit evidence materialization; only broad source sweeps, archives, diffs, and implicit prompt file collection apply the hard filter.                                                                                                     |
| Ownership recovery                                                             | Existing `Ownership.Worktree.orphans`, `Ownership.Process.orphans`, `Ownership.cleanup`, and `WorktreeGC` already define protected cleanup semantics.                  | Reuse those single sources; add candidate visibility without bypassing age, clean, no-in-transit, live-run, and path-root guards.                                                                                                                     |
| Scheduler / task queues                                                        | Logs show high-frequency poll activity near the high RSS incident.                                                                                                     | Add queue depth, poll interval, active wake, and inflight prompt counters to metrics. Do not change scheduling semantics in this pass unless metrics prove a busy loop.                                                                               |

## Design

### 1. Runtime Metrics First

Add low-overhead structured metrics emitted on a configurable interval while
`serve` is active:

- process: `rss`, `heapUsed`, `heapTotal`, `external`, `arrayBuffers`;
- task engine: active tasks, active runs, queued wakes, inflight prompts;
- browser sidecars: active MCP sidecars, active preview/live sidecars, active
  browser processes, profiles, sessions, total created sessions, idle sessions
  reaped;
- trace: events written, bytes written, oversized payload count, blob reference
  count;
- runtime artifacts: task runtime bytes and file count sampled lazily or on
  task terminal events.

Metrics must be log-friendly and machine parsable. They must not scan large
runtime directories on every tick. The metrics interval must be configurable and
the timer must be stoppable/unref'd so observability cannot become a new
long-lived noise source.

### 2. Bounded Trace Contract

Trace event payloads get a per-event byte budget. When the serialized payload
exceeds the budget:

- write metadata and a stable blob reference into the JSONL event;
- store the full payload under task runtime blob storage only if it fits the
  single-blob and per-task blob quotas;
- address blob payloads by content hash so repeated payloads dedupe;
- default UI/debug readers show summary fields and the blob reference;
- explicit debug endpoints can fetch the blob on demand.

Attachment and image data URLs are redacted by default. A development override
may preserve full payloads, but it must be opt-in, visible in metrics, and not
allowed to produce unbounded payloads in long-running serve mode.

Task rollup no longer duplicates full bucket events. It stores chronological
summary records keyed by bucket event identity and blob reference.

Trace blob retention rules:

- set a maximum single blob size and maximum per-task trace blob budget;
- when the task budget is exceeded, keep summary metadata and reject or truncate
  the full blob according to an explicit `truncated: true` marker;
- task archive, workspace export, and debug-copy surfaces do not include blob
  bodies by default;
- an explicit debug endpoint may fetch one blob by id, with authorization,
  response size limits, and no implicit expansion through task trace APIs.

### 3. Browser Sidecar Lifecycle Contract

All long-lived browser sidecars become owner-bound resources. This includes
browser MCP stdio/http sidecars and browser preview live sidecars:

- sidecar process metadata includes owner project, optional task, optional
  session, creation time, last active time, and transport kind;
- stdio transport close triggers session/profile/browser shutdown before exit;
- task/session cancellation and terminal events request sidecar shutdown for
  matching owners only when the sidecar is task/session-exclusive;
- idle profiles and sessions are reaped after a bounded TTL;
- a sidecar must refuse unbounded active browser sessions after a configured
  limit and return a clear tool error;
- server shutdown kills all owned sidecars by process group where supported.

This should reuse the child-tree termination pattern already present in
`browser/runtime/node-executor.ts`, with one important precondition:
`mcp/browser/node-launcher.ts` must spawn in a killable process group on
non-Windows before process-group termination can be relied on. Otherwise cleanup
can kill only the wrapper or Node bundle while leaving Chromium alive.

Do not kill a project-scoped MCP sidecar just because one task ends unless the
host MCP client records the sidecar as task/session-exclusive. Shared project
sidecars are cleaned up on transport close, explicit client dispose, idle
expiry, or server shutdown.

Terminal cleanup must be triggered from concrete lifecycle events, not from
best-effort log scanning. At minimum it needs hooks for:

- task terminal/cancel transitions;
- session terminal/cancel transitions;
- transport close for MCP stdio/http;
- browser preview live close/dispose;
- server shutdown.

### 4. Runtime Path Hard Filter

Promote the existing `ProjectRuntimePaths.isInternalRuntimeRelativePath` into
the single helper family for source-file inclusion decisions. If a new name is
needed, it must delegate to the existing helper rather than creating parallel
semantics:

```ts
ProjectRuntimePaths.isSourceArchiveAllowed(relativePath)
```

The helper rejects:

- `.opencorvus/runtime/`;
- `.opencorvus/worktrees/`;
- `.opencorvus-worktrees/`;
- `.opencorvus-meta.json`;
- any future OpenCorvus-owned runtime roots.

Use it in broad source enumeration surfaces:

- task project archive;
- workspace export;
- worktree staging;
- acceptance diff artifact inclusion;
- prompt/read surfaces that sweep project files for model context.

The filter is defense in depth. `.gitignore` remains useful, but correctness
must not depend on Git ignore state.

Explicit task runtime evidence remains allowed. For example,
`.opencorvus/runtime/tasks/<taskID>/frontend-design/...` can be materialized or
read when a task contract names that exact evidence path. The hard filter only
blocks implicit project-source enumeration, archive, diff, and broad prompt
sweeps from treating runtime artifacts as source files.

### 5. Bounded Task Archive Execution Flow

Task project archives have two independent inclusion paths:

- project source files from Git candidate enumeration;
- execution-flow JSON collected from task APIs.

Both must be bounded. `projectFileSelection` in the archive manifest must be
updated from the current plain `git ls-files --cached --others
--exclude-standard` wording to describe "Git candidates plus OpenCorvus runtime
filter". Execution-flow payloads must export trace, protocol events,
interactions, artifacts, and transcript in summary/tail/blob-reference form
instead of expanding full trace blobs or large payload fields into the zip.

The archive route must never be the path that rehydrates bounded trace blobs
back into one large in-memory object.

### 6. Orphan Detection Without Destructive Surprise

Startup recovery and task terminal events should identify:

- worktree markers whose owner PID no longer exists;
- process markers whose PID no longer exists;
- browser MCP sidecars whose parent owner is gone.

The first pass records cleanup candidates and exposes them through existing
project/worktree inspection surfaces. Detection and cleanup must reuse
`Ownership.Worktree.orphans`, `Ownership.Process.orphans`, `Ownership.cleanup`,
and `WorktreeGC` protections. Automatic deletion is allowed only when those
single-source guards prove OpenCorvus owns the path, the path is inside the
known runtime/worktree root, the worktree is clean, no live run references it,
and no in-transit operation owns it.

## Deepened Second-Pass Design

The next implementation pass must close the gap between local fixes and a
system-level memory contract. The design below is deliberately split by owner
surface so cleanup is triggered by real lifecycle events instead of inference
from logs or broad process scanning.

### A. Metrics Registry, Not Ad Hoc Counters

The first pass added process memory metrics. The second pass adds explicit
counter providers registered by modules that already own the resources:

| Provider             | Owner module                           | Required fields                                                                                                                    | Sampling rule                                                                                                                                       |
| -------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Trace                | `AgentTrace`                           | events written, bytes written, bounded events, blob refs, truncated payloads, per-task blob bytes when already computed by a write | Updated on write; sampled from in-memory counters only. No runtime directory scan on interval.                                                      |
| Browser MCP sessions | `mcp/browser/sessions.ts`              | active sessions, profiles, total created sessions, idle-expired sessions, current Playwright browser connected flag                | Provider function imported only by the browser MCP process itself or explicitly injected into metrics; do not import it from generic serve metrics. |
| Host MCP clients     | `mcp/index.ts`                         | connected local clients, connected remote clients, local stdio transports, failed clients awaiting reconnect                       | Updated inside `create`, `startConnection`, `disconnect`, and failed `listTools` paths.                                                             |
| Browser preview live | `browser-preview/live.ts`              | active live sidecars, pending commands, stderr bytes retained, idle closes, forced kills                                           | Updated by the `BrowserPreviewLiveSidecar` constructor, command lifecycle, close, and closeWithError.                                               |
| Queue/engine         | `engine/queue.ts` / task queue service | queued task count, active task count, live queue loops, in-flight prompt count if already tracked                                  | Use existing DB/query paths only on task terminal events or explicit diagnostics endpoint; interval log reads process-local counters.               |

Metrics become a registry of pull functions:

```ts
RuntimeMetrics.register({
  id: "browser-preview-live",
  snapshot: () => ({ active, pending, forcedKills }),
})
```

The registry must support unregistering providers. This prevents tests and
module reloads from accumulating stale closures. The server sampler logs one
object containing process memory plus provider snapshots. Provider failure is
reported as `{ error }` for that provider only; it must not stop the sampler.

### B. Host MCP Client Disposal Contract

Observed sidecars include two processes per built-in browser MCP: a Bun wrapper
(`node-stdio.ts`) and a Node bundle (`stdio.mjs`), with Chromium below the Node
sidecar. The host path in `packages/opencorvus/src/mcp/index.ts` owns the
`StdioClientTransport` and `Client`; the browser MCP server path owns browser
sessions after the transport is connected. Both halves need a concrete close.

Required contract:

- `McpState` stores a `connections` record, not just `clients`.
- A local connection record contains `client`, `transport`, `type`, `key`,
  `command`, `cwd`, `createdAt`, `lastUsedAt`, and `sharedProjectScoped`.
- `disconnect(name)`, failed `listTools`, failed tool calls that mark a client
  failed, and config replacement must close both `client` and `transport`.
- When replacing an existing client in `startConnection`, close the old
  connection record exactly once before installing the new one.
- Browser built-in MCP stays project-scoped by default. A task/session terminal
  event must not close it unless the connection explicitly records a
  task/session-exclusive owner.
- Close order is `client.close()` then `transport.close()`. Both failures are
  logged, but the connection is removed from state after close is attempted so
  no dead client can keep being reused.
- Stderr capture remains capped. The cap is part of the memory contract and
  must be tested.

Tests:

- local MCP connect stores a transport handle and `disconnect` closes it;
- replacing an existing local MCP closes the old transport before installing the
  new one;
- failed `listTools` closes both client and transport;
- browser built-in config remains project-scoped and is not closed by a random
  task terminal event.

### C. Browser Preview Live Sidecar Contract

`browser-preview/live.ts` already has a session map, idle timer, stderr cap, and
close path. The gaps are owner metadata and process-tree semantics.

Required contract:

- The session key stays `taskID:targetID:viewportID`, but the sidecar object also
  stores `{ taskID, targetID, viewportID, createdAt, lastActiveAt }`.
- Non-Windows spawns must use `detached: true` so forced close can kill the
  process group and any Chromium descendant, matching
  `browser/runtime/node-executor.ts`.
- `close()` must terminate the process tree, not only the immediate child.
- `closeWithError()` must reject pending commands, update metrics, and remove
  the session map entry exactly once.
- Idle close increments an `idleClosed` metric; SIGKILL escalation increments a
  `forcedKilled` metric.
- `closeBrowserPreviewLiveSessions()` remains the single server-wide cleanup
  entrypoint and must be called from the existing app/global routes shutdown
  hooks. Do not create a parallel global sidecar registry for preview live.

Tests:

- source-level lifecycle test continues to assert parent pipe teardown handling;
- unit test with a child-spawning fixture proves process-group close kills the
  descendant on Linux;
- repeated snapshot/input calls for the same tuple reuse one sidecar and update
  `lastActiveAt`;
- idle close removes the map entry and closes the process tree.

### D. Runtime Path Filter Expansion

The grep sweep shows current partial coverage:

- already filtered: `task-project-archive`, parts of build reporting in
  `build/agent.ts`, and `engine/persist.ts`;
- known remaining source-like surfaces: `engine/workspace-export.ts`,
  `engine/publisher.ts`, `acceptance/checks/project-gate.ts`,
  `acceptance/surface-detector.ts`, `acceptance/checks/discovery.ts`, and any
  prompt/file sweep that uses `Glob.scan`.

Required contract:

- Add one helper for broad source enumeration:

```ts
ProjectRuntimePaths.isSourceEnumerationAllowed(relativePath)
```

`isSourceArchiveAllowed()` must delegate to it. The name makes the helper usable
outside archives without creating another semantic source.

- `collectMainWorktreeDiff()` filters both `changedFiles` and patch hunks. A
  patch that contains only rejected runtime files becomes an empty patch with an
  explicit filtered count in metadata.
- Acceptance project-gate changed file discovery ignores rejected runtime paths
  before package-root discovery and check discovery.
- Surface detector ignores rejected runtime paths but still accepts explicit
  runtime evidence paths passed through task contracts.
- Prompt/file sweeps must use the same helper at the inclusion boundary, not
  after reading file contents.
- `TaskRuntimeMaterializer` and explicit task evidence reads remain exempt.
  This exemption must be represented as named functions or types, not an
  inline boolean flag.

Tests:

- workspace export with forced-added `.opencorvus/runtime` file excludes that
  file from `changedFiles` and patch body;
- project-gate package-root discovery ignores runtime-only changed files;
- surface detector ignores runtime-only changed files;
- explicit frontend-design evidence paths still resolve through existing
  materialization tests.

### E. Ownership Candidate Visibility

Ownership cleanup already has single-source primitives in
`engine/ownership.ts` and WorktreeGC has safety rules in `worktree/gc.ts`.
The second pass should not add another cleaner.

Required contract:

- Add an inspect-only route or task-debug field that exposes:
  `worktreeOrphans`, `processOrphans`, and WorktreeGC candidates.
- The inspect path is read-only. It never deletes, kills, or modifies markers.
- Automatic cleanup can only call existing `Ownership.cleanup()` or
  `WorktreeGC.apply()`; callers must pass the existing safe removal callbacks.
- The UI/debug surface must label candidates as candidates, not "deleted" or
  "safe to delete" unless the corresponding cleanup has already returned a
  success result.
- The route response includes the reason, marker path, owner PID, target path,
  and which guard would block deletion when known.

Tests:

- dead PID appears as a candidate;
- live PID is absent;
- out-of-root marker is not exposed as deletable;
- route inspection does not mutate marker counts.

### F. Load Benchmark With No Activity Timeout

The benchmark is required to prove the fix, not just unit behavior. It must use
the project rule that timeouts are based on no activity, not wall-clock from
process start.

Benchmark shape:

1. Start a fresh serve process on a random port, not the current user service.
2. Record baseline:
   - serve PID RSS/heap/external/arrayBuffers from runtime metrics;
   - child process tree count and RSS;
   - browser MCP sidecar count;
   - browser preview live sidecar count;
   - runtime directory bytes.
3. Run deterministic load:
   - connect built-in browser MCP, create/destroy browser sessions;
   - perform live preview snapshot/input cycles;
   - write several large trace payloads that cross event budget and blob quota;
   - export task project archive with forced-added runtime files;
   - call workspace export / acceptance surfaces after filter expansion.
4. Wait for idle cleanup using an activity gate that observes metric lines and
   sidecar close events.
5. Assert:
   - browser MCP and preview sidecar counts return to baseline;
   - Chromium descendant count returns to baseline;
   - trace blobs are bounded by configured quota;
   - archive/export outputs exclude runtime paths;
   - process memory slope after idle is within a documented threshold.

The benchmark must save its evidence artifact under task runtime and include
raw metric lines, PID tree snapshots, archive manifest, and assertion summary.
It must not delete the user's current task runtime or restart the user's active
service.

## Implementation Order

1. Completed first pass: process memory metrics, bounded trace writes, bounded
   task archive execution-flow exports, task archive source filter, browser MCP
   stdio server cleanup, and browser MCP node-launcher process-group close.
2. Add the runtime metrics registry and wire trace, host MCP client,
   browser-preview-live, and queue/engine provider snapshots.
3. Replace `McpState.clients`-only lifecycle with connection records that own
   both MCP `Client` and transport.
4. Apply process-tree lifecycle and metrics to browser preview live sidecars.
5. Expand runtime path filtering to workspace export, acceptance discovery,
   surface detection, and prompt/file sweeps while preserving explicit task
   runtime evidence materialization.
6. Add ownership candidate visibility through existing `Ownership` and
   `WorktreeGC` primitives.
7. Build and run the load benchmark with no-activity timeout semantics.
8. Fix UI showcase cleanup issues as a separate frontend hygiene task.

## Tests

- Trace unit tests:
  - data URLs are redacted by default;
  - oversized payloads produce blob references;
  - single-blob and per-task quotas prevent unbounded blob growth;
  - task rollup does not duplicate full payload bodies;
  - tail readers do not expand blob payloads by default.
- Browser sidecar tests:
  - stdio transport close shuts down browser sessions;
  - HTTP transport close shuts down browser sessions when appropriate;
  - host MCP client dispose tears down its local stdio wrapper / Node bundle /
    Chromium tree;
  - task/session cancel calls sidecar cleanup;
  - idle profile/session reap removes maps and closes Playwright contexts;
  - browser preview live close/dispose terminates its child process tree;
  - process group kill path is exercised on Linux.
- Archive/export tests:
  - `.opencorvus/runtime/foo`, `.opencorvus/worktrees/foo`,
    `.opencorvus-worktrees/foo`, and `.opencorvus-meta.json` are excluded even
    when passed in as candidate files;
  - a real Git fixture with bad `.gitignore`, `git add -f` runtime files,
    nested worktree paths, Windows separators, and symlinks still excludes
    runtime entries;
  - file counts reflect filtered files.
- Execution-flow archive tests:
  - `trace.json` exports summaries/references and does not expand bounded trace
    blob bodies;
  - protocol events, interactions, artifacts, and transcript exports obey size
    limits and include explicit truncation metadata.
- Runtime path regression tests:
  - workspace export, worktree staging, acceptance diff artifact inclusion, and
    broad prompt file sweeps reject internal runtime paths;
  - exact task runtime evidence paths still work through
    `TaskRuntimeMaterializer` and explicit task-contract reads.
- Ownership tests:
  - dead owner PID creates a cleanup candidate;
  - live owner PID is preserved;
  - paths outside the runtime/worktree root are never deleted automatically.
  - cleanup candidate visibility is exposed through the chosen project/worktree
    route without bypassing `Ownership` and `WorktreeGC` guards.
- Observability tests:
  - metric event contains process, task, browser MCP, and trace counters;
  - directory byte sampling is not performed on every metric tick.
  - metrics interval is configurable, unref'd/stoppable, and produces
    machine-parseable failure evidence.
- Load benchmark:
  - start serve;
  - record baseline process memory, sidecar/Chromium counts, and runtime bytes;
  - run a fixed loop of browser session create/destroy, large trace writes,
    task archive export, and nested runtime fixture handling;
  - record during-load and idle-after-load metrics;
  - assert sidecar/Chromium counts return exactly to baseline after idle
    cleanup, and process `rss`, `heapUsed`, `external`, and `arrayBuffers` stay
    within documented delta or slope thresholds for the fixture.
- World economy smoke:
  - existing page behavior still loads and renders after runtime hardening.

## Acceptance

- A defined long-task fixture emits periodic memory and lifecycle metrics
  without requiring external shell inspection. The fixture records start time,
  duration, browser operation count, trace payload size, archive count, and
  post-idle wait duration.
- Trace output remains useful but no longer writes unbounded full multimodal
  payloads into both session and task JSONL streams. Blob storage is deduped,
  quota-bound, and excluded from archive/export/debug-copy expansion by
  default.
- Browser MCP, browser preview live, and Chromium counts return to baseline
  after task/session cancellation, explicit close/dispose, or terminal
  completion.
- Task archive and worktree staging cannot include `.opencorvus/runtime`
  contents even if Git ignore state is wrong or a nested worktree is present.
- Task project archive execution-flow JSON cannot re-expand bounded trace blobs
  or large protocol/interactions/artifacts payloads into an unbounded zip.
- Dead ownership markers are visible as cleanup candidates, and safe cleanup
  refuses paths outside OpenCorvus-owned runtime roots while preserving live
  owner markers and existing `WorktreeGC` protections.
- Existing `world-economy` task behavior is unchanged.
