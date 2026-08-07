# Research-to-Deliverable Case Benchmark

Date: 2026-07-25
Status: Active benchmark and repair record
Owner: Codex

## Recall

### User request

- Execute the ten E01–E10 cases recorded in `specs/artifacts/长程编排测试.md`.
- Evaluate actual task-execution quality rather than accepting advisory prose or a terminal status as delivery.
- Repair every product or expert-squad defect exposed by the runs, add regression coverage, and retest the affected cases.
- Preserve all unrelated concurrent changes in the shared worktree.

### Acceptance criteria

- Every case is submitted through a real OpenCorvus Task execution surface.
- Every case produces a durable, versioned test report beneath
  `specs/records/2026-07/2026-07-25-research-deliverable-case-benchmark/` for
  later optimization and longitudinal comparison.
- Each run records the exact Task, Goal, Session, artifact, evaluation, local verification, browser screenshot, and terminal evidence available from the benchmark.
- Research claims retain source and retrieval-date evidence; generated data and calculations are reproducible.
- Website/application cases produce a runnable desktop target, real interactions, Node-launched browser evidence, and personally reviewed screenshots.
- Spreadsheet, PDF, dataset, and code-repair cases deliver inspectable files rather than prose placeholders.
- A Task is not accepted solely because its status is `completed`; the requested files, behavior, calculations, sources, tests, and visual evidence must independently pass.
- Failures are classified from observable symptom through direct trigger and underlying code/prompt/data-flow cause. Unknown links remain explicit.
- Explicit, traceable defaults and partial-but-honest values do not fail a
  Task by themselves. Failure requires a proven evidence error, missing
  required evidence, invalid path, stuck execution, or another concrete
  acceptance violation; test-owned hard-failure assumptions are not product
  requirements.
- A generic infrastructure failure is repaired in OpenCorvus; a package-owned behavior failure is repaired in the responsible Expert Squad; generated-project defects are repaired in the same benchmark project and rerun.
- No fallback, task-specific routing gate, hidden synthetic evidence, static fake interaction, or mocked End-to-End claim.
- The user-owned backend on port 7878 and any existing Overlay/Vite process are not restarted, refreshed, stopped, or reused as destructive benchmark state.

### Sources read before execution

- `AGENTS.md`
- `specs/artifacts/长程编排测试.md`
- `specs/records/2026-07/2026-07-18-crypto-trading-long-mission-benchmark.md`
- `specs/records/2026-07/2026-07-20-inline-base64-retry-evidence-poison.md`
- `packages/web/src/content/docs/zh-cn/operations/benchmark.mdx`
- `packages/opencorvus/script/benchmark/mission-benchmark.ts`
- `packages/opencorvus/script/benchmark/mission-scenario.ts`
- `packages/opencorvus/script/benchmark/quality-checks.ts`
- `packages/opencorvus/script/benchmark/review-deliverable.ts`
- `expert-squads/builtin/research-studio/README.md`
- `expert-squads/builtin/frontend-innovate/README.md`
- `expert-squads/builtin/review-debug/README.md`
- `expert-squads/mirror/prism/README.md`
- `packages/opencorvus/src/mission-skill/builtin/mirror-prism-cluster/SKILL.md`

### Repository-wide search inventory

- Benchmark and Mission surfaces:
  `rg -n "mission-benchmark|mission-scenario|MissionRoutes|/mission/wake|mailbox" packages/opencorvus/script/benchmark packages/opencorvus/script`.
- Task quality and visual evidence:
  `rg -n "createTask|promptProfile|acceptance|qualityVerdict|verify_cmd|report_build_result|Browser Preview|screenshot" packages/opencorvus/src/{task-api,orchestrator,engine,server} packages/opencorvus/script/benchmark/overlay-web-benchmark.ts`.
- Expert Squad identities, Skills, and binding workflows:
  `rg -n "\"id\"|\"name\"|virtual_workflows|production_skill_names|selector" expert-squads .opencorvus/expert-squads packages/opencorvus/src/mission-skill/builtin`.
- The retired Overlay benchmark was inspected only as historical failure
  evidence. Current execution uses the formal running OpenCorvus service and
  its persistent database directly; no benchmark Task runner is retained or
  invoked.

### Independent-agent feedback

- The user later explicitly requested one independent Agent audit. The
  read-only audit found that none of the ten Tasks was initially terminal,
  distinguished honest unknown/default values from concrete evidence
  failures, identified E05's budget controls as a real behavior conflict, and
  identified E05's first three Goals as an unsuperseded duplicate graph. It
  also confirmed that E06 and E09 already had enough durable execution
  evidence to prioritize final closure rather than repeat implementation.
- The main Agent remains responsible for every repair and for reconciling the
  independent findings against the live API and persistent database.
- A second read-only pass traced E05 and E04 through the exact
  `architect_contract_graph`, `engine_goal.contract_graph_artifact_id`,
  `supersede_of`, and `goal_retraction` facts. It confirmed there is no
  persisted active-plan pointer and no need to add one: the current execution
  projection is the newest ContractGraph with at least one exact Architect
  Goal binding, plus operator-instruction Goals, folded to unambiguous Goal
  revision tips. Unbound conflicting graphs remain history and do not replace
  a successfully projected graph. RequirementSet and ContractGraph audit views
  continue to show all parallel facts.
- The port-7999 smoke audit later distinguished standby prompt ownership from
  Instance lease ownership. It proved that terminal projected workers retained
  process-local prompt owners without blocking concurrent Tasks, and that the
  completed Goal's sessionless successor attempt hid the exact Build Host
  evidence and inflated the Board retry count. The main Agent independently
  reproduced both API/database effects before accepting the repair boundary.

### Initial environment evidence

- Source branch: `v0.0.18beta`.
- The shared worktree already contains concurrent Expert Squad, Software Development Kit, Overlay, documentation, and test changes. They are unrelated and must remain untouched.
- The already-running real service listens on `127.0.0.1:7879` for
  `/Users/yangheng/Documents/OpenCorvus-Demos/prism` and reports the persistent
  database `/Users/yangheng/.local/share/opencorvus/opencorvus.db`. It is not
  stopped, restarted, or refreshed by this run.
- No benchmark-owned service or project existed at the start of this record.
- Existing browser benchmark runs use a headed 1600×1200 Chromium window and persist Task/UI screenshots.

## Execution design

1. Submit each E01–E10 request through the formal `/task` product route on
   the already-running OpenCorvus service, with explicit model, prompt profile,
   verification command, and a dedicated Git project.
2. Use the persistent database reported by `/global/health`; inspect Task,
   Goal, Session, protocol-event, artifact, interaction, and completion rows
   directly rather than accepting a process-local summary.
3. Execute independent cases concurrently across separate projects, while
   keeping one database and one production service as the shared
   infrastructure-under-test.
4. Use the real Overlay and browser control for UI state, interaction, and
   screenshot acceptance. Do not synthesize page state from a runner.
5. For each terminal run, inspect the report, event chronology, Task board, transcript, project Git history, source/data files, verification output, runtime target, and screenshots.
6. Score each case across source quality, artifact completeness, functional correctness, verification strength, visual quality, traceability, and scope control. Record evidence and defects rather than only a numeric score.
7. Repair proven root causes in their owning surface, add a regression that fails for the original behavior, run focused checks, and resume or rerun the exact affected case.
8. Perform final cross-case review, repository checks, document-health validation, task-owned commit/push, and an honest unresolved-items report.

## Report archive contract

The archive for each case contains:

- `case-report.md`: human-readable scope, environment, result, quality score,
  evidence, causal analysis, repair, retest, and unresolved items.
- `benchmark-report.json`: the normalized machine-readable benchmark result.
- `event-summary.json`: milestone and failure events needed to reconstruct Task,
  Goal, Session, acceptance, and cleanup chronology without retaining noisy
  per-token stream deltas.
- `artifact-manifest.json`: project-relative deliverables, source/data
  provenance, verification commands, runtime targets, screenshot references,
  Git revision, and content digests.
- `screenshots.md`: indexed source, Overlay, product, and failure-state
  screenshot evidence with exact viewport and target identity.

The top-level `summary.md` compares E01–E10 across OpenCorvus revision, model,
profile, elapsed time, terminal status, evaluation verdict, local verification,
source quality, artifact completeness, functionality, visual quality,
traceability, scope control, defect ownership, repair revision, and retest
status. Raw per-token traces remain in the benchmark-owned runtime directory
and are referenced by stable paths and identifiers; they are not copied into
the repository or treated as acceptance evidence.

## Case matrix

| Case | Primary delivery                                  | Initial profile                                 | Required local verification | Status                                                                                                                         |
| ---- | ------------------------------------------------- | ----------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| E01  | NVIDIA research and valuation website             | `general`                                       | `bun run verify`            | Initial real Task failed on namespaced Artifact ID mismatch; repair active: `tsk_f99b0313c0017FarNzF3G7mIe5`                   |
| E02  | AI coding-tool decision website                   | `general`                                       | `bun run verify`            | Active: `tsk_f999bf59b001o91p1NXv2Za3gO`                                                                                       |
| E03  | Formula-driven workbook and two-page PDF          | `general`                                       | `bun run verify`            | First Build terminal; explicit scheduler-decision wake injected; active: `tsk_f99a18cb4001556p6aLozuIVH8`                      |
| E04  | City cost and opportunity decision website        | `general`                                       | `bun run verify`            | Active: `tsk_f99a18da2001AxQ0Mxe1pX6TsE`                                                                                       |
| E05  | Verified restaurant decision and booking page     | `general`                                       | `bun run verify`            | Active: `tsk_f99a18fcc001JEAsawjzjTUeqQ`                                                                                       |
| E06  | Reproducible electric-vehicle data dashboard      | `general`                                       | `bun run verify`            | Active: `tsk_f99a19cbf001ACWJzGK2BYWkDR`                                                                                       |
| E07  | Evidence-backed original desktop product website  | `frontend-innovate`                             | `bun run verify`            | Frontend Design has registered real desktop render evidence; active: `tsk_f999e60e7001rmnvhUHVubH6nX`                          |
| E08  | Persistent personal-finance web application       | `general`                                       | `bun run verify`            | Research Goal explicitly completed from terminal Build evidence; implementation Goals active: `tsk_f99a19775001eHdNOJkuVmCYWT` |
| E09  | Reproduced open-source defect and repair material | `general` after two invalid `review-debug` runs | `bun run verify`            | Review & Debug predecessor mismatch proven; clean General bootstrap/repair active: `tsk_f99bfa07b001mWdYmdfav2wtL7`            |
| E10  | One-hundred-item feedback insight website         | `general`                                       | `bun run verify`            | Active: `tsk_f99a19daf001qYdeQp482S5ew2`                                                                                       |

## Execution log

- The authoritative 10-case run no longer invokes the deleted historical
  Overlay benchmark entrypoint. All current Task IDs in the matrix were
  created through the formal `/task` route against the running service and are
  persisted in the real SQLite database reported by `/global/health`.
