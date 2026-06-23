# Reference Comparison Evidence Chain Root Repair

Date: 2026-06-20

## Task

Root-cause and repair the OpenCorvus visual reference evidence chain so a
reference-driven frontend task cannot substitute standalone screenshots or text
reports for task-scoped `browser_preview_compare_regions` evidence.

The triggering task was `tsk_ee0f11c510011D4AnsTMGr0bh7`. Database and artifact
forensics showed:

- `browser_preview_compare_regions` actual tool calls for the task: `0`.
- `browser_screenshot` calls existed, but they were standalone screenshots.
- Three `browser_preview` calls returned `target.status="missing"` and did not
  persist a `browser_preview_target`.
- Integrity later detected the missing `VisualEvidenceBundle` and missing
  preview target, but Build and Visual QA had already accepted ordinary
  screenshots as visual evidence.

## Recalled Constraints

- `AGENTS.md` forbids fallback logic, dual sources, and surface patches.
- `2026-06-12-explicit-browser-preview-agent-tool.md` makes explicit
  `browser_preview` the only automatic preview target owner. Generic bash,
  shell, browser MCP output, and old targets must not silently write or satisfy
  preview target state.
- `2026-06-18-browser-preview-repair-tool-algorithm-pressure-benchmark.md`
  requires `browser_preview_bind_local_module` -> `browser_preview_compare_regions`
  tool-level reachability and `operation_kind="reference-comparison"` evidence.
- `2026-06-19-browser-preview-repair-pressure-benchmark-timeout-fix.md`
  requires inactivity-aware benchmark timeout behavior.
- `2026-06-19-final-visual-qa-scoped-build-context.md` removes old webpage
  score/judge acceptance routes. Visual QA is blocker-based, but explicit
  reference parity still requires region comparison evidence.

## Current Call Point Inventory

