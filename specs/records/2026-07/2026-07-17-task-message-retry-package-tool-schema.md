# Task Message Retry And Package Tool Schema Ownership Repair

Status: complete

## Recall

### User request

- Investigate the failed `重试` message for Task `tsk_f6f54f51e001m1sMEVpRE70cFu`.
- Explain why a new message appeared while the user believed the Task could not be interrupted.
- Repair the root cause and verify the real observable message / execution path.

### Acceptance criteria

1. Reconstruct the persisted message, Task lifecycle, session, tool ownership, and HTTP request chronology instead of treating the final `failed` status as the cause.
2. A message sent to a terminal Task remains visible, reopens that same Task, and produces a durable accepted wake; no hidden or synthetic message path is introduced.
3. A projected expert-squad package tool with non-trivial Zod arguments can be converted through the real provider-bound schema path without a cross-runtime `schema._zod.def` failure.
4. Mirror Watch's real projected iFind tool reaches provider-bound preparation and local input validation in regression coverage; package projection alone is not sufficient proof.
5. Package tools retain one schema owner. Do not add a package-specific fallback, tolerate invalid schemas, bypass provider preparation, or maintain both `args` and `inputSchema` as runtime authorities.
6. Focused package-tool, resolver, session/provider-schema, task-message, type-check, and documentation-health verification passes.
7. Preserve unrelated dirty Overlay Agent Rail work, do not restart or interfere with the running OpenCorvus/Overlay process, and push the completed repair to `legacy-remote` with a `dsw-33987` commit subject.

### Hard constraints

- `prompt_profile.active` and `PromptProfileResolver` remain the only active expert-squad selection and runtime projection sources.
- Fix the package tool Application Binary Interface (ABI) schema ownership; do not remove only the iFind refinement or special-case Mirror Watch.
- Do not introduce retry/fallback routing, a host process gate, hidden messages, or a second Task status source.
- Every code change requires regression coverage. All investigation and architecture records remain under root `specs/`.
- The user's existing changes in `packages/overlay/src/components/ConversationAgentRail.tsx`, its tests, and the existing July index additions are out of scope and must be preserved.

### Sources read before implementation

