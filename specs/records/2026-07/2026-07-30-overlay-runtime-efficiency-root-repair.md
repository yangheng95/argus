# Overlay runtime efficiency root repair

Date: 2026-07-30

## Recall

### User request

- Explain why the Overlay user interface (UI) is severely janky.
- Iterate autonomously until the efficiency problem is repaired.
- Use independent agents for a deep audit and do not limit the investigation to the first visible bottleneck.
- Preserve every feature. A lower-resource implementation is allowed, but animation and other behavior must not be deleted.

### Acceptance criteria

- A selected Task no longer turns repeated `session.status` or Browser Preview Artifact updates into full Board, Task-list, Browser Preview target, evidence, capture, and project-root refresh chains.
- Repeated equivalent Session lifecycle facts are published once per real transition.
- A Server-Sent Events (SSE) transport failure cannot be auto-reconnected underneath the business reconnect owner.
- Reading Model Context Protocol (MCP) status does not start a configured server. The first explicit connect or real tool projection starts it and all Browser capabilities remain available.
- INFO logging keeps useful turn summaries while high-cardinality permission, tool-initialization, and provider-Schema detail remains available at DEBUG without paying disabled-log serialization cost.
- The selected conversation remains exact and live. Database-backed message recovery remains available, but ordinary exact `message.*` events do not trigger a second full conversation hydration.
- The existing Browser auto-reveal, native navigation, evidence view, child-Agent conversation, Mailbox, file draft, pulse, streaming, hover, and reduced-motion semantics remain available.
- Focused non-UI contracts, typecheck, build, document health, an isolated real page, and manually inspected screenshots pass.
- Only task-owned files are committed and the primary branch is pushed to `legacy-remote` with the `dsw-33987` subject prefix.

### Hard constraints

- Preserve unrelated staged, unstaged, deleted, and untracked work in the shared worktree.
- Do not stop, restart, refresh, or mutate the user's running Overlay during diagnosis.
- Do not add, modify, or run UI automation tests. Delete directly encountered obsolete UI source/DOM/browser tests that exist only for the touched presentation contract.
- UI acceptance is interactive and visual only; Playwright must run under Node when used.
- Non-UI behavior uses positive contract tests. Do not add or retain negative tests in touched test files.
- No fallback, compatibility branch, gate, duplicate source, state machine, hidden message, or feature deletion.
- New plans and benchmark evidence live only in `specs/records/2026-07/`.

### Sources read

- `AGENTS.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/records/2026-06/2026-06-19-deep-performance-investigation.md`
- `specs/records/2026-06/2026-06-19-system-performance-high-confidence-pass.md`
- `specs/records/2026-06/2026-06-28-overlay-global-gui-responsiveness-benchmark.md`
- `specs/records/2026-06/2026-06-28-overlay-stream-jank-benchmark.md`
- `specs/records/2026-07/2026-07-28-subagent-conversation-refresh-storm-repair.md`
- Overlay event routing, Board store, conversation recovery, Browser Preview, child-Agent Dock, Task directory bar, Mailbox, stream transport, and animation sources.
- Runtime Session lifecycle, protocol bridge, task event routes, Browser Preview persistence, MCP lifecycle, tool registry, provider-Schema conversion, permissions, logging, Memory, and Board projection sources.
- Read-only process, log, SQLite, and memory-pressure evidence from the current installation.

### Whole-repository search evidence

