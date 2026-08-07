# Overlay Preview yerui Revert And End-to-End Repair

## Recall

### User request

- Automate the preview repair.
- Remove preview code introduced from the yerui branch.
- Keep iterating until end-to-end preview verification is healthy.

### Task definition

Restore the pre-yerui Browser Preview architecture as the single preview source,
then prove that a task-scoped target can render through the native Overlay surface
and that Playwright can persist screenshot evidence consumed by Visual QA and
Integrity.

### Input and output contract

- Input:
  - current branch `v0.0.2beta`;
  - merged yerui preview commits `2c173feae4`, `026c9dc6b3`, `245b3245f7`,
    `492702bd87`, and `bc24e43657`;
  - pre-merge first-parent baseline `d4841d890a`;
  - failed task `tsk_f445b9853001QI3EyyWZFKyk7u`, whose terminal error reports
    missing durable seven-page browser screenshot evidence;
  - the current dirty worktree, which must be preserved.
- Output:
  - no yerui manual raw-URL target owner or native DOM-selection/comment owner;
  - native task-scoped preview target remains the only live preview owner;
  - explicit Playwright capture remains the only screenshot evidence producer;
  - focused unit, Rust, Node browser, route/evidence, Visual QA, and Integrity
    tests pass;
  - generated screenshots are manually reviewed after automation passes.

### Runtime and environment

- Repository: `C:/Users/chuan/myhexin-local/opecorvus`.
- Runtime dependencies come from the checked-in Bun workspace and
  `packages/overlay/test/browser-runner.mjs`.
- Windows browser tests must launch Playwright through Node, never Bun.
- Existing OpenCorvus and Overlay processes must not be restarted, refreshed,
  killed, or reused; verification uses isolated fixtures and processes.

### Timeout strategy

- Benchmark child processes are controlled by stdout/stderr inactivity, not
  elapsed time since process start.
- The backend preview pressure runner uses
  `--idle-timeout-ms 120000` and disables Bun per-test elapsed timeout.
- The Node browser runner owns its own browser inactivity diagnostics.

### Acceptance criteria

1. Exact yerui preview changes are removed without resetting or overwriting
   unrelated dirty worktree edits.
2. No iframe, PNG live loop, local signal, query override, raw URL body,
   fallback preview path, or compatibility branch exists.
3. A saved backend task preview target opens the native child WebView and can
   navigate back, forward, and reload.
4. Capture is explicit and persists readable task-scoped screenshot evidence;
   evidence is not a second live-preview owner.
5. Visual QA and Integrity tool contracts can inspect the persisted preview
   evidence from real task context.
6. Unit/route/protocol/Rust tests, Node browser tests, typecheck/i18n/docs health,
   and `git diff --check` pass.
7. Generated preview screenshots are manually inspected after benchmark pass.

### Hard constraints

- No fallback, dual source, gate, state-machine workaround, blind patch, broad
  Git reset/revert, or extra worktree.
- Preserve user changes in the dirty worktree.
- Every behavior change must have focused regression coverage.
- Do not claim completion from mocked contracts alone; visual evidence is
  required.

### Disk records read before implementation