- The first current E01 Task `tsk_f999bf59b002rVPYWb6dqInDHN` persisted a
  valid RequirementSet but failed after three Architect Turns. The actual tool
  payload copied the durable display reference
  `artifact:art_f99a29f69001BjweMNwrJC517q` into
  `requirement_set_artifact_id`; Architect lookup requires the raw database ID
  `art_f99a29f69001BjweMNwrJC517q`, so its prompt projection contained only a
  missing-selection observation rather than the nine requirement payloads.
  Dispatch input schemas now reject namespaced display references in every
  Artifact-ID field, schema descriptions and the Orchestrator prompt state the
  raw-ID contract, and regression tests reproduce the exact prefixed input.
  E01-R1 `tsk_f99b0313c0017FarNzF3G7mIe5` is the real database retest.
- Real dispatch payloads across E01, E02, E05, E08, and E09 proved a second
  shared contract defect: the provider serializes inactive discriminated-union
  properties as `null` or `[]`, while each target's strict Zod object rejected
  those neutral values as unknown keys before the worker could start.
  `dispatch_agent` now models only `null` and empty-array neutral placeholders
  for non-selected branches, removes them before adapter execution, and still
  rejects every non-empty cross-target value. Focused Orchestrator tests pass
  136/136.
- E09 Task `tsk_f999e60ca001WsFRoCwLQgKPmH` selected
  `visual-debug-repair` in an empty project, then correctly failed with no
  concrete repository/revision, issue, reproduction, source, preview, or
  repair evidence. Its investigators also exposed package-definition defects:
  attempts to call `panel`, scans outside the project root, and local file
  paths registered as durable Visual QA evidence refs. Review & Debug
  `2026.07.25.1` now requires an existing fixed repository and concrete
  review/reproduction handoff, routes open-ended project/issue discovery to a
  General predecessor, forbids `panel` and home-directory scans in the
  evidence investigator, and requires durable evidence namespaces in the
  visual investigator. Source-package, payload-generation, and workflow tests
  pass 22/22. E09-R1 `tsk_f99abdd710015yKfqKadsUfJsf` now executes the
  repository selection/bootstrap and repair under General.
- E09-R1 `tsk_f99abdd710015yKfqKadsUfJsf` proved why a selector-only wording
  change is not sufficient in the already-running old process. Although the
  Task snapshot started with `general`, the scheduler dynamically selected
  Review & Debug. Its mandatory first evidence investigator is read-only and
  therefore cannot clone a repository, install dependencies, produce a
  pre-fix failing test, or materialize a reproduction log. The workflow
  correctly terminated with that concrete capability/predecessor mismatch.
  E09-R2 `tsk_f99bfa07b001mWdYmdfav2wtL7` runs in a clean project where
  Review & Debug is not installed, keeping open-source discovery, checkout,
  reproduction, repair, and Pull Request material under General as one real
  Task.
- Actual Explore Sessions in E06, E07, and the failed E09 path called the
  documented read-only Panel status surface but were rejected with
  `panel tool requires ctx.extra.surface`. The worker prompt promised the
  surface while the runner omitted its authorization projection. Worker prompt
  context now carries the canonical `surface="panel"` value; focused runner
  and Panel tests pass 25/25.
- E02's Architect submitted a provider-shaped `modify_goal` call containing
  exact duplicate top-level `title`/`objective` values alongside
  `updates.title`/`updates.objective`. The strict action union rejected the
  duplicate representation before the correction could persist. Architect
  output handling now normalizes only exact duplicates and neutral provider
  placeholders, while conflicting duplicates still fail without mutating the
  collector. Focused Architect output tests pass 59/59.
- E08's first Build Session `ses_06648307cffei4a1I9sVE9U1Bc` completed with
  commit `d244596`, materializing
  `data/research/product-workflows.json` and
  `docs/research/competitive-workflows.md`. The current service predates the
  repaired Goal refill wording, so its Orchestrator became idle with no Goal
  result. A visible operator observation woke the same Task; the Orchestrator
  inspected the terminal child evidence and explicitly called
  `manage_task action=complete_goal`, persisting
  `goal_attempt:e7bc730d`. This is a real scheduler decision and not a
  database-side status edit.
- E03 reached the same old-runtime gap after terminal Build Session
  `ses_0664f526affeObOCq0W3hrH7QK`. The monitor injected the same visible
  evidence-only observation through the formal Task route, and the scheduler
  was woken to make its own explicit completion, retry, or failure decision.
- Provider-shaped `manage_task` calls expose fields from every lifecycle
  action. E08 first attempted `complete_goal` with task-completion
  `summary`/`evidence_refs`, received the strict schema error, then corrected
  itself to `goalID`/`reason` and completed the Goal. To reduce this
  recoverable retry without adding a host gate or compatibility path, the
  public tool description and every action discriminator now enumerate the
  exact selected-action fields and explicitly forbid copying non-null fields
  from another action. The focused Orchestrator description suite passes
  16/16.
- E02 Build Session `ses_066417e2fffepkjgV0X31gXiRF` and E10 Build Session
  `ses_06648f8a5ffeTHmmq6E7HQpuZR` also became terminal while their
  old-runtime Orchestrators were idle. The real E2E monitor sent visible
  evidence-only observations through each Task's `/inject` route. Both
  schedulers were woken to make their own explicit lifecycle decision; no
  SQLite row was edited directly.
- Independent E03 verification exposed a test-artifact classification error,
  not a proven data defect. `python3 scripts/data/verify_dataset.py` exited 1
  because its own negative test expected every synthetic
  `definition-conflict` mutation to hard-fail. The user contract allows
  explicit, traceable defaults; only an actual evidence error, missing
  evidence, invalid path, or stuck execution is failure-worthy. Inspection
  shows the negative test performs a brittle first-string replacement and
  does not prove that any of the delivered 63 facts or their bound evidence
  anchors are wrong. A visible correction superseding the earlier monitor
  message was injected into the same Task: classify and repair/remove the
  over-strict test-owned assertion, and route product repair only if real
  evidence is wrong or missing.
- Independent E06 data verification passed the declared deterministic rebuild
  contract: two empty temporary output directories produced identical
  180-row, twelve-market, 2021–2025 outputs; data-contract tests passed 3/3 and
  comparability isolation tests passed 5/5.
- E06 dashboard verification passed 12/12 interaction tests and a production
  Vite build. An independent live-browser review then opened the real project
  target, selected China, and changed the primary metric from sales to market
  share. The visible summary changed from 12 markets / 17.75 million sales /
  +16.0% to one market / 13 million sales / +18.2%, then to 53% market share;
  the rendered chart and control state changed with it. The page was personally
  inspected and is visually coherent. The final Goal still owns the declared
  1600x1200 Node Playwright run, saved screenshots, and full offline
  `bun run verify` entrypoint.
- Independent E10 data verification passed `bun run verify`: 120 unique,
  traceable Nextcloud feedback records across three source types passed the
  data audit, and the deduplication audit proved 104 linked/merged records are
  excluded from frequency counts. This proves the first data surface but does
  not yet satisfy the downstream analysis, website, browser, or final-audit
  Goals.
- E02 official-source verification passed 14/14 tests and 582 assertions
  across all five products and eight comparison dimensions, including exact
  official-domain, query-date, currency, billing-period, and unknown-value
  rules.
- E05 geographic-data verification passed 10/10 tests and 134 assertions.
  It proves deterministic generation, entity/address deduplication, complete
  source lineage, current evidence references, offline pedestrian-route
  geometry, and—consistent with the user contract—that unknown fields remain
  unknown rather than being inferred. A monitor message initially mistyped the
  terminal Session reference; a visible correction immediately superseded it
  with the exact persisted Session `ses_0662a510fffe3f1oYSTMvLPpFa`.
- E07 reference acquisition produced real 1600x1200 Node Playwright evidence
  for Linear, Asana, and ClickUp: full-page, per-zone, keyboard-focus, hover,
  and disclosure states. `npm run verify:references` passed three sites and
  nine traced claims. The source screenshots and the Northstar design baseline
  were personally inspected; they are real rendered pages, not string
  references.
- E08's desktop ledger UI was independently started and visually inspected.
  Browser interaction opened and confirmed the demo-reset dialog; the live
  summary changed from zero rows to income CNY 8,000.00, expense CNY 900.50,
  net CNY 7,099.50 and three rows, with two demo accounts and an explicit
  confirmation that formal data was unchanged. The final Goal still owns
  exhaustive CRUD, filter, budget, refresh, CSV, saved screenshot, and
  1600x1200 Node Playwright evidence.
- E03 workbook inspection used the bundled spreadsheet runtime against
  `artifacts/workbook/tesla_formula_model.xlsx`. It found seven real sheets,
  formula-driven historical/forecast/annual/sensitivity/valuation surfaces,
  and zero `#REF!`, `#DIV/0!`, `#VALUE!`, `#NAME?`, `#N/A`, `#NUM!`, or
  `#NULL!` results. Direct renders of every sheet are legible. The separate
  PDF inspection found a concrete acceptance defect: the only PDF is an
  eight-page workbook printout rather than the required investment summary of
  at most two pages. Its raw-data page is scaled too small and its Model Guide
  last column is isolated on page 8. A visible Task observation routes this
  exact defect to the two-page PDF Goal while preserving the user's rule that
  explicit defaults and unknowns are not failures.
- E09-R2 Task `tsk_f99bfa07b001mWdYmdfav2wtL7` reached a real terminal
  `failed` state after its latest fact-check left two claims unresolved. The
  responsible Build requested redispatch, but the explicit dispatch failed
  with `session ... has no exact projected worker descriptor`. Persisted
  Session evidence proves the new Build Session was created without a
  descriptor before failure. The direct trigger is Build's two-stage startup:
  it reports `onSessionCreated` before AgentRunner installs the descriptor,
  while every other projected worker reports creation after runtime
  installation. The redispatch lineage path incorrectly required the
  descriptor during the early Build callback. The repair records the single
  immutable dispatch lineage at Session creation and completes the exact
  coordination binding only at Build `onRuntimeReady`; identity, Expert Squad,
  work-scope, and descriptor-hash checks remain strict. The new real-order
  regression failed before the repair, passed after it, and the complete
  Orchestrator tools suite passes 104/104.
- The user explicitly retired the historical
  `packages/opencorvus/script/benchmark/mission-benchmark.ts` wrapper. The
  script and its script-specific contract test are deleted. The shared
  benchmark environment utilities remain because they have independent
  consumers. English and Chinese operations docs now define E2E acceptance as
  a real `opencorvus serve` process, public Task APIs, persistent SQLite
  storage, Node Playwright rendering, independent deliverable verification,
  and visible reload evidence. `retired-benchmark-entrypoints.test.ts` and
  document-health tests prevent the wrapper or its public instructions from
  returning.

- Baseline inspection completed and E01 was selected as the infrastructure
  probe.
- E01 preflight attempt 1 failed before Task creation because
  `overlay-web-benchmark.ts` imported undeclared `puppeteer-core`. The
  repository-standard browser runtime is the Node-launched Playwright sidecar,
  so the benchmark now uses `packages/overlay/test/launch` and delegates
  process cleanup to that runtime. Regression:
  `packages/opencorvus/test/benchmark/bench-script-cleanup.test.ts`.