- `AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/08-agent-tool-adapter.md`
- `specs/current/architecture/16-unified-teardown.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/2026-07-15-session-background-execution-ownership.md`
- `packages/plugin/src/tool.ts`
- `packages/opencorvus/src/expert-squad/package-tool-bundle.ts`
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`
- `packages/opencorvus/src/session/loop.ts`
- `packages/opencorvus/src/provider/schema.ts`
- `packages/opencorvus/src/task-api/index.ts`
- `packages/opencorvus/src/engine/queue.ts`
- `packages/opencorvus/src/orchestrator/loop.ts`
- `packages/overlay/src/services/chat.ts`
- `packages/overlay/src/store/board.ts`
- `packages/opencorvus/test/expert-squad/mirror-watch-package.test.ts`
- `packages/opencorvus/test/expert-squad/package-tool-bundle.test.ts`
- `packages/opencorvus/test/session/extra-tools.test.ts`
- `packages/opencorvus/test/server/task-message-routes.test.ts`

### Whole-repository search and call-point inventory

| Surface | Call points and disposition |
| --- | --- |
| Task message producer | `packages/overlay/src/services/chat.ts::panelMessage` posts to `POST /task/:taskID/message`, then immediately projects the returned persisted user message. Retain this single visible message path. |
| Task message owner | `EngineService.handleTaskMessage` delegates to `continueTaskMessage` / `appendAndWakeTaskOperatorMessage`, which append once, reopen terminal Task/run state, and call `dispatchTaskLoop`. Retain; runtime evidence proves it accepted this retry. |
| Wake queue | `packages/opencorvus/src/engine/queue.ts::dispatchTaskLoop` reopens terminal operator wakes and serializes Task passes. Do not restore the removed behavior that aborted live child-goal ownership for every root message. |
| Explicit cancellation | `EngineService.cancelTask`, Task lifecycle tools, panel tools, Mission abort, and Overlay cancel actions are separate explicit cancellation surfaces. Runtime logs contain no cancel request for this incident, so no cancellation failure is claimed without evidence. |
| Package tool authoring ABI | `packages/plugin/src/tool.ts::tool` currently returns raw per-field `args`. Every package tool source calls this API. Replace the runtime authority with one complete object `inputSchema` constructed inside the plugin runtime. |
| Package bundle | `PackageToolBundle` compiles a private plugin/Zod runtime into every trusted package tool bundle. This isolation is why host-side `z.object(definition.args)` composes schemas from two runtimes. Keep the isolated runtime; remove the cross-runtime composition. |
| Runtime projection | `PromptProfileResolver.packageToolFromDefinition` is the sole package-tool materializer for scheduler and worker projections. It must consume the plugin-owned complete schema directly. |
| Provider preparation | `SessionLoop.prepareProviderTool` / `providerBoundInputSchema` call `ProviderSchema.input`, which converts the complete schema before sending it to the provider. Add the missing production-shaped package-tool regression here. |
| Existing package tests | Mirror Watch tests validate projection, `safeParse`, and execution, but do not pass the projected tool through `prepareProviderTool`; package-bundle tests inspect definitions but do not prove provider conversion. Extend these exact suites. |
| Payload package | `packages/opencorvus/src/expert-squad/payload.ts` embeds package sources using the public `tool({ args })` authoring API. No payload source rewrite is needed if `tool()` itself constructs the canonical schema. |

### Runtime evidence chronology

1. The original Task became `failed` at `2026-07-17T09:19:18Z`; its first orchestrator session was already terminal before the retry message.
2. `POST /task/tsk_f6f54f51e001m1sMEVpRE70cFu/message` started at `09:21:07.698Z` and returned HTTP 200 after 87 ms.
3. The root session persisted exactly one user message, text `重试`, as `msg_f6f612ec30017qm6JW7NAqDuMz`.
4. Protocol events record `task.message`, then Task `queued`, then `active`. `operator_message_wake` records `started`; a new orchestrator session `ses_0909ed0f7ffeW30PDwiJoyIIwc` started 69 ms after the message.
5. The retry orchestrator dispatched `mirror-watch-research-lead`; its projected iFind package tool failed before research with `invalid inputSchema: undefined is not an object (evaluating 'schema._zod.def')`.
6. The retry Task then correctly surfaced that new terminal failure at `09:21:53Z`. No source evidence or accepted goal outcome was produced.
7. Runtime HTTP logs contain no Task cancel request during the active retry interval. Therefore the evidence proves a successful retry followed by a package-tool schema failure; it does not prove that a cancellation request reached and failed in the backend.

### Independent agent feedback

No sub-agent was created because the user did not request delegation and the active collaboration instruction forbids implicit spawning. The primary agent owns the evidence reconstruction, implementation, and second review.

## Implementation plan

1. Change the plugin `tool()` ABI result so it owns one complete strict object `inputSchema`, constructed in the same bundled Zod runtime as its child argument schemas; remove raw `args` from the runtime definition.
2. Change `PromptProfileResolver` definition validation/materialization to require and forward that canonical schema without host-side recomposition.
3. Extend package bundle and Mirror Watch regressions to prove the runtime definition shape, provider-bound JSON Schema conversion, duplicate-channel local validation, and projected execution.
4. Run focused tests, package and OpenCorvus type checks, route/docs checks, and document-health tests. Review the diff for all package-tool call points and unrelated-worktree isolation.
5. Mark this record complete, commit only owned files with a `dsw-33987` subject, push `v0.0.8beta` to `legacy-remote`, and verify the remote hash.

## Implementation and verification log

### Causal chain

- Observable symptom: the Overlay showed a new `重试` user message, then the Task failed again with an adapter error; the user interpreted this as a retry/message interruption failure.
- Direct trigger: `SessionLoop.prepareProviderTool` asked `ProviderSchema.input` to convert the projected iFind tool's schema and failed while traversing `schema._zod.def`.
- Deeper cause: package tools execute from a content-addressed bundle that contains its own plugin/Zod runtime, but `PromptProfileResolver.packageToolFromDefinition` exported raw child `args` schemas across that bundle boundary and called host `z.object(definition.args)`. Parsing happened to work, while provider JSON Schema traversal mixed the host object schema with bundle-owned children and broke.
- Why prior coverage missed it: Mirror Watch tests proved bundle closure, projection, `safeParse`, and direct execution, but never passed that real projected tool through provider-bound preparation. Generic provider-schema tests used schemas created wholly inside the host runtime, so neither suite exercised the mixed-runtime object.
- Cancellation finding: no cancellation request appears in the incident's HTTP logs. The original Task was already failed before `重试`; the message successfully reopened and ran it. It is therefore unsupported to label this incident a backend cancellation failure. Explicit cancel remains a separate lifecycle action.

### Implemented single-source repair

- `@opencorvus-ai/plugin::tool({ args })` now constructs and returns one complete object `inputSchema` inside the package bundle's own Zod runtime. Raw `args` are no longer part of the runtime `ToolDefinition`.
- `PromptProfileResolver` now validates the canonical `inputSchema` definition and forwards it directly. The host-side `z.object(definition.args)` cross-runtime composition was deleted.
- Package bundle coverage asserts that the runtime definition exposes `inputSchema`, not a second raw `args` authority, and that AI SDK schema conversion accepts the bundle-owned schema.
- Mirror Watch coverage sends its real projected iFind tool through `SessionLoop.prepareProviderTool` using the production provider family and verifies local rejection of duplicate channels before any tool transport runs.
- Current architecture and English/Chinese product documentation now state the one-schema-owner contract.

### Secondary review

1. Whole-repository search found only `PromptProfileResolver` consuming the public package `ToolDefinition`; package sources keep the ergonomic `tool({ args })` authoring form and require no parallel source migration.
2. `PackageToolBundle` already fingerprints the compiled plugin runtime closure. Changing `tool()` therefore changes the package bundle/projection digest naturally; no cache alias or compatibility branch is required.
3. The first focused run proved the original `_zod.def` path is gone for the exact iFind tool. The broader resolver and MirrorTest runs proved scheduler/worker projection, TaskArtifact execution, and other package tools still use the same ABI.
4. Task-message route regressions confirm failed/cancelled/completed Task reopening, visible persisted messages, accepted wake commitments, and live child-goal ownership behavior. No message or queue code needed a speculative patch.
5. Diff review confirmed the existing Agent Rail source/tests and their July record remain untouched. Shared index files contain both the user's prior entry and this record.

### Verification evidence

- `bun test packages/opencorvus/test/expert-squad/package-tool-bundle.test.ts packages/opencorvus/test/expert-squad/mirror-watch-package.test.ts --timeout 30000`: 30 passed.
- `bun test packages/opencorvus/test/expert-squad/prompt-profile-resolver.test.ts packages/opencorvus/test/expert-squad/dynamic-agent-resolver.test.ts packages/opencorvus/test/session/extra-tools.test.ts packages/opencorvus/test/server/task-message-routes.test.ts --timeout 30000`: 106 passed.
- `bun test packages/opencorvus/test/expert-squad/opentest-package-tool-chain.test.ts packages/opencorvus/test/expert-squad/opentest-protocol-engine.test.ts --timeout 30000`: 2 passed, including the real projected command/artifact/validation chain.
- `bun run typecheck` in `packages/plugin`: passed, including type tests.
- `bun run typecheck` in `packages/opencorvus`: passed.
- Root `bun run typecheck`: 10 successful package tasks; SDK import and AI runtime checks passed.
- `bun run api:routes-check`: passed, 6 rules across 31 route files.
- `bun run docs:check`: passed, 272 operations in 24 groups.
- Historical/product/document-health pre-stage run: 80 passed; the one expected failure reported only that this newly indexed record was not yet Git-tracked.
- After precisely staging the new record, `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 30000`: 81 passed.
- `git diff --check`: passed.

The user's running OpenCorvus/Overlay process was not stopped, restarted, refreshed, or used as a test target. The repair takes effect through the normal updated build/release lifecycle.
