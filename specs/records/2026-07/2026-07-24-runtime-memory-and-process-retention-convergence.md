# Runtime Memory and Process Retention Convergence — 2026-07-24

## Status

Implementation is in progress. Stages 0–3 have landed in the working tree, the
three fixed-threshold controls pass, and the focused packaged macOS workload
passes. Stage 4 is not accepted until the eight-hour timer-driven soak
completes; the short run is evidence of lifecycle correctness, not a claim that
the overnight leak is already fully accepted.

The plan supersedes the unfinished acceptance portion of
`2026-06-14-runtime-memory-retention-hardening.md` for the current codebase. It
does not undo the earlier live-replay and board-cache fixes.

Glossary:

- RSS: Resident Set Size, the physical memory resident for one process.
- LLM: Large Language Model.
- MCP: Model Context Protocol.
- LSP: Language Server Protocol.
- PID: Process Identifier.
- PPID: Parent Process Identifier.
- WAL: Write-Ahead Log, SQLite's append-oriented transaction log.
- E2E: End-to-End.
- P0/P1: priority zero/one, with P0 completed first.

## Recall

### User request

1. Determine which problems caused the OpenCorvus coalition to reach 18 GB
   overnight.
2. Provide a staged plan that fixes root causes and proves the fix under a real
   overnight workload.

### Acceptance requested by this plan

- Separate the desktop Overlay, serve process, Browser MCP/Node/Chromium
  descendants, LSP descendants, and disk artifacts instead of adding
  incompatible memory counters.
- Stop full LLM prompt/history capture and duplicate full trace bodies.
- Make every long-lived child process have one durable owner until its real
  descendants have exited.
- Preserve compaction safety while classifying missing boundaries precisely;
  repair compaction creation/persistence only if an eligible history is proven
  to lack its structured boundary.
- Prove plateaued parent memory, exact descendant return-to-baseline, bounded
  trace growth, and bounded disk writes with a fresh packaged macOS process.
- Do not use a restart, memory threshold, periodic PID sweep, automatic runtime
  deletion, or a kill-on-pressure gate as the fix.

### Hard constraints

- Preserve all parallel uncommitted work. In particular, the current
  `session/llm.ts` and `trace/index.ts` diff that replaces full session LLM
  prompts with `requestMessageID` is protected concurrent work and must be
  reviewed and completed, not overwritten.
- Do not restart, refresh, close, or kill the user's running OpenCorvus/Overlay
  processes without explicit authorization.
- Run benchmarks in a fresh isolated service on a random port and a disposable
  project. Do not use the current service.
- Benchmark waits use a timer wake-up and bounded snapshots, not continuous log
  listening.
- Physical footprint/RSS, allocator counters (`heapUsed`, `external`,
  `arrayBuffers`), child-process RSS, and disk bytes remain separate series.
- No fallback, compatibility reader, second lifecycle source, state-machine
  gate, or automatic deletion is introduced.

### Materials read

- `specs/records/2026-06/2026-06-09-serve-memory-retention-p0.md`
- `specs/records/2026-06/2026-06-14-runtime-memory-retention-hardening.md`
- `/Library/Logs/DiagnosticReports/opencorvus_2026-07-23-150039_YANG-HENGdeMac-mini.diag`
- `/Users/yangheng/.local/share/opencorvus/log/2026-07-23T102557-20232-1.log`
- current trace, session compaction, Browser MCP launcher, process supervisor,
  LSP, server trace routes, and their focused tests
- full-repository searches for every symbol and route listed in the call-point
  sweep below

### Independent-agent feedback

No independent agent was requested or authorized for this planning turn, so no
sub-agent was created. The main agent performed the repository-wide call-point
sweep and evidence reconciliation directly.

## Evidence and boundaries