- E01 preflight attempt 2 reached the headed browser but failed before Task
  creation because the benchmark hand-built persisted Overlay settings and had
  drifted from the canonical schema (`workLedgerOrganization` and
  `workLedgerSort` were missing). The benchmark now starts from
  `browserSettingsFixture` and overrides only benchmark-owned values.
  Regression:
  `packages/opencorvus/test/benchmark/store-bridge-benchmark.test.ts`.
- E01 Task `tsk_f9928f169001XaE6A7x95oumXt` proved that intent analysis could
  finish successfully while the root Orchestrator stopped with no tool call.
  The Task remained `active`, had zero Goals, and had no live producer.
  Transcript and provider logs show the preceding synchronous
  `dispatch_agent` result already contained
  `final_message_id=msg_f992c44eb001LmkSUUvLAiBBKU` and the durable
  `intent_analysis` decision-log reference. The global prompt had contradictory
  wording: it described the dispatch edge as sufficient to stop even when the
  same synchronous result was also terminal producer evidence. The prompt now
  distinguishes a dispatch-only acknowledgement from a terminal synchronous
  result. Regressions:
  `orchestrator-core-prompt.test.ts` and
  `natural-stop-contract.test.ts`.
- E01 retest Task `tsk_f9933252d001TKMpiAbp3UiC16` proved that the global
  prompt alone was not sufficiently local to the decision. Its
  `dispatch_agent` result contained
  `final_message_id=msg_f99351f05001TQ06tcc3KN7fSR`, but the Orchestrator
  described the completed request-interpreter as running and scheduled a
  1,200,000-millisecond internal wait. `dispatch_agent` now states next to its
  schema that non-Goal-build adapters return terminal evidence synchronously,
  that `final_message_id` means the worker has ended, and that only a
  Goal-scoped build returns a nonterminal start reference. Each target literal
  also enumerates its exact accepted adapter fields so the model does not send
  fields owned by another strict union variant. Regression:
  `orchestrator-tool-descriptions.test.ts`.
- The current E01 rerun uses the repaired browser runtime, canonical Overlay
  settings, clarified decision-epoch prompt, and target-local dispatch
  contract. Its terminal result and product evidence are not yet available.
- E01 rerun Task `tsk_f9939457e001jmhaHnBoHcpyL9` then reached Architect and
  exposed a separate typed-contract feedback failure. The Architect registered
  five draft Goals and assembly owners, but every invalid nested
  `ir_json.valueDomain.kind` caused `register_contract` to surface only a
  `null` tool error. The canonical Architect prompt already listed the legal
  values, yet the execution transcript shows the model repeatedly guessed
  `string`, `number`, `scalar`, `text`, `free_text`, `contract_ref`,
  `enum_ref`, and `reference` because the provider-visible tool schema treats
  `ir_json` as an opaque string and the execute-time Zod rejection discarded
  its diagnostics. `register_contract` now returns a visible validation error
  without mutating the collector; nested discriminated-union values are
  derived from `ContractIRSchema` through the existing generic schema repair
  helper, preserving the schema as the single source. Regression:
  `output-tools.test.ts` covers the original `valueDomain.kind="string"`
  failure and asserts all five legal values are visible.
- E01 rerun 3 Task `tsk_f99450a7d001Yo1Cy1rsZp4tyq` proved the Architect
  validation repair in a real execution. The Agent first submitted invalid
  typed contracts, received the exact five legal `valueDomain.kind` values,
  corrected the missing `reason`, and persisted eight Goals, seven contracts,
  fifteen dependency contracts, source coverage, and assembly ownership.
- The root Orchestrator then dispatched all eight pending Goals in one Turn
  while stating that declared dependencies would make ineligible workers wait.
  Runtime evidence contradicted that claim: `dispatch_agent` starts each Goal
  immediately, so dependent verification and End-to-End workers entered the
  same current-project workspace before bootstrap/data producers completed.
  The scheduler prompt now states that runtime does not queue a worker behind
  Goal dependencies, and permits dispatch only for Goals explicitly exposed
  as dispatchable by the current Collaboration Closure. Regression:
  `orchestrator-core-prompt.test.ts`.
- All eight prematurely concurrent build Sessions then terminated with
  `Cannot provide an instance through a closing instance cache lease`. The
  direct trigger was a same-directory `Instance.provide` call from a registered
  background Goal activity after the parent callback had begun lease closure.
  `closeLease` correctly waits for registered activities and the general lease
  assertion already recognizes their ownership, but the same-key
  `Instance.provide` branch bypassed that assertion and rejected every closing
  lease. It now uses the canonical inherited-lease assertion: a registered
  activity can finish and re-enter while closure waits, while an unregistered
  fire-and-forget callback still fails after ownership ends. Regression:
  `instance-cache.test.ts`.
- Rerun 3 was cancelled only after every Goal Session was terminal and no
  producer remained. It did not produce an acceptable deliverable. The next
  clean-project rerun must prove both dependency-ordered dispatch and
  background Goal completion under the repaired instance lifecycle.
- E01 rerun 4 Task `tsk_f995b4663001yZIhiQ58IW3HMf` proved both of those
  repaired runtime paths. The Orchestrator dispatched only the dependency-free
  bootstrap Goal `gol_f99649a5c001w8aMxBWl4snu2Q`; its Build Session
  `ses_0669742a1ffebMFW86xRme6W8M` continued after the dispatch Turn closed,
  installed 180 packages, wrote the scaffold, passed its build and verification
  commands, recorded final message `msg_f996ac00e001ZYTIcpAuOwH35A`, and
  persisted Host observation `art_f996b16c8001UwHY4jhcRg9BNF`. This is real
  execution evidence that dependency ordering and registered Instance activity
  re-entry now work.
- The same run exposed an exact-scope workload-review defect. The Orchestrator
  dispatched the reviewer with `goal_ids=[]`, even though its visible
  ContractGraph referenced five persisted Goals. The reviewer correctly
  reported “Goal graph under review (0 goals)”; a coordination response could
  not widen the immutable selected scope, and all five attempted
  `register_workload_brief` calls were rejected because the collector knew zero
  Goals. The `dispatch_agent` target schema and scheduler prompt now state that
  `goal_ids` is the exact immutable review set, an empty list means zero Goals,
  and every intended persisted Goal reference must be copied into the original
  dispatch. Regression:
  `orchestrator-tool-descriptions.test.ts` and
  `orchestrator-core-prompt.test.ts`.
- Rerun 4 then stopped with the bootstrap Goal still `pending` despite its
  terminal child Session and complete Host observation. This was not a stale
  progress projection: the Task Board showed Goal-attempt `36e5b3a5` with the
  full observed diff but no `goal_attempt_result` artifact. The Build adapter
  intentionally does not manufacture that result; `complete_goal` is the
  scheduler-owned explicit decision after evidence review. However, both the
  adapter description and global prompt incorrectly promised that an immutable
  terminal Goal result would arrive automatically on a later refill. The
  Orchestrator therefore parked again waiting for a fact no producer writes.
  The contract now says that the refill contains the child final Turn,
  terminal Session, and Host observation; the Orchestrator must judge those
  facts and call `complete_goal`, retry/correct, or fail. The wake note uses
  those exact facts rather than the misleading phrase “Goal Build terminal
  fact.” Regressions:
  `orchestrator-core-prompt.test.ts` and the two background-Goal wake cases in
  `orchestrator/tools.test.ts`.
- Manual termination of the now-idle rerun 4 preserved the Task database but
  exposed a benchmark-owned evidence-loss bug. Cleanup closed the Overlay page
  before asking the shared Node Playwright sidecar to close the browser. Page
  closure aborted the live Server-Sent Events requests with `ERR_ABORTED`; the
  sidecar's error collector then rejected `browser.close`, and report assembly
  ran only after the browser and server were gone, replacing the Task diagnosis
  with `Overlay browser sidecar is not started`. Cleanup now delegates page
  closure exclusively to `browser.close`, so the collector asserts while the
  page is still live. Signal handling writes an interrupted benchmark report
  before any browser/server teardown. Regression:
  `bench-script-cleanup.test.ts`.
- E01 rerun 5 Task `tsk_f997ca2ff001k6Hbrtm9Uip4xS` exposed a second
  benchmark evidence-loss path: the shared browser sidecar closed before
  report-time page evaluation and screenshot capture. The resulting report
  records `Target page, context or browser has been closed`; it is an
  infrastructure failure and contains no acceptable product evidence.
- E01 rerun 6 Task `tsk_f9986692a001rCI0vOW1nom3oA` used a fresh isolated
  SQLite database and project. Intent analysis completed, one
  `source-investigator` Session completed, and a second remained streaming,
  but the benchmark process disappeared without a terminal report. The
  database therefore retains an active Task with zero Goals and no live
  producer. This is not a product pass and will be replaced by a clean rerun.
- The registered-activity re-entry repair initially regressed concurrent
  inherited transactional preflights: the second legal same-key call arrived
  while the first preflight had temporarily released lock ownership and was
  rejected before it could join the tracked lifecycle queue. Same-key
  admission now validates closed/closing activity authority first, then
  validates lock ownership after the serialized preflight returns it.
  Detached callbacks remain rejected. The focused Instance and Architect
  suites pass 97/97 after the correction.
- The historical single-case Overlay benchmark entrypoint and temporary copy
  were deleted at the user's direction. All current E01-E10 rows were created
  through the formal service route and are persisted in
  `/Users/yangheng/.local/share/opencorvus/opencorvus.db`.
- Fresh projects initially failed preflight with `MissingModelConfigError`.
  This was correct no-fallback behavior: the new projects had no default
  model. The retried formal Task requests explicitly bind the authoritative
  current model `hexin/gpt-5.6-sol`; the failed preflights created no Task rows.
- The real project catalog initially exposed only `general` and `prism`.
  E07 and E09 therefore installed `frontend-innovate` and `review-debug`
  respectively through `/expert-squad/install-payload` with explicit
  project scope. Catalog re-read proves versions `2026.07.24.2`, twelve and
  seven projected agents, and their exact manifest workflow IDs before Task
  creation.
- Process shutdown previously called `Session.updatePart` for owned prompt
  sessions outside their project identity. The resulting
  `No context found for instance` error prevented tool settlement and consumed
  the full server-stop timeout. Shutdown now re-enters each Session's exact
  project identity before aborting tool parts and terminating its prompt;
  `writer.test.ts` reproduces the out-of-context shutdown boundary.
- Operator wake previously left a prior top-level Task error attached to an
  already-active Task. E02 and E08 therefore presented current execution
  alongside stale shutdown/session-loop errors. The current Task projection
  now clears that error on a successful operator wake while preserving the
  earlier snapshots and failure artifacts.
