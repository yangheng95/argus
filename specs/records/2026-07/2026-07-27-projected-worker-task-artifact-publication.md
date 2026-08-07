# Projected Worker Task Artifact Publication

Status: Implemented; fresh Mission proof pending
Date: 2026-07-27
Owner: Codex

## Recall

### User request

The user requires the real Prism TradingView Spaces end-to-end run to expose
and repair shared infrastructure and Expert Squad failures until the product
Artifact is complete. Monitoring must not inject messages, manufacture
evidence, write Task-owned Artifacts on behalf of a worker, or use a benchmark
wrapper. Optional domain fields may be absent; wrong or missing evidence,
wrong paths, persistence/tool failures, duplicated dispatch, and stuck
execution are defects.

For this failure the user requires ordinary workers to be able to generate
immutable Artifact refs rather than introducing per-Agent Git worktrees or
asking downstream Agents to scan mutable directories. The repair must apply to
all projected Agent and Expert Squad families, preserve concurrent worktree
changes, include regression tests, use a `dsw-33987` commit subject, and push
through normal hooks to `myhexin`.

### Acceptance criteria

1. Every projected worker receives one Core-owned `artifact_snapshot` tool in
   addition to `artifact_publish`, `artifact_search`, `artifact_read`, and
   `artifact_select`.
2. `artifact_snapshot` accepts a nonempty bounded inventory of canonical
   project-relative file paths and normalized media types from the current
   Task product repository.
3. The Host validates Task/session/Agent ownership, rejects paths outside the
   exact Task project root and linked or changing files, copies the bytes into
   one immutable `catalog` snapshot, and returns exact `TaskArtifactRef`
   values.
4. The worker can pass those refs to the existing `artifact_publish` tool.
   The Engine Artifact envelope stores immutable refs, never workspace paths.
5. Downstream Agents use `artifact_search`, `artifact_read`, and
   `artifact_select`; they never scan another Agent's directory. Complete but
   unselected reads remain observations and zero selections are valid.
6. Scheduler capabilities remain read-only. Package tools retain the typed
   `taskArtifacts.stage/publish` Host interface and do not receive a
   compatibility path.
7. Missing files, foreign paths, invalid media types, duplicate inputs,
   symlinks, hard links, changed bytes, corrupt snapshots, and read failures
   remain explicit errors. Empty optional domain fields remain valid.
8. A real projected-worker tool-message flow publishes PNG bytes, returns a
   ref, publishes an Engine envelope using that ref, and exact-reads both.
9. All repository Expert Squads, portable templates, SDK guidance, and
   representative projection families agree on the same platform tool set.
10. A fresh Mission naturally completes the Prism
   source/Requirements/Architect/PRD/Design/Code/MirrorTest chain with current
   task/goal/region-scoped PNG locators.

### Hard constraints

- Follow `AGENTS.md`; do not add a gate, fallback, compatibility alias, retry
  state machine, automatic workflow step, or Prism-specific Core branch.
- Do not put Prism domain policy in the Core prompt.
- Do not infer Artifact handoff from a Git commit, digest, repository path, or
  assistant message. Only cataloged exact-readable locators are evidence.
- Do not reset, stash, restore, clean, or create a worktree. Preserve all
  concurrent changes in the shared dirty worktree.
- Port 7777 may be restarted only after the current Task is terminal and the
  canonical database has no live owner. Other services must not be touched.

### Sources read and repository-wide search

The design was checked against:

- `packages/plugin/src/{artifact-catalog,task-artifact,project-path,tool}.ts`;
- `packages/opencorvus/src/task-artifact/{store,recovery}.ts`;
- `packages/opencorvus/src/artifact-catalog/index.ts`;
- `packages/opencorvus/src/tool/{artifact-catalog,plugin-tool-host,task-tool-execution-scope,platform-artifact-tool-ids}.ts`;
- `packages/opencorvus/src/expert-squad/prompt-profile-resolver.ts`;
- `packages/opencorvus/src/engine/{evidence-locator,cross-task-artifact-import}.ts`;
- Browser Preview and Visual QA filesystem snapshot producers;
- Artifact catalog, Task Artifact store, projected-worker, package-host,
  projection, SDK, portable-template, and documentation tests;
- every repository occurrence of `artifact_publish`, `TaskArtifactRef`,
  `taskArtifacts.stage`, `taskArtifacts.publish`,
  `publishEngineArtifactResources`, and platform Artifact tool IDs.