| Contract or symbol | Exhaustive search result and disposition |
| --- | --- |
| `session.status` / `SessionStatus.set` | Lifecycle owner is `packages/opencorvus/src/session/status.ts`; producers span Session processor/loop, agent runner, delegate Agent, scheduler, and cancellation. Consumers include protocol persistence, Board/conversation projections, CLI, and Overlay tree/live-agent projection. Equivalent transition suppression belongs only in `SessionStatus.set`; Overlay keeps the exact event projection and drops its redundant Board reload. |
| `scheduleBoard` / `boardUpdatedAt` | The selected event router schedules Board for `session.status`; Board 304 and every successful hydrate bump `boardUpdatedAt`; Browser Preview and TaskDirBar use it as a cache-buster. Replace those cross-domain consumers with domain revisions instead of changing legitimate Board consumers globally. |
| `browser-preview.target` / `persistBrowserPreviewEvidenceBatch` | Target create/update/promote emits `task.updated` with source `browser-preview.target`; evidence persistence emits no domain event. Emit one atomic `browser-preview.evidence` update per affected Task, project the event source through task-list SSE, and let Overlay consume only those sources into one Browser Preview revision. |
| `task.messages.changed` / `taskMessageWatermarkCursor` | Task SSE owns an immediate GlobalBus listener and a two-second recovery poll. Overlay always full-merges the latest conversation. Exact message events already use the same task stream. Suppress the redundant immediate change after an exact message mutation and keep the poll as recovery for database-only writes. |
| `EventSource` / `HostTransport.openStream` | Tauri unauthenticated GET uses native `EventSource`; the Host contract says transports never reconnect. Close the native source on the first error before yielding control to the business reconnect owner. |
| `MCP.status` / `projectStatus` / `ensureConfiguredConnections` | Global and project status reads start configured connections. Explicit configure/connect and tools/prompts/resources paths already own startup. Make status projection read-only and leave all explicit/on-demand startup paths intact. |
| `prepared provider tool schema` / permission `evaluate` / tool registry `time` | Provider preparation, Permission evaluation, and every tool initialization emit per-item INFO rows. Logger sanitizes before Pino level filtering. Add level-aware early exit and DEBUG timing; retain one INFO `resolveTools` summary and exact detail at DEBUG. |
| child conversation route and revision | `SubagentConversationPanel` keys a full child transcript request on status, timestamps, and the complete activity list. The route scans the full Task event list to extract one Session. Follow-up work must make initial hydrate plus exact message/event cursor the single transcript path; no status/TODO fact may become network identity. |
| animations | Running-card gradient, message mask, and sub-Agent pulse use paint-heavy properties. They remain visible; offscreen work pauses and equivalent transform/opacity composition replaces paint-heavy motion where verified visually. |

### Baseline evidence

- The affected sidecar sampled between 9.2% and 44.4% CPU over ten seconds while the shell process stayed near 0%.
- The sidecar held roughly 760–782 MiB resident memory; WebContent sampled roughly 319–609 MiB. System memory pressure still reported 58% free, so global memory exhaustion was not the trigger.
- A 32-minute log reached 49,534 lines and 16.9 MB. Permission evaluation contributed 8.57 MB, provider tool Schema logs 2.72 MB, and tool-registry timing 1.95 MB.
- One minute contained 1,255 permission evaluations, 969 provider tool-Schema preparations, 207 empty-Memory probes, and 24 large-context LLM streams.
- Context diagnostics averaged roughly 64,342 tokens and reached 116,673 tokens; tool Schemas averaged roughly 97,269 characters.
- The current database was only about 7 MB with a roughly 4.4 MB write-ahead log and passed SQLite integrity checks.
- The inspected Task contained 512 persisted `session.status` events; 475 were consecutive equivalent `streaming` facts.
- The hidden Browser Preview endpoint completed 387 times. Child transcript endpoints completed 99–323 times per Session.
- Live-replay expiry produced 304 connections to one Task event URL in 4.86 seconds.
- Browser MCP startup consumed roughly 296.3 MiB in the Bun wrapper plus 40.3 MiB in Node before a Browser tool was used.

### Independent agent feedback

- Frontend audit: the dominant hidden cascade is `session.status` -> Board -> `boardUpdatedAt` -> Browser target -> evidence -> capture; child Dock requests and conversation-agent projection also scale with every activity; hidden Mailbox and editor instances retain avoidable work; current animation is secondary, not the primary cause.
- Backend audit: native EventSource replay-expiry reconnect, duplicate lifecycle publication, per-turn tool/Schema reconstruction, INFO log serialization, repeated full transcript reads, recursive watermark polling, empty-Memory fan-out, and repeated EffectiveConfig resolution are independent amplifiers. There is no evidence of an unbounded process leak.
- System audit: startup MCP status reads create the Browser process chain before use; ordinary message mutations and child Dock activity invoke full hydration; a no-feature-loss lazy-start and exact incremental projection provide the largest memory and request reductions.
- Final independent review found two recovery edges before acceptance: streamed
  `message.part.delta` facts were advancing the child-transcript HTTP revision
  even though they are not yet persisted, and replay expiry/process restart
  lacked an explicit snapshot-replace contract. It also found a competing
  terminal-publication failure window and a task-list Browser target cursor
  race. All four were returned to implementation rather than accepted as
  residual risk.