- E05 retained eight immutable Goal rows after a repaired five-Goal
  ContractGraph superseded its first three-Goal graph. E04 retained both sides
  of an append-only Goal revision, and its final assembly Goal still referred
  to the older revision ID. A single derived Goal projection now selects the
  newest graph with an exact Architect Goal binding, keeps operator-added
  Goals, excludes explicit retractions, folds unambiguous `supersede_of`
  chains, and remaps dependent Goal refs to the unique revision tip. Branched
  revisions remain visible conflicts rather than being selected by timestamp.
  Progress, Task description, Board Goals, Brief, and failed-Goal diagnostics
  use this execution projection; historical RequirementSet, ContractGraph,
  exact Goal, attempt, result, and Host-observation readers remain unchanged.
- E06 exposed a terminal-delivery race rather than a legitimate retry. Its
  Orchestrator called `fail_task`, but the same still-delivering operator wake
  remained queued until the root prompt returned. A child/final activity drain
  consumed that old wake 32 milliseconds later and reopened the just-failed
  Task. Queue draining now leaves a terminal Task closed while its root
  Session still owns the prompt that is delivering that wake; a genuinely
  later operator message remains queued and may reopen only after the prompt
  finishes. The regression starts a real root prompt, stamps the Task
  terminal during delivery, proves the drain cannot reopen it, then proves the
  queued event settles after prompt completion.
- The E06 failure judgment itself was also disproven by fresh deliverable
  verification. `data/metadata/build-manifest.json` is a temporary rebuild
  output, not one of the 21 repository deliverables required by
  `scripts/verify/audit-deliverables.ts`. A clean `bun run verify` in the real
  E06 project rebuilt 180 records, passed 3/3 data-contract checks, 8/8
  committed-data checks, 8/8 CSV/UI consistency checks, 13/13 dashboard tests,
  the production Vite build, a Node-launched 1600x1200 Playwright run, 36
  persisted Task trace events, and all 21 deliverable checks. Happy DOM's
  zero-width chart warning and Vite's chunk-size warning are non-failing
  environment/default warnings, not missing or erroneous evidence. A visible
  operator correction carrying these exact facts was appended through the
  formal Task route so the Orchestrator, not SQLite, owns the revised terminal
  judgment.
- An independent E05 rerun passed its data, lineage, route, ranking,
  application, Task-context, and forbidden-chain checks but initially failed
  before Playwright because another concurrent project briefly owned its
  hard-coded port 4173. The owner exited naturally; no process was killed.
  Attaching to the existing server would risk testing the wrong project, so
  E05 now uses a Node launcher that obtains a fresh loopback port for every
  invocation, passes it explicitly to Playwright, and retains
  `reuseExistingServer: false`. The repaired exact `bun run verify` passed,
  including three real 1600x1200 Chromium interactions. The platform Build
  prompt now also states that repeatable acceptance commands must allocate
  their own port rather than embed a shared default or reuse another
  project's server.

## 2026-07-26 port-7999 continuation and Goal-Build terminal-wake impact analysis

### Recall

- The user requires all continued real End-to-End execution to use
  `127.0.0.1:7999` so parallel backends cannot collide. Port 7999 owns the
  independent persistent database
  `/Users/yangheng/.local/share/opencorvus-e2e-7999/data/opencorvus.db` and
  control repository
  `/Users/yangheng/Documents/OpenCorvus-Demos/real-e2e-7999-control`.
- The user corrected the earlier process target and explicitly requested that
  port 7879 be closed. Before shutdown, its eight nonterminal
  `real-e2e-20260725` Tasks were cancelled through the formal Task API; a
  read-only database query proved all eight have `task.cancelled` terminal
  events and completion timestamps. PID 74179 then exited on `SIGTERM`, port
  7879 stopped listening, and port 7999 remained healthy.
- Defaults, explicit unknowns, and partial-but-honest values are not failures.
  Only proven evidence error or absence, invalid paths, stuck execution, and
  concrete acceptance violations are repair targets.
- No production repair may add a lock, gate, retry counter, state machine,
  duplicate-dispatch admission rule, automatic Goal result, or compatibility
  path. The Orchestrator remains the only owner of `complete_goal`.

### Whole-repository call-point inventory

| Surface                     | Complete call points                                                                                                                                                                                                                                                                                           | Disposition                                                                                                                                                         |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal Build background owner | `orchestrator/build-tool.ts::runGoalBuildAsInstanceActivity`, the sole production Goal-Build caller at the `terminalBuild` creation site; focused callers are `build-active-plan-graph-scope.test.ts`, `orchestrator/tools.test.ts`, `opentest-typed-dispatch.test.ts`, and `streamed-agent-fact-flow.test.ts` | Retain one registered activity, but include terminal-wake acceptance in that activity's owned tail                                                                  |
| Instance activity primitive | `project/instance.ts::runAsInstanceActivity`; the other production caller is `scheduler/task-queue-service.ts` recovery-timer ownership                                                                                                                                                                        | Do not change the general lease/lock primitive or timer behavior                                                                                                    |
| Background task-loop wake   | `engine/queue.ts::dispatchTaskLoopInBackground`; the only production caller is the external `.finally` attached to the Goal Build activity                                                                                                                                                                     | Replace this caller with an awaited `dispatchTaskLoop` inside the registered Goal Build activity; retain the generic background helper for unrelated future callers |
| Build terminal evidence     | `BuildAgent.run` publishes terminal Session lifecycle through `completeProjectedWorkerTurn`, then records exactly one `build_host_observation` per immutable Goal attempt                                                                                                                                      | Preserve ordering and single-source artifacts; do not manufacture `goal_attempt_result`                                                                             |
| Goal result decision        | `orchestrator/goal-lifecycle-tools.ts::complete_goal` calls `engine/persist.ts::completeGoal`; no Build producer writes this result                                                                                                                                                                            | Preserve scheduler ownership and visible evidence judgment                                                                                                          |
| Current regressions         | Two `orchestrator/tools.test.ts` cases replace `dispatchTaskLoopInBackground` with a mock and assert only that the external callback was invoked; `build-active-plan-graph-scope.test.ts` proves the Build body retains the lease but does not cover the later wake callback                                   | Add a real closing-lease regression and make the focused wake tests exercise the awaited queue boundary                                                             |

### Proven causal chain

1. Goal-scoped Build returns a start receipt while
   `runBuildToTerminalUnbounded` continues in a registered Instance activity.
   This correctly retains the project lease through the physical child Turn,
   terminal Session publication, Git/workspace observation, and
   `build_host_observation` persistence.
2. The terminal scheduler wake is not part of that activity. It is attached as
   `.then(...).catch(...).finally(...)` to the already-settled activity
   Promise. `startLeaseActivity` removes the activity from
   `lease.activities` in its own inner `finally` before this external
   callback runs, so `closeLease` may mark the inherited lease closing or
   closed first.
3. Production logs prove the resulting race. E02, E06, E08, and E10 emitted
   `background task wake failed` for operation
   `goal build child terminal and host observation wake`, with the exact error
   `Cannot access instance context through a closing/closed instance cache
lease`. Some later attempts succeeded only when another live owner happened
   to keep the project Instance usable; this timing dependence is why the
   defect is intermittent.
4. E02 then had no reliable decision opportunity after Host evidence. Separate
   root wakes repeatedly saw a pending final Goal and redispatched the same
   scope. Attempts `0bbaff5f`, `87e8f3bf`, `b063035f`, `da2db742`, and
   `74acc3af` began within 162 seconds, while their worker loops remained
   physically active for another 17 to 24 minutes. This is not legitimate
   parallel Goal work and not a project-wide lease serialization issue.
5. Every one of those attempts eventually persisted a distinct Host
   observation, but none had a scheduler-authored `goal_attempt_result`.
   Repeated producers therefore amplified filesystem, browser, model, and
   verification contention without advancing the authoritative Goal.
6. The existing scheduler prompt already says not to duplicate a successful
   Goal dispatch from a stale snapshot and to leave a child owned until
   terminal evidence arrives. The root lifecycle loss is therefore the first
   repair. Real 7999 evidence must then determine whether the visible snapshot
   still needs clearer wording for the specific “attempt exists but Host tail
   is not yet durable” interval; no Host admission gate will be added.

### Repair and acceptance boundary

- Move terminal-wake queue acceptance into the same registered Goal Build
  activity after the Host tail settles. Await only queue acceptance/start, not
  Orchestrator completion, so the lifecycle remains event-driven and does not
  turn into a second scheduler.
- Keep background-set bookkeeping outside the activity only when it performs
  no project/queue work.
- Add regression coverage proving that the outer `Instance.provide` may begin
  lease closure after the Goal Build start receipt, yet the real terminal wake
  is accepted exactly once without a closing/closed-lease error. Preserve the
  success and infrastructure-failure wake cases and prove no automatic
  `goal_attempt_result`.
- Restart only the isolated 7999 backend after focused tests and typecheck.
  Use its real API and persistent SQLite to prove: one Goal Build produces one
  child attempt, one Host observation, one refill decision, one scheduler Goal
  result, and a terminal Task; no same-Goal duplicate producer appears.
- Run two independent Tasks in the same 7999 project to prove the project
  Instance read lease does not mean “one Task per project”. Record queue versus
  concurrent execution facts separately from the Goal-Build wake repair.

### Port-7999 smoke findings after terminal wake repair

The real Task `tsk_f9aac0384001vzRJTwIzeqymgI` completed on port 7999 through
Requirements, Architect, Goal-scoped Build, Host observation, Integrity,
Orchestrator `complete_goal`, and `complete_task`. Its Build Session
`ses_065461491ffegQnKn5E6o70nSN` produced attempt `6f364629`, Host observation
`art_f9abc5007001218YWWcKoqS9xb`, and commit `067117b`. This proves the repaired
terminal wake reaches a later Orchestrator decision opportunity in the real
database.

The same run proved two separate lifecycle defects. They are not Instance
lease serialization and they do not justify a gate or automatic Goal
completion:

1. Every non-Orchestrator projected worker entered Session standby before
   `runAgentSession` returned. `completeProjectedWorkerTurn` published the
   Session terminal and disposed its Runtime, but did not settle the physical
   `SessionPromptState` owner. After the Task completed, the API still exposed
   seven terminal `owned_prompt_sessions`. Standby runs outside the Instance
   activity, so these owners did not block the next worker or the ten parallel
   projects; however, `hasProjectOwnedPromptControllers` and
   `hasAnyOwnedPromptControllers` treat them as live ownership and therefore
   refuse instance disposal, global disposal, database reset, and import.
   Coordination handoff is different: its Session remains idle with a Runtime
   and prompt owner so that the same worker can continue, and must not be
   settled by this repair.
2. `engine/persist.ts::completeGoal` always appended a sessionless
   `manual_completion` attempt, even when the exact latest Build attempt
   already had immutable Host evidence and awaited the Orchestrator verdict.
   The smoke therefore appended attempt `1ecda900`, superseding `6f364629`,
   and wrote the result only to the new attempt. The live Board then reported
   `goalAttemptID=1ecda900`, `retryCount=2`, and no Goal evidence, because
   `workbench/board.ts::buildGoalEvidence` correctly looks up Host evidence on
   the exact attempt tip. This is a proven evidence-attribution error, not an
   allowed default or honest unknown.

#### Whole-repository call-point inventory