| Layer | Observed evidence | Supported conclusion | Not supported |
| --- | --- | --- | --- |
| Packaged `opencorvus` process | macOS diagnostic report records physical footprint `401.47 MB -> 3797.53 MB` and `2147.50 MB` file-backed writes over `8651s`. | The native serve process grew materially and produced severe write amplification. | The report does not prove that the Overlay WebView itself consumed 18 GB. |
| Runtime allocator telemetry | At log line `258487`, `rss=639,451,136`, `heapUsed=11,658,798,510`, `external=9,476,530,302`, `arrayBuffers=705,088,981`; trace reports `734,819,520` bytes written. | Bun/JavaScriptCore experienced extreme allocation pressure while trace writes were already hundreds of MB. | `heapUsed + external` is not physical memory and must not be added to RSS or macOS footprint. |
| Trace/runtime artifacts | `crypto3/.opencorvus/.r` is `2.3G`, `prism/.opencorvus/.r` is `883M`; individual task `trace.jsonl` files exceed `100 MB`, with the largest observed file about `247 MB`. Current `append()` writes the same line to a bucket and task rollup. | Full-history serialization and duplicate bodies amplify allocations, writes, later reads, and archive/debug work. | Disk size alone is not a heap leak. It becomes memory pressure when code constructs, serializes, or eagerly reads the payload. |
| Browser MCP lifecycle | Four shutdown records at log lines `284658-284661` report `SIGTERM terminate failed: kill() failed: EPERM`. The incident inspection found many wrapper, Node, Playwright profile, and Chromium descendants, including PPID 1 orphans. | Browser MCP termination can lose ownership while descendants remain alive. This is a real process/resource leak. | Descendant RSS does not explain all parent-process growth and must be reported separately. |
| LSP lifecycle | Log lines `267604-267605` report TypeScript and ESLint shutdown failures with `EPERM`. `disposeClient()` catches the failure, while idle pruning removes clients from the retained list before disposal succeeds. | LSP cleanup can hide failure and discard ownership evidence before real exit. | The two LSP failures alone do not explain the full 18 GB. |
| Compaction | The incident log contains `103` occurrences of “no structured compaction boundary covers old tool output.” Code-path and fixture inspection show that `prune()` is also called for ordinary never-compacted sessions and completed compactions with no covered interval. | The old log message conflated expected no-ops with invalid boundaries, so it was not proof of retained eligible history. The cases require separate telemetry. | No upstream compaction creation/persistence defect was proven in the incident evidence, and it is not safe to prune arbitrary old output without a valid boundary. |
| Overlay | The inspected Overlay process had a small footprint relative to the serve/child coalition. | The frontend is not the first repair target. | This does not prove every future frontend surface is leak-free. |

The user-observed 18 GB is therefore a coalition high-water mark rather than one
single additive counter. The evidence supports two coupled retention defects
and one observability defect:

1. parent-process allocation retention and write amplification around full
   request/history tracing and later trace consumption;
2. child-process lifecycle failure that leaves Browser MCP/Node/Chromium and
   LSP descendants without a live owner;
3. compaction logging that labeled ordinary uncompacted/no-covered-history
   calls as missing-boundary failures, obscuring whether any eligible history
   was actually retained.

## Full call-point sweep