| Call-point family | Disposition |
|---|---|
| `task-artifact/store.ts` | factor the verified filesystem publication path and add current-Task project-file `catalog` snapshot publication |
| `tool/artifact-catalog.ts` | add the model-facing `artifact_snapshot` schema and execution using persisted Task tool identity |
| platform tool inventory and projection | add `artifact_snapshot` to worker publication tools; schedulers stay search/read-only |
| `artifact_publish` and package Host | preserve existing exact-ref publication; no second Engine publisher |
| Browser Preview and Visual QA | preserve Host-owned `engine_resource` snapshots on the same store implementation |
| catalog/read/import/recovery | preserve exact locator, cursor, import, and orphan-recovery behavior |
| Expert Squads and SDK/template docs | describe snapshot-then-envelope publication and remove impossible pre-existing-ref wording |

### Exact failure evidence

- Mission `355553a997f3d741`, Task
  `tsk_f9f5dd8090018qHl9ifRRUv879`, and worker
  `ses_0606b8acfffdoKsig6lVKsPU4M` are terminal failure evidence only.
- Worker commit `8f5ac44` contains the corrected 24-row SpaceSummary authority
  and six readable current-run PNG files.
- Tool part `prt_f9f9c77830013Gh0pJY7MDpmwq` returned a complete,
  provider-error-free `task_artifact` catalog with zero entries.
- Coordination request `art_f9f9cbd1b001m059UGL4eggmBP` correctly reported
  that the worker could not form the immutable screenshot locators required by
  its publication contract.
- The worker's persisted tool history contains file read/write tools and
  `artifact_search`/`artifact_read`, but no Task Artifact snapshot publisher.
- Core currently projects only `artifact_publish` as a worker publication
  tool, while its `resources` input already requires `TaskArtifactRef[]`.
  `TaskArtifactHost.stage/publish`, which mints those refs, is reachable only
  from package-tool code through `ToolHost`.
- SQLite `PRAGMA quick_check` is `ok`, the failed Task is terminal, the
  complete database has zero active Tasks, and port 7777 is healthy. The
  direct cause is therefore capability composition, not database corruption,
  service death, optional-field policy, or an Agent stall.

## Root cause

The two authoritative Artifact stores and exact-read protocol are present, but
the projected-worker capability surface is not composition-complete.
`artifact_publish` consumes immutable refs while the only ref-producing
interface is hidden behind package-tool code. A worker without a dedicated
package binary producer can create and verify files but cannot register them
in the Task Artifact store. The downstream scheduler correctly refuses to
substitute mutable repository paths for immutable evidence.

## Implementation

1. Add strict `artifact_snapshot` input/output schemas to the Core model tool.
2. Publish current-Task project files through the existing Task Artifact store
   as a producer-attributed `catalog` snapshot.
3. Return the snapshot locator and exact resource refs needed by
   `artifact_publish`.
4. Project the new tool to every worker family through the shared platform
   publication-tool constant; do not project it to schedulers.
5. Calibrate repository package and SDK/template guidance.
6. Add positive real-message-flow and negative path/link/ownership tests.
7. Run targeted tests, document health, typecheck, independent review, normal
   commit hooks, and push.

## Verification

Implemented verification:

- `bun test packages/opencorvus/test/task-artifact/store.test.ts packages/opencorvus/test/tool/artifact-publish.test.ts packages/sdk/js/test/expert-squad-authoring.test.ts packages/sdk/js/test/repository-squad-fact-turn-calibration.test.ts`
  — 75 passed, 0 failed.
- `bun test packages/opencorvus/test/task-artifact/store.test.ts packages/opencorvus/test/tool/artifact-publish.test.ts packages/sdk/js/test/repository-squad-fact-turn-calibration.test.ts`
  after worker-only authority and linked-ancestor hardening — 46 passed,
  0 failed.
- `bun test packages/opencorvus/test/expert-squad/repository-dynamic-agent-packages.test.ts`
  — all eight repository Expert Squads resolved, every projected package tool
  reached provider schema preparation, and the reserved platform transport was
  excluded from package-supplied placeholders.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`
  — document and historical-link checks passed.
- `bun run typecheck` in `packages/opencorvus` and `packages/sdk/js` — passed.

The real projected-worker flow creates a PNG in the Task product repository,
executes a persisted `artifact_snapshot` tool part, exact-reads the returned
binary ref, executes a persisted `artifact_publish` tool part with that ref,
exact-reads the Engine envelope, and confirms both catalog sources. Negative
coverage rejects escaped paths, linked files and directories, hard links,
case collisions, scheduler ownership, malformed JSON, and an output inventory
that cannot fit the structured transport before any snapshot is persisted.

Fresh Mission proof remains pending a safe reload of the agent-owned port 7777
backend and an uncontaminated run directory. The failed fresh-22 lineage is
retained only as exact failure evidence and will not be reused.