| Surface                               | Complete call points                                                                                                                                                            | Disposition                                                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Projected-worker success              | `agent/runner.ts::completeProjectedWorkerTurn`, called by first-turn and coordination-continuation execution                                                                    | Settle the prompt owner only after the non-handoff terminal publication; preserve the early coordination-handoff return and its idle owner                         |
| Projected-worker failure/cancellation | `agent/runner.ts::failProjectedWorkerTurn`, called by first-turn and coordination-continuation error paths                                                                      | Settle an existing/cancelled prompt owner before Runtime disposal without rewriting the already-published terminal result                                          |
| Prompt ownership                      | `session/prompt/state.ts::{cancel,waitForFinish,clearCancellationReceipt}` and `engine/cancellation-scope.ts`                                                                   | Reuse the exact Session directory and owner identity; do not use task-cancellation publication, which would incorrectly replace successful completion with aborted |
| Physical ownership readers            | `engine/runtime.ts::{hasProjectOwnedPromptControllers,hasAnyOwnedPromptControllers}` and `/tasks` `owned_prompt_sessions` projection                                            | Keep strict semantics; fix the stale owner producer instead of filtering terminal Sessions from readers                                                            |
| Goal completion                       | `orchestrator/goal-lifecycle-tools.ts::complete_goal` is the sole production caller of `engine/persist.ts::completeGoal`                                                        | Preserve the Orchestrator decision owner; when the exact latest unresolved attempt has a Host observation, append its result to that attempt                       |
| Sessionless manual completion         | `engine/persist.ts::completeGoal` plus Workbench tests for Goals already satisfied without execution                                                                            | Preserve creation of a new sessionless attempt only when no unresolved Host-observed Build attempt can own the verdict                                             |
| Attempt/evidence projections          | `engine/store.ts::{findLatestTipGoalAttempt,findBuildHostObservationByGoalAttempt}`, `engine/describe.ts`, `workbench/board.ts`, retry diagnostics, analytics, and Task context | Keep the immutable attempt chain and exact-attempt evidence readers unchanged; correct the writer so the chain tip retains the execution evidence                  |

#### Repair and retest boundary

- Add a terminal-worker prompt settlement helper that cancels only the exact
  non-handoff owner, waits for its background standby loop to release the busy
  slot, and clears its cancellation receipt without publishing an aborted
  Session over the completed/error terminal fact.
- Add focused regressions proving terminal projected workers leave no prompt
  owner, while coordination handoff remains idle and resumable.
- Change `completeGoal` attribution using durable facts only: an unresolved
  tip with an exact `build_host_observation` receives the
  `goal_attempt_result`; an already completed verdict remains idempotent; a
  Goal with no attributable execution attempt receives the existing
  sessionless manual attempt. Do not infer attribution from reason text.
- Prove one Host-observed Build attempt remains one attempt after
  `complete_goal`, its result and observation share the attempt ID, Board
  evidence remains visible, and retry count does not increase.
- Preserve the completed smoke database as defect evidence. After focused
  tests and typecheck pass, restart only port 7999 without resetting its
  database, then resume the ten real Tasks and verify terminal owners and
  Goal-evidence attribution on new completions.

The first post-repair typecheck also exposed a separate current-disk
infrastructure defect in `bus/global.ts`. `GlobalEventBus` narrowed the generic
Node `EventEmitter.emit` override to only the product `event` tuple, which is
not a valid subtype of the base emitter signature under the installed type
definitions. The same surface's existing listener-failure regression then
proved that `emitAndWait` allowed synchronous and rejected-listener errors to
reject `Bus.publish`, contradicting the fire-and-observe bus boundary. The
repair replaces inheritance with a typed one-event composition wrapper,
preserves the complete repository call surface (`on`, `off`, `emit`, and
`emitAndWait`), and catches/logs each listener failure in both emission modes.
The existing regression was corrected to assert the actual
`Promise<void>` contract (`resolves.toBeUndefined`) while still proving no
rejection or process-level error escapes.

### Port-7999 restart orphan finding

After loading the prompt-owner and Goal-evidence repair, the isolated 7999
backend restarted without resetting its persistent database. Nine of the ten
active cases obtained new Orchestrator or worker prompt owners from durable
pending coordination/wake facts. E03 did not:

- Task `tsk_f9ab19d8f001kpnCY19fFd78aO` remained active with zero
  `owned_prompt_sessions`.
- Its first Build attempt `04d98ca4` had terminal Host observation
  `art_f9ad5ba3c001Yb0aAnv6ocpsA4`.
- The Orchestrator dispatched replacement attempt `821eef0d` into Build
  Session `ses_06529c1c6ffecS0ESI9Zlk32CO`.
- The latest durable lifecycle events for that Session were `streaming`
  immediately before process shutdown. There is no later terminal event,
  Host observation, Goal result, pending coordination request, or pending
  queued wake.
- The root Orchestrator had already returned to idle after dispatch, so neither
  the root nor the interrupted worker had a current-process owner after
  restart.

This is a process-interruption evidence and wake-loss defect. A drained root
wake proves only that the Orchestrator accepted the dispatch; it is not a
durable replacement for the child worker's future terminal callback. When the
process dies mid-worker, no producer remains to append the Host observation
and wake the Orchestrator.

#### Impact and call-point inventory

| Surface                     | Complete call points                                                                                                                                               | Disposition                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Instance startup            | `project/bootstrap.ts::InstanceBootstrap` initializes queue/runtime bridges and calls `drainPendingQueuedOperatorWakes` for each concrete project                  | Drain already-pending delivery first, then run one factual interrupted-worker reconciliation; do not add a timer, retry loop, status machine, or Task transition                     |
| Active Task and owner facts | `engine/store.ts::{listStartedIncompleteTaskIDs,listOwnedPromptSessionsForTask}`, `engine/queue.ts::queuedTaskEventStats`, `session/prompt/state.ts` owner readers | Current-process prompt ownership remains the only physical-liveness source; durable `streaming` is evidence of the interrupted prior process, not proof of a live worker             |
| Durable worker identity     | `orchestrator/task-event.ts::listTaskConversationAgentSessions`, `agent/worker-turn-descriptor.ts`, `dispatch_lineage`, `goal_attempt`                             | Use the existing latest invocation projection and exact descriptor/attempt/session identities; do not reconstruct a provider stream or invent a replacement worker result            |
| Recovery evidence           | `engine/persist.ts::recordTaskInfrastructureError`, consumed by `engine/describe.ts`                                                                               | Persist the exact interrupted Session/attempt as a visible infrastructure fact; it is not a Session, Goal, expert, or Task business conclusion                                       |
| Root decision wake          | `engine/queue.ts::dispatchTaskLoop`, durable `queued_operator_wake`, `orchestrator/loop.ts`                                                                        | Wake the existing Task once from the exact recovery fact so the Orchestrator reads current Task/Goal/Artifact/Session evidence and naturally decides retry, redispatch, ask, or fail |
| Existing durable requests   | `engine/queue.ts::reconcilePendingCoordinationRequestWakes` and pending queued wake drain                                                                          | Preserve them as the first recovery source. Do not create a second recovery wake for a Task that already has a pending delivery or any current-process owner                         |
| Session lifecycle           | `session/status-publication.ts` cancellation-only convergence and `specs/current/architecture/16-unified-teardown.md`                                              | Do not synthesize terminal Session status or derive current liveness from the persisted `streaming` row; retain the interrupted lifecycle as historical evidence                     |

#### Repair boundary

- Reconcile only a nonterminal Task in the current concrete project that has
  no current-process prompt owner, no pending durable root wake, and at least
  one latest projected worker invocation whose durable lifecycle is
  `streaming` or `retry`.
- Bind recovery identity to the exact latest lifecycle protocol event and
  worker descriptor/attempt. Re-running startup must not append duplicate
  infrastructure facts or duplicate wakes for the same interruption. The
  infrastructure fact and its first delivery wake are one transaction; once
  that wake is drained, the Host has delivered the fact and must not turn
  later restarts into a mechanical retry loop.
- Persist the infrastructure observation and its root wake atomically, then
  let the existing queue and Orchestrator consume them. The host does not
  choose a Goal action or create a worker result.
- Add restart-shaped regressions for the E03 orphan, for a Task already covered
  by a pending coordination wake, for an already-owned live Task, and for an
  idle/terminal historical worker that must not be recovered. Also prove the
  recovery appends no conversation message.
- Resume E03 through the formal visible Task route while the shared repair is
  validated, so the real ten-case run does not wait on code delivery. The
  visible message must identify the exact interrupted Session/attempt and ask
  the Orchestrator to inspect durable evidence; no database row is edited
  directly.

#### Claude `-p` adversarial review

The requested Claude `-p` review returned `REVISE`. It accepted the observed
causal chain and the prompt-over-Host, no-synthetic-message, and no-automatic-
Goal-transition boundaries, but challenged repeated delivery of one historical
interruption and requested an explicit regression that conversation messages
remain unchanged. Those findings changed the implementation: one exact event
set now owns one infrastructure fact and one transactionally paired wake, and
a drained wake is never mechanically recreated.

The review's alternative—persist a pending root wake whenever a worker enters
`streaming`, then clear it on terminal—was rejected after checking the actual
queue semantics. Such a wake is immediately eligible root work during a
healthy worker Turn, and pairing its lifecycle to worker status would create a
second Host workflow state/lease mechanism. Existing pending requests remain
the first recovery source; the new path is only a one-shot factual ingress
when both pending delivery and current-process ownership are absent.

### Port-7999 cold-start project coverage and shutdown settlement

#### Recall

- The operator requires ten real Tasks on port 7999 against the persistent
  SQLite database, with no historical benchmark runner and no database reset.
- Defaults and unknown fields are not failures. A Task with a durable
  `streaming` worker or unfinished Goal attempt but no current-process owner,
  pending wake, interaction, or terminal result is an execution-path error.
- Recovery must reuse the natural Orchestrator decision path. It must not add
  a gate, lock, lease, timer, workflow state machine, synthetic message,
  automatic Goal result, or database migration.
- The isolated 7999 database is currently opened only by PID 53179. All ten
  started Task root Session directories exist and are Git repositories.
- Read materials and call-point search:
  `project/bootstrap.ts`, `project/instance.ts`,
  `project/independent-project-owner.ts`, `engine/queue.ts`,
  `engine/store.ts`, `engine/task-directory.ts`, `engine/writer.ts`,
  `engine/cancellation-scope.ts`, `session/loop.ts`,
  `session/prompt/state.ts`, `cli/cmd/serve.ts`, `cli/cmd/sidecar.ts`,
  `server/server.ts`, and all callers/tests found by repository-wide `rg`.
- Independent Agent and Claude `-p` both confirmed the lazy-project recovery
  gap. Claude corrected the proposed project-worktree unit to the canonical
  Task root Session directory and exposed an existing cross-project pending
  wake drain.

#### Observed causal chain

After commit `2a381cf7ed`, PID 53179 cold-started with only the control
directory. E09 was later opened by a UI request; its project bootstrap created
one `task-infrastructure-error/process-recovery` fact and resumed Build.
E02, E05, and E10 remained active with zero prompt owners, pending wakes, or
interactions even though their Task session trees contained respectively two,
one, and two latest nonterminal Agent invocations. Their current Build attempts
`4cfd2bf7`, `b7e3efee`, and `cf487254` had no result.