| Surface                                                           | Current behavior                                                                                                                                                                                              | Required repair                                                                                                                                                                             |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/tool/browser-preview.ts`                 | Starts the service through `BashTool`, then probes explicit/process-output URLs once through `waitForBrowserPreviewUrlReachable`. A slow dev server can miss the window and return `target.status="missing"`. | Keep `browser_preview` as sole owner, but make its own startup observation and reachability wait robust enough for slow URL output and slow page readiness.                                 |
| `packages/opencorvus/src/browser-preview/liveness.ts`             | Uses a fixed short reachability window and HTTP status only.                                                                                                                                                  | Add configurable readiness waiting that can be reused by the explicit tool tests without relying on browser-session fallback.                                                               |
| `packages/opencorvus/src/browser-preview/extract.ts`              | Exposes output URL extraction and generic `persistBrowserPreviewUrls`.                                                                                                                                        | Do not reintroduce generic automatic materialization. Any helper used for this repair must be called only by `browser_preview` or direct tests.                                             |
| `packages/opencorvus/src/tool/browser-preview-compare-regions.ts` | Correctly requires a persisted `browser_preview_target` ID.                                                                                                                                                   | Preserve this strict target ID requirement.                                                                                                                                                 |
| `packages/opencorvus/src/acceptance/visual-evidence.ts`           | `VisualRegionEvidence.evidenceRefs` is `string[]`; `visualEvidenceBundlePasses` does not resolve refs to `browser_preview_evidence` rows or require `reference-comparison`.                                   | Add a resolver/validator contract for required reference regions. Passing visual bundles must include readable `browser_preview_evidence` rows with `operationKind="reference-comparison"`. |
| `packages/opencorvus/src/visual-qa/schema.ts`                     | Evidence type still allows generic `screenshot`; refs are free-form strings.                                                                                                                                  | Add a first-class `reference_comparison` evidence type or structured equivalent. Keep screenshots as context only.                                                                          |
| `packages/opencorvus/src/visual-qa/output-tools.ts`               | `accepted=true` only requires some evidence and coverage, so screenshot-only reports pass.                                                                                                                    | When a report claims or covers reference parity, `accepted=true` must require reference comparison evidence or reject with a blocker message.                                               |
| `packages/opencorvus/src/integrity/acceptance-tools.ts`           | `inspect_visual_evidence` summarizes bundle pass/fail using bundle-local status only.                                                                                                                         | Surface invalid/missing reference-comparison refs as not passing so Integrity cannot pass from prose alone.                                                                                 |
| `packages/opencorvus/src/engine/workflow.ts`                      | Visual QA projection treats `accepted=true` and zero blockers as completed.                                                                                                                                   | Projection may remain simple only if the Visual QA submit tool enforces the evidence contract before accepting.                                                                             |
| `packages/opencorvus/test/tool/browser-preview.test.ts`           | Covers registration, printed URL, explicit URL, command-derived diagnostic-only, no stale target reuse, and bind->compare.                                                                                    | Add slow explicit/process-output readiness regressions.                                                                                                                                     |
| `packages/opencorvus/test/visual-qa/output-tools.test.ts`         | A screenshot-only accepted report is currently the default valid fixture.                                                                                                                                     | Add negative screenshot-only reference parity test and positive reference-comparison fixture.                                                                                               |
| `packages/opencorvus/test/integrity/acceptance-tools.test.ts`     | Visual bundle fixture uses screenshot/report refs, not persisted comparison evidence.                                                                                                                         | Add invalid-ref and valid `browser_preview_evidence` comparison tests.                                                                                                                      |

## Acceptance Criteria

- `browser_preview` persists a task-scoped target when an explicit URL or
  process-output URL becomes reachable after the initial short startup window,
  without using old targets, generic command output, browser navigation, or raw
  URL comparison as fallback.
- Command-derived URLs remain diagnostic only unless explicitly supplied as
  `url`.
- `browser_preview_compare_regions` continues to require a persisted target ID.
- Visual QA cannot accept screenshot-only evidence when reference parity is in
  scope; it must cite `reference_comparison` / `browser_preview_evidence`
  evidence or submit blockers.
- `VisualEvidenceBundle` pass inspection for required regions requires readable
  `browser_preview_evidence` artifacts with `operationKind="reference-comparison"`
  and `status="passed"`.
- Integrity visual inspection reports missing, unreadable, wrong-kind, or
  non-comparison refs as `not_passing`.
- Targeted tests and the browser-preview repair pressure benchmark pass.
- Independent review agents find no remaining path where standalone screenshots
  or prose can satisfy explicit reference parity.

## Non-Goals

- No overlay-side URL override or iframe fallback.
- No automatic target creation from ordinary `bash`, session shell, or browser
  MCP output.
- No acceptance score/judge resurrection from retired `webpage_*` tools.
- No mobile parity requirement for the cited TradingView desktop task; generic
  tooling may still support mobile viewports.

## Implemented Repair Notes

- `browser_preview` now observes background process output after the bash
  startup window and waits for late printed preview URLs. Explicit URLs own
  target selection; printed URLs under an explicit URL remain diagnostic only.
- `persistBrowserPreviewEvidence` now requires `operationKind` at write time
  and parses it at runtime. The writer no longer defaults malformed input to
  `preview-capture`.
- Readable passed `reference-comparison` evidence now requires the comparison
  artifact set: `source_crop`, `implementation_crop`, and `side_by_side`.
- The writer also rejects passed `reference-comparison` evidence before
  inserting when that artifact set is incomplete, so malformed passed rows are
  not created through the supported API.
- The generated OpenAPI/SDK contract no longer exposes `operationKind` as
  optional or defaulted to `preview-capture`.
- `VisualEvidenceBundle` cannot pass with zero required regions. Required
  regions must resolve to readable, passed `browser_preview_evidence` rows whose
  `operationKind`, `taskID`, `regionID`, and `viewportID` match exactly.
- Visual QA reference parity acceptance now requires authoritative
  `requiredReferenceRegions` from task evidence. A report cannot self-shrink the
  region set or satisfy explicit reference parity with screenshots.
- Orchestrator derives Visual QA reference parity from active visual-evidence
  scorers, frontend-design `reference_artifacts`, and current
  `VisualEvidenceBundle` regions.
- Workflow projection now parses full `VisualQaReportSchema` and refuses bare
  `accepted=true` JSON or reference-parity reports without comparison refs.
- Workflow projection does not mark Visual QA completed for reference-parity
  tasks from decision-log strings alone, even when the report contains non-empty
  comparison ref strings. Synchronous projection cannot prove artifact
  readability, so the final pass remains Integrity's validated gate.
- Workflow projection now passes the current task-scoped `VisualEvidenceBundle`
  into `deriveVisualQaReferenceParityContext`. The bundle reader is shared with
  orchestrator instead of duplicated, and a bundle-only required region can no
  longer be hidden by a screenshot-only Visual QA report that claims reference
  parity is not required.
- A malformed `visual-evidence-bundle.json` is no longer silently swallowed by
  the shared reader. Missing file means no bundle; existing malformed or
  wrong-task evidence is surfaced as a broken evidence artifact.
- Integrity `submit_integrity_consensus` blocks `verdict=pass` when reference
  visual evidence is required but no valid passing `VisualEvidenceBundle` is
  present. This is tool-level validation, not prompt-only guidance.
- `reviewIntegrity()` now forwards `visualEvidenceRequired` and `projectRoot`
  into the single-session integrity toolkit. The real agent terminal tool path
  is covered by `team-agent.test.ts`; the prior direct toolkit test alone was
  insufficient because it did not exercise the production call chain.
- Browser preview evidence image endpoints now respect evidence operation
  kind. `capture.png` is only served for `preview-capture`; region artifact
  endpoints are only served for `reference-comparison`. This prevents
  reference-comparison implementation screenshots and source-binding puzzle
  images from being reclassified as ordinary screenshots or final comparison
  artifacts.
- Workflow projection treats any accepted report that declares reference parity
  as `pending` instead of `completed`, even when authoritative context is
  absent. Synchronous projection cannot verify browser-preview evidence rows,
  so reference parity completion remains the Integrity-validated path.
- Workflow projection now skips `latest_summary` entries while scanning for the
  latest full `report_*`, matching the real Visual QA write order where the
  structured report is appended before the summary.
- Build terminal reports now have an explicit
  `reference_comparison_evidence_refs` field. The field is optional for
  ordinary builds, but a build whose structured context declares reference
  parity cannot record `status="passed"` unless those refs resolve to readable,
  passed `browser_preview_compare_regions` `reference-comparison` evidence.
- Orchestrator now passes current-target reference parity context into Build.
  Goal builds use the current goal's structured acceptance scorers; task-level
  direct builds use the task-level reference parity context. This avoids
  keyword guessing and avoids forcing every early non-visual goal to provide
  comparison evidence just because the task has reference artifacts.
- External executor synthesized passed results are downgraded to failed when
  the active Build context requires reference-comparison evidence but the
  synthesized result cannot provide verifiable refs.
- The pressure benchmark now includes an SDK/OpenAPI contract test that asserts
  `operationKind` is required and has no `preview-capture` default.
- The pressure benchmark now includes Build terminal reference-comparison
  report validation, covering screenshot-only rejection and readable
  `browser_preview_evidence` acceptance.
- The pressure benchmark runs the mock-heavy Integrity team-agent suite in an
  isolated Bun test process. This keeps the benchmark coverage while avoiding
  test-level module mock contamination of browser-preview tool tests.
- The pressure benchmark now covers browser-preview algorithms plus Visual QA,
  Integrity, workflow projection, and orchestrator tool schema regressions.

## Scope Exception Inventory

The updated goal asked to keep changes near frontend-design/frontend-research
and frontend expert review unless a severe common bug is proven. The following
out-of-scope areas were changed because independent review found concrete
systemic bypasses in the visual evidence chain:

| Area                                                | Files                                                                                                      | Why this was in scope for the root repair                                                                                                                                                                                        |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser preview evidence persistence/API            | `src/browser-preview/persist.ts`, `src/server/routes/browser-preview.ts`, browser-preview route/tool tests | The task could create or expose evidence rows without a strict `operationKind` contract, and reference-comparison/source-binding artifacts could be read through screenshot/comparison endpoints with the wrong semantics.       |
| Visual QA/workflow projection                       | `src/visual-qa/*`, `src/engine/workflow.ts`, workflow/visual-qa tests                                      | Visual QA and workflow could accept or project screenshot-only/prose/self-reported reference parity without verified comparison evidence.                                                                                        |
| Integrity final gate                                | `src/integrity/*`, integrity tests                                                                         | The production `reviewIntegrity()` path did not forward required visual evidence gate inputs, so a pass verdict could bypass missing `VisualEvidenceBundle`.                                                                     |
| Build terminal report contract                      | `src/build/*`, build-agent tests                                                                           | Independent review found Build still accepted standalone screenshot/prose self-reports for structured reference parity. Build had to consume the same evidence contract before accepting `report_build_result(status="passed")`. |
| Orchestrator handoff into Build/Visual QA/Integrity | `src/orchestrator/tools.ts`                                                                                | Orchestrator must pass structured task/goal-scoped visual evidence context into Build, Visual QA, and Integrity; otherwise agents receive incomplete evidence contracts.                                                         |
| SDK/OpenAPI and benchmark                           | `packages/sdk/*`, pressure benchmark script/tests                                                          | The generated API contract had to encode `operationKind` as required, and the benchmark had to fail if that contract regresses.                                                                                                  |

## Dirty Workspace Exclusions

Independent scope review also found many unrelated dirty-tree changes in this
workspace: mission archive export, runtime isolation, stage continuation,
goal-refill/interaction-blocker scheduling, AGENTS/skill/provider metadata, and
overlay agent rail/UI service work. Those files are not part of this repair
claim and were not reverted or normalized here. They are a repository-state
risk, not a failure of the current reference-comparison repair. The current
repair scope is the reference-comparison evidence chain and the explicitly
listed scope exceptions above; final verification below is bound to those files
and tests.

## Verification Snapshot

Commands run from `packages/opencorvus`:

- `bun run typecheck` passed.
- Focused suite passed: `bun test test/visual-qa/output-tools.test.ts
test/integrity/acceptance-tools.test.ts
test/integrity/browser-preview-tool.test.ts
test/engine/workflow-integrity-step.test.ts test/tool/browser-preview.test.ts
test/benchmark/browser-preview-repair-pressure.test.ts`.
- After independent review found the bundle-only workflow projection gap,
  `bun test test/engine/workflow-integrity-step.test.ts` passed with the new
  regression `does not project visual_qa as completed when VisualEvidenceBundle
alone requires reference parity`.
- `bun run typecheck` passed after the shared reader/workflow repair.
- OpenAPI/SDK check confirmed browser-preview evidence `operationKind` has no
  default, is included in OpenAPI `required`, and is required in generated SDK
  types.
- After the Build terminal repair, the focused Build suite passed:
  `bun test test/build-agent/reference-comparison-report.test.ts
test/build-agent/types.test.ts test/build-agent/prompt-context.test.ts`.
- After independent review requested narrower Build negative coverage,
  `test/build-agent/reference-comparison-report.test.ts` also covers fake refs,
  `preview-capture`, `source-binding`, failed `reference-comparison`, and the
  external-executor downgrade helper.
- `bun run typecheck` passed after the Build terminal repair.
- Pressure benchmark passed after the final Build/Integrity/API/workflow
  repair:
  `bun script/benchmark/browser-preview-repair-pressure.ts --idle-timeout-ms
120000 --per-test-timeout-ms 30000`. It now runs a main group with 170 tests
  across 19 files plus isolated `team-agent` with 8 tests, covering 178 tests
  total across 20 files, including server browser-preview routes, SDK/OpenAPI
  contract checks, and Build terminal reference-comparison validation.
- Focused suite passed:
  `bun test test/server/browser-preview-routes.test.ts
test/server/browser-preview-sdk-contract.test.ts
test/engine/workflow-integrity-step.test.ts test/integrity/team-agent.test.ts
test/integrity/browser-preview-tool.test.ts`.
- `bun test test/tool/browser-preview.test.ts` and
  `bun test test/integrity/team-agent.test.ts` each pass in isolated processes;
  running them in one Bun process intentionally demonstrates mock contamination,
  which the pressure benchmark now avoids by process isolation.
- `bun test packages/opencorvus/test/orchestrator/architect-fidelity-gate.test.ts
packages/opencorvus/test/build-agent/prompt-goal-discipline.test.ts` passed
  from the repository root. The architect-fidelity test intentionally uses
  repo-root-relative `packages/opencorvus/...` owned paths and fails if invoked
  from `packages/opencorvus` with `workDir=process.cwd()`.

Final independent review closed the remaining open item. Epicurus rechecked the
current disk Build/reference-comparison path and reported no P0/P1/P2 findings:
fake refs, `preview-capture`, `source-binding`, failed `reference-comparison`,
and standalone screenshot/prose evidence are all rejected before a required
reference-parity Build can pass. Ohm rechecked scope/documentation and reported
no P0/P1/P2 findings: the scope exception inventory, dirty workspace exclusions,
and pressure benchmark count of 170 + 8 = 178 are now consistent.
