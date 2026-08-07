# Compiled Artifact Search schema initialization repair

Status: Completed
Date: 2026-07-27
Owner: Codex

## Recall

### User request

The user reported that Task `tsk_fa383376b001YpjQ1sd24E6kj4` opened an
empty message panel, asked for the cause, and then explicitly requested that
the product defect be fixed and independently reviewed by another Agent.

### Acceptance criteria

1. The packaged Overlay server can initialize the Orchestrator Artifact tools
   without `ArtifactSearchInputSchema.omit(...)` throwing.
2. Artifact search input, applied-filter output, and Mission panel search
   parameters derive from one strict object-field source.
3. `sort: "relevance"` without `query` remains invalid on every parsed
   Artifact-search input/output surface that owns that relationship.
4. A production-shaped `bun build --compile` probe imports and executes the
   exact Artifact schemas instead of merely scanning compiled bytes.
5. Existing Artifact catalog and panel contracts continue to pass.
6. A separate read-only Agent reviews the final diff and tests and may not
   delegate further.
7. Current OpenCorvus, Overlay, and browser sidecar processes are not restarted
   or otherwise disturbed.
8. Concurrent worktree changes remain untouched; only repair-owned paths and
   exact index hunks are committed.

### Hard constraints

- No fallback, compatibility alias, duplicate field definition, Host gate,
  synthetic message, or second Artifact-search parser.
- Use the existing Zod schema family and production Bun compiler.
- Do not infer failure from Session naming. The database and runtime log prove
  the failure happened after the child Orchestrator Session was created but
  before any `message`, `part`, Goal, decision-log, or worker-turn row existed.
- The observed Task remains `active` because the existing error handler writes
  `task.error` without `time_completed`; this repair targets the concrete
  initialization crash. Lifecycle/error-presentation hardening is not used to
  hide or bypass that crash.
- Do not modify or stage unrelated Overlay and concurrent spec work.

### Sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-26-unified-task-artifact-catalog-protocol.md`
- `packages/plugin/src/artifact-catalog.ts`
- `packages/plugin/test/artifact-catalog.test.ts`
- `packages/opencorvus/src/panel/capability.ts`
- `packages/opencorvus/src/tool/panel.ts`
- `packages/opencorvus/src/artifact-catalog/index.ts`
- `packages/opencorvus/src/orchestrator/agent.ts`
- `packages/opencorvus/src/engine/task-status.ts`
- `packages/opencorvus/test/script/compiled-overlay-artifact.test.ts`
- Runtime database `/Users/yangheng/.local/share/opencorvus/opencorvus.db`
- Runtime log
  `/Users/yangheng/.local/share/opencorvus/log/2026-07-27T114136-19015-1.log`
- Installed sidecar and matching build Artifact with SHA-256
  `a909b2afd0d8419119379df4770e5cb490f107d2470e48b8f8d3363f861bbb22`

### Whole-repository search