The direct trigger is that factual recovery runs only inside
`InstanceBootstrap`, while server listen and `GET /global/tasks` do not
initialize every started Task execution directory. The deeper boundary error
is that recovery activation depends on an incidental project-scoped UI
request. In addition, `drainPendingQueuedOperatorWakes` currently reads pending
wakes without a project filter, so opening E09 can launch loops for other
projects through an identity-only owner. That existing cross-project behavior
must be removed rather than copied into a second global recovery source.

Shutdown independently exposed a two-phase settlement defect. The old process
cancelled and awaited prompt owners serially. E02's idle Orchestrator did not
finish inside five seconds, causing a fail-fast
`TaskCancellationIncompleteError`; all later owners therefore received no
cancellation request before the server exited. Current evidence proves the
missing finish and the blast-radius mechanism, but cannot distinguish whether
the idle loop waited in Instance re-entry, compaction prune, final-message
flush, or error publication. The repair must not guess that internal phase or
increase the timeout.

#### Revised impact and call-point inventory

| Surface                  | Complete call points                                                                                                                                       | Disposition                                                                                                                                                                                                |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Started execution source | `engine/store.ts::listStartedIncompleteTaskIDs`, `engine/task-directory.ts::taskRootDirectory`, `engine_task.session_id -> session.directory`              | Derive one canonical execution directory per started incomplete Task; do not use `Project.registeredDirectories` or assume `project.worktree`                                                              |
| Project initialization   | `project/independent-project-owner.ts::{provideInitializedProjectExecution,runWithInitializedIndependentProject}`, `project/instance.ts::Instance.provide` | Open each canonical directory through the existing initialized owner; Instance cache remains the only bootstrap serialization mechanism                                                                    |
| Host activation          | long-lived `serve` and managed sidecar/server ownership entry points after `OPENCORVUS_SERVER_URL` is published                                            | Start recovery asynchronously without blocking HTTP readiness; a managed workspace may initialize only Tasks owned by that workspace, while the isolated unmanaged server may initialize all started Tasks |
| Project queue drain      | `engine/queue.ts::{pendingQueuedOperatorWakeTaskIDs,drainPendingQueuedOperatorWakes,reconcilePendingCoordinationRequestWakes}`                             | Filter pending wake discovery by `Instance.project.id`; no project bootstrap may drain another project's queue                                                                                             |
| Factual recovery         | `engine/queue.ts::reconcileInterruptedTaskExecutions`                                                                                                      | Keep the existing project-scoped fact/wake algorithm as the sole recovery writer                                                                                                                           |
| Process shutdown         | `engine/writer.ts::terminateCurrentProcessOwnedExecution`, `engine/cancellation-scope.ts::{cancelSessionPromptInScope,awaitSessionPromptFinishedInScope}`  | Request cancellation for every owned prompt first, then await every requested owner with all-settled error aggregation; one slow owner must not prevent sibling cancellation                               |
| Idle loop                | `session/loop.ts::{beginStandby,waitForUserMessage,finalizePrompt}`, `session/prompt/state.ts::{cancel,finish}`                                            | Preserve the five-second evidence threshold. Do not claim an internal phase root cause until a reproducible phase-level test or observation identifies it                                                  |

#### Repair and verification boundary

- Add a host recovery module that discovers canonical root Session directories
  for started incomplete Tasks and initializes each directory independently.
  One directory failure is reported without preventing the others.
- Scope managed servers to the authoritative project worktree while still
  opening that project's Task root Session directories. Do not create a global
  database lock or infer another process's prompt ownership.
- Make project bootstrap queue drain project-local. Prove that a pending wake
  in project B is untouched while project A bootstraps.
- Make shutdown cancellation two-phase and aggregate failures only after every
  current-process owner has received a cancellation request. Test with two
  owners where the first can finish only after the second is aborted; this
  distinguishes the new behavior from the old serial fail-fast loop.
- Keep `GET /global/tasks` read-only and prove it creates neither recovery
  artifacts nor initialized project state.
- Restart only the isolated 7999 process, retain its database, and require E02,
  E05, and E10 to obtain one process-recovery fact and a real Orchestrator
  continuation without manual injection. Re-query all ten Tasks for owners or
  terminal outcomes before continuing deliverable QA.

#### Claude `-p` and independent-Agent review disposition

Both reviews accepted the lazy-project causal chain and rejected a read-route
side effect, timer, lock, lease, or duplicated recovery implementation. Claude
returned `REVISE` because project worktree is not always the Task execution
directory and because the existing pending-wake drain crosses projects. Those
points are adopted. Its multi-process warning is addressed by current evidence
for the isolated 7999 database and by retaining managed-workspace scope rather
than adding a global lock. The independent Agent additionally proved shutdown
is serial fail-fast; the revised design uses the repository's existing
request-then-all-settle cancellation pattern instead of changing the timeout.

### Same-Goal duplicate dispatch and recovered error projection

#### Recall

- Run all ten Tasks through the real port-7999 backend and persistent SQLite
  database. Historical benchmark scripts are not an acceptance path.
- Defaults and unknown optional values are not failures. Missing or incorrect
  evidence, wrong paths, lost execution ownership, and stalled work are.
- Repair the root prompt/evidence boundary without an admission gate, lock,
  lease, state machine, keyword rule, or automatic Goal decision.
- Preserve parallel changes in `prompt/core/orchestrator-core.txt` and its
  tests. This repair does not edit or stage them.
- Repository-wide search covered Goal Build creation, non-Build Goal workers,
  `completeGoal`, retry/recovery/coordination, Task description, prompt
  ownership, Session lifecycle, root-wake entry, and immutable Host
  observations.
- Claude `-p` and the independent Agent reviewed the live database and the
  proposed boundary before implementation; the independent Agent then issued
  a second `REVISE` on the first implementation.

#### Live causal evidence

E03 created attempts `f28e6ee4` and `6f09d933` for the same Goal, agent,
directory, and scope 83 seconds apart. Both Sessions still had current-process
prompt controllers and produced later messages/tool activity. E04 repeated the
same shape with attempts `cf509639` and `3571d657`; the second "read-only"
worker observed the first changing its shared files and returned a polluted
result. Both pairs occurred inside one continuously streaming root wake before
any terminal child refill or Host observation, excluding restart recovery and
terminal-wake duplication as triggers.

A Goal Build call returns a nonterminal start acknowledgement containing the
Session and immutable attempt reference, but the root wake continued and
treated a missing result/final message as permission to dispatch again. Task
Context rendered the unresolved attempt as `unknown` and omitted the exact
current-process prompt and lifecycle observations. A second attempt then made
the first non-tip and allowed both workers' shared-directory changes to pollute
Host attribution.

`beginBuildAttempt` intentionally remains append-only and permits a later
attempt. It must not become a Host admission gate. The repair instead makes the
existing facts visible at the scheduler judgment boundary:

| Surface                                           | Disposition                                                                                                                                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `engine/store.ts::listOwnedPromptSessionsForTask` | Reuse exact current-process prompt-controller ownership; do not infer ownership from durable status                                                                                              |
| `session/status.ts::SessionStatus`                | Pair each owner with `streaming`, `retry`, `idle`, or `terminal`; owner alone is not execution                                                                                                   |
| `engine/describe.ts`                              | Render Session, Goal, lifecycle, and last activity as current-now observations; render unresolved ownerless attempts explicitly but not as failures                                              |
| durable collaboration closure                     | Keep `execution_started` and `undispatched_goal_ids` derived only from Goal attempts; ephemeral owner appearance/release cannot rewrite them                                                     |
| rewind                                            | Keep current-process observations explicitly current-now while durable attempts follow the rewind cursor                                                                                         |
| `dispatch-agent-tool.ts`                          | Define the Build return as a start acknowledgement for that dispatch epoch and end the wake; later wakes use current lifecycle/owner/terminal/Host/coordination facts                            |
| completion and recovery                           | Missing result/message, elapsed time, or transient rate limit is not stop evidence; exact terminal, recovery, ownerless-execution, or bound coordination facts remain available for LLM judgment |

The first implementation incorrectly equated prompt ownership with physical
execution. Independent review proved a coordination handoff publishes
`SessionStatus=idle` while deliberately retaining its prompt controller and
Runtime. The final projection therefore distinguishes active
`streaming/retry` owners from legitimate `idle` handoffs and never applies a
categorical owner-only completion prohibition. Regression tests cover one
active owner, two same-Goal owners, active+retry lifecycle, an unresolved
ownerless attempt, and an idle non-Build owner whose release leaves durable
closure unchanged. Description remains read-only.

#### Active Task error across a recovered root wake

E06 and E08 resumed after SIGINT and produced later attempts/Host observations,
but retained `engine_task.error = Orchestrator error: Server shutdown: SIGINT`.
They were active (`time_completed` absent), not failed; the append-only
process-recovery facts correctly retained shutdown history. The stale current
error nevertheless continued to render as the new decision pass's `Error`.

The single lifecycle boundary is
`orchestrator/loop.ts::runTaskLoopInner`: after rereading and confirming the
Task is non-terminal, but before `EngineGit.prepare` and
`Orchestrator.processTask`, a newly executing root decision pass clears the
previous current-error projection through `updateTask`. It does not match
SIGINT text, delete recovery/infrastructure artifacts, reopen a terminal Task,
or make any retry/admission/outcome decision.

Tests prove:

- a new active decision pass clears an arbitrary prior current error before
  both Git preparation and Orchestrator processing;
- Task Context no longer renders that stale error while the exact durable
  process-recovery artifact remains visible;
- a terminal failed Task's outcome error is never cleared by an internal wake;
- existing startup recovery, prompt-owner, idle-handoff, collaboration,
  dispatch description, and Task-reactivation tests remain green.

### Current operator intent lost on retry

#### Recall

- Continue the ten real Tasks through the persistent port-7999 service. Do not
  use the deleted benchmark runner or mutate SQLite directly.
- A defaulted or absent optional field is not a failure. A supplied current
  retry intent that is dropped and then contradicted before the scheduler sees
  it is a path error; a reopened Task left active after a prose-only historical
  failure restatement is stuck execution.
- Retry does not guarantee success or require a worker dispatch. It authorizes
  a fresh evidence-based scheduler decision. That decision may dispatch or
  modify work, complete from current evidence, ask for a real external fact,
  or call `fail_task` again when current evidence proves no responsible repair
  remains. Plain prose cannot perform any of those lifecycle actions.
- The repair belongs to the prompt projection. It must not add a Host gate,
  natural-language classifier, automatic retry/failure/dispatch, wake loop,
  lock, lease, finite-state machine, synthetic user message, or database
  migration.
- Repository-wide search covered every `retryTask`, `operatorIntent`,
  retry/replan route, Task-loop entry, dynamic Orchestrator system builder,
  wake-provenance renderer, lifecycle tool, decision-effect classifier, and
  related test.

#### Live causal evidence

