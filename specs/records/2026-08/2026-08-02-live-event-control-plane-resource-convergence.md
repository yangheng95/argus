# Live Event Control-Plane Resource Convergence

## Recall

- User request: explain why `Live event stream connecting` becomes nearly certain as projects accumulate, then systematically repair the problem rather than masking the banner.
- Acceptance:
  1. Registered historical projects do not imply an unbounded set of initialized Project runtimes.
  2. Restart recovery initializes only directories that own started incomplete Tasks, and idle initialized runtimes converge to a configured bound without interrupting active leases.
  3. Task conversation hydration does not scan transcript-only Part rows merely to derive the compact Agent activity projection.
  4. Overlay distinguishes backend reachability from Server-Sent Events (SSE) reachability and presents the observed failure honestly.
  5. A production-sized database copy keeps `/global/health`, `/global/tasks`, `/work-ledger`, and Task conversation hydration responsive under concurrent reads; the real page is visually inspected with screenshots.
- Hard constraints: preserve all unrelated changes; no reset, stash, new worktree, compatibility path, fallback, gate, database migration, live-process restart, or UI automation test. Non-UI contracts receive positive tests. UI acceptance uses a real page and manual screenshot review only.
- Read records:
  - `specs/records/2026-07/2026-07-24-runtime-memory-and-process-retention-convergence.md`
  - `specs/records/2026-06/2026-06-19-deep-performance-investigation.md`
  - `specs/records/2026-08/2026-08-02-project-bootstrap-recovery-lifecycle-reentry-repair.md`
  - `specs/current/architecture/02-data.md`, `03-control.md`, `07-panel.md`, and `99-principles.md`
- Live evidence, read-only:
  - packaged sidecar PID 57829 listened on port 7878 but could not accept `/global/health`; sampling placed its main thread in `sqlite3_step` while CPU remained near one core.
  - the live SQLite file was about 326 MB; `part` accounted for about 242 MB across 67,689 rows. The process footprint had reached 10.2 GB with a 14.3 GB peak.
  - logs contained 23 `creating instance` and 9 `disposing instance` occurrences, proving initialized runtime retention rather than merely a visual reconnect defect.
  - a cycle-safe read found no current Session parent cycle, so recursive-query risk is not being presented as the proven trigger.
- Isolated production-copy benchmark before repair: `/global/health` 0.02 s, `/global/tasks` 0.03 s, `/work-ledger` 0.04 s; 24 concurrent Task hydrations delayed otherwise trivial health reads up to about 0.46 s. Individual Task hydrate payloads reached 5.6 MB.
- Whole-repository call-point audit:

| Contract | Call points and disposition |
| --- | --- |
| `recoverStartedTaskExecutions` | `cli/cmd/serve.ts` is the only production caller; keep exact started-incomplete discovery, then converge idle runtimes after recovery. `engine/host-recovery.test.ts` owns its positive contract. |
| `Instance.provide*` | Server middleware, Session/Task execution, queue/wake, SSE identity, configuration, CLI, MCP, agent and worktree callers all share `project/instance.ts`. Keep active leases authoritative; add convergence at the shared cache owner rather than caller-specific disposal. |
| `Instance.dispose*` | Explicit project deletion, destructive database routes, CLI shutdown/tests remain explicit full disposal. Cache convergence reuses the same `State.dispose` path and never deletes Project/Task/Session history. |
| `latestConversationAgentActivityBySession` | Only Task conversation hydration calls it. Replace paging across transcript-only history with indexed, per-activity-type candidate reads and retain the exact latest 24 projected activity facts. Corrupt rows whose raw type is an activity type still use the canonical part-error parser; transcript-only corruption remains owned by the full transcript route. |
| recursive Session CTEs | `engine/store.ts`, `task-session-lineage.ts`, `describe.ts`, `orchestrator/task-event.ts`, and `engine/task-event.ts` remain separately owned; no current cycle was found and this repair does not claim those queries caused the incident. |
| connection presentation | `services/connection.ts` owns backend health, `services/sse.ts` owns selected stream liveness, `store/app.ts` and `store/messages.ts` own their separate signals, and `ConnectionBanner.tsx` is the single banner projection. Preserve two sources and label them accurately. |

- Independent-agent feedback: the first implementation was rejected because synchronous pre-request disposal could block an unrelated request, concurrent convergence was not serialized, raw-type ranking could omit projectable facts, the window query scanned full Sessions, rollback entries were skipped, and synchronous stream-open failure could leave `sseExpected` stuck. The implementation below incorporates those findings.

## Root Cause Chain

1. Project history and live Project runtime are not separated by a bounded ownership policy. `Instance` caches every discovered/initialized directory until explicit global/project disposal.
2. Each initialized entry owns Plugin, Language Server Protocol (LSP), FileWatcher, File, Version Control System (VCS), schedulers, channels, and other State resources. More touched or recovered projects therefore monotonically increase resident runtime and child-process pressure.
3. Task hydration separately derives compact Agent activity by paging backwards through all Part types for every Agent Session. Large tool/reasoning histories amplify synchronous SQLite work on the same event loop that accepts health and SSE requests.
4. When that event loop is delayed or wedged, health and stream connection fail together. The banner currently combines those independent facts and can describe backend unreachability as a live-stream connection attempt.

## Implementation

1. Make the shared Instance cache record recency and expose one serialized configured convergence operation. It disposes least-recently-used entries only when they have no active lease, retries rollback cleanup through the canonical State disposal path, and reports the exact retained/active result. Active Task, request, and stream owners remain untouched.
2. After an ordinary project-scoped request owner closes, coalesce convergence into at most one running operation plus one dirty rerun signal, without awaiting unrelated Project disposal; also converge after startup recovery completes. A request racing with same-Project eviction retries entry preparation after replacement. Slow or failed disposers are reported per directory and do not prevent later idle candidates from converging. The configured maximum and disposal timeout are server resource parameters, not Project-count or memory-pressure gates.
3. Add the canonical raw Part type/time expression index. Compact Agent activity loading reads the first bounded page for Text, Tool, Patch, File and part-error in one compound indexed query per Session, then uses indexed keyset continuation only for a type whose page contained non-projectable values. It globally caps each Session at 24 actual facts. Do not change canonical full Session transcript routes.
4. Give backend and selected-stream failures separate banner labels and status attributes. Health failure must never be called only an SSE connection attempt.
5. Update current architecture for the runtime cache ownership, bounded activity projection, and honest connection semantics.

## Verification

- Focused positive Instance-cache convergence and MessageStore activity-projection tests.
- Existing host-recovery, server Task-conversation, typecheck, API route, docs, i18n, and historical-doc-link checks relevant to touched paths.
- Repeat production-copy endpoint timings and concurrent health probe.
- Start the real Overlay against the isolated server, force each canonical backend/stream presentation through real runtime conditions, inspect screenshots manually, and do a second source/diff review.

Final production-copy pressure evidence: the activity query plan uses `part_session_type_time_idx`; under 24 Task hydrations at concurrency 12, health probes averaged 0.0154 s and peaked at 0.4922 s, below the 2.5 s presentation grace. The large conversation payload path remained payload-bound (average 4.7603 s, maximum 10.3823 s), so this repair does not claim that multi-megabyte Task serialization has become a separate control-plane process.