- The final frontend, backend, and system re-reviews found no remaining P0/P1.
  The two-second database-only recovery poll and long-running Browser MCP
  workload remain candidates for a future load profile, but current
  post-repair process/request evidence does not identify either as a present
  bottleneck.

## Root-cause chain

1. Runtime producers emit duplicate or high-cardinality facts and repeatedly materialize large tool, permission, message, and context payloads.
2. The task stream adds a second coarse “messages changed” recovery fact beside exact message events.
3. Overlay routes a lifecycle fact through both precise card/live-agent projection and a full Board request.
4. A generic Board timestamp is reused as Browser Preview, evidence, capture, project-root, and target invalidation.
5. Hidden, force-mounted panels therefore perform real network, parse, object-URL, layout, and paint work.
6. INFO logging serializes and writes the same per-tool/per-permission detail, increasing CPU, allocation, disk traffic, and diagnostics volume.
7. Under a replay-expired edge, native EventSource begins transport-owned reconnect while the Overlay business layer believes it owns reconnect, multiplying the entire chain.

## Implementation sequence

1. Repair the producer boundary: idempotent Session lifecycle and read-only MCP status.
2. Repair stream ownership: terminal native EventSource errors and recovery-only `task.messages.changed`.
3. Split Browser Preview invalidation from Board freshness and atomically publish target/evidence changes.
4. Remove per-item INFO amplification while preserving DEBUG detail and INFO summaries.
5. Re-benchmark requests, lifecycle events, log volume, process footprint, and visible streaming.
6. Continue with child-session incremental transcript, normalized Agent projection, lazy hidden Mailbox/editor view, and frame-clock animation/layout work if the first benchmark still shows material pressure.

## Implemented root repairs

1. `SessionStatus.set` now treats equivalent lifecycle payloads as one fact,
   while idle entries are still released and terminal ownership remains
   observable. A different terminal fact racing an in-flight terminal
   publication waits for the winner; if that publication fails, the competing
   fact publishes instead of being silently lost.
2. Native EventSource closes on its first transport failure, leaving reconnect
   and backoff to the one business owner.
3. Exact live `message.*` events advance the task message watermark. The
   coarse `task.messages.changed` event now remains only for database-only
   recovery and reconnect gaps.
4. Browser Preview target and evidence persistence publish exact domain
   sources into one shared Browser Preview revision. Session lifecycle no
   longer reloads the Board, and the retired generic `boardUpdatedAt`
   cache-buster no longer couples Board, project root, target, evidence, and
   capture.
5. Inactive Browser Preview panels keep target discovery for ready-state
   auto-reveal, but do not download evidence images or allocate object URLs.
6. `MCP.status` and project status are read-only projections. Explicit
   connect/configure and real tools, prompts, or resources remain the only
   runtime acquisition paths.
7. Permission evaluation, provider Schema detail, and per-tool initialization
   moved to DEBUG. The logger exits before sanitization and Session tag
   projection when the selected level is disabled; INFO summaries remain.
8. Live conversation-Agent identity, lifecycle, and target updates now update
   the exact record when order and parent structure are unchanged. Full array
   cloning, sorting, and depth projection are reserved for structural changes.
9. Child transcripts now hydrate once, then request only persisted message
   identities changed after the exact task live-replay sequence. Per-token
   `message.part.delta` facts neither advance the HTTP request key nor cause
   database reads; the persisted part boundary advances once. The request
   carries the live epoch, and each response explicitly declares snapshot or
   delta semantics. Replay expiry, sequence rewind, and process-epoch change
   replace the snapshot, so stale messages and old high cursors cannot survive.
   The backend otherwise loads only changed messages and the Overlay merges
   replacements/removals by message ID, aborting superseded requests.