After the repaired backend restarted on port 7999, the public retry route
reopened E03, E04, and E10 with the same Task IDs:

| Case | Task                             | Retry response            | New root message                 |
| ---- | -------------------------------- | ------------------------- | -------------------------------- |
| E03  | `tsk_f9ab19d8f001kpnCY19fFd78aO` | HTTP 200, `status=active` | `msg_f9b4f23aa001PHlk6lUzzn7l42` |
| E04  | `tsk_f9ab1a20a0019PN2s6lHxeX7q5` | HTTP 200, `status=active` | `msg_f9b4f20e1001NllDg4fZoiyaq5` |
| E10  | `tsk_f9ab1bcdf001OQ5RbxDQVZSSmw` | HTTP 200, `status=active` | `msg_f9b4f2264001XXEJ4aonjC55VE` |

Each new root message completed normally after 15–20 seconds and contained
only a prose restatement that the old failure had already been recorded. Each
message has text and `step-finish(reason=stop)` parts but no tool part, while
the public Task remained active and its only current owner settled idle. The
previous Turns had actually called `manage_task action=fail_task`; the retry
Turns merely described those historical actions as current. This excludes a
broken `fail_task` implementation and proves a current-wake evidence error.

The direct trigger is in the prompt data path:

| Surface                   | Complete call points                                                                                                                                       | Disposition                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Operator retry/replan API | `task-api/index.ts::wakeTaskForOperatorIntent`, `retryTask`, `replanTask`; server `/task/:taskID/{retry,replan}`; panel and Orchestrator lifecycle callers | Preserve current queue reopening and typed `operatorIntent`; no new message or database field                         |
| Root loop                 | `orchestrator/loop.ts::runTaskLoopInner`                                                                                                                   | Preserve one natural decision pass; correct stale comments that claim a removed Host no-decision artifact             |
| Dynamic prompt            | `orchestrator/agent.ts::buildSystemParts`, runtime system resolver, wake-provenance renderer                                                               | Project the exact current root message, retry, replan, coordination request, or no-ingress wake without contradiction |
| Static scheduler contract | `prompt/core/orchestrator-core.txt`                                                                                                                        | No edit: it already says retry/replan are explicit wakes and prose is not a decision                                  |
| Lifecycle actions         | `orchestrator/task-lifecycle-tools.ts`, `orchestrator/tools.ts` decision effects                                                                           | No edit: current actions correctly persist real outcomes and never infer lifecycle from prose                         |
| Tests                     | `operator-message.test.ts`, `internal-wake-provenance.test.ts`, `session-reuse.test.ts`, `replan-routes.test.ts`, `natural-stop-contract.test.ts`          | Add branch and real runtime-system coverage; preserve the no-Host-gate contract                                       |

`buildSystemParts` currently renders `event.rootMessage` but never consumes
`event.operatorIntent`. Every reused Orchestrator Session then receives the
fixed `renderInternalWakeProvenanceNotice()`, which falsely states that the
current wake contains neither a root message nor an operator intent and that
historical retry requests are not fresh authorization. The typed current retry
therefore disappears and is replaced by its logical opposite.

#### Reviewed repair

- Replace the fixed notice with one `renderWakeProvenanceNotice(event)` source.
  Render all present current ingress facts without assuming they are mutually
  exclusive: root message identity, exact retry/replan intent, and coordination
  request. Only a wake with none of them receives the anonymous internal-wake
  wording.
- State that retry/replan is an operator-issued current intent but not a new
  user-authored message. Historical failure evidence remains valid evidence;
  it is not the current request. Require any claimed scheduler outcome to be
  expressed by the corresponding real tool, while leaving the actual outcome
  to the model and current evidence.
- Append the provenance on every reused Session and on a first physical Turn
  that already carries explicit ingress. Omit anonymous wake wording only for
  the normal first Turn whose real user request is already appended.
- Cover retry, replan, root message, combined ingress, coordination request,
  unknown current intent, and no-ingress branches. Add a runtime-system
  regression on a reused Orchestrator Session proving retry is visible and the
  false no-intent sentence is absent.
- Keep the natural assistant message as visible evidence when the model stops
  without a tool. Do not restore the retired Host
  `orchestrator-decision-contract-failure` classifier or self-wake path:
  `natural-stop-contract.test.ts` explicitly forbids them, and the July 18
  incident record proves they produced an automatic prose-only wake storm.

Claude `-p` and the independent Agent both accepted the direct causal chain and
prompt-owned repair. Claude required the wording to preserve retry's freedom
to fail again from current evidence and requested combined-ingress coverage.
The independent Agent proposed restoring a passive Host no-decision artifact;
that proposal is rejected because it conflicts with the current natural-stop
contract and the proven historical removal. Its discovery that the Task-loop
comments still promise that removed artifact is adopted as a documentation
correction, not a Host behavior change.

### Fact-check scope limits misread as delivery failures

#### Recall

- The user explicitly distinguishes defaults, unknown values, and review scope
  limits from evidence errors. Only false or missing required evidence, an
  invalid path, stuck execution, or a concrete acceptance failure may block
  delivery.
- E04 and E05 each produced a `fact_check_review` whose unresolved items were
  `why_unresolved=out_of_scope`. The Orchestrator later failed the Task from the
  unresolved count even though the review did not refute the underlying
  contract. Operator messages can recover an individual Task but are not the
  system repair.
- This repair must remain prompt- and evidence-projection-owned. It must not
  add an automatic PASS, Host lifecycle gate, status machine, keyword
  classifier, retry loop, fallback, or database migration.
- Repository-wide search covered `FactCheckReviewSchema`,
  `deriveFactCheckVerdict`, `validateFactCheckReviewSemantics`,
  `fact-check-core.txt`, every `fact_check_review` persistence/render/read
  surface, General and Research Studio overlays, and their tests.

#### Live causal evidence

E04 fact-check artifact `art_f9b6fb111001x7PHVUmOE1Nhfa` records six verified
items, one minor wording correction, and four unresolved items. Every
unresolved item is `out_of_scope`: clean Git status, registered Goal/scorer
execution, fresh command exit codes, and macOS deny-network execution. It
contains no evidence that the data or citation contract is false.

A fresh external verification on clean `main` at
`b358450907d3fe579a4b51b235000819feb7d786` then proved:

- macOS `sandbox-exec` with `deny network*`:
  `bun test tests/data` = 34 pass, 0 fail, 985 assertions;
- the same sandbox:
  `node scripts/validate-data.mjs` = 35 records, five cities, 64/64 citation
  anchors, no missing/orphan/duplicate/empty fields, and
  `network_attempts=0`;
- all five city source validators passed; and
- `git diff --check` passed on a clean worktree.

The Orchestrator's `read_context scope=fact_checks` output did not expose any
of those unresolved claims or reasons. It rendered only the verdict and
verified/corrected/unresolved counts. The Orchestrator therefore could not
execute its existing core instruction to inspect unresolved fact-check items
and treated `needs_orchestrator_action` plus a non-zero count as a business
failure.

#### Impact and call-point inventory

| Surface                    | Complete call points                                                                                            | Disposition                                                                                                                                                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review data contract       | `fact-check/schema.ts::{FactCheckUnresolvedItemSchema,deriveFactCheckVerdict,validateFactCheckReviewSemantics}` | Preserve the JSON shape and `needs_orchestrator_action` as an attention verdict, not a Task outcome; define `why_unresolved` and `severity` so the verifier does not confuse claim importance with proven delivery impact   |
| Fact-check worker contract | `prompt/core/fact-check-core.txt`, General `claim-verifier` overlay                                             | Define `out_of_scope` as an unjudged scope boundary, not verification failure or acceptance PASS; severity describes the consequence if the claim is false                                                                  |
| Exact review projection    | `orchestrator/read-context-tool.ts`, `orchestrator/fact-check-tool.ts::renderFactCheckReview`                   | Replace counts-only drill-down with a bounded decision-first rendering that preserves each corrected/unresolved claim, reason, severity, impact, and evidence pointer                                                       |
| General scheduler judgment | `expert-squad/builtin/general/agents/orchestrator/system.md`                                                    | State that fact-check verdicts are evidence, not completion gates; an out-of-scope item is neither verified nor refuted, so use other current evidence or dispatch the capable verifier instead of failing from count alone |
| Other packages             | Research Studio overlay                                                                                         | No first repair while that external package is not active in the ten E2E Tasks; record its verdict-name coupling as a separate affected consumer                                                                            |
| Tests                      | fact-check schema/prompt, read-context projection, General package tests                                        | Prove semantic descriptions, per-item projection, bounded critical ordering, and no count-only failure instruction                                                                                                          |

Claude `-p` correctly identified the counts-only projection as a direct
co-cause and rejected operator-message-only recovery. Its broader proposal to
add new mandatory unresolved fields and change the verdict formula is not
adopted for this live repair: it would break every persisted historical review
in the real database and is unnecessary to express the required distinction.
`needs_orchestrator_action` remains truthful when a material claim is unjudged;
the required action may be to inspect other evidence or route exact proof, not
to fail the Task. The repair restores that existing LLM judgment surface
without an automatic `out_of_scope => PASS` rule.

### Graceful-shutdown ownerless Task recovery

#### Recall

- Continue all ten real Tasks on port 7999 against the existing persistent
  SQLite database. Restarting the isolated backend is authorized, but database
  reset, direct database mutation, a historical benchmark runner, and broad
  process termination are not.
- A missing optional field or default is not a failure. A started incomplete
  Task with no current-process owner, no pending durable wake, and exact
  execution-cancellation evidence is a path error because no producer remains
  that can advance it.
- Recovery must remain one factual Host observation plus the existing natural
  Orchestrator wake. It must not choose a Goal result, parse shutdown prose,
  auto-retry a Goal, add a lock/lease/gate/state machine, synthesize a
  conversation message, or migrate the database.
- Repository-wide search covered
  `engine/queue.ts::{persistQueuedRecoveryWakeInTransaction,drainPendingQueuedOperatorWakes,interruptedSessionEvidence,reconcileInterruptedTaskExecutions}`,
  `engine/host-recovery.ts`, `engine/writer.ts`,
  `engine/task-directory.ts::taskRootDirectory`,
  `engine/task-session-lineage.ts`, `project/bootstrap.ts`,
  `orchestrator/agent.ts`, `orchestrator/error-envelope.ts`,
  `session/prompt/{state,cancellation}.ts`, `session/loop.ts`, the serve and
  sidecar shutdown entry points, and every recovery/shutdown test found by
  repository-wide `rg`.

#### Live causal evidence

The isolated PID 17862 received SIGINT and stopped cleanly before the same
database was reopened on port 7999. E01, E03, E05, E06, and E07 recovered
automatically. E02 and E04 remained `active` with no
`owned_prompt_sessions`, no pending wake, and this structured current Task
error:

```text
errorName=ExecutionCancellationError
message=Server shutdown: SIGINT
```

Their latest worker and Orchestrator lifecycle events converged to `idle` and
then the Orchestrator emitted `terminal(reason=aborted)`. The current recovery
predicate accepts only a latest durable worker status of `streaming` or
`retry`, so successful graceful settlement removed the only evidence family
it knew. Both Tasks resumed only after the public retry route supplied a new
operator-intent wake.