- `AGENTS.md`
- `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
- `specs/current/architecture/09-verification-evidence.md`
- `specs/records/2026-07/2026-07-01-browser-preview-native-webview-root-repair.md`
- `specs/records/2026-07/2026-07-05-overlay-preview-cli-root-repair.md`
- `specs/records/2026-07/2026-07-08-browser-preview-dom-selection-sync.md`
- `specs/records/2026-07/2026-07-08-v0.0.2-yerui-0707-merge.md`
- `specs/records/2026-07/2026-07-09-browser-preview-selection-unmounted-rejection.md`
- `specs/records/2026-07/2026-07-09-overlay-page-preview-e2e-repair.md`
- `specs/records/2026-06/2026-06-18-browser-preview-repair-tool-algorithm-pressure-benchmark.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/SKILL.md`
- `C:/Users/chuan/.codex/skills/opencorvus-expert-squad-creator/references/open-corvus-expert-squad-checklist.md`
- `packages/opencorvus/test/AGENTS.md`
- `specs/current/architecture/04-extensions.md`
- `specs/records/2026-07/2026-07-10-dynamic-expert-squad-agent-identity.md`

### Whole-repository search and commit evidence

- Searched Browser Preview target, evidence, native command, Overlay component,
  Visual QA, and Integrity call points across `packages/overlay`,
  `packages/opencorvus`, `packages/transport-protocol`, `packages/sdk`, and
  current/historical specs.
- `git diff b3e064bc71^1 b3e064bc71` identifies the actual merge effect on the
  main line.
- `git log d4841d890a..b3e064bc71^2` identifies the incoming yerui commits.
- The current branch contains the yerui branch tip `ef4fd506d1` as an ancestor.
- The expert-squad registry/manager/resolver/payload/package call-point inventory
  from the expert-squad checklist was rerun after the preview evidence tests
  proved project startup was blocked before capture.

### Callpoint inventory

| Surface                                                             | Authority and action                                                                                                                                                             |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/server/routes/browser-preview.ts`          | Remove yerui POST raw-URL target save; keep saved-target selection, capture, evidence, and comparison routes.                                                                    |
| `packages/overlay/src/components/BrowserPreviewPanel.tsx`           | Restore pre-yerui task-target selector, viewport/capture controls, native live surface, and explicit evidence states; remove DOM selection/comment and manual address ownership. |
| `packages/overlay/src/services/browser-preview.ts`                  | Remove raw-URL save client; retain load/select/capture/evidence clients.                                                                                                         |
| `packages/overlay/src/services/browser-preview-native.ts`           | Remove selection commands; retain sync/navigate/close.                                                                                                                           |
| `packages/overlay/src/services/{host-transport,tauri-transport}.ts` | Remove selection command/result types and invocations only.                                                                                                                      |
| `packages/transport-protocol/src/index.ts`                          | Remove selection protocol commands; retain native sync/navigation/close.                                                                                                         |
| `packages/overlay/src-tauri/src/main.rs`                            | Remove yerui guest DOM-selection runtime and commands while preserving unrelated dirty runtime-path/job-object work.                                                             |
| `packages/overlay/src/styles/surfaces/inspector.css`                | Remove selection/comment/manual-address styling and restore the pre-yerui browser chrome/capture surface.                                                                        |
| `packages/overlay/src/main.tsx`                                     | Remove only the yerui selected-node-to-composer bridge while preserving current unrelated composer work.                                                                         |
| Overlay locale files                                                | Remove selection/comment/manual-address copy and restore capture/candidate/navigation copy; preserve unrelated locale edits and recalculate panel revision.                      |
| Preview unit/browser/Rust tests                                     | Restore pre-yerui behavior and add regression assertions that removed raw-URL and selection paths stay absent.                                                                   |
| OpenAPI/SDK/API docs                                                | Regenerate from the restored route contract; do not hand-edit generated drift.                                                                                                   |

### Independent feedback

No subagent was used because the current tool policy permits subagents only when
the user explicitly requests delegation or parallel agent work.

## Baseline benchmark result

- The benchmark contract self-test passed.
- The full pressure runner executed under inactivity timeout but failed with
  103 passed / 111 failed because the current dirty expert-squad/agent identity
  refactor rejects package/schema fixtures during global initialization. These
  failures are tracked as current-worktree integration noise, not treated as
  proof of a preview regression.
- The failed production task independently proves the actual acceptance gap:
  all 15 implementation goals passed, but Visual QA did not persist accepted
  screenshots for seven routes.
- After the Overlay rollback, the native Node/Chromium test passed with an
  explicit three-viewport `/browser-preview/capture` request and no retired
  `/live/*` calls. The visual stress test also passed after its Work Ledger
  fixture was repaired.
- Backend evidence runner contract tests passed, but all tests that open a real
  temporary project failed before Playwright because the current uncommitted
  dynamic expert-squad refactor leaves repository packages incompatible with
  the authoritative registry schema: projection entries lack required labels,
  legacy top-level `team/workflow/agents` remain in package manifests, and the
  MirrorTest package still contains the rejected `virtual-agents/` root.

## Startup Toolchain Repair Addendum

This is not a preview fallback or scope expansion. Real preview capture opens a
project, and project open provisions/validates expert-squad payloads before the
browser runner can execute. The current invalid package state therefore blocks
the required E2E input. The repair must follow the already-landed dynamic-agent
identity record: `capability_projection.agents.<agent_id>` owns identity,
`label` is required, `base_role` only seeds the runtime template, and canonical
resources live under `agents/<agent_id>/`. No legacy schema compatibility parser
will be added.

## Plan

1. Restore the clean preview-owned files to the pre-merge first-parent contract.
2. Surgically remove preview hunks from dirty shared files.
3. Regenerate API/SDK/docs and update focused tests.
4. Run focused route/protocol/Rust tests and isolated Node browser screenshots.
5. Run evidence/Visual QA/Integrity tests after separating or repairing current
   global fixture initialization failures.
6. Run typecheck, i18n, docs health, diff checks, then manually review screenshots
   and the final diff.

## Results

### Implemented

- Restored the preview-owned runtime, Overlay, transport protocol, styles, and
  focused tests to the `d4841d890a` first-parent architecture. Dirty shared
  files were edited hunk-by-hunk; no reset, checkout, or broad revert was used.