| Surface | Current call points | Decision |
| --- | --- | --- |
| `AgentTrace.recordLLMRequest` | `session/llm.ts`; trace rollup and server isolation tests | Keep the session LLM chokepoint, but persist only a durable request-message reference and physical provider/tool facts. Never reconstruct a second full prompt copy for trace. |
| `AgentTrace.recordHelperLLMCall` | `task-api/index.ts` follow-up generation; `project/vcs-commit-message.ts`; trace tests | Replace full helper `messages/schema/output` capture with durable input/output references plus a bounded diagnostic summary. |
| `AgentTrace.append` | Internal trace writers only | Store one canonical event body. Session/domain/task projections become bounded indexes or filtered views, not duplicated JSON bodies. |
| Trace read API | `task-api/index.ts` summary/detail helpers; `server/routes/orchestrator.ts` task trace route; Overlay consumes the route | Introduce bounded pagination/tail reads over the one canonical source. No route may parse an unbounded task trace into one array. Regenerate route/OpenAPI clients if the contract changes. |
| `SessionCompaction.prune` | `session/loop.ts` at two lifecycle points; focused compaction tests | Keep structured-boundary validation. Repair compaction creation/persistence so every eligible history has an authoritative boundary before pruning. |
| `BrowserMCPNodeLauncher` | CLI `mcp` command, `mcp/browser/node-stdio.ts`, serve-command/session-proxy/launcher tests | Replace direct `ChildProcess` plus private negative-PID signaling with the canonical supervised process handle and one owner-completion promise. |
| Browser MCP session cleanup | `mcp/browser/index.ts`, `mcp/browser/sessions.ts`, host `mcp/index.ts` connection records | Close transport, browser sessions/profiles, Node wrapper, and Chromium descendants through one ordered owner chain. Do not add a separate orphan sweeper. |
| `ProcessSupervisor` | MCP host, LSP stdio, PTY bridge, inactivity process, utility process, plugin host, browser node executor | Extend the canonical abstraction only where the macOS reproduction proves a missing primitive. Do not duplicate process-group algorithms in each caller. |
| LSP state/disposal | tools `read`, `write`, `edit`, `apply_patch`, `lsp`; prompt parts; debug CLI; file/app routes; `createInstanceState` disposal | A failed dispose remains owned and visible until terminal exit or an explicit terminal cleanup error. Never clear `clients` first and swallow the failure. |
| Browser Preview processes | Current one-shot evidence/layout/scroll runner paths; the former long-lived PNG live sidecar is retired | Audit the one-shot runners against the shared supervisor contract, but do not preserve the obsolete long-lived target from the June plan. |
| Runtime metrics | server startup/stop and runtime metric tests; trace and MCP providers | Add attribution counters, not new control flow: canonical trace bytes, log bytes, SQLite/WAL bytes, live supervised owners, cleanup failures, descendants, and compaction outcomes. |
| Global task/trace routes | `/task`, `/global/tasks`, task-list SSE, `/task/:taskID/trace`, task trace summary/detail helpers | Keep task-list change notification as the list refresh source. Measure request/response allocation before changing scheduling or polling behavior; no speculative poll gate. |

## Staged implementation plan

### Stage 0 — Reproducible baseline and ownership map

Priority: P0. Expected duration: one focused implementation day.

Deliverables:

1. Add a deterministic memory/lifecycle benchmark that starts a fresh packaged
   macOS serve process on a random port with a disposable project.
2. Define one benchmark configuration source for warm-up, operation count,
   snapshot cadence, idle settle, and overnight duration.
3. Capture, at every checkpoint:
   - packaged process `footprint`, RSS, `heapUsed`, `heapTotal`, `external`, and
     `arrayBuffers` as separate fields;
   - supervised owner IDs and PID/PPID/process-group tree;
   - Browser MCP wrapper, Node, browser profile, and Chromium counts/RSS;
   - LSP client/server counts/RSS;
   - canonical trace events/bytes, log bytes, SQLite database/WAL bytes, and
     runtime directory bytes;
   - compaction eligible/created/pruned/skipped counters with structured reason.
4. Reproduce one Browser MCP create/use/close cycle and one TypeScript/ESLint
   LSP create/use/dispose cycle on packaged macOS without touching the current
   service.
5. Save the immutable baseline evidence under the benchmark task runtime.

Exit criteria:

- the benchmark reproduces either the `EPERM` path or proves the exact process
  group/owner mismatch that led to it;
- every sampled PID is attributable to one owner or explicitly classified as
  pre-existing baseline;
- three no-op control runs establish the allocator and footprint variance used
  by Stage 4; implementation code cannot loosen that recorded threshold.

Stage 0 must finish before lifecycle code is selected. `EPERM` is evidence, not
the root cause by itself.