The same database contains exact append-only occurrence anchors:

| Task | Orchestrator stream-error artifact | Error                        |
| ---- | ---------------------------------- | ---------------------------- |
| E02  | `art_f9b9afa190017ZhooM4UrijgTn`   | `ExecutionCancellationError` |
| E04  | `art_f9b9afa2d001vYU2g2Yr16bMoB`   | `ExecutionCancellationError` |

This excludes a missing/default field and excludes a content-contract failure.
It is a graceful process-lifecycle recovery gap. An ownerless active Task also
prevents the same-directory queue from advancing, so the impact includes its
queued siblings.

#### Reviewed repair and impact

The first proposed repair extended startup reconciliation with
`task.error.errorName=ExecutionCancellationError` plus a matching
`orchestrator-stream-error` artifact. Independent review rejected that
inference after tracing the shared cancellation producer: a direct operator
Session abort can emit the same error and terminal event. The artifact lookup
also did not establish that the Task error and artifact were the same
occurrence. Treating that evidence as process shutdown would therefore revive
execution the operator intentionally stopped. That implementation and its
tests were removed in full rather than retained as a fallback.

The repaired ownership handoff is written only by the actual serve/sidecar
process-shutdown path:

- serve and sidecar stop the HTTP ingress before owner enumeration, closing
  the race where a request creates a new Task root after the shutdown snapshot;
- `terminateCurrentProcessOwnedExecution` snapshots the prompt owners that
  physically belong to the exiting process and resolves their exact Task and
  root Session lineage;
- an owner Session's own directory is used only to cancel that physical
  owner. The affected serialization directory is resolved from the Task root
  with `taskRootDirectory(task)`: a Build owner normally runs in a managed
  Goal worktree while the Task root and its queued siblings remain in the
  primary project directory;
- it enters a process-shutdown-specific in-memory handoff for every unfinished
  Task root in each affected serialization directory, including queued
  siblings. That handoff composes the existing root destructive scope but is
  not shared by cancel/delete/archive/rewind;
- one database transaction writes a structured
  `ProcessShutdownInterruptionError` infrastructure fact for every active
  physically owned Task, with `origin=process_shutdown`, the process ID and
  owned Session IDs, plus each paired durable recovery wake. A multi-Task
  shutdown therefore cannot commit only a prefix of its handoffs;
- the existing destructive behavior cancels root wake queues and rejects late
  descendant Session creation. The shutdown-specific marker additionally
  prevents queue claim/re-entry and preserves only a structured
  `processRecovery` wake; ordinary destructive scopes retain their prior
  rejection semantics. The repair adds no persisted lock, lease, workflow
  gate, or second scheduler;
- direct dispatch during the shutdown handoff persists the durable request
  without launching it. An accepted wake still consumes any pending Task
  wait/cron and records the caller's existing accepted-wake callback;
- serve and sidecar retain the scope until process exit. A newly started
  process has no in-memory destructive scope and consumes the same durable wake
  through the ordinary natural Orchestrator path;
- `retainTaskHandoffUntilProcessExit` is a required call-site declaration, not
  an optional default. Repository-wide call-point search proves production
  callers are only serve and sidecar; user abort/cancel paths do not call this
  writer;
- direct operator Session abort never calls this shutdown writer and therefore
  creates neither a `process_shutdown` fact nor a recovery wake. Ungraceful
  process loss continues to use the existing durable `streaming/retry`
  startup-reconciliation evidence.

The transaction gives the infrastructure fact and recovery delivery one
commit boundary. The wake identity is new for each concrete process shutdown;
it does not depend on mutable Task error text, so a later independent shutdown
can recover again. The Host still records only physical interruption and does
not select a Goal outcome, synthesize a conversation message, or reinterpret
missing/default business data.

Regression coverage proves that a process-shutdown handoff preserves rather than
delivers a durable process-recovery wake, blocks a same-directory queued
sibling, releases both after the scope closes, consumes pending Task wait/cron
state on wake acceptance, writes exactly one structured shutdown handoff per
affected Task, creates no `message` row, scopes same-directory siblings during
cancellation even when the only physical owner is a Build Session in a
different managed worktree, releases every acquired scope if the fact/wake
transaction fails, cancels all physical owners before awaiting any one of
them, and leaves terminal operator-abort evidence outside startup recovery. A
separate root wake test proves ordinary destructive scope does not acquire
shutdown-handoff semantics. Serve and sidecar source tests prove ingress stops
before owner enumeration and production shutdown retains the handoff until
process exit.

Validation also exposed a separate test-lifecycle defect in
`startup-error-envelope.test.ts`: its async-disposable deleted the test-owned
database directory before `afterEach` closed the cached SQLite vnode, producing
`SQLITE_IOERR_VNODE` even when run alone. The test now disposes project
instances and closes that exact database before temporary-directory removal.
This is a test-lifecycle repair, not Task recovery evidence.

### Unbounded Task evidence projection and ownerless length termination

#### Recall

- E04 is `active` but its root Orchestrator has no current owner or pending
  wake after a 67-visible-token response ended with the provider's structured
  `finish=length` signal. This is a stuck execution, not a missing/default
  business field.
- Repository-wide search covered the provider and Session finish paths, plus
  every `describeTask` / `renderTaskDescription` caller and the complete
  specialist evidence projection:
  `engine/describe.ts::{describeTask,listAgentMessageRefs,listCompletedToolCallRefs,renderTaskDescription}`,
  `orchestrator/agent.ts::prepare`,
  `orchestrator/read-agent-message-tool.ts`,
  `orchestrator/read-context-tool.ts`, and their Engine/Orchestrator tests.
- The repair must not hard-code a model-specific context size, treat every
  `length` response as context overflow, or add a retry gate. Provider
  execution evidence must remain distinct from the concrete prompt-construction
  defect and from business defaults.

#### Live causal evidence

The persisted E04 message `msg_f9bb4343e0012K1HQMATxdyZdA` records
`input=356651`, `output=67`, `reasoning=54`, `cache.read=14848`,
`finish=length`, then its Orchestrator Session transitions from `streaming` to
`idle` with no further wake. The model catalog claimed
`context/input=1050000` and `output=128000`, so predictive and usage-based
reactive compaction both considered the response safely below the declared
budget.

The same database contains two later independent occurrences:
E01 `msg_f9bd308df001Rr41bM0tIl9cJ8` at input 356184 with 818 generated
tokens, and E10 `msg_f9be0e833001lf0LNXch4vpweo` at input 356460 with 397
generated tokens. All three use the same model, report the same 14848 cached
input tokens, end with `length`, and leave their root Orchestrator without a
follow-up tool call. The clustering is strong evidence of a live provider
execution boundary, but it still does not prove whether that boundary belongs
to context, reasoning, or another provider-side completion policy.

The explicit public `POST /provider/models/refresh` path was run against the
real Hexin credential and atomically refreshed the isolated port-7999 catalog.
It returned the same 27 models and persisted the same
`1050000/1050000/128000` limits. A direct credentialed read, sanitized to emit
only model metadata, found three duplicate `gpt-5.6-sol` rows and all declared
the same `max_tokens=128000`, `max_input_tokens=1050000`, and
`max_output_tokens=128000`. OpenCorvus separately caps a call's requested
output at 32,000 tokens; the affected messages still stopped after only
67/534/258 visible output tokens and 54/284/139 reasoning tokens. Neither a
stale catalog nor a recorded exhaustion of that local output cap is proven.

Direct rendering against the same persistent Task facts identified a more
specific product-owned trigger:

| Task | `renderTaskDescription` chars | completed specialist messages | completed specialist tools |
| ---- | ----------------------------: | ----------------------------: | -------------------------: |
| E01  |                       686,407 |                           848 |                      2,287 |
| E04  |                       519,989 |                           562 |                      1,882 |
| E10  |                       582,466 |                           761 |                      1,982 |

`listAgentMessageRefs` and `listCompletedToolCallRefs` enumerate the entire
specialist Session tree, and `renderTaskDescription` currently repeats
session, kind, message, tool, call, part, and timestamp on one line per fact at
every root wake. Read-only SQLite analysis across E01–E10 found 16,479
completed tool refs. Every one belongs to a completed assistant message; there
are zero tool refs whose enclosing assistant message is incomplete. The
existing `read_agent_message(session_id,message_id)` call already returns all
tool facts from that exact message. Therefore the tool-ref projection is
currently a duplicate index, not an independent evidence source.

Claude `-p` accepted that projection diagnosis but correctly rejected a
stronger claim that the 519–686 thousand rendered characters alone prove why
the provider emitted `finish=length`. OpenCorvus estimated the affected turns
at roughly 174–224 thousand total tokens, below the provider-declared window.
Claude proposed output-budget saturation by reasoning as a competing
explanation; the persisted affected messages record only 54, 284, and 139
reasoning tokens respectively, so they do not support that explanation either.
The final provider-side reason for `length` therefore remains unknown. The
proven product defect is narrower and still material: a 98%-duplicate,
non-compressible system projection is rebuilt on every wake and cannot
self-converge through message compaction.

#### Revised repair boundary

Claude `-p` rejected the initial proposal to classify
`length + low generated tokens` as context overflow. That rejection is
accepted: failing to reach OpenCorvus's requested output ceiling does not prove
input-side context exhaustion, and compaction would hide an unknown provider
boundary behind the wrong product meaning.

The temporary proposal to keep issuing provider turns automatically after
`finish=length` is suspended. It acts after the oversized prompt has already
been sent, cannot explain which provider budget ended, and can repeat an
unknown provider boundary without limit. It must not be accepted as the root
repair.

The repair belongs in the single Task evidence projection:

- preserve the complete `TaskDesc` inventories and every durable database
  fact;
- group completed specialist message refs by Session so shared agent/kind
  identity is rendered once, while every exact `(session_id,message_id)` ref
  needed by `read_agent_message` remains discoverable in durable order;
- do not separately render a completed tool ref when its enclosing completed
  message is already projected, because the exact message reader returns that
  tool fact;
- continue to render completed tool refs whose enclosing assistant message has
  no matching completed-message projection ref, whether the message is
  incomplete or is completed but lacks the parent/agent identity required by
  that projection;
- derive that deduplication key only from the actually projected completed
  message refs, not from a second database completion predicate, so malformed
  completed messages without required parent/agent identity cannot lose their
  otherwise durable tool facts;
- keep the total completed-tool inventory count visible beside the orphan
  count, making a later message-completion transition auditable;
- do not let prompt size, ref count, agent name, tool name, or `finish` text
  choose Task/Goal lifecycle, retry, completion, or failure.

This is a normalization of one read model, not evidence deletion, a fallback,
gate, lease, state machine, second active source, or database mutation.
Regression coverage must prove compact discovery of every completed message,
absence of duplicate tool refs for completed messages, preservation of
interrupted-message tool refs, exact tool payload recovery through
`read_agent_message`, and unchanged ordinary Goal/artifact/failure projection.