| Call site                                                  | Decision                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/plugin/src/artifact-catalog.ts` input definition | Keep the complete validated public input, but derive it from an unrefined strict object owner.                                                          |
| `packages/plugin/src/artifact-catalog.ts` applied filters  | Replace `.omit({ cursor: true })` on the refined schema with a named derivative of the strict object owner, then apply the same cross-field refinement. |
| `packages/opencorvus/src/panel/capability.ts`              | Replace `.omit({ limit: true })` on the refined schema with a named derivative exported by the plugin package.                                          |
| `packages/opencorvus/src/tool/artifact-catalog.ts`         | Preserve the validated complete input schema.                                                                                                           |
| `packages/opencorvus/src/artifact-catalog/index.ts`        | Preserve authoritative parse through the validated complete input schema.                                                                               |
| `packages/opencorvus/src/tool/panel.ts`                    | Preserve execution-time authoritative parse; update types only if the named panel schema requires it.                                                   |
| Plugin and OpenCorvus tests                                | Extend with derived-schema validation and an executed compiled probe.                                                                                   |
| Generated OpenAPI and SDK                                  | Expect no contract delta; verify route/API checks instead of editing generated files by hand.                                                           |

No other production `.omit()` call on `ArtifactSearchInputSchema` exists.

### Independent Agent feedback

The first read-only review found one P1 contract gap: spreading the no-limit
schema shape into the Panel capability discarded the shared `query`/`sort`
refinement, so `sort: "relevance"` without `query` still passed the final Panel
parser. The repair exported the single refinement, applied it to every parsed
schema variant, taught the existing Panel `item` primitive to preserve an
optional Zod refinement, and bound it to `query_task_artifacts`. Positive and
negative final-parser tests were added. The same Agent re-reviewed the revision
without editing or delegating and returned `No findings`; it confirmed the P1
was closed.

The reviewer also required commit-time hunk isolation because the shared spec
indexes contain concurrent task entries. The final commit must construct its
index from the latest `HEAD` and add only this record's exact index lines.

## Causal chain

1. The Task wake created root Session `ses_05c7cc654ffeF2Toj9XOqtjfLG` and child
   Orchestrator Session `ses_05c7cb64cffeSx3Umcqm7RtQ5H`.
2. Tool initialization evaluated
   `ArtifactSearchInputSchema.omit({ cursor: true })`.
3. The packaged sidecar threw `TypeError: Oa.omit is not a function`.
4. The failure preceded prompt execution and message persistence, so both Task
   Sessions had zero `message` and `part` rows.
5. The catch path persisted `task.error` but did not complete the Task, so the
   derived status remained `active`; the empty panel was a truthful projection
   of missing messages, not the initiating defect.
6. Source-mode tests did not reproduce the packaged initialization behavior,
   and the existing compiled test only inspected binary contents without
   executing this lazy module path.

## Implementation plan

1. Introduce one strict Artifact-search object schema before cross-field
   refinement.
2. Derive the complete input, applied-filter output, and no-limit panel schema
   from that object owner.
3. Share one named cross-field refinement between parsed variants that retain
   `query` and `sort`.
4. Add focused schema assertions, panel contract assertions, and an executable
   production-shaped compiled probe.
5. Run focused suites, typecheck/API/docs checks as applicable, and the compiled
   probe.
6. Record independent review feedback, repair any finding, rerun verification,
   then commit only owned paths with the required `dsw-33987` prefix and push
   through normal hooks to `legacy-remote/v0.0.19beta`.

## Verification

- `bun test packages/plugin/test/artifact-catalog.test.ts`: 23 pass, 0 fail.
- `bun test packages/opencorvus/test/panel/query-task.test.ts packages/opencorvus/test/tool/panel-capability.test.ts`:
  24 pass, 0 fail before review and 24 pass, 0 fail after the P1 repair. This
  run exposed and repaired one adjacent stale
  `engine_artifact` locator fixture that lacked the already-required
  `catalog_revision`.
- Combined post-review Artifact and Panel regression run: 47 pass, 0 fail with
  4,496 assertions.
- `bun test packages/opencorvus/test/script/compiled-overlay-artifact.test.ts`:
  2 pass, 0 fail. The new test compiled the Orchestrator graph with production
  browser conditions, materialized the packaged runtime dependency closure,
  executed the binary, and parsed the complete input and applied-filter page.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`:
  22 pass, 0 fail.
- `bun run --cwd packages/plugin typecheck`: passed.
- `bun run --cwd packages/opencorvus typecheck`: passed after the final review
  repair.
- `bun run api:routes-check`: passed, six rules across 32 files.
- `bun run docs:check`: passed, 294 operations across 24 groups.
- `git diff --check`: passed.
- Independent read-only Agent review: initial P1 fixed; final re-review returned
  `No findings`.
- Existing OpenCorvus, Overlay, and browser-sidecar processes were not
  restarted, refreshed, or terminated. Compiled execution used only an
  isolated temporary directory removed by the test.
- Final push hooks remain the delivery-level verification over the latest
  shared branch state.