### Stage 1 — Remove full-history trace retention and duplicate bodies

Priority: P0. Expected duration: one to two focused days.

Deliverables:

1. Complete and test the protected concurrent change that makes session LLM
   trace events reference `requestMessageID` instead of copying system prompts
   and all messages.
2. Apply the same single-reference contract to helper LLM calls; the helper
   caller persists the durable request/result fact, and trace stores only its
   identity plus bounded physical diagnostics.
3. Replace bucket-plus-task duplicate bodies with one canonical per-task event
   body and bounded session/domain projection metadata.
4. Make task/session trace reads paginated or tail-bounded. Remove eager
   `read every line -> parse every event -> return one array` behavior from
   interactive routes and archive/debug consumers.
5. Count allocations and bytes before/after bounding at the writer so a large
   prompt is never deep-cloned/stringified merely to decide that it is too
   large.

Required regression tests:

- a growing conversation does not increase `llm_request` event size;
- helper calls do not persist full prompt, schema, or output bodies;
- one logical event creates exactly one full body;
- session/domain/task reads preserve ordering and identity without duplicate
  body storage;
- route pagination/tail limits reject unbounded expansion;
- trace remains useful when attachment and tool-result payloads are large.

Exit criteria:

- trace bytes grow with event count and bounded diagnostic size, not with total
  conversation history;
- the deterministic fixture writes one full event body per logical event;
- repeated trace reads have a bounded response/allocation envelope;
- no “disable trace” flag is needed to pass.

### Stage 2 — Converge child-process ownership and real termination

Priority: P0. Expected duration: two to three focused days.

Deliverables:

1. Make Browser MCP wrapper, Node bundle, Playwright profile, and Chromium
   descendants one owner chain backed by the canonical `ProcessSupervisor`
   handle.
2. Replace `SIGTERM`/`SIGINT` handlers that call `process.exit()` in `finally`.
   A wrapper reaches terminal success only after descendant absence is proven.
   Cleanup failure remains a visible non-terminal owner failure rather than
   silently orphaning descendants.
3. Make stdin close, transport close, session/task cancellation, server
   disposal, explicit MCP disconnect, and normal completion call the same
   idempotent owner cleanup promise.
4. Repair LSP idle and instance disposal so state entries are removed only
   after real client/server exit. Aggregate and surface shutdown failures.
5. Audit the one-shot Browser Preview, PTY, plugin host, and generic utility
   process callers against the same contract; change only callers that violate
   it.

Required regression tests:

- a real macOS child with a grandchild exits fully on normal close, stdin close,
  `SIGTERM`, session cancellation, and server disposal;
- packaged Browser MCP create/use/close returns wrapper, Node, Chromium, and
  profile counts exactly to baseline;
- termination error stays attributable and cannot be converted to successful
  wrapper exit;
- LSP idle prune/dispose preserves failed owners and removes successful ones;
- full test-process exit is asserted, not only signal delivery or a mocked
  callback.

Exit criteria:

- zero attributable PPID 1 Browser MCP/Node/Chromium/LSP descendants after each
  settled cycle;
- zero hidden `EPERM` cleanup warnings;
- every cleanup failure names the owner, PID tree, operation, and terminal
  outcome;
- no periodic PID scan or unrelated-process kill is required.

### Stage 3 — Restore safe compaction and attribute write amplification

Priority: P1 after Stages 1–2. Expected duration: one to two focused days.

Deliverables:

1. Trace every path that reaches `SessionCompaction.prune` without an eligible
   structured boundary.
2. Classify `never_compacted`, `no_covered_history`, and
   `invalid_boundary` separately. Repair the authoritative compaction
   create/persist contract only if an eligible history reaches
   `invalid_boundary`. Keep pruning refusal when the boundary is invalid or
   absent; do not add age- or keyword-based fallback deletion.