10. The running Tool animation remains visible and reduced-motion aware, but
    the paint-heavy moving mask was replaced by compositor-owned opacity
    animation.
11. Published MCP connections now bind close handling to the exact connection
    identity and durable owner generation. Unexpected process exit removes the
    stale client and projects `disconnected`; explicit close and replacement
    cannot let an old callback clobber the new connection.
12. Browser event cursors are monotonic per Task and cleared with workspace
    runtime ownership. Agent progress cards use exact Session selectors and
    one batched live-event projection; file-tree freshness uses its own
    mutation/event revision rather than Board snapshot churn.
13. Both selected-task and task-list Browser target/evidence notifications
    schedule the active Board after advancing the shared per-Task cursor. A
    task-list event can no longer consume the cursor and suppress the selected
    Task refresh.

## Post-repair evidence

- Focused positive contracts passed for lifecycle publication recovery, MCP
  lazy startup and unexpected-exit reconnect, Browser evidence batching,
  stream transport ownership, task message recovery, child-transcript delta
  merge, exact Agent projection, and file-workbench revision.
- Repository typecheck passed across 8 packages. Overlay production build
  completed after transforming 7,056 modules.
- OpenAPI was regenerated through the repository generator. The 6 route
  inventory rules are clean across 33 files, and generated documentation is
  current.
- Historical-link and product-doc single-source suites passed. Document health
  exposed one stale assertion for an already absent UI test; that obsolete
  assertion was deleted. Its affected contract now passes. The monthly index
  check requires the new record to be tracked and is re-run from the final
  task-only index.
- A fresh same-origin Overlay connected to an isolated real server and was
  manually inspected. It showed one platform titlebar, one Online connection,
  stable main/left/right regions, and no visual regression.
- Chrome DevTools Protocol sampling over five idle seconds measured 2 requests,
  9.7 ms total main-thread task time, 6.9 ms script time, 0 ms layout, 0 ms
  style recalculation, a 38.8 MiB JavaScript heap, and 1,385 document nodes.
- The live built stylesheet contains the retained
  `tool-active-pulse` keyframes and the existing reduced-motion boundary. The
  new animation changes only opacity.
- The isolated server sampled 0.4%-1.2% CPU with no Browser MCP, Chromium
  BiDi, or Node MCP child process after normal Overlay startup. Its resident
  memory was roughly 486 MiB; this empty isolated process is not directly
  comparable with the affected active workload, but it proves status reads no
  longer pre-acquire the roughly 336 MiB Browser MCP process chain.
- The 2.50 MiB compressed-entry source chunk warning remains a cold-start
  opportunity, not the observed continuous request/CPU storm. Spreadsheet,
  diagram, map, and three-dimensional renderers are already separate chunks;
  changing the remaining module boundary is deferred until a load-profile
  attributes its retained bytes rather than adding speculative splitting.

## Verification commands

Only focused non-UI contracts are automated:

```bash
bun test packages/opencorvus/test/session/status-idempotency.test.ts
bun test packages/opencorvus/test/mcp/status-lazy-start.test.ts
bun test packages/opencorvus/test/mcp/startup-failure.test.ts
bun test packages/opencorvus/test/mcp/unexpected-close.test.ts
bun test packages/opencorvus/test/util/log-pino.test.ts
bun test packages/opencorvus/test/browser-preview/persist-events.test.ts
bun test packages/opencorvus/test/server/task-list-events.test.ts
bun test packages/opencorvus/test/server/task-conversation-routes.test.ts --test-name-pattern "conversation/session/:sessionID"
bun test packages/overlay/test/tauri-transport-stream-branches.test.ts
bun test packages/overlay/test/subagent-conversation-service.test.ts
bun test packages/overlay/test/file-workbench-revision.test.ts
bun run --cwd packages/opencorvus typecheck
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay build
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
```

The final UI acceptance uses an isolated real Overlay page, Node-driven interaction, manually inspected screenshots, and live request/process measurements. It is not saved as an automated UI test or baseline.