- Removed the yerui raw-URL `POST /task/:taskID/browser-preview/target`, manual
  address owner, DOM-selection/comment bridge, native selection runtime, and
  selection protocol commands. The existing target-selection `PUT` remains.
- Regenerated OpenAPI, TypeScript SDK, and both API reference documents. The
  route inventory now contains only the task target resolver, explicit capture,
  comparison, evidence/artifact reads, and saved-target selection.
- Repaired the current Work Ledger fixtures in the restored Node browser tests.
  The native-host test now proves explicit `{ targetID, viewportIDs:
["desktop", "tablet", "mobile"] }` capture and rejects retired `/live/*`
  requests. The non-native test refreshes saved evidence instead of attempting
  native page navigation.
- Repaired six repository expert-squad manifests and regenerated their payload
  to the already-recorded strict dynamic-agent schema so real temporary-project
  preview tests can open a project. No legacy schema parser was introduced.
- Migrated MirrorTest package resources from `virtual-agents/` to canonical
  `agents/` paths and removed package prompt files for non-dispatchable legacy
  roles, as authorized by the dynamic-agent cleanup record.
- Updated `orchestrator/tools.ts` to import the new advisory
  `dispatchAdapterID` workflow API rather than deleted legacy exports. This was
  required to make the OpenAPI/SDK generator executable; no compatibility
  export or fallback was added.

### Passing verification

- Backend task target and persisted evidence: **24 passed, 0 failed** across
  `browser-preview/target.test.ts` and `browser-preview/verification.test.ts`.
- Backend route pressure: **19 browser-preview route tests passed**, including
  arbitrary URL body rejection, cross-task isolation, evidence PNG/artifact
  validation, and removal of the old project-scoped route.
- Overlay preview/service/native, transport protocol, and preview theme clean
  set: **52 passed, 0 failed**. A broader combined run additionally exposed one
  unrelated stale `TaskDirBar` capability expectation from the concurrent
  titlebar/runtime-toolbar refactor.
- Tauri preview bounds and navigation actions: **2 passed, 0 failed**.
- Overlay TypeScript: `tsc --noEmit` passed.
- Node/Playwright browser verification through Node, not Bun:
  - persisted evidence non-native surface: passed;
  - native surface navigation plus explicit three-viewport capture: passed;
  - ten-state target/evidence/live/failure/layout visual stress: passed.
- Generated contract health:
  - SDK build passed;
  - `api:routes-check` passed across 30 route files;
  - `docs:check` passed with 249 operations in 24 groups;
  - `git diff --check` passed.
- Final production-source residue scan found no raw target-save client, selection
  command, selection runtime, or `/browser-preview/live/*` path. The only
  `/browser-preview/target` operation in generated output is the retained saved
  target-selection `PUT`.

### Visual review

- Manually reviewed
  `packages/overlay/.scratch/browser-preview-evidence/01-evidence-backed-preview.png`:
  persisted task-scoped screenshot, evidence summary, viewport, URL, refresh,
  and explicit capture controls are visible; native navigation is disabled on
  the non-native host as designed.
- Manually reviewed the native surface/loading captures and the generated
  ten-state stress set, including load failure, missing target, persisted
  evidence, stale selection failure, alternate native target, narrow layout,
  and terminal target failure. Chromium cannot paint Tauri child-WebView pixels,
  so child-WebView ownership is additionally covered by the native transport,
  Rust command, and Node invocation assertions.

### Concurrent-worktree blockers kept separate

- The full pressure benchmark reached its own `idle_timeout` after exercising
  the route suite. Its failures are in the in-progress dynamic expert identity
  migration (`runner-prompt`, skill mounts, obsolete static dispatch schema) and
  one Windows `EBUSY` fixture cleanup, not in the reverted preview route.
- The OpenCorvus package typecheck reports the same pre-existing incomplete
  dynamic-agent migration across runner, session loop, skill mounts,
  coordination, and orchestrator capability fields. Overlay typecheck is clean.
- The panel i18n revision is current. The repository-wide i18n checker is still
  blocked by 23 unrelated unused keys from concurrent command-palette/titlebar/
  expert-squad UI changes. They were not deleted because repository policy
  requires explicit user authorization before deleting unrelated dead code.
- The host-capability source assertion still expects controls removed by the
  concurrent `TaskDirBar`/titlebar refactor. Production preview capability
  declarations and native preview tests pass; production code was not changed
  to satisfy the stale assertion.
- The machine contains long-lived Bun supervisor and `git ls-files` processes
  from other tasks dating back to June 30. They were not killed because the
  repository explicitly forbids terminating existing OpenCorvus-related
  processes without approval. This made temporary-project pressure runs slow
  but did not affect the isolated Node browser results.