3. Measure trace, structured log, SQLite database, and WAL writes separately.
   Use the diagnostic report's SQLite checkpoint stack as a lead, not as proof
   that SQLite is the sole writer.
4. Remove only write duplication proven by those counters. Preserve one
   canonical durable fact and project summaries/references from it.
5. Keep historical runtime data intact. Any later cleanup of existing artifacts
   or orphan processes is a separate, explicit operator-authorized action.

Required regression tests:

- ordinary uncompacted and no-covered-history calls are expected no-ops, while
  every eligible compaction exposes one valid boundary before prune;
- invalid/missing boundaries remain a visible hard diagnostic and never cause
  destructive pruning;
- repeated compaction removes old completed tool output while preserving the
  anchor, summary, recent tail, and protected tools;
- subsystem byte counters reconcile with produced files within documented
  buffering variance;
- a fixed workload no longer produces body-level write duplication.

Exit criteria:

- zero unexplained invalid-boundary skips for eligible benchmark sessions;
- completed old tool output stops accumulating after valid compaction;
- trace/log/database/WAL growth is attributable and proportional to durable
  events, not repeated full history.

### Stage 4 — Packaged macOS soak, overnight proof, and release decision

Priority: terminal acceptance. Expected duration: a focused run plus one
overnight window.

Run order:

1. focused unit/integration suites for trace, compaction, MCP launcher/host
   lifecycle, LSP lifecycle, process supervisor, route contracts, and archive
   reads;
2. packaged macOS smoke with repeated Browser MCP and LSP cycles;
3. fixed-load soak long enough to cover warm-up and multiple idle cycles;
4. eight-hour overnight packaged soak, scheduled with a timer wake-up;
5. independent second review of code, tests, raw evidence, and package behavior.

Terminal acceptance:

- Browser MCP wrapper, Node, Chromium, profile, and LSP counts return exactly to
  their pre-cycle baseline after every terminal settle.
- No attributable PPID 1 orphan and no hidden cleanup error remains.
- Parent physical footprint and RSS stop showing monotonic growth after warm-up
  and stay within the Stage 0 control-derived variance envelope during
  equivalent idle windows. Forced garbage collection is diagnostic only and
  cannot be a pass condition.
- Allocator telemetry is reported separately and does not show unbounded
  history-proportional growth across equal workloads.
- Canonical trace size is independent of cumulative prompt history and contains
  no duplicate full body.
- Eligible compaction reaches a valid boundary and prunes covered old tool
  output; ordinary uncompacted sessions are not reported as failures.
- Disk-write volume is explained by subsystem counters and no longer repeats
  full trace/history bodies.
- The macOS diagnostic, benchmark report, PID snapshots, file-size deltas, and
  assertion summary are retained as task-scoped evidence.

If any terminal criterion fails, the release is explicitly not accepted under
rule 28b. A restart, lower trace quota, shorter benchmark, or cleanup sweep
cannot convert failure into acceptance.

## Implementation checkpoint — 2026-07-24

- Trace now stores one canonical task event body. Session/domain reads filter a
  two-megabyte bounded tail, and session LLM/helper events store durable request
  references instead of full prompts, schemas, histories, and outputs.
- Browser MCP, generic supervised commands, and LSP use one
  `ProcessSupervisor` ownership contract. POSIX cleanup snapshots the owned
  root's descendants and process-group members while the handle is live, then
  signals and verifies those exact PIDs directly. It does not depend on a
  negative-PGID signal after the root has exited.
- LSP owners are removed only after shutdown succeeds. Failed idle/dispose
  owners remain registered and their errors propagate for retry.
- Compaction prune telemetry distinguishes expected `never_compacted` and
  `no_covered_history` no-ops from invalid structured boundaries. Invalid
  boundaries remain non-destructive warnings.
- The first fixed packaged run reproduced the prior macOS failure precisely:
  TypeScript's direct language-server child exited, tsserver/typingsInstaller
  remained in its PGID, and the old group signal failed with `EPERM`.
- After the direct-PID ownership repair, the identical packaged workload passed:
  three Browser MCP cycles each returned two Node/wrapper and seven Chromium
  processes to zero; three TypeScript plus ESLint cycles returned all LSP
  descendants to zero; all 56 observed workload PIDs were absent after settle.
- In the six equal post-workload samples, serve physical footprint stayed at
  310,378,496 bytes. SQLite was 802,816 bytes, WAL was zero, and no trace event
  was produced by this no-conversation workload. These values are kept as
  separate series and are not summed.
- Raw short-run evidence is in the task runtime at
  `.scratch/runtime-memory-soak-evidence/2026-07-24T03-18-33.390Z-43501-run-1/`.
- The three configured no-op controls all passed with zero remaining
  attributable processes. Their immutable physical-footprint envelope is
  308,281,344–322,961,408 bytes; final values were 308,281,344, 314,572,800,
  and 313,524,224 bytes. The repair workload's 310,378,496–315,621,376-byte
  range is inside that control envelope. Workload acceptance uses the immutable
  322,961,408-byte control ceiling; lower samples are permitted because
  additional memory reclamation is not a leak.
- Raw control reports are in the task runtime at
  `.scratch/runtime-memory-soak-evidence/2026-07-24T03-24-38.072Z-60171-run-1/`,
  `.scratch/runtime-memory-soak-evidence/2026-07-24T03-24-59.859Z-60171-run-2/`,
  and
  `.scratch/runtime-memory-soak-evidence/2026-07-24T03-25-21.531Z-60171-run-3/`.
- The final short workload consumes those three control reports as immutable
  acceptance input. All six post-workload samples were 306,184,192 bytes,
  below the 322,961,408-byte ceiling; all 56 observed PIDs were absent after
  settle, with zero errors. Its raw report is
  `.scratch/runtime-memory-soak-evidence/2026-07-24T03-38-08.105Z-94462-run-1/report.json`.
- After adding interrupted-`ps` retry evidence and requiring raw LSP stdio
  `close`/pipe release, the current source was rebuilt and the packaged
  workload rerun. Its six steady samples were all 307,232,768 bytes; all 55
  PIDs observed in this run were absent, errors and remaining processes were
  zero, and the immutable control ceiling still passed. The final short report
  is
  `.scratch/runtime-memory-soak-evidence/2026-07-24T03-56-57.036Z-50814-run-1/report.json`.

Remaining terminal work:

1. Run the eight-hour packaged workload with timer wake-up.
2. Perform the independent second review and make the release decision from
   the retained raw reports.

## Dependency and delivery order

| Order | Stage | May run in parallel | Blocks |
| --- | --- | --- | --- |
| 1 | Stage 0 baseline | Trace/source call-point inspection and test-fixture authoring | All implementation choices and thresholds |
| 2 | Stage 1 trace | Stage 2 after the Stage 0 owner map exists | Stage 3 write attribution and Stage 4 |
| 2 | Stage 2 lifecycle | Stage 1 after the Stage 0 reproduction exists | Stage 4 |
| 3 | Stage 3 compaction/writes | Compaction and byte-attribution tests may proceed in parallel | Stage 4 |
| 4 | Stage 4 packaged acceptance | Focused suites may run in parallel; soak is one controlled workload | Release decision |

## Explicit non-goals

- No modification to the current running OpenCorvus/Overlay process.
- No deletion of existing runtime files or old task records.
- No killing of currently orphaned processes without explicit user approval.
- No UI work or screenshot requirement unless implementation changes a visible
  diagnostics surface.
- No speculative scheduler/polling rewrite without Stage 0 allocation evidence.
- No compatibility path for old trace body duplication in this unpublished
  project; the new canonical trace format replaces it directly.

## Plan validation

- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- second read-through against the current dirty diff and the complete
  call-point sweep
- stage and commit only this record and its two indexes
