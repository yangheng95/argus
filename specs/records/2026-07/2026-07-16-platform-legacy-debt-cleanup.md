# Platform Legacy Debt Cleanup

Date: 2026-07-16
Status: In progress
Owner: Codex

## 2026-07-18 Final-Tree Recall Refresh

### Recalled Goal And Acceptance

- The current delivery denominator excludes the three abandoned Frontend Replica, Mirror Watch and IWC/MirrorTest
  end-to-end publications. It still includes exact dynamic-agent identity through Overlay, removal of remaining
  false runtime surfaces, Frontend Replica domain externalization, the final stability/debt matrix and independent
  final-tree review.
- `capability_projection.agents.<agentID>` remains the runtime, dispatch, tool, skill and catalog identity.
  `base_role` remains only the strict runtime-template seed. Missing projected agents and missing runtime templates
  must fail immediately.
- The current branch is `v0.0.9beta`; every completed slice is committed and pushed to `myhexin` before the next
  implementation slice grows.

### Exact Tree And Sources Recalled

- Exact reviewed tree before this refresh: `85417817d2` (`dsw-33987 settle environment GUI fixture requests`).
- Re-read `AGENTS.md`, this record's complete Recall and disposition tables, current architecture records, the
  expert-squad SDK record and the 2026-07-17 all-squad runtime audit before implementation.
- Re-ran production and test searches for dynamic `agentID`, `normalizeAgentRole`, `goal_report`, `goal.report`,
  `GoalReportTool`, `GoalReportEvent`, `max_executor_groups`, manifest v2, `pre-terminal-reflection`, base-role
  dispatch targets and Frontend Replica/web-clone host imports.
- Re-ran the real repository package projection path with Bun elapsed timeout disabled:
  `repository-dynamic-agent-packages.test.ts` passed 10/10 tests and 909 assertions. This covers every repository
  squad, exact projected dispatch targets, resolver-owned model-visible identity and payload release semantics.

### Independent Final-Tree Feedback

- Runtime residue review confirmed strict exact-agent dispatch, fail-fast projected-agent/template lookup,
  `general` as the only built-in package, manifest v1 and inactive-package isolation. It found three concrete
  remaining defects: Overlay discards `CardNode.agentID` in bubble titles; Frontend Replica still consumes
  domain-specific core host generation; and the obsolete `goal_report` terminal surface remains globally exposed.
- Platform/SDK review independently confirmed the resolver, virtual-workflow DAG guidance and projected-agent
  concurrency contracts. Its 44/44 registry/workflow/SDK tests, 36/36 lease/dispatch/package tests and SDK
  typecheck passed. It agreed that host `web-clone` externalization is the principal remaining platform boundary.
- Repository-debt review is still pending at the time of this refresh. No deletion disposition will be inferred
  from file names or branch line counts before that review reports exact ownership and regeneration evidence.

### Codex Review Feedback On Item 19

- The first implementation treated every non-user card as a runtime agent. Independent review rejected it:
  permission/question interaction cards are real `system` participants with no agent identity, while Integrity
  lifecycle cards were incorrectly created with an empty `agentID`.
- The corrected boundary is data ownership, not a display-name exception. `system` interaction cards retain the
  translated system-participant label. Every actual agent card requires an exact non-empty identity at
  `createSessionCardNode`; Integrity review events carry the projected `agentID` already owned by their emitter
  through started/progress/completed payloads, and Overlay materialization consumes that field directly.
- Tests must cover system interaction rendering, started-before-message Integrity materialization, progress replay
  reconstruction and completed-only materialization. Missing or drifting agent identity must fail at ingestion,
  never later in Solid rendering and never by inferring `integrity` or another runtime-template role.

### Item 19 Final Evidence

- OpenCorvus review and Integrity events now carry the exact projected `agentID`; Overlay uses that identity as the
  sole agent-card identity, rejects missing or drifting values during ingestion and keeps `base_role`/stage only as
  presentation metadata. The generated OpenAPI and JavaScript SDK were regenerated with the package SDK builder.
- Focused OpenCorvus and Overlay tests passed, all three affected package typechecks passed, and the independent
  exact-tree review accepted the corrected protocol after earlier reviews exposed system-participant, replay,
  late-event and report-body double-source defects.
- The Node-headed agent summary test passed and its screenshot shows the complete long projected ID without
  clipping. The larger compact/reload GUI test initially failed because its own Server-Sent Events (SSE) lifecycle
  list omitted the newly mounted Mailbox stream and cleanup stopped the fixture server before its browser. The
  test now classifies teardown for every stream it actually owns through the same SSE lifecycle helper and closes
  the browser before closing fixture streams/server. It then passed 1/1; inspected hydrated and keyboard-focus
  screenshots show complete dynamic identity, no horizontal overflow and a visible focus ring.
- The GUI replay also exposed a real focus regression: `.conversation-agent-rail` directly set `box-shadow: none`
  on the shared Button and overrode its canonical `:focus-visible` ring. The direct override is removed; the test
  asserts the Button primitive's actual box-shadow focus contract rather than a stale outline implementation.

### Item 21 Recall: Remove The False Goal Report Surface

- A fresh exact-tree audit at `003957bb39` proved `extractGoalReport()` has no caller, no production path constructs
  `goalReports`, and no consumer subscribes to `goal.report`; Overlay only discarded the event as pass-through.
- The sole Build terminal path is `report_build_result` schema validation, Orchestrator build finalization,
  `build_attempt_outcome`/acceptance/diff artifacts, `TaskAgentOutcome`, and Integrity evidence derived from those
  outcomes. Deleting `goal_report` does not require an alias or replacement terminal.
- The atomic deletion covers the tool and event definitions, global registry/catalog/tool pools, delegate policy,
  server event imports, Overlay event policy, acceptance persistence's unused report field, Integrity's unsupported
  `goalReports`/`executor_reports` evidence branch, OpenAPI/SDK, public tool docs, snapshots and positive/negative
  tests. Historical records remain historical evidence and are not rewritten.
- Removal tests must prove `goal_report` is absent from the registry and docs, `goal.report` is absent from OpenAPI
  and unknown to Overlay, legacy `goalReports` packets fail as unsupported fields, and `executor_reports` fails the
  AI SDK input schema. Tests must not directly execute invalid typed input through `as any` and then match an
  incidental runtime exception.
- The first broad replay passed 145/146. The only failure was outside the removed surface: schema stress resolved
  current `general`, whose visual reviewer explicitly projects Browser MCP tools, with an incomplete config lacking
  the `browser` MCP server. Resolver fail-fast behavior is correct. The fixture must use the existing
  `BrowserMCPBuiltin.localConfig()` just like the general-package/resolver tests; no resolver fallback is allowed.

### Item 21 Final Evidence

- The false tool/event and every production projection, persistence, Integrity, Overlay, OpenAPI/SDK and current
  public-document surface are deleted atomically. Exact production/current-document residue is zero; only explicit
  negative regressions and retained historical records still name the retired contract.
- The corrected 14-file OpenCorvus matrix passed 194/194 with 4,041 assertions and one snapshot. Overlay event
  policy passed 6/6. OpenCorvus, Overlay and SDK typechecks, API route inventory, generated API docs, historical
  links and `git diff --check` all passed.
- Independent final review accepted the exact tree and independently passed 118/118 tests with 2,380 assertions.
  It confirmed `task_report` remains only a task-owned helper-session communication surface and cannot compete with
  the Build finalizer. No known Item 21 defect remains.

### Item 20 Recall: Frontend Replica Package Externalization

- The exact starting tree is `8696397ae1`. The installed `builtin/frontend-replica` package has no `tools/`,
  `lib/` or `assets/` implementation, while its interface-modeler still projects
  `default/tool/web_clone_generate_source_project` and `default/tool/create_frontend_skeleton_project`. The
  Frontend Innovate experience-designer also projects those Replica-specific host tools. Earlier prose that
  described the generator as package-owned is therefore not evidence for the current tree.
- The complete generator call-point scan found two host tool wrappers, the Frontend Design static-tool assembly,
  static tool-ID inventories, agent tool-pool data, both expert-squad manifests, the generator and profile source,
  `web-clone/index.ts` exports, `host-prepared-source-project.ts` helper imports and their focused tests. Slice A
  must replace or delete all of those surfaces atomically so no host/package or Replica/Innovate double source
  survives.
- Two independent read-only reviews agree that generic browser capture, `orchestrator/webpage-evidence.ts`,
  `web-clone/{context,handoff,source-skeleton,ir,archive-html,layout,evidence-integrity}`, Build prompt context and
  Visual Quality Assurance/reference-parity consumers are not generator execution owners. They remain for later
  evidence-publication and adapter slices and cannot be deleted merely because their current main consumer is
  Frontend Replica.
- The package-tool runtime already supplies a strict task-scoped host and the TaskArtifact ABI. Adding
  `htmlparser2` to the host external-import allowlist is rejected: it would make one squad's domain dependency a
  platform runtime dependency and create a per-package exception mechanism. The source generator already reads
  strict `page.ir.json`, owns `domNodeFromIrNode()` and can project the exact body children directly. Slice A must
  remove the redundant source-skeleton HTML parse rather than recreate it inside the package. Plain captured SVG
  sidecars remain explicit UTF-8 SVG artifacts; they must not trigger a second HTML parser implementation.
- Slice A uses one package tool with explicit canonical project-relative source-package and output paths. It has
  no default path, install-root lookup, environment inference or fixed `.opencorvus/.r` spelling. The caller owns
  the task-relative paths already presented in the Frontend Design prompt, and the tool validates that both paths
  remain under the active project directory. The later artifact-publication slice will replace the surrounding
  host-prepared path handoff as one atomic consumer migration; Slice A does not add a union input or compatibility
  alias.
- Acceptance for Slice A requires a real Registry/Resolver materialization and package-tool execution that
  produces the expected React source project, exact active/inactive package isolation, absence of both retired
  host tool IDs from source/catalog/tool pools, Frontend Innovate isolation, generator behavior regressions,
  typecheck/document health/generated payload freshness, independent exact-tree review, commit and push. Passing
  Slice A does not close Item 20: the later generic TaskArtifact publication/consumer and host domain-prompt
  residue slices remain explicit Goal work.

### Item 20 Slice A Verification And Independent Rejection

- The Frontend Replica generator and package-profile implementation now live under the manifest v1 package. The
  interface-modeler projects the single package ref
  `frontend-replica/frontend-replica-interface-modeler/generate-source-project`; Frontend Innovate projects no
  Replica generator. The retired host wrappers, fixed skeleton wrapper, host-prepared source-project helper and
  continuation snapshot branch are deleted without aliases.
- The package tool requires four explicit inputs: canonical project-relative source and output paths, canonical
  package name and explicit replacement permission. Its result contains only project-relative manifest refs and
  SHA-256 digests. A real installed-package Registry/Resolver test executes it through the persisted dynamic
  `frontend-replica-interface-modeler` task/session owner and rejects missing, absolute, parent-traversal, Windows
  reserved-name and noncanonical package-name inputs. It also installs the generated payload and resolves the same
  scheduler/worker identity, proves General and Frontend Innovate do not project the package ref, rejects identical
  or ancestor-overlapping source/output paths before any deletion, and rejects a junction-backed output that
  resolves outside the project while preserving the source manifest after every rejected write. The focused
  generator matrix passes 26/26 with 421
  assertions; Registry passes 24/24 with 178 assertions; Resolver passes 30/30 with 143 assertions; repository
  package projection passes 10/10 with 914 assertions; Frontend Design prompt/process coverage passes 18/18; and
  OpenCorvus typecheck passes.
- Two abandoned Frontend Replica E2E suites and their private preview runner/preload configuration are deleted
  because they directly executed the retired host wrapper and could not constitute current package-projection E2E
  evidence. The general full-pipeline test remains. The generic HTML skeleton checker remains, but its checks that
  required the retired tool name in trace/log text are deleted instead of being rebound to a domain package ref.
- That checker exposed a separate false-green from the runtime-root rename: it recognized the old `r/t` topology
  through a copied segment literal and allowed the real `.r/t` fanout parent to pass as a task directory. It now
  derives the only canonical task root through `ProjectRuntimePaths.projectRuntimeRoot`, removes a redundant `fd`
  pre-check that could bypass rejection for a valid fanout bucket, and passes 12/12 focused tests with 40
  assertions.
- Independent exact-boundary review REJECTS closing Item 20. The generator ownership slice is correct, but
  `frontend_design` and `frontend_research` still invoke the automatic host webpage acquisition/source-package
  pipeline; core Frontend Design prompt/schema/output validation still encode Replica-specific
  `web-clone-source`, visual-skeleton and region-replacement policy; and Build/Architect context still consume the
  parallel `webCloneSource` projection. The next atomic slice must first give the Replica package explicit source
  acquisition/IR capability, then remove both automatic host callers and the core domain prompt/schema/handoff
  residue. Slice A must not be cited as proof that Frontend Replica is fully externalized.
- A fresh exact-tree reviewer initially rejected Slice A for destructive source/output overlap, junction escape,
  missing direct inactive-package assertions and missing generated-payload installation coverage. After the
  corrections above, the same reviewer returned ACCEPT, independently replayed the focused test at 26/26 with 421
  assertions, confirmed `git diff --check`, and found no remaining known Slice A defect. The combined final
  Registry/Resolver/package runtime replay passes 80/80 with 742 assertions.

### Item 20 Slice B Recall: Explicit Source Acquisition Projection

- User requirement: continue the platformization Goal without special-case rules, fallback behavior, hidden host
  workflows or a second dispatch engine. The Frontend Replica package must own the decision to acquire source
  evidence, while OpenCorvus supplies only reusable runtime primitives. Three abandoned product E2E suites remain
  outside the current Goal acceptance and cannot be reintroduced as completion evidence.
- The exhaustive production call scan at `5e8a17448f` found three pre-model automatic owners of the same fixed
  webpage pipeline: `orchestrator/frontend-design-tool.ts` for any live Frontend Design URL,
  `frontend-research/agent.ts` through `research/agent.ts` for every source URL, and Deep Research through the same
  adapter for `targetDeliverable=prd`. `research/agent.ts` also retains an unused
  `read-existing-for-source-url` branch that catches every read error and silently continues. Frontend Design and
  Deep Research accept multiple URLs but the automatic pipeline captures only the first while later prompt and
  provenance surfaces still name all URLs.
- The full tool scan found five existing model-callable owners: `webpage_extract`, `webpage_compile`,
  `webpage_analyze`, `webpage_runtime_state` and `web_clone_prepare_context`. Their concrete `Tool.Info` providers
  exist, but `frontend-research` supplies none of them to the runner and its base-role template permits no default
  host-tool projection. The installed Frontend Replica source-researcher declares no tool refs, so deleting the
  automatic producers before adding explicit projection would break the package.
- Independent reviewers proposed one atomic package `acquire-source-package` tool plus a new callback-style browser
  Plugin ABI. That proposal is rejected for this slice: it would hide extract/compile/analyze/runtime/context flow
  inside one host callback, add a second browser request surface beside the mature Browser MCP and webpage tools,
  and turn domain sequencing back into host-controlled workflow. The existing manifest v1 projection protocol
  already provides the smaller general solution: a runtime template advertises reusable host primitives, the
  dynamic package agent explicitly selects them, and its prompt decides when and how to call them through visible
  natural tool messages.
- Slice B therefore makes the five current providers projectable only from the generic `frontend-research`
  runtime-template seed, supplies their runtime implementations to that adapter, and lists their canonical
  `default/tool/*` refs only on `frontend-replica-source-researcher`. It also projects read-only project access;
  extract and runtime-state tools already own the required DOM, screenshot and interaction-state capture, so this
  slice must not make Browser MCP configuration a redundant package-resolution prerequisite. General, Frontend Innovate and
  every other Frontend Replica agent must remain isolated from these refs. `base_role` remains only the permitted
  host-template seed; the dynamic source-researcher ID remains the projection and execution identity.
- Once real Registry/Resolver/runtime projection is green, the same slice removes all three pre-model automatic
  callers, the `prepareWebpageEvidence` mode union, the swallowed read-existing branch and the host-prepared prompt
  claim. Source URLs remain ordinary visible task input. The package prompt owns the explicit call sequence and
  must report acquisition failure instead of receiving injected evidence or silent reuse.
- This slice does not close Item 20. The next exact-boundary slice must move or delete the Replica-specific
  `web_clone_prepare_context` implementation, fixed webpage artifact prompt/schema, Frontend Design output
  semantics and Build/Architect `webCloneSource` handoff. Generic Browser MCP, browser runtime, factual webpage
  extraction/IR primitives, TaskArtifact and visual comparison remain platform infrastructure unless a later
  call-point review proves them domain-only.
- Slice B acceptance: real installed-package Registry and Resolver materialization; dynamic source-researcher tool
  projection with exact active/inactive isolation; persisted worker runtime execution for at least the
  task-scoped context tool; negative source scan for every automatic caller and host-prepared prompt; tests proving
  Deep Research, Frontend Research and Frontend Design no longer execute source acquisition before their model;
  no first-URL provenance claim; payload freshness; focused tests, typecheck and document health; independent
  exact-tree review; traceable `dsw-33987` commit and push to `myhexin/v0.0.9beta`.

#### Slice B implementation and verification refresh

- The active Frontend Replica source researcher now receives the exact five model-visible webpage evidence tools
  through its dynamic projection. Frontend Research supplies the reusable providers, but Resolver remains the only
  authority that exposes package-declared refs; General, Frontend Innovate and the Replica interface modeler do not
  inherit them. A persisted projected worker test executes the task-scoped context tool with no host-prepared input.
- Frontend Design, Frontend Research and Deep Research no longer run a webpage pipeline before the model. The old
  orchestration module, PRD adapter, swallowed read-existing branch, automatic status/artifact injection and
  `frontend_design.urls` contract are deleted. Frontend Design now treats a URL as text, consumes only explicitly
  projected source evidence, and reports missing evidence to the orchestrator instead of acquiring it itself.
- The residue review found and removed the second dead Frontend Design tool wrapper, its positive self-tests, the
  uncalled `reference-capture.ts` sidecar and dedicated tests, two producerless design-resource enum values, stale
  architecture-document paths, retired tool-ID tombstones and two tracked specialized benchmark request files.
  The four reusable webpage providers and their task-scoped output resolver remain because the dynamic source
  researcher calls them. Their user-facing descriptions now name projected package workers rather than a base role.
- The same review found that the HTML skeleton checker accepted the retired word `webpage_evaluate` as rendered
  visual evidence. That false acceptance path is removed and a behavior test requires the retired word alone to
  fail. Scheduler prompt tests now inspect the installed `SessionRuntimeContract.system` callback, which is the
  model-turn authority, and pin both complete-system mode and the initial-snapshot plus turn-refresh composition.
- Verification completed so far: the focused package/runtime matrix passed 145/145 with 916 assertions; the
  persisted dynamic worker context-tool test passed; document health and historical links passed 82/82 with 1,374
  assertions; root typecheck passed across 11 packages. A later broad five-suite replay passed 204/205 and exposed
  one test fixture that omitted the Browser MCP required by Frontend Innovate's declared visual workers; after
  adding the explicit fixture server, that full visible-skill-selection flow passes with 73 assertions. Final
  post-residue matrix, payload freshness and independent exact-tree review remain required before commit.
- The frozen post-residue matrix passed 376/378 and exposed two stale handoff string oracles from the current HEAD,
  not production failures: one asserted deleted prompt-editing prose and one still named fixed Build/Architect roles
  instead of persisted crop rows plus the execution evidence pack. After synchronizing those assertions, the full
  handoff suite passes 5/5. The generated payload is fresh, document health and historical links pass 82/82 with
  1,375 assertions, and root typecheck, API route inventory and generated API docs pass.
- Production Knip then identified `playwright` as apparently unused after `reference-capture.ts` deletion. Exact
  call tracing proved it remains a real runtime dependency: the scroll-slice comparison launches a Node sidecar
  whose generated script calls `require("playwright")`. Knip cannot statically parse that template-string entry, so
  its existing browser-runtime dependency annotation now names `playwright` beside `playwright-core`; production
  dead-code checking passes and the real scroll-slice sidecar suite passes 6/6 with 55 assertions.

### Item 20 Slice C Recall: Package-Owned Source Context and Single Visual-Handoff Semantics

- User requirement: continue from the accepted explicit-acquisition slice without manifest v2, special-case host
  rules, fallback behavior or another workflow engine. Frontend Replica domain context must be owned by the external
  package, while the core retains only reusable project, artifact, browser, visual and agent runtime interfaces.
- The current implementation baseline is `5a11daa4db`, which includes the pushed Slice B commit `1cd3933bbe` plus a
  concurrent clean G2 acceptance commit. The shared worktree is clean. The user-abandoned three product E2E suites
  remain outside acceptance, and every code change still requires focused tests plus independent exact-tree review.
- The exhaustive source scan found 724 matches across `web_clone_prepare_context`, `webCloneSource`, fixed
  `web-clone-source`, `source-ir`, `source-skeleton`, `prd-evidence-summary` and `frontend-design-skeleton`. This
  proves the remainder cannot be removed as one directory deletion. Browser Preview source binding, scroll-slice
  comparison, visual-region evidence, worktree preservation and benchmark verification have real consumers.
- Two independent read-only reviews rejected a context-only move. `webpage_analyze`, context, handoff, source
  skeleton and evidence-integrity form one Frontend Replica domain closure: analyze creates the handoff and semantic
  skeleton that context validates and packages, while source-skeleton and context share the same integrity readers.
  Copying only context would duplicate schemas and validation semantics. Slice C therefore moves this complete
  transform into one `frontend-replica-source-researcher` package tool and package-local library, removes the
  producerless `prd-evidence-summary.md`, and deletes the corresponding host tool/provider modules and tests in the
  same change. The generic `webpage_extract`, `webpage_compile` and `webpage_runtime_state` primitives remain in
  core. Existing manifest v1 package tools, mandatory project-relative source/output paths and package ToolContext
  are sufficient; no new host callback ABI, manifest version, workflow engine or runtime-directory discovery is
  allowed.
- The exhaustive call-point inventory for that closure covers `research/agent.ts`, `frontend-design/tools/index.ts`,
  `tool/non-base-tool-ids.ts`, provider schema stress tests, Frontend Research projection tests, package payload and
  source-project tests, the host prepare-context test, analyze topology test, and all `web-clone/{context,handoff,
source-skeleton,evidence-integrity}` tests. `web-clone/{archive-html,ir,layout}` remain temporarily as the generic
  compile wire-format producer; package code must consume the emitted files without importing host source or
  discovering its installation. Their neutral relocation and naming is a later residue slice, not a compatibility
  alias.
- The same audit proves `VisualHandoffContextData.webCloneSource` is a derived duplicate of `projectMode`. The
  orchestrator sets it whenever mode is `source_baseline` or `visual_baseline`; Architect and Build then consume the
  redundant boolean. Slice C must delete that field from producer, strict structured schema, renderer and consumers;
  `visualReference`, `projectMode` and `visualRegionBindings` remain the single generic visual-handoff contract.
- Do not partially delete fixed Browser Preview paths in Slice C. `source-reference`, region schema and local-module
  source binding first need one explicit project-relative or TaskArtifact reference contract; otherwise removing
  `web-clone-source/reference.png` would break real visual tools. Likewise, the large Replica-specific Frontend
  Design prompt/output/handoff surface is shared today by Frontend Innovate and requires a separate package-overlay
  extraction after its generic adapter contract is identified. These are ordered follow-up slices, not accepted
  variance and not evidence that Item 20 is complete.
- Slice C acceptance: generated and installed payload executes the package-owned source-context transform from the
  persisted dynamic source-researcher; no core `webpage_analyze`, `web_clone_prepare_context`, context, handoff,
  source-skeleton or evidence-integrity owner remains; General, Frontend Innovate and sibling Replica agents cannot
  see the package tool; every `webCloneSource` producer/parser/render/consumer and positive test is removed and
  strict parsing rejects the retired field. Payload freshness, package bundle closure, typecheck, dead-code, docs,
  focused runtime tests and independent exact-tree review must pass; then commit and push to
  `myhexin/v0.0.9beta` before the Browser Preview and Frontend Design residue slices begin.

### Repository-Debt Independent Feedback

- The branch delta is not deletion evidence. Generated SDK/OpenAPI/payload, retained June/July Recall and external
  package sources have proven owners.
- Confirmed later deletion slices are isolated orphan benchmark/diagnostic assets, one-shot database repair scripts
  and a channel-runtime sticker with zero consumers. Eight `packages/web/public` files are invalid path-text files
  masquerading as PNG assets and must be replaced by real assets or have their public references removed.
- `capture-ainvest-reference.ts`, the tracked AInvest delivery, Executor selector assets and tracked `.scratch`
  residue are already absent. Generic browser capture/diff, current Overlay benchmark inputs and active runtime
  evidence are not deletion candidates.

### Current Slice Call-Point Disposition

| Surface                      | Exhaustive current call-point conclusion                                                                                                                                                                                                                                                        | Required disposition                                                                                                                                                                                                 |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overlay bubble identity      | `tree-writer.ts` writes exact non-user `CardNode.agentID`; `card-tree.ts` documents it; `ChatBubbleIdentity` ignores it and renders only `roleLabel(normalizeAgentRole(role/stage))`. Agent rail and settings already display exact IDs.                                                        | Make the bubble title require and display exact non-user `agentID`; retain normalized role only as presentation metadata; add direct positive and missing-ID failure tests.                                          |
| `goal_report`                | Definition/event/global registration/tool catalog/tool pools, schema snapshots, acceptance evidence types, Overlay event pass-through, generated API and docs/tests still reference it. No current projected Build finalizer consumes it; `report_build_result` is the Build terminal contract. | Handle as a separate atomic removal slice after exact consumer verification; do not partially hide the tool while retaining a false event/API contract.                                                              |
| Frontend Replica host domain | The external package projects host `web_clone_generate_source_project`, skeleton and comparison tools; core `frontend-design`, Build prompt context, webpage evidence and `web-clone` generator still encode replica-specific artifact and React skeleton policy.                               | Externalize only the domain generator/policy through the existing package-tool protocol; retain generic browser/capture/comparison primitives and prove active/inactive isolation before deleting host entry points. |
| `max_executor_groups`        | Config, engine, OpenAPI, generated SDK and product docs all expose the same old public name for projected-agent concurrency.                                                                                                                                                                    | Rename atomically only after the higher-risk identity, false terminal and host-domain slices; do not add an alias.                                                                                                   |

## Recall

### User Request

The continuing platform-runtime Goal requires OpenCorvus to become generic infrastructure that supplies only
the common development runtime and extends agent-team behavior through explicit interfaces and protocols. The
user also requires a large-scale cleanup of remaining technical debt, legacy code, stale tests and intermediate
files, with final verification kept until the final phase. Every implementation slice requires
independent-agent review, a traceable commit and a push to `myhexin/v0.0.8beta`.

### Acceptance Criteria

- Preserve manifest v1, `prompt_profile.active`, dynamic
  `capability_projection.agents.<agentID>` identity, `base_role` as a runtime-template seed,
  `PromptProfileResolver` as the sole active projection owner, and package-owned virtual workflow guidance.
- Eliminate every remaining second execution owner, false public extension API, swallowed deterministic
  configuration failure, dead runtime entry, domain-specific tracked application and stale test that proves a
  retired source shape instead of current behavior.
- Keep one internal OpenCorvus execution/lifecycle adapter for projected workers while removing the parallel
  user-selectable Codex/Claude Executor runtime and its backend, Overlay, OpenAPI and generated SDK surfaces.
- Ensure every dynamic worker message remains exact through persistence and Overlay display; stage, channel and
  runtime template may control presentation but cannot replace the projected agent identity.
- Move remaining Frontend Replica domain generation and workflow policy out of core only after generic artifact,
  browser and package-tool primitives are proven sufficient. Do not remove generic capture or comparison
  primitives merely because they currently support that squad.
- Keep generated artifacts, retained June/July records and active evidence. Remove only tracked/local artifacts
  whose ownership and regeneration boundary are proven.
- Finish with concurrency, cancellation, cache, package-isolation, generated-freshness and residue verification,
  then a basic headed Overlay GUI/visual review that does not publish a Frontend Replica, Mirror Watch or
  IWC/MirrorTest task.

### Hard Constraints

- No fallback, compatibility alias, keyword gate, hidden workflow state, second active-squad field or second
  dispatch engine.
- Do not infer deletion from a name such as `legacy`, `retired`, `web-clone` or `NativeAgentInfo`; require call-point,
  ownership and behavioral evidence.
- Do not touch the concurrently modified
  `packages/opencorvus/src/expert-squad/payload.ts`; canonical package owners and the official generator own it.
- Tests run through `packages/opencorvus/script/run-with-inactivity.ts` with Bun elapsed timeout disabled. The
  three expert-squad E2E runs are removed from the Goal; basic headed GUI review remains last.
- Do not operate on existing OpenCorvus or Overlay processes. Do not spend product work on occasional network or
  Windows-only resource cleanup failures.
- Do not blanket-delete `.scratch`, build output or dependencies while active evidence or parallel work may still
  own them. Use exact path disposition and preserve sync-conflict backups.
- Every code slice receives focused regressions, self-review, a fresh independent exact-tree review, commit and
  push before the next slice grows the diff.

### Sources Read

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/README.md`
- `specs/current/architecture/01-agents.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/03-control.md`
- `specs/current/architecture/04-extensions.md`
- `specs/current/architecture/05-config.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/current/architecture/08-agent-tool-adapter.md`
- `specs/current/architecture/10-worktree-lifecycle.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/current/architecture/14-agent-runtime-mode.md`
- `specs/current/architecture/16-unified-teardown.md`
- `specs/current/architecture/99-principles.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-11-platform-runtime-external-goal-team.md`
- `specs/records/2026-07/2026-07-16-expert-squad-development-sdk.md`
- `specs/records/2026-07/2026-07-16-hidden-runtime-dot-directory.md`
- Runtime Executor, Plugin, Config, ToolRegistry, expert-squad resolver, Orchestrator ownership, Overlay RightDock,
  message rendering, package/workspace and generated-artifact sources named below.

### Whole-Repository Search Evidence

The audit used tracked-file inventories, Git history, `knip`, source call-point searches, ignored-file size scans,
legacy/fallback marker scans and a comparison with the actual local and `origin/dev` ref. The branch is not a
small delta from that baseline: `dev...v0.0.7beta` contains 7,690 changed files, 1,003,759 insertions and 527,925
deletions. Added lines are concentrated in `packages/opencorvus` (about 480,000), `packages/overlay` (about
221,000), generated SDK surfaces (about 90,000), retained specs (about 137,000) and external expert-squad sources
(about 36,000). These totals are investigation signals, not deletion criteria.

Tracked and generated disposition:

| Surface                                                            | Evidence                                                                                                                                             | Disposition                                                                                                                                                              |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| SDK OpenAPI/generated client, expert payload and portable template | Registered by `script/generated-artifacts.ts` and covered by freshness tests.                                                                        | Retain; modify only through the official generators.                                                                                                                     |
| June/July specs                                                    | 1,111 retained files, about 12.2 MiB; no prohibited pre-June record exists.                                                                          | Retain as required Recall and historical evidence.                                                                                                                       |
| `packages/ainvest-amd-replica/**`                                  | 24 files/about 2,166 lines, no consumer outside its own workspace except version/lock bookkeeping; introduced as a concrete AMD replica application. | Remove as a domain delivery accidentally tracked in platform packages; update workspace lock, release target and current-doc example reference with negative regression. |
| `.scratch/pin-visual/project/.gitignore`                           | The only tracked `.scratch/**` file; no call point; root `.gitignore` already ignores scratch.                                                       | Remove and add a repository hygiene regression.                                                                                                                          |
| Overlay MSI under `dist-artifacts/windows-x64`                     | Stale 0.0.6 LFS build output; output path is produced by packaging workflows but is not ignored.                                                     | Decide release-asset retention, then remove from source and ignore generated output; do not delete before that decision is bound.                                        |
| Local ignored outputs                                              | About 23.5 GiB including `.scratch`, `node_modules`, dist trees and Rust target.                                                                     | Clean only after active owners finish and exact evidence paths are retained; not a tracked-line explanation.                                                             |
| Overlay font packages                                              | Imported from `src/styles/tokens/fonts.css`; current Knip project excludes CSS.                                                                      | Retain and fix dead-code tool visibility rather than deleting live fonts.                                                                                                |

Runtime and API disposition:

| Surface                                                                                                            | Exhaustive call-point conclusion                                                                                                                                         | Disposition                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| `executor/codex.ts`, `executor/claude-code.ts`, `executor/index.ts`                                                | Production has no consumers; only executor tests import them.                                                                                                            | Delete dead implementations and replace generic managed-runtime fixtures without preserving aliases.                        |
| `ExecutorRegistry.createInstance/list` and default instance fallback                                               | Zero production callers; `createInstance` explicitly falls back.                                                                                                         | Delete. Propagate `autoRegister` failure instead of replacing it with a secondary not-configured error.                     |
| User-selectable Codex/Claude Executor runtime                                                                      | Still appears in contract, Task creation, Build branching, routes, Overlay and generated SDK.                                                                            | Remove atomically after the smaller dead/API slices; retain only the internal OpenCorvus lifecycle adapter.                 |
| Plugin hooks `permission.ask`, `evaluation.checks`, `evaluation.result`, `evaluation.analysis`, `acceptance.ready` | Declared by `packages/plugin/src/index.ts`; no production `Plugin.trigger`; EN/ZH docs advertise part of the false surface.                                              | Delete types and documentation; add type-level negative coverage. Do not invent triggers to justify them.                   |
| Managed Config and command Markdown failures                                                                       | `config/config.ts` skips managed directory/file permission errors and parses command Markdown through catch-and-continue.                                                | Fail with exact path and cause; prove no partially materialized Config is returned.                                         |
| `ToolRegistry.tools(..., agent?: NativeAgentInfo)`                                                                 | Production introspection caller passes no agent; agent-bearing callers are old fixtures. Real sessions use `runtimeTools`, projected workers use `projectedWorkerTools`. | Remove the optional legacy projection entry and migrate tests to the real runtime/projection APIs.                          |
| PromptProfile aliases and legacy tool/Skill special cases                                                          | Unused aliases or tests-only aliases remain; retired tool IDs and Skill frontmatter keys receive dedicated legacy handling.                                              | Replace with current ExpertSquad terminology and strict general schemas; unknown values fail uniformly.                     |
| Active/current workflow wording and retired tools docs                                                             | Three core prompts say active/current workflow; tools docs still mention `dispatch_goal/retry_goal`.                                                                     | Correct to active projection/projected capability and current `dispatch_agent/manage_task`; add negative prompt/docs scans. |
| `JSON_SCHEMA_DESCRIPTION` with hard-coded Build identity                                                           | Dead export; real compaction path calls the identity-specific renderer.                                                                                                  | Delete with residue test.                                                                                                   |

#### Production Call-Point Disposition

The following table records the production definitions and consumers found by the full-tree searches. Test
families in the final column are part of the same replacement, not optional follow-up work. Before each
implementation slice, the exact search is rerun against the then-current tree and this record is appended if a
new caller appears.

| Contract                          | Definition/producer call points                                                                                                                                                                                                                                                                                                                   | Consumer disposition                                                                                                                                                                                                                                                                                                                                                               | Test/generated/doc disposition                                                                                                                                                                                                                                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| False Plugin hooks                | `packages/plugin/src/index.ts` owns all five declarations. No `Plugin.trigger` call exists for any key.                                                                                                                                                                                                                                           | Delete the five declarations; retain every hook that has a real trigger in `session/**`, `build/agent.ts`, `system-terminal/index.ts`, `tool/**` and `protocol/store.ts`.                                                                                                                                                                                                          | Remove examples/tables/claims from EN/ZH `plugins.mdx`; add exact SDK/doc negative coverage.                                                                                                                                                                                                                                      |
| Config swallowed failures         | `config/config.ts` owns `permissionDenied`, both managed-config catch-and-continue branches and `loadCommand` parse-and-continue. `config/markdown.ts` owns the typed frontmatter error.                                                                                                                                                          | Replace both managed catches and the command parse catch with path/cause-preserving failure; retain precedence and merge behavior.                                                                                                                                                                                                                                                 | Extend `test/config/config.test.ts`, `skill-mount-source.test.ts` and `markdown.test.ts`; no partial Config may be returned.                                                                                                                                                                                                      |
| Dead Executor implementations/API | `executor/codex.ts`, `executor/claude-code.ts`, `executor/index.ts`; `executor/registry.ts` owns `createInstance`, `list` and the default-instance fallback.                                                                                                                                                                                      | Delete these symbols/files. Retain live internal `opencorvus.ts` and, until later full removal, live `codex-app-server*`, `codex-cli.ts`, `claude-agent.ts`, `managed.ts`, `bootstrap.ts` and protocol code.                                                                                                                                                                       | Delete `test/executor/request-mapping.test.ts` and dead-provider-only `runtime-env.test.ts` cases; replace uses in `managed.test.ts` with an explicit test adapter.                                                                                                                                                               |
| ToolRegistry Native projection    | `tool/registry.ts` imports `NativeAgentInfo` and accepts it in `tools`; `server/routes/experimental.ts` calls without agent.                                                                                                                                                                                                                      | Remove the parameter/conversion. Keep `runtimeTools` and `projectedWorkerTools` as the only agent-aware materializers.                                                                                                                                                                                                                                                             | Replace agent-bearing `test/tool/registry.test.ts` fixtures with real session runtime/projection tests; retain route introspection coverage.                                                                                                                                                                                      |
| PromptProfile aliases             | `agent/prompt-profile.ts` owns tests-only aliases; `expert-squad/catalog-profile.ts`, `catalog.ts`, `config/prompt-catalog.ts` and generated catalog types consume current names.                                                                                                                                                                 | Delete zero-consumer aliases first; rename remaining generic catalog types to ExpertSquad terminology only in a separate slice. Keep `prompt_profile.active`.                                                                                                                                                                                                                      | Replace alias-equality assertions in `test/expert-squad/registry.test.ts`; regenerate OpenAPI/SDK only if the public shape changes.                                                                                                                                                                                               |
| Legacy tool IDs                   | `tool/tool-id-catalog.ts` owns the retired-ID replacement map; `skill/required-tools.ts` consumes it.                                                                                                                                                                                                                                             | Remove the replacement map and make every unknown ID fail through the canonical tool-ID set.                                                                                                                                                                                                                                                                                       | Replace dedicated retired-name tests with general unknown-ID negatives in tool/Skill suites.                                                                                                                                                                                                                                      |
| Retired Skill keys                | `skill/skill.ts` owns `agents`/`mounted_agents` special handling.                                                                                                                                                                                                                                                                                 | Make the frontmatter schema strict and remove key-specific handling.                                                                                                                                                                                                                                                                                                               | Schema tests cover these two and arbitrary unknown keys through the same error path.                                                                                                                                                                                                                                              |
| Build-default compaction export   | `session/compaction-handoff.ts` alone exports `JSON_SCHEMA_DESCRIPTION`; no consumer exists.                                                                                                                                                                                                                                                      | Delete only that export; retain `jsonSchemaDescriptionForIdentity`.                                                                                                                                                                                                                                                                                                                | Add exact absence plus dynamic-identity positive coverage to compaction tests.                                                                                                                                                                                                                                                    |
| Prompt/docs workflow wording      | `prompt/core/deep-research-core.txt`, `frontend-research-core.txt`, `frontend-design-core.txt` and EN troubleshooting docs say active/current workflow. EN/ZH `tools.mdx` name retired dispatch tools.                                                                                                                                            | Replace with active expert-squad projection/current projected capability and real `dispatch_agent`/`manage_task` contracts.                                                                                                                                                                                                                                                        | Update `test/agent/final-system-prompt-audit.test.ts`, document health and docs single-source checks.                                                                                                                                                                                                                             |
| Dispatch ownership                | `engine/tool-ownership.ts` defines payload/query semantics; `engine/writer.ts` aborts owners. `orchestrator/tools.ts` opens/closes the public dispatch owner. `build-tool.ts` and `integrity-review-stage.ts` open/close inner owners.                                                                                                            | Enrich only the public owner. Replace inner-owner reads in `goal-mutation-guard.ts`, `engine/persist.ts`, `engine/agent-coordination.ts`, `task-api/index.ts`, cancellation and queue/A2A paths; retain Goal Run and execution leases.                                                                                                                                             | Replace positive dual-owner fixtures in `test/expert-squad/opentest-typed-dispatch.test.ts` and ownership/cancel/queue/goal/A2A test families; require one exact owner.                                                                                                                                                           |
| External Executor selection       | `executor/contract.ts` owns the three-value identity; `executor/{bootstrap,discovery,registry,runtime-env,session-ref}.ts`, `protocol/**`, `codex-app-server*`, `codex-cli.ts` and `claude-agent.ts` own external discovery/execution.                                                                                                            | Remove external selection. `build/agent.ts`, `orchestrator/build-tool.ts`, `task-api/index.ts`, `engine/{model,engine.sql,task,store,state,pipeline,writer,execution-abort}.ts`, `control/{message-schema,message}.ts`, `channel/ingress.ts`, `panel/capability.ts`, `tool/panel.ts`, `platform/capability.ts` and `server/routes/{executor,app}.ts` become internal-runtime only. | Remove `ExecutorSelector.tsx`, Overlay executor settings/services/storage and executor-specific tree mapping; regenerate OpenAPI/SDK; update executor test families. Update current architecture `02`, `04`, `14`, `99` and every exact external-executor claim in EN/ZH config, environment, install, plugin and Goal/Task docs. |
| AInvest replica application       | `packages/ainvest-amd-replica/**` is self-contained; only root workspace lock, `script/sync-version.ts`, its test and one current-doc example reference mention it.                                                                                                                                                                               | Delete the application package; remove it from release targets and update the current evidence example to a platform-owned fixture.                                                                                                                                                                                                                                                | Regenerate `bun.lock`; add a workspace/package hygiene negative asserting domain delivery apps are absent. Historical records remain unchanged.                                                                                                                                                                                   |
| Tracked scratch                   | `.scratch/pin-visual/project/.gitignore` is the sole tracked scratch path; no caller exists.                                                                                                                                                                                                                                                      | Delete the file.                                                                                                                                                                                                                                                                                                                                                                   | Add a repository hygiene test that rejects every tracked `.scratch/**` path.                                                                                                                                                                                                                                                      |
| Installer artifact                | Packaging scripts/workflows produce `packages/overlay/dist-artifacts/**`; a stale 0.0.6 MSI LFS pointer is tracked and the directory is not ignored.                                                                                                                                                                                              | After release-asset retention is explicitly resolved, remove the pointer and ignore generated installer output; retain CI artifact upload.                                                                                                                                                                                                                                         | Packaging tests prove output remains produced/uploaded without being tracked.                                                                                                                                                                                                                                                     |
| RightDock dead UI                 | `SideActivityToolbar.tsx` and `center-workbench-size.ts` have no production imports. `RightDock.tsx` and `main.tsx` own current tabs/width.                                                                                                                                                                                                       | Delete each dead source in its own slice; remove only dead selectors from `activity.css`.                                                                                                                                                                                                                                                                                          | Migrate `right-panel-tabs-flat`, `acceptance-panel-mount`, `pane-config`, `center-workbench-size` and every browser fixture returned by the exact old-selector search.                                                                                                                                                            |
| Dynamic Overlay identity          | `orchestrator/protocol/message-bridge.ts` validates exact identity; `tree-writer.ts` stores it; `ChatBubble.tsx` and `utils/message.ts` discard/guess it.                                                                                                                                                                                         | Render exact active projected identity/label and keep stage/channel only as visual metadata. Delete alias guessing.                                                                                                                                                                                                                                                                | Cover same-template distinct IDs, unknown exact ID, active label and inactive-label isolation; headed visual review is final-phase acceptance.                                                                                                                                                                                    |
| Frontend Replica host domain      | Host call points are `frontend-design/{agent,handoff,host-prepared-source-project,output-tools,schema,skeleton-project-tool,tools/**,visual-skeleton-coverage}.ts`, `tool/web-clone-*.ts`, `web-clone/**`, `orchestrator/webpage-evidence.ts`, browser-preview source/region/scroll bindings, Build prompt context and research webpage evidence. | Classify and migrate domain generators/protocols behind the active package. Retain generic browser capture, task-artifact and comparison primitives. No host file is deleted until package execution and inactive-package isolation prove its exact replacement.                                                                                                                   | Migrate matching `test/web-clone/**`, `test/tool/web-clone-*`, Frontend Design, Browser Preview, benchmark and E2E consumers. The final real replica E2E/GUI proves replacement before residue deletion.                                                                                                                          |

Execution and UI disposition:

| Surface                                                  | Evidence                                                                                                                                                     | Disposition                                                                                                                                                    |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool ownership                                           | `engine/tool-ownership.ts` models `dispatch_agent`, `build`, `integrity`; adapters open an inner owner while Orchestrator already owns the dispatch.         | Extend the sole dispatch owner with goal-run/session/outcome data, then delete Build/Integrity owner variants and all dual-owner positive fixtures atomically. |
| Overlay message identity                                 | Backend validates exact `agentID`, tree writer stores it, but `ChatBubble` displays only fixed role/stage and `message.ts` guesses old aliases or Assistant. | Display exact active projected identity/label; stage/channel remain visual metadata; delete identity guessing.                                                 |
| `SideActivityToolbar` and center-workbench sizing helper | No production imports; tests read dead source or require removed panel-weight symbols. Current owners are `RightDock` and `rightDockWidth`.                  | Delete dead files/selectors and migrate tests to current RightDock behavior. Final headed visual review remains mandatory.                                     |
| Frontend Replica host domain                             | `src/web-clone/source-project-generator.ts` is active through host tools and Frontend Design; prior record explicitly marks full externalization incomplete. | Do not call it dead. Migrate domain generators/protocols behind the package after generic primitives and package execution are stable.                         |

### Independent Agent Feedback

Three one-layer read-only reviewers, each prohibited from editing or delegating, independently returned
`REJECT` for platform finalization:

1. Runtime extension audit found the parallel external Executor, five false Plugin hooks, Config swallowed errors,
   dead Executor implementations/registry APIs, the ToolRegistry `NativeAgentInfo` entry, PromptProfile aliases and
   legacy special cases. It found no live `Agent.get(baseRole)`, base-role-to-agent-ID dispatch, retired
   `PromptProfile.builtIns/targets/overlayFor` or `pre-terminal-reflection` residue.
2. Expert/Goal audit accepted the core manifest v1/resolver/catalog/skill-mount/dynamic-target chain but found
   dual Build/Integrity execution ownership, loss of exact dynamic identity in Overlay, active-workflow wording,
   obsolete tool docs and a dead Build-default compaction schema export.
3. Artifact/legacy audit found the dead Side Activity Toolbar and center-workbench helper with false-green tests,
   one tracked scratch file, stale tracked installer output and large ignored local output. It independently proved
   the generated artifacts, fonts, current Goal record and negative schema/API legacy tests are not blanket-delete
   candidates.

## Cleanup Order

Each numbered item is a separate reviewed and pushed slice unless a later call-point audit proves that atomicity
requires two adjacent items to land together.

1. Remove false Plugin hooks from the SDK and public documentation.
2. Make managed Config and command Markdown loading fail with path/cause and no partial Config result.
3. Remove stale Knip SDK-v2 entries and make dead-code analysis see Overlay CSS without deleting live fonts.
4. Remove dead Executor implementations/registry APIs and migrate only the generic managed-runtime tests.
5. Remove ToolRegistry's `NativeAgentInfo` projection entry.
6. Delete zero-consumer PromptProfile aliases, then rename still-public catalog types in a separately reviewed slice
   if the call-point refresh confirms a public terminology change is required.
7. Remove the retired tool-ID replacement map.
8. Replace retired Skill-key special cases with one strict frontmatter schema.
9. Delete the dead Build-default compaction export.
10. Correct active-workflow prompt text and retired dispatch-tool documentation.
11. Replace dual Build/Integrity tool ownership with one enriched `dispatch_agent` owner across cancel, settle,
    queue, Goal mutation, persistence and Agent-to-Agent redispatch.
12. Remove the user-selectable Codex/Claude Executor runtime across Task contract, Build, routes, Overlay,
    OpenAPI/SDK, environment, current architecture, EN/ZH product docs and tests while retaining internal
    projected-worker lifecycle execution.
13. Remove `packages/ainvest-amd-replica` and its workspace/release bookkeeping.
14. Remove the sole tracked scratch file and add the tracked-path hygiene test.
15. Resolve installer release-asset retention, then remove the tracked MSI and ignore generated installer output
    as its own slice.
16. Delete the dead Side Activity Toolbar and migrate its tests/selectors to RightDock.
17. Delete the dead center-workbench sizing helper and migrate resize tests to `rightDockWidth`.
18. Replace the remaining live `rightToolbar` / `RightActivity` terminology with RightDock terminology as one
    atomic rename after the sizing slice; do not retain aliases or conflate live names with dead code.
19. Preserve exact dynamic-agent identity through Overlay display and remove identity guessing.
20. Finish Frontend Replica package externalization and remove host domain implementations after Registry,
    Manager, Resolver, package-tool and inactive-package-isolation integration tests prove the replacement.
21. Run the complete concurrency, cancellation, cache, package-isolation, generated freshness, docs, dead-code and
    residue matrix.
22. Do not publish Frontend Replica, Mirror Watch or IWC/MirrorTest E2E tasks. Run only the remaining full static,
    unit, integration and generated-freshness matrix plus a basic headed Overlay GUI/visual review, then perform a
    final independent exact-tree review.

## First Slice Validation

The first implementation slice will target only the false Plugin hooks. It must prove:

- none of the five false hook keys exists in the Plugin SDK type or public EN/ZH documentation;
- current Plugin auth, provider, service, event and real execution hooks retain their types and behavior;
- Plugin/OpenCorvus typechecks, focused Plugin tests, documentation health, residue scans and `git diff --check`
  pass;
- a fresh independent reviewer accepts the exact candidate tree before commit and push.

## Slice 1: False Plugin Hooks

The Plugin SDK no longer declares `permission.ask`, `evaluation.checks`, `evaluation.result`,
`evaluation.analysis`, or `acceptance.ready`. The first was the sole consumer of the generated
`PermissionRequest` import, which is also removed. No production `Plugin.trigger` existed for any of the five
keys, so the change deletes a false public capability rather than removing a working integration or inventing a
host trigger to justify stale types.

English and Chinese Plugin documentation now demonstrates only real `chat.params` and
`tool.execute.before` hooks and lists only hooks backed by production trigger paths. Bus event names such as
`permission.asked` and `acceptance.ready`, persisted `engine_evaluation.checks`, and their UI/event consumers are
separate protocols and remain unchanged. The document-health regression rejects all five false SDK/doc keys and
pins representative live hooks so a broad deletion cannot make the negative test pass.

Inactivity-supervised focused evidence passes `82 / 82` with 1,257 assertions across strict Plugin failure,
Plugin auth selection, task-scoped Plugin tool host, document health and product docs single source. Plugin and
OpenCorvus TypeScript checks pass. Web Astro check reports zero errors and three pre-existing unused-value hints.
`docs:check` remains fresh at 262 operations across 24 groups, `api:routes-check` passes six rules across 30
files, exact SDK/EN/ZH scans find none of the five keys or the orphan `PermissionRequest`, and
`git diff --check` passes. An attempted `packages/web typecheck` command reported that no such script exists;
the package's authoritative `astro check` command was then run successfully. A fresh exact-tree independent
review rejected the first candidate because its source-string residue checks did not prove that the removed keys
were absent from `keyof Hooks`. A first attempted compile-time assertion was also rejected because OpenCorvus
excludes tests from `tsconfig.json` and Bun erases types when running tests. The Plugin package now has a dedicated
`tsconfig.type-tests.json` project wired into its authoritative `typecheck` script. Its exported
`ExpectNoMembers<Extract<RemovedPluginHook, keyof Hooks>>` contract therefore runs in the real TypeScript compiler
without adding tests to the production build. Any of the five keys re-entering through a direct, mapped or
composed declaration fails package typecheck. The corrected exact tree received independent `ACCEPT` against
HEAD `3a13c9d892` and cached patch `e4897289b4`; commit `7ae874b10a` is pushed to
`myhexin/v0.0.7beta`.

## Slice 2: Config Fail-Fast Loading

Managed Config loading no longer asks `existsSync` to collapse missing and inaccessible directories into the
same false value, and no longer catches `EACCES` or `EPERM` from either managed file. It now calls the existing
`loadFile` path for both managed filenames in precedence order with `writeSchema: false`, because an
administrator-owned source is read-only from the application process even when it omits optional schema
metadata. `ConfigPaths.readFile` remains the single error boundary: `ENOENT` is the only valid absence and returns
no file content, while every other read error becomes a `ConfigJsonError` carrying the exact managed filepath and
original cause. Consequently Config loading cannot return the already-merged user/project or first-managed-file
portion when a later administrator-owned source is unreadable.

Command Markdown loading no longer catches and logs `ConfigMarkdown.parse` failures. The existing
`ConfigFrontmatterError`, which already owns the exact command path, parser message and parser cause, now rejects
the complete Config load. Command schema failures continue to use the existing `ConfigInvalidError`; valid
command merge order and managed precedence are unchanged.

The first red run proved the old behavior: both new end-to-end Config tests failed because `Config.get()` returned
a partial object after an invalid command and after an injected `EACCES` on the managed JSONC file. Independent
review then rejected the first green candidate because it still allowed schema write-back and only failed the
first managed file. A second red run proved the write-back defect by observing the managed file change. The
corrected complete `test/config` directory now passes `123 / 123` with 261 assertions. The managed read regression
first loads valid JSONC settings, then injects `EACCES` for the second JSON file and asserts no Config is returned,
the exact `ConfigJsonError.data.path`, and the identical permission error as `cause`. Another regression proves a
schema-less managed file loads without any byte change. Command regressions prove both typed frontmatter failure
and a read-time permission error reject the complete Config while preserving their respective path/cause
identity. The managed skill-mount regression also pins the exact managed source path. OpenCorvus TypeScript
checking, exact catch/log residue scans and `git diff --check` pass. Independent review accepted the implementation
candidate at HEAD `7ae874b10a` and cached patch `36a83faaf9`; the reviewer independently reran the complete Config
test directory with the same `123 / 123` result.

Historical document links pass `21 / 21`. Document health passes `55 / 56`; its sole failure is outside this
candidate: concurrently modified, unstaged `specs/records/2026-07/README.md` links to the concurrently created but
still-untracked `2026-07-17-iwc-opentest-futures-e2e.md`. Neither file is staged in this slice. This failure is
recorded rather than hidden or repaired by taking ownership of parallel work, and must be rerun after its owner
finishes that record.

The independent review also found `SkillManager.market()` using `Config.getGlobal().catch(() => undefined)`.
That path does not read managed/project Config and is not part of this atomic loader change, but it is another
swallowed deterministic failure. It is retained as an explicit follow-up debt item for the strict Skill/schema
slice rather than being silently bundled here.

## 2026-07-17 Goal Update: Three Expert-Squad E2E Runs Cancelled

The user removed the Frontend Replica, Mirror Watch and IWC/MirrorTest futures real E2E runs from this Goal. No new
main-database Task or Mission may be published for those three squads as acceptance work. Their existing package
protocol, static parity, unit/integration regressions and retained historical failure evidence remain valid inputs,
but terminal scheduler/database/artifact evidence from a new model run is no longer a completion requirement.

This update supersedes every earlier "E2E remains last", "fresh ordinary Task", and equivalent pending-run
instruction in this cleanup plan and the platform Goal for those three squads. Cleanup still requires complete
typechecking, focused and broad unit/integration tests, generated-artifact freshness, documentation health,
dead-code/residue scans, exact active/inactive package isolation and independent review. A basic headed Overlay
review may still verify platform UI rendering without selecting or running any of the cancelled squads.

The later parallel Mirror Watch checkpoint accidentally re-tracked `dashboard/data/personas.json`, whose four
identifiers were all `mirror-watch-e2e-*` run inputs. Exact-history review proved that file had previously been
removed after an older E2E and has no platform, package, fixture or application owner. It is deleted again as
cancelled-run residue. Mirror Watch's package-owned contract-graph prompt, its static regression and regenerated
payload remain because they correct the external package protocol without publishing or accepting another E2E.
The ignored project-root `.opencorvus/ifind.json` was likewise copied from a scratch E2E project solely for that
run; it was removed without reading or publishing its credential-bearing content after the cancellation.

A parallel process nevertheless published Mirror Watch Tasks `tsk_f6c4423ce001QPOIj8nmVM3lbk` and
`tsk_f6c60e990001uHE4wZIgkMo5ia`, restored `dashboard/**` artifacts and generated local verifier output after the
cancellation. Those immutable database records remain historical evidence, but the run is explicitly outside
the current Goal and contributes no E2E acceptance. After the writer stopped, the exact restored dashboard tree,
the tracked persona run input, the ignored iFind configuration, `.scratch/mirror-watch-real-e2e`,
`.scratch/opentest-real-e2e`, and the standalone Mirror Watch verifier outputs were removed as cancelled-run
intermediate state. No frontend-replica, Mirror Watch or IWC/MirrorTest task will be published by the remaining
Goal work.

The IWC/MirrorTest record and monthly index were also written after the cancellation and initially described Task
`tsk_f6bd60b8900192Rjckp7x5r4Ah` as accepted current-Goal evidence. Its package parity, runtime findings, 9/9
browser result and lifecycle/status repairs remain historical facts, but the run is outside the current Goal.
The record and index now state that boundary explicitly; no external futures-project artifact is claimed as a
current platform deliverable.

An independent residue audit then proved the first exact-name cleanup was incomplete. Alternate cancelled-run
names still held about 327 MiB: `.scratch/expert-squad-real-e2e`, `.scratch/mirror-watch-direct-e2e`,
`.scratch/mirror-watch-vite-probe`, `.scratch/futures-opentest-e2e-20260717`, smaller Mirror Watch/MirrorTest logs,
scripts and parity workspaces, plus an ignored root Mirror Watch survey screenshot. The direct-E2E tree also held
the remaining iFind configuration copy; its content was not read. Process inspection found no owner for these
paths. Every exact cancelled-scenario path was resolved beneath the repository root and removed. Mixed
`.opencorvus/.r` and `.opencorvus/r` runtime stores remain untouched because the active backend may own them.

## Slice 3 Plan: Dead-Code Input Repair

### Recall refresh

The canonical `bun run check:dead-code` baseline on `v0.0.7beta@d7bfd0c238` reports exactly two unused source
files (`SideActivityToolbar.tsx` and `center-workbench-size.ts`) plus three false unused font dependencies. The
font packages are live: `src/index.html` loads `src/styles/tokens/fonts.css` first, and that file imports Geist,
Noto Sans SC and JetBrains Mono. Knip 6.27.0 follows the Vite module script but does not follow stylesheet links;
Overlay has no Tailwind dependency, so Knip registers no plain-CSS compiler. The current root command also uses
unversioned `bunx knip`, making the audit depend on registry latest rather than the lockfile.

The complete SDK-v2 search found only four stale Knip entries. Their files do not exist, and the only other v2
reference is the existing workflow negative regression. `packages/sdk/js/package.json` exposes six current
subpaths; Knip lists four real entries, four nonexistent v2 entries, and omits the current `defaults` and
`expert-squad-authoring` entries. The exact replacement set is derived from those six public exports.

The complete Overlay stylesheet search found 44 source CSS files and 44 ordered stylesheet links in
`src/index.html`. Browser contrast matrices, primitive ownership tests and architecture guards intentionally read
that link order as the runtime source. An independent agent suggested replacing them with one CSS aggregator and
a custom Knip CSS compiler. Final call-point review rejects that direction: it would migrate many unrelated
visual tests, add a second parser for Vite-owned CSS resolution and turn a three-dependency visibility defect into
a broad styling-topology change.

This slice instead uses the existing standard Vite module graph for the only invisible dependencies: import the
three Fontsource package CSS exports as side effects from `main.tsx`, remove the forwarding `fonts.css` file and
its HTML link, and keep every other stylesheet link/order unchanged. Knip then observes the real dependency
without an ignore or compiler shim. `check:dead-code` pins `bunx knip@6.27.0` instead of resolving registry latest.
Installing Knip into the root lockfile was rejected after Bun rewrote 3,321 unrelated lockfile lines with the
current enterprise registry URL; the generated lock diff was discarded rather than committed. The SDK contract
test will compare Knip entries with source paths derived from package
exports and require every entry to exist. The font regression will require all three module imports, their order
before application imports, absence of the retired forwarding link/file, exact package versions and retained
license assets.

Validation is the focused SDK/font regression, Overlay typecheck and Vite build, SDK typecheck, dependency-only
Knip proof that the three fonts are no longer reported, the canonical dead-code check whose only remaining issues
must be the two separately planned dead files, document health, `git diff --check`, and a fresh independent
exact-tree review before commit and push.

### Slice 3 implementation evidence

Knip now lists exactly the six SDK source entries derived from public exports and contains no `src/v2/**` entry.
The contract regression dynamically maps each exported `./dist/*.js` target back to its required source file,
compares the complete set with Knip and requires every file to be nonempty. The root dead-code command pins Knip
6.27.0 without adding lockfile churn.

Overlay loads all three Fontsource packages through top-level Vite side-effect imports before application module
imports. The forwarding `styles/tokens/fonts.css` and its HTML link are deleted; the remaining application CSS
links preserve their previous relative order. Focused SDK/font coverage passes `22 / 22` with 377 assertions.
Overlay and SDK typechecks pass. The real Vite production build transforms 2,482 modules and emits all three font
families, Noto Sans SC subsets and one generated CSS asset. Overlay dependency-only Knip exits clean with no font
finding. The canonical dead-code command now reports only the two previously identified real unused files and no
unused dependency, unlisted dependency or binary; those file deletions remain separate reviewed slices rather
than being hidden by this input repair.

The first push attempt correctly failed the existing Overlay i18n freshness hook because changing `index.html`
changed its panel revision. Typecheck, API route inventory and product documentation checks had already passed.
Both locale metadata files now carry the single revision computed by `check-panel-i18n.ts`; the locale content is
unchanged. The authoritative Overlay i18n check passes before the corrected commit is pushed.

## Slice 4 Plan: Retire SideActivityToolbar

### Recall refresh

The user requires removal of legacy code and false-green tests after the platform/runtime refactor, with no
fallback, compatibility selector or special-case gate. The three scenario E2E runs remain cancelled; this slice
tests the platform Overlay only. The current cleanup record, the July RightDock history, the exact Knip output and
the independent read-only audit were reviewed again before implementation. The candidate baseline is the pushed
merge `adf980ac5e`, which includes the parallel Disclosure primitive work without modifying
`SideActivityToolbar.tsx` or its CSS ownership.

The full repository search for `SideActivityToolbar`, `side-activity-button`, `solidRightActivityToolbar`,
`side-activity-toolbar`, `revealRightActivityToolbar`, `right-activity-fixture` and `left-activity-toolbar` proves
that `SideActivityToolbar.tsx` has no production import, dynamic import, barrel export or build entry. Its only
source consumers are `right-panel-tabs-flat.test.ts` and a negative assertion in
`acceptance-panel-mount.test.ts`. The dead toolbar CSS occupies the toolbar mount/control block in
`styles/surfaces/activity.css`; the later `.side-activity-body` rules remain live panel-content styling and must
not be removed.

`RightDock.tsx`, `App.tsx` and `main.tsx` are already the single production implementation. They own the panel
catalog, `#rightDock`, empty launcher, add menu, titled tabs, selected tab, explicit tab close and dock close.
No production compensation or alias is required. Tests must use the exact current interaction for their known
fixture state: `right-dock-empty-<panel>` for an explicitly empty dock, `right-dock-add-<panel>` after explicitly
opening the add menu, `.right-dock-tab[data-tab=...]` for an existing tab and `.right-dock-tab__close` for close.
They may not probe several selectors and choose whichever exists.

### Exhaustive call-point disposition

| Call point                                                                                                                                                        | Disposition                                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/SideActivityToolbar.tsx`                                                                                                                          | Delete the unused component and its private types.                                                                                                                 |
| `src/styles/surfaces/activity.css` toolbar block                                                                                                                  | Delete only toolbar mount/control/label/badge rules; retain live panel body and shell rules and correct the file header.                                           |
| `test/right-panel-tabs-flat.test.ts`                                                                                                                              | Remove dead-source/CSS assertions; retain old horizontal-tab absence and move current RightDock ownership assertions to the real component.                        |
| `test/acceptance-panel-mount.test.ts`                                                                                                                             | Strengthen the existing negative assertion to require the dead file and selector family to be absent while preserving current RightDock ownership.                 |
| `test/browser/right-activity-fixture.ts` and its ten importers                                                                                                    | Rename to `right-dock-fixture.ts` and `revealRightDock`; do not retain an alias. `selectWorkLedgerTask` remains generic and unchanged.                             |
| `acceptance-panel-button-owner-browser.test.ts`                                                                                                                   | Delete the remaining query of all legacy right activity buttons; its current goals RightDock opening already uses explicit empty/add state.                        |
| `expert-squad-selector-browser.test.ts`                                                                                                                           | Delete the unused `waitForAssistantButton` legacy-left-toolbar helper.                                                                                             |
| `titlebar-toolbar-toggle-browser.test.ts`                                                                                                                         | Replace the one stale `solidRightActivityToolbar` measurement with `#rightDock`; the file already owns comprehensive current RightDock tests.                      |
| Browser preview, file explorer, menu, pane, controls, goal residue, live-pressure, screenshot and center separator fixtures returned by the exact selector search | Migrate each explicit old action to its known current RightDock state. Repeated click-to-close steps become the real tab close control, never a selector fallback. |
| `left-activity-toolbar.test.ts`                                                                                                                                   | Rename to `left-work-ledger-shell.test.ts`; retain its current Work Ledger and old-toolbar-absence contract without an alias file.                                 |
| Historical records                                                                                                                                                | Preserve immutable historical paths and design statements. Only this current cleanup record declares supersession.                                                 |

The independent audit also found that `center-workbench-separator-browser.test.ts` and its sizing utility belong
to the next RightDock sizing slice. Any legacy toolbar selector inside that file will be migrated there rather
than mixing the sizing rewrite into this component-removal slice. The same boundary applies to old separator
instrumentation in `screenshot-browser-panel-browser.test.ts`; only its panel open/select/close actions belong
here.

Validation requires exact legacy-selector/source absence, focused static tests, Overlay typecheck and Vite build,
Node browser execution for every changed fixture, canonical Knip showing only the separately planned
`center-workbench-size.ts`, `git diff --check`, a headed RightDock screenshot inspected by the implementer, and a
fresh independent review of the exact candidate tree before commit and push.

### Recall extension: Browser Preview chrome residue found by the headed stress run

The current headed `browser-preview-visual-stress` run reached the real RightDock and then proved that its fixture
still drove the removed `Refresh the saved preview evidence` button and Browser Preview candidate dropdown. Commit
`eba4544778` is the authoritative design change: it replaced the old SelectControl/viewport toolbar with the
Codex-style address/navigation/zoom chrome and native URL navigation. Its diff deliberately removed the
`SelectControl` and `SegmentedControl` imports and their JSX, but left the old candidate selection signals,
`selectCandidate` callback, selection-failed stage, Overlay service wrapper, CSS and tests behind.

The full repository search covered `browser-preview-candidate`, `selectCandidate`,
`pendingSelectedTargetID`, `targetSelectionError`, `selectTaskBrowserPreviewTarget`,
`browser-preview-controls`, `browser-preview-toolbar-row`, `browser-preview-viewport-controls` and
`browser-preview-evidence-status`. The server `PUT /task/:taskID/browser-preview/target` route, generated SDK/API
documentation and server route tests remain the generic platform protocol and are not deleted. The obsolete
Overlay-only surface is removed as follows:

| Call point                                                                          | Disposition                                                                                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BrowserPreviewPanel.tsx` candidate type/import/signals/memos/callback/stage        | Delete; current task/directory target loading and native URL chrome remain the only Overlay interaction.                                                |
| `services/browser-preview.ts` selection wrapper and its focused service tests       | Delete the uncalled Overlay wrapper only; preserve the backend API route and generated clients.                                                         |
| `inspector.css` candidate, old controls/toolbar/viewport and evidence-status blocks | Delete selectors with no current JSX owner, including their container-query branches.                                                                   |
| `theme-form-control-coverage.test.ts` candidate dropdown contract                   | Replace the false-positive expectation with negative ownership assertions for the retired Overlay classes.                                              |
| `select-popup-contrast-matrix.test.ts` fabricated Browser Preview candidate popup   | Delete that fixture section; the shared Select primitive remains covered by live expert-squad and app-dialog consumers.                                 |
| `browser-preview-panel.test.ts` old selection callback expectation                  | Require the removed Overlay selection wrapper/state to stay absent while preserving target load and native navigation contracts.                        |
| `browser-preview-visual-stress.test.ts` stale refresh/candidate paths               | Drive target refresh through real RightDock close/reopen, validate the current blank new-tab state and keep evidence/native/failure/layout screenshots. |

The same run exposed two fixture defects: a persisted capture lacked the required `capture.summary`, and its missing
target screenshot threshold still assumed deleted explanatory text. The fixture now uses the production rendered
capture schema. The deliberately blank New tab screenshot keeps explicit dimension, non-white-pixel and color
bounds calibrated to the visually inspected chrome; all content-bearing screenshots retain the stricter defaults.
The unreachable capture-missing branch, its four capture/selection/evidence strings, the three retired status
labels and the corresponding bilingual keys are deleted with the same old toolbar surface.

The first complete stress run then exposed a browser-sidecar teardown defect. `launchBrowser().close()` closed the
browser before checking its centralized error collectors, so its own close aborted the open Server-Sent Events
(SSE) streams and reported those teardown aborts as product failures. It also swallowed `closeBrowser` Remote
Procedure Call (RPC) failures. The runner now snapshots runtime errors before closing, propagates close and
termination failures (aggregating multiple failures), and does not reclassify teardown-generated aborts as runtime
errors. The visual fixture no longer injects a redundant HTTP 503 because the later failed-target state covers the
same visible failure surface. Its only allowed request failures are exact `net::ERR_ABORTED` paths for its owned
Work Ledger, Mailbox and task event streams; every ordinary request, response, page error and console error remains
fatal.

### Slice 4 implementation evidence

`SideActivityToolbar.tsx`, its private toolbar CSS and the old `right-activity-fixture.ts` identity are deleted.
The current `RightDock` remains the only production panel owner. Browser fixtures now open a known-empty dock,
use the add menu only when the fixture has existing tabs, select the real tab shell and close through the real tab
close button. The left-toolbar source test is renamed to the Work Ledger shell contract instead of retaining an
alias. The current diff deletes substantially more code than it adds and does not introduce a replacement toolbar
implementation.

The Browser Preview cleanup removes the abandoned candidate selection, manual capture and viewport-toolbar UI
state, its Overlay-only service wrappers, stale bilingual labels and all unowned CSS. The server `PUT target` and
`POST capture` routes, OpenAPI and generated SDK remain because they are the generic task-scoped preview/evidence
protocol. Persisted evidence and the native address/navigation/zoom surface remain the Overlay data path. The
headed visual stress test covers blank new-tab, persisted evidence, task isolation, a backend target change,
native navigation and failed target states. The implementer inspected the desktop ready and failed screenshots,
plus the screenshot browser high-zoom/narrow and RightDock empty/review images; text, controls and tab chrome do
not overlap or escape their owned panels.

Self-review found two false-green fixture contracts before review. The shared Mailbox fixture originally omitted
the required unread/active/archived counts even though an empty list did not immediately crash the browser; its
unit test now pins the full `MailboxPage` response and an SSE (Server-Sent Events) first byte. Three unrelated
browser fixtures still returned the retired `{ target: null, verification: null }` Browser Preview shape; they now
return the current explicit `kind: "missing"` target response. Positive wait selectors for the deleted
`browser-preview-evidence-missing` stage were also removed. A subsequent Node run exposed one fixture with no
Mailbox routes at all; it now reuses the same exact shared contract rather than allowing 404 or console errors.
Independent overlap review then found that the shared collector also allowed an ordinary `/mailbox` request abort.
That allowance is removed from both the shared collector and the visual stress suite; only durable SSE teardown
aborts remain explicit.

Focused Bun coverage passes `63 / 63` with 1,266 assertions, and the strengthened Work Ledger fixture coverage
passes `2 / 2`. Overlay typecheck, i18n freshness and the real Vite production build pass. Documentation health,
historical link and product single-source coverage passes `81 / 81`; `docs:check` is fresh at 266 operations in
24 groups and the API route inventory passes six rules across 31 files. Node browser evidence on the current tree
passes the Browser Preview stress, controls, screenshot browser, file explorer, pane, focus, titlebar, acceptance,
expert-squad, live-pressure, menu, select, terminal, image-preview and related RightDock suites. The first
canonical Knip run reported exactly one unused file, `center-workbench-size.ts`; the exact-tree review below
required that file and its stale tests to join this atomic RightDock retirement.

The exact residue scan finds no production `SideActivityToolbar`, old toolbar selector, old fixture identity,
Overlay candidate/capture wrapper or abandoned Browser Preview chrome class. Six positive old toolbar selectors
initially remained only in `center-workbench-separator-browser.test.ts`; that file also depended on the removed
conversation separator/weight architecture and could not receive selector-only patches. The audit also found live
terminology debt in `RightActivity`,
`rightToolbarOpen`, `ChatHeaderRightToolbarToggle` and their i18n/data attributes. Those are functioning RightDock
owners, not dead code; cleanup order item 18 records their later alias-free atomic rename.

During validation, `myhexin/v0.0.7beta` advanced by two commits to `ce20053924`. The remote primitive-convergence
change overlaps eight files in this slice, including `BrowserPreviewPanel.tsx`, `inspector.css` and shared browser
fixtures. The current candidate will receive an exact-tree review and local commit first; then the remote commit
will be merged, conflicts will preserve both the new text-field primitive and this deletion semantics, and the
merged tree will be revalidated and independently reviewed before push.

### Codex exact-tree review feedback

The first staged candidate was rejected. The review proved that the planned boundary around
`center-workbench-size.ts` was invalid: the package browser runner auto-discovers
`center-workbench-separator-browser.test.ts`, so deleting the old toolbar while deferring that test would submit a
known red full suite. The dead sizing helper, its unit test and the wholly retired separator browser fixture are
therefore deleted in this same atomic RightDock slice. Positive settings/frame-scheduler tests for nonexistent
panel weights are replaced by negative absence coverage while the still-live generic animation-frame and window
resize contracts remain tested.

The same review found a File Explorer helper that probed an existing tab, an empty dock and the add menu in
sequence. Both of its fixtures start from a known empty dock, so it now uses only the explicit empty Explorer
launcher after `revealRightDock`; no selector fallback remains. It also found that the sidecar child handler still
swallowed Playwright `browser.close()` failure even though the parent RPC propagated its own failure. The child
catch is removed and its source contract is pinned, so the RPC error path can reach the parent's aggregate cleanup
error.

Removing the broad ordinary-Mailbox abort allowance then exposed deterministic request cancellation in tests
that switched task directories or closed before the always-mounted Mailbox panel finished loading. The generic
Work Ledger task-selection fixture now waits for both the selected row and the Mailbox panel's real non-busy DOM
state before returning. Tests continue to fail on any ordinary Mailbox abort; only owned durable event streams
remain eligible teardown aborts.

The first synchronization revision also registered an unbounded `/mailbox` response-event waiter. Exact browser
execution proved that a task switch does not guarantee a distinct response event, so this test-only Promise could
remain unresolved forever and leave the runner, test worker and Playwright sidecar alive after an outer shell
timeout. That false contract is deleted. Task selection now waits for the product's actual completion surface:
the requested task is both selected and hydrated, `taskSwitching` is false, its directory matches the active API
directory, and Mailbox is non-busy. Initial-page tests likewise wait on the DOM-owned Mailbox state instead of
assuming a particular request event.

Exact-tree review also found that six changed browser fixtures still swallowed `browser.close()` failures in
their `finally` blocks. Because browser close owns the centralized page/console/network collector assertion, that
pattern erased the very failures this slice intended to expose. Those changed fixtures now use the existing
browser/server aggregate cleanup owner and a source guard forbids close swallowing in the reviewed set. The same
legacy pattern remains outside this slice and is recorded for the next cleanup pass rather than silently claimed
as resolved here.

The sidecar close lifecycle is no longer covered only by source-string assertions. Its collector assertion,
close RPC, termination and exit wait are composed through one test-runner helper, with executable tests for the
success order, a single RPC failure, collector plus RPC aggregation, and termination failure without a false exit
wait. The cleanup source tests are split and named to match their actual scope instead of claiming a stronger
repository-wide contract than they enforce.

Restoring the exact Browser Preview sync-key guard invalidated one old visual assertion that expected a failed
reload from the previous generation to write into the newly refreshed surface. The live-input browser test now
proves both sides of the contract: the stale reload rejection remains hidden after a new native sync, while a
failed back navigation in the current generation remains visible.

### Slice 4 frozen-tree verification

The current candidate passes 87 focused non-browser tests with 1,918 assertions, Overlay TypeScript typecheck,
the canonical repository dead-code command with zero findings, panel i18n freshness, the real Vite production
build, docs freshness at 266 operations in 24 groups, API route inventory at six rules across 31 files, and the
historical-doc health suite at 21/21. Related Node/Playwright browser files pass individually, including File
Explorer 14 cases, titlebar 5 cases, Browser Preview persisted/live/visual paths, Diff, Interaction, Terminal,
RightDock empty/review, pane/menu/focus, screenshot projection and global live pressure. The Browser Preview
visual stress suite ran explicitly headed, regenerated six screenshots at 2026-07-17 08:03 local time, and the
missing, ready, cross-task and failed states were manually inspected without overlap, clipping or state leakage.

One isolated global-live-pressure run recorded a 133.4 millisecond requestAnimationFrame gap with no failed
request, missing DOM, long-task regression or functional error; an immediate isolated rerun passed with a 50.1
millisecond maximum. Per the user constraint, this non-reproducible Windows scheduling fluctuation did not cause
a threshold patch or product special case.

Known follow-up debt remains explicit. Twenty-nine browser fixtures outside the files changed by this slice still
contain `browser.close().catch(() => undefined)` and require a separate mechanical-plus-behavioral cleanup pass.
The browser runner also does not publish activity while waiting for its cross-process browser lock, so a queued
test can appear silent even while the lock owner heartbeat is healthy. These are not claimed resolved by Slice 4.

The first state-based rerun exposed a deeper browser-tool defect before the predicate could be evaluated. The
OverlayPage proxy padded every `waitForFunction` call to three arguments, while its encoder converts `undefined`
to `null`; consequently every ordinary two-argument predicate received `null` and the sidecar's intended
options-versus-argument branch was unreachable. The proxy now preserves the caller's real arity. A source
contract pins that transport behavior, while the File Explorer and Browser Preview browser tests exercise the
two-argument predicate with real page state.

The next browser rerun showed that a bare Mailbox `aria-busy=false` could still observe the previous directory
before Solid scheduled the new refresh. Mailbox now records the directory whose canonical list response has
actually committed, and its directory computation is memoized by string value so a same-project task selection
does not restart the request merely because `selectedSource` changed. The shared helper waits for both non-busy
and the exact hydrated task directory. This is application evidence, not a response-event guess or abort
allowance.

### Slice 4 second exact-tree review rejection

Three independent reviewers rejected the staged tree before commit. Their findings replace the earlier frozen-tree
acceptance claim until the corrected tree is revalidated:

- `BrowserPreviewPanel` still synthesized a target-less native identity from `localHomeUrl` and `targetID:
"__local__"`. Submitting an address without a persisted task target therefore bypassed the task-scoped backend
  target/evidence source. The existing missing-target screenshot covered only the initial New tab state and did
  not exercise address submission. The local identity and navigation path must be deleted, and missing-target
  address submission must be behaviorally proven unable to create a native sync or navigation.
- The same panel labelled the valid `captured` native selection result as a backward-compatible path. Full call
  point inspection showed that the Rust guest has two current outcomes: click delivery can report `captured`,
  while the in-guest comment submission reports `comment`. The protocol remains one discriminated union; the
  compatibility claim must be removed and tests must pin both current results.
- `closeOverlayBrowser` asserted the centralized collector before closing the browser. Errors emitted during the
  close RPC could therefore arrive after the only assertion and produce a false green. Collector assertion must
  run after close, sidecar termination and exit settling while preserving aggregate failures. The global pressure
  fixture also swallowed `ReadableStreamDefaultController.close()` failures in an empty catch and must propagate
  or aggregate them.
- `MailboxPanel` only owned and aborted non-append loads. A delayed old-directory load-more response could commit
  items, cursor and counts after a directory switch. Every list request must have abort ownership and validate its
  captured directory and view before committing; a delayed append race must be exercised as behavior rather than
  a source-string assertion.

The branch is still at local `adf980ac5e`; fetched `myhexin/v0.0.7beta` is `fcb930ee30` and is four commits ahead.
The remote primitive-convergence commits overlap the Overlay slice, so the corrected local tree will receive a
fresh exact-tree review and local commit first. Only then will the remote be merged, conflicts resolved without
discarding either ownership change, the merged tree revalidated and independently reviewed, and the result pushed.

The implementer then challenged the reviewer's initial assumption that `captured` and `comment` were two valid
terminal outcomes. Commit `eba4544778` introduced the in-guest comment panel and explicitly removed host popover
ownership, but the same commit retained a bare-capture branch labelled backward compatible. The current guest
click handler immediately invokes `overlay_browser_preview_selection_report`, which fills the Rust result store
with `Captured`; the Overlay poll consumes it, disables selection and stops polling. `nodeSelection` has no host
render or submit consumer, so the later guest `comment` result can no longer reach the composer. The canonical
completion protocol must therefore remove this obsolete intermediate result rather than merely reword it, while
preserving `comment`, `canceled` and `waiting` and proving click-then-comment delivery end to end through the
guest/host protocol.

Cross-review rejected the first Mailbox and close-lifecycle corrections as well. The Mailbox request token itself
correctly prevents a delayed append commit, but production still retained old items/cursor/counts while a new
scope loaded; a failed replacement could therefore reveal old-directory data again. An old stream's delayed
`onClose` also cleared shared stream ownership before checking its generation, and notification projection checked
abort only before entering the projector, not before badge/notification side effects. The corrected slice must
clear replacement state atomically, bind stream callbacks to the exact handle/generation, and carry supersession
ownership through notification side effects, with failure and reordering behavior tests.

The close cross-review confirmed the new success order catches errors emitted during browser close, but found the
underlying Windows helper still swallowed `taskkill.exe` failures and could wait forever because the helper process
had no inactivity timeout. Signal errors must remain observable, helper activity must reset a real inactivity
timer, termination/exit/collector failures must be aggregated without awaiting an exit promise that has already
been proven not to settle, and global-pressure cleanup must be fault-injected as one composed cleanup rather than
only testing its individual pieces.

### Slice 4 corrected-tree validation

The corrected tree removes the target-less Browser Preview identity and the obsolete `captured` completion result
across the Overlay panel, native service, transport protocol and Tauri host. The real Node browser test keeps the
selection poll alive across a simulated guest click, releases a delayed `comment` result and verifies that the
composer receives the selected-node draft. The headed visual stress test also force-submits the disabled address
form in a missing-target state and proves that no native sync or navigation command is emitted. The implementer
and primary reviewer separately inspected the regenerated missing, ready, native and failed screenshots without
finding overlap, clipping or state leakage.

Mailbox replacement now clears all projected fields in one batch only when directory/view ownership changes,
retains current projection during same-scope refresh, guards page commits with one request owner, and validates
both stream generation and exact handle identity before shared stream state is cleared. Notification projection
carries the same abort ownership through badge, permission, send and baseline commits. Behavior tests cover late
old-directory append, failed replacement, same-scope refresh, stale stream close, delayed badge and permission
supersession.

Browser-sidecar cleanup now checks collectors after close/termination settling, preserves ordered failures, gives
the Windows `taskkill.exe` helper an activity-refreshed inactivity timeout and removes signal-error swallowing.
The global pressure fixture closes all stream controllers and the browser/server owner even when both cleanup
branches fail. Focused validation on the primary tree passes 142 Bun tests with 3,271 assertions, Overlay and
transport typechecks, two Rust guest protocol tests, Node sidecar launch, Browser Preview delayed-comment and
headed visual tests. The first global-pressure run passed every functional/request/cleanup assertion but recorded
one 126 ms animation-frame gap; an immediate isolated rerun passed at 54 ms maximum. Per the user constraint this
non-reproducible Windows scheduling fluctuation produced no threshold change or product special case.

### Slice 4 third exact-tree review rejection and correction

Three fresh reviewers rejected the corrected candidate before commit. The architecture review proved that the
TypeScript service's malformed-result tests bypassed the Rust guest callback path: Rust decoded both a quoted JSON
string and a raw payload, discarded decode/validation/store failures, returned `None` when the native webview was
missing or callback startup failed, and therefore converted every production protocol failure into perpetual
`waiting`. The callback now has one wire format: wry must deliver one JSON string containing a tagged
`waiting`, `comment`, `canceled`, or `error` document. Raw payloads and malformed/invalid documents are explicit
errors, guest runtime failures are stored and returned through the next poll, missing webviews and callback startup
fail immediately, and `null` at the Overlay service remains only the command's real in-flight result. Four Rust
tests cover successful comment, the absence of the obsolete captured path, noncanonical wire rejection, and the
waiting-versus-failure distinction.

The concurrency review proved that notification mocks checked ownership after an awaited native call even though
the production transport cannot revoke an already-issued side effect. It also proved that send/permission failures
were converted into successful projection completion and advanced the seen baseline. Notification projection is
now serialized without a workflow state machine: a superseded native call completes before the current projection
can issue its badge/send, each successful notification is recorded immediately, a failed item remains unseen for
the next projection, and permission/badge/send transport failures are reported and rethrown. Tests exercise delayed
badge ordering, delayed send ordering, partial batch failure, permission failure, and baseline retry.

The same review found that Mailbox stream ownership protected only `onClose`. `onChange`, `onError`, and a queued
refresh timer now require the exact stream handle and generation; stream replacement clears the prior refresh
timer before connecting the new directory. A new Node/Playwright test drives the real mounted `MailboxPanel`
through an old-directory delayed page, an already-enqueued old stream change, a new-directory selection, and a
failed replacement. It proves that only the new item remains, the new directory receives one base request, and a
failed replacement stays empty while exposing its own error. This replaces the earlier false confidence from
helper-only tests, which remain only as focused request-owner unit coverage.

The lifecycle review found three test-infrastructure false greens. Overlay route-handler errors were caught and
silently continued to the real network; the route owner now responds with status 599, retains the original error,
and makes browser close fail. Windows used the same forced `taskkill /T /F` operation for both nominal TERM and
KILL phases and allowed unrelated sidecar output to keep a stuck helper alive; Windows now performs one bounded
forced tree termination, whose inactivity is refreshed only by the helper's own output. Browser-lock owner/stat
errors and lock deletion failures are no longer interpreted as dead owners or ignored; release failures are bound
to launch/close failure reporting. The global pressure stream owns each client by exact instance rather than path,
and the GUI pressure benchmark now launches headed.

Focused correction validation passes 53 Bun tests with 1,024 assertions, Overlay TypeScript typecheck, four Rust
guest protocol tests, the real launch-sidecar failure test, and the real Mailbox concurrency browser test. The
headed global-pressure run passes all three tests; its maximum recorded interaction gap is 83.0 milliseconds, with
no request, DOM, cleanup, or retired-route failure. The screenshot at
`packages/overlay/.scratch/overlay-global-live-pressure.png` was regenerated at 2026-07-17 09:20 local time and
manually inspected: the Settings/Skills projection is visible with no incoherent overlap or clipping.

The final negative scan then found the same obsolete callback pattern in the adjacent native current-page poll:
it accepted quoted and raw payloads, swallowed guest/eval/decode failures, synthesized the webview URL with an
empty title, and the Solid panel discarded poll rejection in an empty catch. Current-page inspection now uses one
quoted tagged payload (`page` or `error`), returns `null` only while the asynchronous callback is genuinely pending,
rejects missing webviews, callback startup failures and malformed native results, clears stored completion on scope
replacement/close, and exposes polling failure through the existing native error surface. The same pass deleted an
`add_child` race recovery branch that re-scanned and reused a webview after creation failure; the already durable
single hidden webview remains the sole owner, while an actual creation failure now stays visible. Rust and
TypeScript tests cover the canonical page payload, raw-wire rejection, guest failure, pending callback, and malformed
native results.

The stricter current-page contract exposed three browser fixtures that returned generic `true` for every native
Browser Preview command. That was another test-only protocol lie: each fixture now records URL changes from the
real sync/navigation commands and returns a structured URL/title only for `current_page`. An initial combined
five-file browser command then exceeded its outer 240-second shell limit while the live-input child remained
active; the exact process tree created by that command was verified by command line and creation time, terminated,
and each file was rerun separately so the outer aggregate timer could not hide the responsible test. Launch,
Mailbox concurrency, delayed comment delivery, and headed Browser Preview visual stress all pass independently.
The first final-tree headed global-pressure run had one 165.1 millisecond frame gap with otherwise clean functional,
request, DOM, long-task and cleanup evidence; its immediate isolated rerun passed at 111.2 milliseconds. Per the
user's Windows scheduling constraint, no threshold or product special case was added. The six Browser Preview
screenshots and the global-pressure screenshot were regenerated at 2026-07-17 09:35-09:36 local time and manually
re-inspected without overlap, clipping, stale state, or error leakage.

### Slice 4 fourth exact-tree review rejection

Three fresh reviewers rejected staged patch
`b36721ae9a850e72a5eed611b7e0b9b8e26e52cd`; the candidate remains uncommitted. Architecture review found
that optional Browser Preview service commands still converted unsupported capabilities into successful no-ops,
and that current-page and selection callback completions were stored without the dynamic target/scope owner that
started them. Clearing a global slot on replacement cannot invalidate an already-started callback, so an old
target with the same URL could publish its title or error into the new target, and a delayed selection comment
could survive disable/re-enable. The correction must make unsupported commands use the HostTransport error
contract, validate zoom input, carry exact owner identity through callback completion, and prove delayed old-owner
results are rejected. The sync unit test must also send and assert a real `scopeKey`; omitting the required field
was a false green because the object comparison tolerated an undefined property.

Lifecycle review found that browser-lock release first resolved the in-process queue and marked itself released,
then deleted the cross-process lock. A deterministic deletion failure therefore let the next launch enter lock
acquisition while the same live PID still owned the directory, producing a fixed 120-second wait. Lock acquisition
also occurred outside the launch cleanup owner, so any owner/stat/read/write failure left the in-process queue
unresolved forever. The correction must keep queue ownership until lock deletion succeeds, report release failure
through the launch/close owner, fail immediately on a same-process lock, and release the in-process queue after an
acquisition failure without pretending that the cross-process lock was acquired.

The lifecycle call-point enumeration also found that all 23 server-backed browser fixtures changed by this slice
start their HTTP server before entering the `try/finally` that owns the browser. A browser-launch failure therefore
leaks the server, while two nested-finally fixtures and two titlebar fixtures can overwrite or discard concurrent
body/browser/server failures. The shared fixture owner must acquire server and browser as one operation, close an
already-started server when browser launch fails, and preserve all ordered failures. In addition, routed async
handlers are started without a pending-handler owner; `closeOverlayBrowser` only snapshots errors that have already
settled, so a handler that rejects after the snapshot creates another false green. Pending route promises must be
tracked and settled before the final collector assertion, with a real sidecar/route/close regression rather than
only directly awaiting the handler helper.

Concurrency review found that clearing Mailbox DOM state on a failed or empty replacement scope did not project a
zero native badge, so an already-issued badge from the old directory could remain indefinitely. It also found that
notification permission transport failures were rethrown into a `void` Settings caller, creating an unhandled
rejection with no UI error owner, and that the boolean permission guard sent concurrent callers down a separate
permission-read path instead of sharing the single pending request. The correction must project every current
scope, including empty and failed loads, serialize badge replacement behind old in-flight effects, bind the
Settings action to visible failure state, and make concurrent permission callers await the same pending promise.
Behavior tests must exercise the native badge, rejected Settings action and concurrent permission result rather
than relying on a browser host that declares badge support absent.

### Slice 4 fourth-review correction and integrated branch

The correction binds Browser Preview page and selection callbacks to a generated scope owner and exact callback
request ID. Scope replacement, close, selection disable/re-enable and same-scope navigation invalidate the old
owner; a late completion can no longer populate the current request. Unsupported URL navigation, current-page and
zoom commands now use the HostTransport error contract, invalid/out-of-range zoom fails rather than clamping, and
the TypeScript sync regression sends and asserts a real `scopeKey`. Rust `browser_preview_` coverage passes 13/13,
the focused native/Panel Bun coverage passes 14/14, and the integrated TypeScript typecheck passes.

Mailbox replacement now serializes a zero badge behind any already-issued native effect for new, failed, empty and
directory-less scopes. Every zero-badge operation has a supersedable request owner. Concurrent notification
permission callers share the exact pending Promise, and General Settings awaits and visibly owns permission
failure instead of creating an unhandled rejection. Focused notification coverage passes 27/27, the headed General
Settings failure path and real Mailbox concurrency browser path pass, and the regenerated
`.scratch/general-settings-fail-fast.png` was manually inspected with the permission error visible and no overlap.

The browser runner now owns cross-process lock acquisition/release through one serialized resource owner. Acquire
failure releases the local queue; release failure poisons waiting and future acquisitions with the same root cause
instead of releasing them into a same-PID lock or leaving them pending. A direct same-PID lock also fails
immediately. Pending route/page handlers are settled after a proven sidecar exit and before collector assertion;
when termination/exit itself has not settled, the close remains failed without waiting forever on an arbitrary
handler. The existing HTTP fixture owns server-to-browser acquisition and ordered body/browser/server cleanup.
All 23 server-backed fixtures changed by this slice, covering 40 browser launches, use that owner. Lifecycle
coverage passes 32 Bun tests with 819 assertions and four real Node browser cases, including a delayed route
failure observed during close. An accidental full-file formatter rewrite in seven fixtures was detected, restored
precisely to the staged candidate, and replaced with minimal line-level ownership edits before validation.

During the correction another obsolete source-string assertion was exposed: it still required the removed
`refetchTargetFromPanel` callback. The current single owner is Solid's target resource, whose source includes
`refreshToken`; reload increments that token and does not fire an unowned `refetchTarget()` Promise. The regression
now pins that actual owner and passes 2/2.

The shared worktree was then switched by parallel work from local `v0.0.7beta` at `adf980ac5e` to
`v0.0.8beta` at `50dbbc78f7`. That HEAD equals both `myhexin/v0.0.8beta` and the fetched
`myhexin/v0.0.7beta`; it already contains the five previously pending primitive-convergence commits. The local
Slice 4 index and worktree were preserved on top, including `TextField` and semantic icon ownership in Browser
Preview and the remote Mailbox/CSS primitive changes. Therefore no second merge remains: final validation and
exact-tree review must bind the combined `v0.0.8beta` tree, and delivery must push that current branch.

### Slice 4 integrated-tree validation

The first combined non-browser run passed 130/131 tests and exposed one real test defect introduced by the
primitive integration: `theme-form-control-coverage.test.ts` referenced `browserPreviewPanel` and `inspectorCss`
without loading either source. The test now uses its existing direct-source pattern and passes 15/15. Overlay
typecheck then exposed two Mailbox icons that retained numeric sizes after the semantic Icon API landed; they now
use the remote owner's exact `large` and `compact` tiers. Overlay and transport typechecks, the Vite production
build, the semantic icon regression, Mailbox regression and theme regression all pass on the corrected tree.

Rust's first integrated run used a 60-second inactivity threshold and legitimately timed out while the compiler
was silent; Windows then reported access denied while cleaning one child, which had exited by the next process
inspection. No product or threshold special case was added. Re-running with a 180-second no-activity threshold
completed the first compile in 1 minute 52 seconds and passed all 13 Browser Preview tests.

Real Node browser validation passes the launch-sidecar lifecycle (3/3), Mailbox cross-directory concurrency
(1/1), headed General Settings permission failure (1/1), Browser Preview delayed comment/native navigation
(1/1), and headed Browser Preview visual matrix (1/1). The visual matrix initially failed because the generic
`minUniqueColorBuckets: 20` contract used strict `>`, rejecting an actual value of 20. Every `min*` option now has
the mathematically correct inclusive `>=` semantics; no scenario threshold changed. Six regenerated screenshots
were manually inspected: missing/cross-task states remain intentionally blank without native commands, evidence
and long URLs wrap inside the panel, native placeholders remain bounded, and the failed target exposes its URL and
diagnostic without overlap.

The headed global pressure run passed all functional, request, DOM and cleanup evidence but recorded one 249.8 ms
animation-frame interval while opening Browser Preview. Its immediate isolated rerun passed 3/3 with a maximum
89.4 ms interval. Per the user constraint this non-reproducible Windows scheduling event caused no product or
threshold change. The regenerated global Skills pressure screenshot was manually inspected without incoherent
overlap or horizontal overflow.

Canonical verification passes `check:dead-code` with no findings, docs freshness at 266 operations in 24 groups,
API route inventory at six rules across 31 files, and historical document health at 21/21. Negative residue scans
find the removed toolbar, center sizing/separator, Browser Preview candidate/local identity and captured result only
inside explicit absence assertions. Twenty-three browser fixtures outside the changed Slice 4 set still swallow
`browser.close()` rejection and remain the next cleanup slice; they are not claimed resolved here.

### Slice 4 fifth exact-tree review rejection

Three independent reviewers rejected staged patch
`a6b67a52fb4d973e408ad5265d5d8e5f93252d12`; it remains uncommitted. The rejection is bound to
`v0.0.8beta@50dbbc78f7`, not an earlier worktree. The architecture review found four related ownership defects.
Browser Preview imported the shared `TextField` primitive but rendered its address as a bare input, leaving the
primitive CSS contract disconnected. Only `browserPreview.sync` carried a scope key; navigate, URL navigation,
close, selection enable/take, current-page inspection and zoom could therefore mutate the singleton native
webview after another task had replaced it. The service also coupled sync, navigate and close capability checks
and always reported close as the unsupported command. Finally, the transport boundary admitted blank scope keys
and any numeric zoom even though the TypeScript service and Rust host required a finite factor in `[0.25, 5]`.

The complete Browser Preview call-point disposition is one strict path. `packages/transport-protocol/src/index.ts`
and its contract tests make `scopeKey` required and nonblank on all eight commands and validate the same zoom
range. `browser-preview-native.ts` removes the aggregate capability assertion, constructs each exact command and
preserves that command in `UnsupportedNativeCommandError`. `BrowserPreviewPanel.tsx` captures the current scope
before every asynchronous command and uses `TextField.Root/Input`. `tauri-transport.ts` forwards the scope on
every invoke. Each corresponding command in `src-tauri/src/main.rs` validates that exact active scope before any
webview mutation, callback start/take, state clear or invalidation; in particular a delayed old-scope close cannot
hide or invalidate the replacement. Native service tests cover partial capability matrices and exact error
identity, protocol tests cover missing/blank scope and every invalid zoom class, Rust tests cover stale operations,
and the real Panel browser fixtures retain scope arguments in their Tauri-shaped command evidence.

The concurrency review found two different ownership domains that must remain separate. General Settings has no
owner for overlapping enable/disable actions, so an old enable permission rejection or save failure can overwrite
a later successful disable. A component-local monotonic action generation will own all store rollback and error
writes after each await; superseded actions finish without changing current UI or settings. Desktop notification
projection separately checked the preference only before awaiting permission. `ensureDesktopNotificationPermission`
must re-read the preference after permission inspection and before/after requesting permission;
`canSendDesktopNotification` must re-read after inspection, and `sendHostNotification` must check at the actual
side-effect boundary. Mailbox directory ownership remains unchanged and cannot stand in for preference ownership.
Tests cover delayed enable then disable then rejection, stale save failure, preference disable during permission
read without a subsequent request, and a granted late permission that sends no notification or advances no false
delivery baseline.

The lifecycle review found three falsy-throwable false greens and two fixture defects. `SerializedResourceOwner`
uses `undefined` as both successful release and a throwable, while route resolution and sidecar release collect
failures through truthiness. All three sites will use explicit tagged outcomes/wrappers so `undefined`, `null`,
`false`, `0` and the empty string remain real failures. Browser lock creation must clean the exact canonical lock
after every post-`mkdir` owner/heartbeat write failure, aggregate root and cleanup failure, and reject an incomplete
lock after the existing publication grace instead of silently spinning. The changed General Settings headed
fixture must acquire its browser through the server owner and aggregate body/browser/server failures. The Browser
Preview image helper must replace average-RGB comparison with a same-dimension per-pixel normalized Sharp diff;
same-average but pixel-swapped images are a mandatory negative regression. These corrections do not add a second
runner, a benchmark controller, fallback, workflow state or special-case threshold.

The three read-only auditors independently confirmed these dispositions before implementation. The native audit
enumerated protocol, service, Panel, Tauri, Rust, VS Code rejection and four browser-fixture call families. The
notification audit confirmed GeneralPanel as the only preference writer, `ensureDesktopNotificationPermission` as
its only production caller, and the singleton projector as the only send-capability consumer. The lifecycle audit
confirmed the resource owner, route resolver, sidecar collector, canonical lock, General Settings fixture and two
image-comparison consumers as the complete affected surface. No auditor modified, staged, committed or pushed.

### Slice 4 sixth native-lease review rejection

The fifth-review correction remains uncommitted. A fresh read-only review rejected the exact native Browser
Preview tree because the Panel still used the stable logical tuple `directory:taskID:targetID:url` as the native
surface lease. Rust validates only that string, so the same target can close and reopen with the same accepted
identity. A delayed dialog-hide close can therefore arrive after restore sync and hide the replacement; the same
reuse admits old navigation, zoom, current-page and selection effects after a reopen or sync retry. The existing
browser regression changed the URL and therefore proved only different-key replacement. The Rust regression also
proved only key A to key B. Both were false green for same-logical-target replacement.

The complete production call-point disposition is one native lease owner. `BrowserPreviewPanel.tsx` is the only
producer of the scope key and the only caller of the eight Browser Preview service commands. Logical target
identity remains the backend/evidence identity, while every unmounted-to-mounted acquisition receives a new opaque,
non-reusable native lease; bounds-only sync may reuse the current lease. Close atomically detaches the Panel lease
before issuing the host release, and dialog restore acquires a new lease. Same-lease mutations are serialized and
their UI results are accepted only by the exact request owner. Current-page results also carry a navigation owner,
and selection enable/disable/take carry their own effect owner. `browser-preview-native.ts`, `tauri-transport.ts`
and `transport-protocol/src/index.ts` remain the single strict command path; their nonblank scope, finite zoom and
exact unsupported-command semantics were independently accepted and must not be weakened.

Rust `with_browser_preview_scope_replacement` currently invalidates ownership before a different-key operation but
keeps the old owner when a same-key `set_position`, `set_size`, URL read/navigation or show operation fails. It must
invalidate the owner on every sync mutation failure, and failure cleanup must hide the child webview so a partially
mutated OS surface cannot remain above the HTML error surface. All other Rust commands continue validating the
exact active lease before mutation. The correction must prove same-key sync failure rejection, same-logical-target
new-lease rejection, serialized mutation ordering, and no mutex re-entrancy or deadlock.

The failure also exposed the only app-dialog surface registration, in `BrowserPreviewPanel.tsx`. The shared
`app-dialog.ts` hook contract is synchronous `void`, catches and discards hide/restore failures, and opens the HTML
dialog before the native OS child webview is known hidden. Its opening call points are `main.tsx` (five),
`FileExplorerPanel.tsx` (seven), `TaskDirBar.tsx` (two), `use-card-head-actions.ts` (one), `utils/native.ts` (three),
`utils/git.ts` (two), `services/task.ts` (one), plus `nativeMessage` callers in ChatComposer, MemoryPanel,
ProvidersPanel and workspace. AppDialogHost is the only confirm/dismiss surface. The hook lifecycle must become a
single awaited resource transition: hide completes before opening, restore completes before resolving the dialog,
and neither failure is swallowed. Concurrent dialog replacement must retain its existing exact epoch ownership.

Native operation failure may switch the HTML stage to an error only after the lease has been reliably hidden. If
hide itself fails, that combined failure must remain observable and the UI must not claim that an error surface
under the still-visible OS child is visible. Required regressions are: delayed close then same-target reopen;
delayed dialog hide then restore; delayed old navigation/URL/zoom/current-page effects after a new lease; selection
disable/re-enable with delayed old enable/disable/take; same-key sync failure followed by rejection of every old
mutation; delayed navigation failure after a successful resync; and delayed current-page completion after
navigation. Headed Node fixtures prove DOM ownership and exact commands, while the final native acceptance must use
a real headed Tauri surface and screenshots to prove the dialog and native error are not occluded.

Independent review status at this point is lifecycle ACCEPT, native REJECT, and notification still under review.
The native reviewer made no modifications, staging, commits or pushes.

### Slice 4 sixth notification-owner review rejection

The final notification review also rejected the uncommitted tree. `GeneralPanel.tsx` kept its save tail, persisted
baseline and action generation inside one component instance, but `ConfigDialogHost.tsx` deliberately destroys and
recreates that instance on every settings-tab change. An old enable save can therefore remain pending across
unmount, a new General instance can save disable, and the old save can complete last and overwrite disk. A new
instance also initializes its alleged persisted baseline from the old instance's optimistic store value. The
single-mount headed fixture did not exercise either lifecycle and was false green.

The full-repository call-point scan found nineteen production `saveSettings()` calls: two in `main.tsx`; two in
`connection.ts`; one each in CommandPalette, locale preference, WorkspaceEditorLaunchers, AppearancePanel,
GeneralPanel and ServerConnectionSettingsGroup; two each in ExecutorSelector, task and workspace/titlebar-related
paths, with the remaining startup persistence in init/workspace. Every call writes a complete settings payload to
the same Tauri file. Because `settings.ts` currently has no shared save owner, any older unrelated save can retain
an optimistic notification value and complete after the notification save. GeneralPanel's local tail cannot
serialize or observe those writes.

The correction places the single save queue and last confirmed persisted snapshot in `settings.ts`, which is the
only common call path. Each save waits for the prior save and reads the current store only when its turn begins, so
an older queued full-payload caller cannot capture and later replay a stale global snapshot. A field-specific action
may additionally provide its exact intended field value plus a failure callback. The notification action uses that
input for each issued enable/disable request and runs rollback to the last confirmed value inside the save owner,
before the queue is released, but only when its module-global monotonic action still owns the preference. This
preserves rapid enable/disable/enable intent, prevents a later unrelated save from observing a transient failed
value, and does not add a second settings persistence path.

The notification action generation and visible notification preference error also outlive GeneralPanel mounts.
An old permission or save failure cannot overwrite a newer action after tab replacement, while a current failure
that finishes during unmount remains visible when General is opened again. Required regressions cover pending A
enable across General unmount/remount followed by B disable, both A-success/B-failure and A-failure/B-success,
rapid same-value re-entry through enable/disable/enable, and an older unrelated full-settings save completing
before the serialized notification save. The existing projector `delivered`/`deferred`, per-item eligibility and
batch remainder retry were independently ACCEPTed and remain unchanged.

Independent lifecycle review is ACCEPT; independent native and notification reviews are REJECT until their exact
corrections and fresh reviews pass. The notification reviewer made no modifications, staging, commits or pushes.

### Slice 4 native-lease correction self-review

Implementation of the opaque native lease exposed three additional ownership races before the corrected tree was
frozen. First, a fire-and-forget close publishes its cleanup failure while a later sync is awaiting the serialized
lease-transition barrier. Checking the failure only before that await is insufficient: the later sync can otherwise
create a new lease immediately after the failed release. Sync must re-read the tagged transition failure after the
barrier, refuse acquisition, and propagate the exact owned throwable when an awaited dialog restore requested
failure propagation. A string-only UI projection cannot replace that throwable owner.

Second, app-dialog A to B to C replacement can interleave after B has replaced A but while B is awaiting the hidden
surface transition. A B-local copy of the config section is lost when C supersedes B at the post-await epoch check.
The config section therefore belongs to the complete hidden-dialog resource lifetime, not to an individual dialog
completion. The deterministic regression must start B, suspend it after A has been replaced, introduce C, and prove
that C's settlement restores A's exact config section once while the native surface is hidden and restored once.

Third, native-surface restore failure must not prevent cleanup of the independent config-dialog resource. Final
settlement must always consume and restore the exact config owner, retain every falsy native restore throwable, and
avoid an implicit retry or repeated config restore. The same-logical-target headed regression must also prove that
no replacement sync occurs while the old opaque lease release is pending, then prove a distinct lease is acquired
only after the release succeeds. These are implementation acceptance conditions, not accepted variances.

### Slice 4 notification acceptance and native validation boundary

The notification correction passed a fresh independent review after its headed regression was made deterministic.
The final call-point inventory is nineteen production invocations: `main.tsx` two, `connection.ts` two,
`CommandPalette` one, locale preference one, `WorkspaceEditorLaunchers` one, `AppearancePanel` one,
`GeneralPanel` one, `ServerConnectionSettingsGroup` one, `ExecutorSelector` two, task service two,
`TitlebarMenubar` three, init one, and workspace one. The twentieth grep match is the `saveSettings` definition.
Only `settings.ts` sends the native `settings.save` command. The headed regression now rejects the current B save
while General is absent, proves settlement, rollback and no unhandled rejection before remount, then proves the
persisted error and confirmed switch state appear on the new instance. The independent verdict is ACCEPT.

Native/app-dialog focused Bun coverage passes 29/29, Overlay and transport typechecks pass, Rust Browser Preview
coverage passes 15/15, the headed Node fixture passes, and the same-logical target waits for release before obtaining
a distinct opaque lease. Main-thread replay initially exposed three `MissingI18nKeyError` diagnostics from the
app-dialog unit test even though the keys exist. The test now installs the canonical English locale fixture before
importing the dialog service, and the identical 29-test replay passes without diagnostic noise.

The Node headed screenshot is not a real Tauri child-webview screenshot and therefore cannot prove operating-system
z-order. Actual Tauri visual acceptance for dialog occlusion and the native-error surface remains open until an
isolated real app session produces and inspects those states. It must not be represented as complete by the Node
fixture, DOM assertions, Rust tests or the blank fixture-native crop.

### Slice 4 real-Tauri sync-preflight blocker recall

The first real Tauri child-webview investigation reopened the native slice. `overlay_browser_preview_sync` reports
`surfaceHidden: true` for four failures that occur before its existing mutation owner: blank `scope_key`, invalid
or non-finite bounds, URL parse failure, and an unavailable main window while no child webview is discoverable.
Those branches did not hide an already mounted child, clear page/selection callbacks, or invalidate the active
scope owner. The Panel consequently trusted a false cleanup claim, detached its lease, selected the HTML error
stage, and could leave the operating-system child webview visible above that stage.

The full call-point scan found one Tauri command definition and registration, one transport invocation, the native
service wrapper, the Panel caller, Rust Browser Preview tests, two direct service/panel contract tests, and four
headed fixture families. Existing mutation failures are distinct: they already execute hide and callback cleanup
inside `with_browser_preview_scope_replacement`, whose error path invalidates the same-key owner before releasing
the scope mutex. The correction must put every preflight failure that could observe an existing owner/surface under
one scope-mutex cleanup owner, attempt physical hide, clear both callback stores, and invalidate the active owner.
It must aggregate the exact cleanup failures and report `surfaceHidden: false` whenever the child could remain
visible; it must not claim cleanup, retry through another path, or add a fallback.

Acceptance requires Rust regressions that enumerate all four preflight reasons with an existing active owner and
prove hide, both callback cleanups, owner invalidation, mutex ownership, and the hide-failure `surfaceHidden: false`
contract. The real Tauri Chrome DevTools Protocol fault injection must send negative/invalid bounds against an
already visible child and verify that the child is actually hidden and the HTML error is observable. Node fixture
evidence remains useful for DOM ownership but cannot satisfy this native acceptance.

### Slice 4 seventh native-transition review rejection

A fresh independent review rejected the post-preflight tree before native visual acceptance. The Panel has one
`nativeLeaseTransitionTail`, but the app-dialog hide hook waits for it only when that hook itself detaches an active
lease. If a prior close already detached the lease and its native release is still pending, hide returns immediately
and `showAppDialog` can publish the HTML modal while the operating-system child is still visible. The same false
success occurs after a sync failure reports `surfaceHidden: false`: the lease is detached and the exact transition
failure is recorded, but hide sees no lease and returns without propagating that known child-visibility failure.

The full `releaseNativeLease` call-point scan has four production callers: fire-and-forget Panel close, target
replacement inside sync, app-dialog hide, and native-operation failure cleanup. The first three use the transition
owner, while `exposeNativeOperationFailure` currently detaches and calls `closeBrowserPreviewNativeSurface`
directly outside it. That unowned cleanup is invisible to both dialog hide and a replacement sync. Its optional
`operationError` also uses truthiness, so falsy throwables cannot be distinguished from no operation failure.

The correction keeps one owner rather than adding another: every release enters `runNativeLeaseTransition`; dialog
hide always waits for the current tail even when no lease remains, then reads and exact-propagates the tagged
transition failure before allowing a modal to open. Native-operation cleanup passes a tagged failure into the same
release path so falsy throwables remain real and a close failure aggregates both exact causes. Required regressions
must prove a dialog remains unopened while an already-detached release is pending, opens only after successful
release, rejects on pending-release failure, rejects immediately for the existing `surfaceHidden: false` failure,
and serializes generic operation cleanup. The real Tauri screenshots remain blocked until this correction passes
focused tests and a new independent review.

Main-thread lifecycle review found the same ownership gap at Panel disposal. `onCleanup` currently unregisters the
dialog surface hook before requesting native close, so an unmounted Panel with a pending or failed child release has
no remaining participant that can delay or reject a later app dialog. The hook lifetime must therefore extend until
the detached release succeeds. A failed release keeps the hook as the exact global child-visibility failure owner;
it must not unregister and silently allow a modal under the child. Restore after Panel disposal is a no-op and must
never reacquire a native lease. The headed regression must cover pending unmount plus dialog, not only a mounted
target replacement, and must prove successful release unregisters the retired hook while failure remains visible.

The first headed correction replay exposed a command-tail self-deadlock. A native operation failure settlement runs
inside its current lease command, but synchronously awaiting `releaseNativeLease` queues the release command behind
that same unresolved command tail. Neither side can advance. The failure settlement must synchronously register the
release after the current lease tail and then return so the command `finally` releases that tail. The registered
release still enters the single transition owner before a later user event can request a dialog, and its rejection
must have an explicit observer. The regression must prove the close command is actually reached and settles rather
than accepting a pending Promise as ownership evidence.

### Slice 4 eighth native-transition review rejection

The corrected mounted-Panel transition paths pass focused Bun coverage and repeated headed replay, and a rebuilt
real Tauri window proves a normal task-rename dialog hides the operating-system child before the modal becomes
visible. That screenshot is valid for normal z-order but does not close the disposal acceptance gap. A fresh
independent review found that the headed test calls the RightDock close action and labels it an unmount, while the
production `TabPanel` uses `forceMount`. Removing the Browser panel from the active collection only makes the same
Panel inactive; it does not dispose the Solid owner or execute `BrowserPreviewPanel.onCleanup`.

The existing assertions therefore prove pending release ownership for an inactive, still-mounted Panel, not the
required disposal contract. Static source assertions for `nativePanelDisposed` and deferred hook unregistration are
not behavioral evidence. A production-component fixture must conditionally mount and actually dispose the Panel,
then prove: a pending close keeps the dialog hook registered; successful release unregisters it and restore never
reacquires a lease; failed release retains the hook and exact failure so the dialog rejects. This fixture must use
the real `BrowserPreviewPanel` and shared `showAppDialog` path without a product test API. Until that passes and a
fresh exact-hash review accepts it, the transition slice remains REJECT despite the valid normal Tauri screenshot.

### Slice 4 ninth native-transition review rejection

The conditional-mount fixture now disposes the real production `BrowserPreviewPanel` and its headed replay proves
three public effects: a pending release prevents dialog publication, a successful release permits later dialogs
without reacquiring the native surface, and a failed release makes later dialogs reject with the exact retained
failure. A fresh exact-hash review nevertheless rejected the evidence wording and fixture lifecycle. The second
dialog's unchanged close count cannot by itself prove that the retired hook was physically unregistered, because
an accidentally retained disposed hook with no active lease could also produce no close command. Likewise an
unchanged sync count proves only the public no-reacquisition contract; it does not prove that a restore callback was
invoked before successful unregistration. The acceptance record must therefore distinguish observable public
behavior from source-level lifecycle structure and must not label either counter as behavioral proof of an internal
callback invocation.

The same review found a concrete resource-owner defect in the test: the Vite fixture server had no cleanup owner
between creation and browser launch, browser-close failure could skip server close, and a cleanup failure could
replace the original body failure. The fixture must acquire browser ownership underneath an already-owned server
and aggregate body, browser and server failures without fallback or overwrite. The final contract review must
decide whether public no-reacquisition plus exact source lifecycle evidence is the correct acceptance boundary;
adding a production test API merely to expose hook invocation is prohibited. Until the fixture owner and evidence
claims are corrected and freshly accepted, Slice 4 remains REJECT.

### Slice 4 tenth fixture-infrastructure review rejection

The corrected disposal fixture passed its isolated three-test replay and a combined four-test replay with the
original Browser Preview lifecycle case. One fresh reviewer accepted the frozen public disposal contract, but an
independent fixture-infrastructure reviewer found stricter reproducible defects. The shared
`BrowserFixtureServer.close()` calls the underlying Node server close operation anew on every invocation; a second
close therefore rejects with `ERR_SERVER_NOT_RUNNING`. A local memoized Vite owner avoids that failure only for the
new fixture and leaves the shared owner contract inconsistent. The common helper must own one close Promise and a
regression must prove repeated close returns the same settlement rather than adding a fixture-local compatibility
path.

The disposal fixture also mixes its activity-aware `waitForFixtureState()` with raw Playwright `waitForFunction()`
and `goto(..., networkidle0)` calls whose timeouts are measured mechanically from invocation. Those waits do not
satisfy the repository's inactivity-timeout contract. Its launch uses the default headless mode even though prior
records called the replay headed, and its local page/console/request collector duplicates the canonical collector
installed by `launchBrowser()` while observing a weaker error set. The next correction must use the canonical
browser error owner, replace fixed waits with observable activity-aware waits, and either launch visibly or record
the evidence accurately. The Vite port must also be verified against the user's random-port requirement instead of
assuming that `port: 0` is honored merely because Vite selected the next conventional port. Because these defects
affect the test infrastructure rather than the production disposal semantics, production Panel code remains
frozen. Slice 4 remains REJECT until the shared helper and final fixture pass fresh exact-tree review.

### Slice 4 disposal and fixture acceptance

The tenth-review correction uses one exported `ownBrowserFixtureResource` for both the shared HTTP fixture and the
Vite disposal fixture. Its close operation owns one Promise for successful, failed and falsy settlements; listen or
browser acquisition failure closes through that same owner, while body, browser and server failures remain ordered
and exact. The disposal fixture now calls the underlying Node HTTP server's `listen(0, "127.0.0.1")`, so the
operating system rather than Vite's conventional port increment chooses the port. It launches Playwright visibly,
uses the canonical `launchBrowser()` error collector, disables fixed navigation timeout, and routes every target
state through the dataset/dialog activity-aware wait. The headed disposal replay and the original Browser Preview
lifecycle replay pass together 2/2; focused Bun coverage passes 68/68, Overlay and transport typechecks pass, Rust
Browser Preview coverage passes 17/17, historical-doc links pass 21/21, and API routes, generated docs and dead-code
checks pass. Both the disposal-contract reviewer and the stricter fixture-infrastructure reviewer independently
ACCEPT the exact frozen hashes.

The final disposal fixture screenshots have identical SHA-256
`1fce8d277f796def9af1003c6ff7cb7460f5f4e6ed109c283f545aaefd70b574`: both correctly show the conditionally
disposed production Panel with only the fixture controls remaining. They are lifecycle evidence only and are not
represented as native child-webview z-order evidence.

### Slice 4 native visual acceptance boundary

An isolated rebuilt Windows Tauri session produced and was manually inspected at the frozen production hashes.
`01-native-visible.png` SHA-256 `3ae4f89418df1957b873524dece2b8ca20a97cd6e625a72066035a3b79f824c6`
shows the real child webview visible inside the right dock with correct bounds. `02-dialog-visible.png` SHA-256
`422b0daaa478843f34f8c5d6ce232b734d599d6e3d3abc42f2a5bb8c7355f463` shows the real rename dialog centered and
fully readable while the operating-system child content is completely hidden; no z-order overlap or clipped text
is visible. The isolated Tauri process exited through production `overlay_quit`, and its Chrome DevTools Protocol
and sidecar listeners were confirmed closed.

A real operating-system screenshot of the native error surface was not obtained. Repeated test-session attempts to
intercept the next production sync did not cause another bounds sync, and the Tauri capability model correctly
rejected direct window resizing. The four corrected Rust preflight branches are also structurally unreachable from
the ordinary Panel command path: the TypeScript service rejects blank scope, the Panel refuses invalid element
bounds, the only production persistence owner normalizes and rejects invalid non-HTTP(S) URLs before saving, later
unreachable loopback targets resolve as failed before the Panel can issue a ready native sync, and the production
app necessarily has its main window. Forcing one requires a transport/window fault injector or a product test API,
both of which would violate
the no-specialization boundary and the user's instruction not to micro-control this E2E. Rust 17/17 proves exact
hide/callback cleanup/owner invalidation and `surfaceHidden: false` on hide failure; the headed Panel regression
proves that this result prevents publication of the HTML dialog/error claim. The missing injected operating-system
error screenshot remains explicit evidence debt. A final independent review must decide whether the combination of
reachable real-Tauri z-order proof and exact unreachable-branch tests is sufficient to accept Slice 4; it must not
be silently described as an obtained screenshot.

The final independent native-boundary review ACCEPTed this evidence boundary. It confirmed that the visible-child
and dialog screenshots exercise the same Tauri `webview.hide()` used by every corrected preflight cleanup, that
Rust 17/17 covers the four exact defensive branches, and that `surfaceHidden: false` prevents the Panel from
publishing an HTML success/error claim while the child might remain visible. It also confirmed that producing the
missing screenshot would require an external fault injector or product test API for a path outside ordinary product
interaction. Slice 4 is accepted with the missing native-error screenshot retained as explicit evidence debt and
must never be reported as an artifact that exists.

### Slice 4 full-unit CSS runtime-property rejection

The first complete Overlay unit replay after the native/disposal corrections rejected one current-tree mismatch:
`surfaces/mailbox.css` consumes `--mailbox-progress`, while the staged `MailboxPanel` change had replaced the
element-owned custom property with a direct `width` declaration. That direct declaration visually overrides the
stylesheet rule but leaves the stylesheet's runtime-property contract undefined, so the CSS token-closure test
correctly rejected it. The repository-wide runtime-style inventory confirms that dynamic visual values use
element-owned custom properties (`--pct`, `--todo-progress`, file-explorer geometry, image-preview geometry and
task-progress geometry), and the closure test discovers those real assignments from production source. The
correction must restore `--mailbox-progress` as the single dynamic value owner and add a mailbox regression proving
that the component assignment and stylesheet consumer remain paired. It must not add a global default token,
allowlist the mailbox property, or weaken the closure scanner, because each would hide a missing production
assignment rather than repair it. Acceptance requires the focused mailbox and CSS-closure tests, Overlay typecheck,
and a fresh complete Overlay unit replay.

The complete replay advanced past that correction and then rejected the committed execution-disclosure colour
formula. Commit `8116a8d6587` had embedded the named colour `white` in `surfaces/messages.css`, while the existing
colour-literal contract requires surfaces to compose cascade-owned theme tokens. Its focused `message-embed` test
then pinned the same invalid formula, creating a false-green focused slice that the complete suite correctly caught.
The full token/call-point scan shows an existing general wash convention: light surfaced controls mix toward
`--surface-strong`, while dark neutral highlights mix toward `--text-strong`; `conversation.css` already uses the
same four-percent foreground wash. The correction preserves the native `light-dark()` branch and the established
74%/96% card ratios, replaces only those endpoints with the existing theme tokens, and updates the exact regression.
It must not add a component-specific root token, weaken the literal coverage, or move a hard-coded colour into an
allowlist. Because both direct browser consumers save screenshots, they must also request an explicitly headed
Node sidecar before their light/dark computed-colour and screenshot evidence is replayed and manually inspected.

The first explicitly headed replay rejected a pre-existing device-scale assumption before reaching its screenshot
matrix. The real Windows browser reported the visible one-device-pixel Agent-card border as `0.666667px`, while the
test compared `getComputedStyle().borderTopWidth` to the literal string `1px` twice. The production source still
owns `border: var(--oc-border-width)` and the structural token remains exactly `1px`; changing product CSS to
compensate for host display scaling would be incorrect. The browser contract must instead prove that the computed
border is present and no thicker than the declared structural token, while the source-level contract continues to
pin that token. This is a test-fidelity correction, not an accepted visual variance. The same headed replay must
then finish its existing geometry, light/dark tone and screenshot assertions before the slice can proceed.

The independent headed-scale review also found a test-tool contract defect behind the stale assumption.
`OverlayPage.setViewport` advertised an optional `deviceScaleFactor`, but its sidecar adapter forwarded only width
and height to Playwright's `setViewportSize`; three browser tests supplied the silently discarded field and therefore
claimed a deterministic device-pixel ratio they never obtained. The tool contract must be made truthful by removing
that field and the three ineffective arguments, with the launch contract test pinning their absence. The current
runtime border assertion must prove a solid, non-transparent edge at no more than the structural token width and at
least one physical device pixel. This repairs the diagnostic tool rather than adding a product-side display-scale
special case.

The strengthened replay proved that the headed sidecar reports the quantized `0.666667px` used width while also
reporting `devicePixelRatio` as approximately one. That browser value therefore does not expose the host compositor
scale and cannot support a physical-pixel multiplication assertion. The acceptance contract retains only evidence
the page can truthfully observe: positive width, solid style, non-transparent colour distinct from the card fill,
and no width greater than the declared structural token. Screenshot inspection remains the independent proof that
the edge is visibly rendered; an invented device-pixel formula would be another false-green test assumption.

The corrected headed chat-disclosure replay passes 1/1, and the independently headed real-component chronology
replay passes 1/1. Manual inspection found no overlap, clipping or unreadable controls: the Agent-card edge is
visible, and the expanded Tools/Reasoning surface remains a quiet same-hue lift rather than a nested heavy card in
both themes. Evidence hashes are `5965b1780c07fefa91ba2fb4b7f01304bd47cac203ed62350fd0ec5cf0c270c4`
for the light expanded component, `de94768719a601cf489a453afb66e20da97f32efadb26735d3f4f0a68d078983`
for its full page, `7b7f1dff9d1d3f3c68d96204761017826224031ef9a80d78f6a87cda0f4f43de`
for the dark expanded component, `51564410a965b1dd060cf350b77c8e4d483e7e098c27b979558a0ad07380188f`
for its full page, and `1ec9060b7ee473c1eefed91ac3f3aa20c760ab2f15e652be9300ea5b0c9a52c3`
for the chronology component. These artifacts are visual acceptance evidence, not runtime E2E evidence.

The next complete Overlay replay advanced to `overlay-architecture-guards` and rejected its stale Agent Models
description literal. Commit `484e2c5707` correctly added a real no-directory global configuration scope and changed
the single `SettingsGroup` description to select `agent_models.intro_global` for that scope and `agent_models.intro`
for project/session scope. Its focused service and browser regressions cover global loading, persistence and copy,
but the broad architecture test still required only the old project literal. Production has one conditional owner;
the correction updates that guard to require the exact two-scope expression rather than deleting the global copy or
loosening the assertion. No production change is warranted.

The following full replay exposed a separate merge-time contract split. Commit `50dbbc78f7` had converged the
workspace search button on canonical `--oc-density-icon-button`; parallel commit `e6f560b92c` introduced
`--ui-left-rail-search-action-size` and a manually duplicated half-size solely to preserve the search/project-action
centreline, and merge `3f901bf729` selected that specialized geometry while retaining the canonical-density test.
Updating the test to bless a one-consumer 30px token would preserve the split and violate the no-specialization
requirement. The correction removes both search-only tokens, restores the Button primitive's standard icon density,
and derives the centreline subtraction directly from that canonical token. The distinct 20px project-row action
token remains because it represents a genuinely compact control family shared by both project actions. The
left-rail geometry regression must pin the canonical expression and reject both retired search tokens.

The same full-repo review found `settings-content-inset.test.ts` repeating the stale project-only Agent Models copy.
The architecture guard already owns the exact global/project description expression; the inset test should verify
only that the one direct `SettingsGroup` opts into `contentInset`, avoiding another copy/scope contract duplicate.

### Slice 4 headed left-Dock and provider global-scope rejections

After the canonical left-rail density correction passed 139/139 focused assertions, Overlay typecheck and the real
Vite production build, the explicitly headed `left-dock-compact-browser.test.ts` rejected navigation height 54px
against its stale 45px expectation. The full call-point and history scan covered the four `WorkLedger` navigation
callers, the sidebar density variables, their project/work/nested consumers, the source density regression and the
July 14, July 16 and July 17 design records. The latest production and architecture contract is one scale-1 density
of 36/26/34/26px; commit `0e8ae64d5a` restored that contract while failing to update this browser fixture from an
intermediate 30/24/26/24px revision. A read-only independent review therefore ACCEPTed production and REJECTed the
fixture. At its explicit `--ui-scale: 1.5`, the exact behavioral expectations are navigation 54px, project 39px,
ordinary and Mission rows 51px, nested row 39px, section margins 12/6px and dock 900px. The correction must keep
exact rendered geometry but express the base densities and scale once in the test; it must not probe the same CSS
variables as its oracle, because an incorrect production token would then create a self-consistent false green.

The next complete Overlay unit replay advanced to two stale assertions in `provider-settings-layout.test.ts`.
Commit `100bbccda8` made first-launch Settings usable without a project directory: provider configuration mutations
now select the project config writer when a directory exists and the global config writer otherwise, while
`/auth/:providerID` remains the server's global credential owner mounted before project-directory middleware. The
old test still requires a directory query on that global auth route and a direct `updateConfig` call, contradicting
both the current route topology and the headed first-launch browser contract. The full scan includes all
`providerScopedPath`, `updateActiveProviderConfig`, form-directory, save/delete/key mutation call sites, both Auth
route mounts, global/provider service tests and commit history. An independent review is pending before the test is
changed. The intended correction is to pin the single global auth path and the conditional config writer helper,
not restore a directory query or duplicate global/project mutation tests in this layout-only suite.

Manual inspection of the corrected left-Dock screenshot rejected the first passing image: the fixture still
rendered a retired `.sidebar-codex-search-toggle` beneath New chat, even though production moved the same real
`work-ledger-search-toggle` action to App's `.workspace-command-search` context-bar button and the source contract
already rejects the retired sidebar selector. The isolated left-Dock fixture must remove that obsolete DOM instead
of visually accepting a lone search glyph. Its density, non-overlap, Mission inset and narrow-width evidence remain
valid after that removal and must be replayed and inspected again.

The completed independent Provider review REJECTed a test-only correction because it found a real captured-owner
race. `formDirectory` currently uses `""` for both an explicitly captured global form and an uncaptured/reset form,
then `formDirectory() || activeDirectory().trim()` silently changes owner if the operator opens the global form and
selects a project before saving; the inverse scope switch has the same conceptual risk. This is forbidden fallback,
not a harmless UI detail. The correction must use `string | null`, where `null` alone means uncaptured and the empty
string is a valid global owner, capture the scope at both add/edit entry points, and make save/model discovery consume
only that captured value. Missing capture must fail visibly; it must never re-read the current directory. Regression
coverage must pin the global auth path, reject scoped auth, pin the strict global/project config-writer split, and
prove both empty-global and non-empty-project captured values are not expressed through `|| activeDirectory()`.

The next complete unit replay reached `workspace-active-directory.test.ts` with one failure: immediately after
`closeProject()` it expected a captured native `settings.save`, but the array was still empty. Production still
calls `saveSettings()` after clearing the directory and project projections. The shared, currently modified
settings owner now serializes every save by awaiting the prior save tail before invoking the native host; its
focused executor tests deliberately read the store when each queue turn begins so a failed action can roll back
before the following full save snapshots the store. The old synchronous assertion therefore observes before the
native call's already-queued Promise continuation, rather than proving persistence is missing. Repository search
covered all three product `closeProject` callers, both closeProject tests, every saveSettings caller, the queue and
failure regressions, and workspace history. The correction makes only this test asynchronous and yields one native
Promise microtask before inspecting the command. It must not add a timer, polling loop, test-only flush API or a
second persistence owner, and it must keep asserting the cleared-directory payload.

After that microtask-boundary correction, the focused workspace plus serialized-settings suite passes 33/33 and
the complete Overlay unit runner passes with no failing file in 176.5 seconds. The final visual-entry scan then
found that `provider-agent-model-sync.test.ts` writes both the Provider disclosure and first-launch global Settings
screenshots while accepting `launchBrowser`'s default headless mode. Because the current correction changes the
Provider form's visible strict-error path and scope ownership, its browser replay must explicitly use the headed
Node sidecar, run serially with the already-headed General Panel fail-fast case, and have its resulting Settings
screenshots manually inspected before the Overlay slice can freeze.

### Slice 4 final contract-correction review rejection

The first exact-tree review after the complete Overlay unit pass REJECTed two remaining false-green browser
oracles and one incomplete Provider owner capture. `titlebar-toolbar-toggle-browser.test.ts` and
`command-palette.test.ts` still required a 30px workspace-search action even though production now consumes the
canonical 32px `--oc-density-icon-button`; both tests also wrote screenshots from the browser launcher's default
headless mode. Repository search covered every `work-ledger-search-toggle`, search geometry assertion, retired
search-only token and workspace alignment record. Both real-page oracles must require the canonical 32px density,
launch explicitly headed through Node, and have the alignment screenshot manually reviewed. The July 17 alignment
record must be corrected at the same time because its claimed 30px pass condition is now the opposite of the
single production owner.

The review also found that capturing only `formDirectory` does not close the Provider scope race.
`handleSave()` still used `formBaseConfig() ?? providerConfigWithoutApiKey(id)`, while Add left
`formBaseConfig` null. If an operator opened Add in one scope, changed the active scope, and entered an ID already
present in the new scope, Save copied options from the new scope into the captured target scope. This is forbidden
fallback and cross-scope contamination. The full call-point search covers both Add/Edit entry points, both
Save/Discover consumers, the sole `providerConfigWithoutApiKey` helper, global/project config writers, auth routes,
and the headed first-launch fixture. Add must capture an explicit empty object, Edit must capture the selected
provider's key-free config, Save must reject a null seed visibly, and no submission path may reread current provider
config. Regression coverage must independently pin both entry points and both consumers, reject the nullish
fallback, and keep `/auth/:providerID` as the global credential owner.

The shared worktree is also 38 commits behind `myhexin/v0.0.8beta`. Those commits overlap the Overlay delivery
surface, so final acceptance cannot bind to the current local tree. The current reviewed slice must first become a
coherent commit without resetting, stashing or discarding any shared edits; the remote line must then be merged in
the same primary worktree, conflicts resolved from both designs, and the complete validation plus exact-tree review
repeated against the merged result before push.

The first focused replay correctly rejected the initial Provider correction because its patch context placed the
new `baseConfig` read and combined null check in `handleDiscoverModels()` rather than `handleSave()`. The strengthened
test sliced the two consumers independently and exposed that wrong ownership immediately. The correction must
restore Discover's directory-only capture check and move the base-config read plus combined fail-fast check into
Save before any form-derived mutation is built.

The corrected Provider and density contracts pass 154/154 focused assertions and Overlay typecheck. The residue
scan finds no production nullish Provider seed fallback, directory fallback, retired search-only token or 30px
browser oracle; remaining matches are negative assertions and the Recall's explicit history. The Node-launched,
explicitly headed titlebar fixture passes 2/2 and the explicitly headed command-palette fixture passes 1/1.
Manual review ACCEPTs `workspace-search-project-plus-alignment.png` SHA-256
`8dc0203ee74336f91107ca84aaf680ac6df64e82deec3a099948a57b8bdccd97`: search and Project-plus glyphs share one
right axis, the canonical search hit area does not clip the title, and the complete 280px rail remains readable.
It also ACCEPTs `overlay-sidebar-project-actions.png` SHA-256
`98509f56ef7f3d710afbd16e110e6d447d16098147ba77ffe524a935d4f6deab` and
`command-palette-dialog-primitive.png` SHA-256
`29ae6cf8ec30489111247000b8f3cf26538b18e2bcdf946f4feb02fb03a445ae`: the full desktop surface and Dialog have no
overlap, clipping or unreadable controls, and the highlighted command row remains clear. Fresh independent reviews
of the Provider captured owner and search/visual contract are pending; these local results do not yet freeze the
slice or substitute for the required post-remote-merge validation.

Both fresh reviews REJECTed the claimed evidence rather than production semantics. The visual reviewer proved the
headed option had been applied to the first file-manager case, while the second titlebar case that actually writes
the workspace-alignment screenshots still used the headless default. The current alignment hash is therefore a
valid geometry artifact but not headed visual evidence and must be replaced by a new explicitly headed replay and
manual review. The Provider reviewer confirmed the production Add/Edit/Discover/Save owner semantics and global
auth route, but showed that three assertions still searched the entire file: unrelated Provider mutations could
keep them green if Save stopped passing the captured directory, stopped consuming captured options, or Discover
lost its captured scoped request. Those assertions must bind the writer, base-options consumption, scoped request
and visible missing-capture error to their exact Save or Discover slices before replay.

The four Provider assertions are now bound to their owning function slices: Discover owns the captured scoped
request and missing-capture error, while Save owns the writer call, captured options consumption and its own
missing-capture error. The focused Provider plus visual-launch contract passes 17/17 and Overlay typecheck passes.
The actual screenshot-producing titlebar case now launches explicitly headed through Node and passes 2/2. Its newly
generated `workspace-search-project-plus-alignment.png` SHA-256 is
`8251cf8a57349659852ecc10d85565f505a4638f2c2f8559372c7d6a6716d34a`; manual inspection ACCEPTs the common
search/Project-plus axis, readable title and unclipped complete rail. The earlier `8dc0203e...ccd97` artifact is
superseded headless evidence and must not be cited as headed acceptance. The full Overlay unit runner also passes
on the corrected local tree in 132.2 seconds. Fresh reviewer rechecks and post-remote-merge validation remain
required before the slice can freeze.

The Provider re-review ACCEPTed the exact correction: Add/Edit independently capture directory and seed,
Discover's captured route and error are slice-bound, Save's writer, options consumption, auth path and error are
slice-bound, and the submission slice rejects any current-scope config reread. The workspace-search re-review also
ACCEPTed the exact correction: the screenshot-producing launch is headed, both real-page oracles independently
require 32px, production has only the canonical icon-button owner, the retired tokens have negative coverage, and
the new `8251cf8a...d34a` visual evidence is coherent. Both reviews explicitly limit acceptance to the current local
tree; the required staged-tree review and the full post-remote-merge replay remain open.

### Exact staged-tree review rejection

The local candidate was frozen at tree `b8622aa5f209f03d4725b8bb4f7ef9d9b48da572`, stable patch ID
`b12220a732cd1056bc67a7b087b74b63ebf243cd`, spanning 95 files with 8,834 insertions and 3,831 deletions. Its
complete Overlay unit suite, repository typecheck, API route inventory, generated-doc check, production dead-code
scan, 77 documentation-health/history tests and 30 transport contract tests all passed. Three independent exact-
tree reviews nevertheless REJECTed it; those green commands do not cover the failures below and cannot be reused
as final evidence.

The native/runtime review found one settings schema split. TypeScript persists `projectEditor`, `rightDockWidth`,
`preferredProjectEditor` and canonical `workspaceTaskID`, while Rust omits the first three, retains obsolete
`sectionsWidth`, `workspacePanelHeight`, `directoryMode` and `workspaceSessionId`, and silently ignores unknown
fields. TypeScript simultaneously reads/writes legacy `workspaceTaskId`. The save command therefore confirms data
that will disappear on restart, while workspace identity survives through forbidden dual spelling. Rust must own
the exact current persisted schema with unknown-field rejection; TypeScript must remove the legacy read/write;
round-trip coverage must enumerate every persisted field. The same command currently truncates the live settings
file in place. Failure after truncation invalidates the supposedly confirmed snapshot, so persistence must use a
mature same-directory atomic-replacement owner and a fault test must prove a failed write preserves the prior file.

The Browser Preview selection contract has four coupled defects. Rust clears selection after every successful
back, forward or URL navigation, while the Panel clears its signal only for reload; the next poll then reports
selection-not-enabled and closes the preview. All navigation entry points must share one owner that exits selection
before navigation. `browserPreview.selection.setEnabled.labels` is unvalidated at the transport boundary and
untyped in Rust, so malformed labels silently preserve defaults; the typed schema must reject unknown keys and
blank/non-string values in both hosts. The native selection result parser accepts non-finite coordinates,
non-positive dimensions, blank labels and unchecked optional fields; it must canonicalize the same strict shape as
Rust rather than trust one host implementation. Finally the guest hover HUD hard-codes Chinese color/font/source
labels even in English mode; color and font must join the same typed i18n projection as every other guest-visible
label, with no language-specific runtime literal.

The browser-test review found infrastructure false greens. `settlePendingEventHandlers()` can wait forever after
the sidecar exits if one route/page handler never settles. Its owner must reject only after a real inactivity period
and refresh that period whenever another handler settles; a never-settling regression is mandatory. The new
right-Dock fixture likewise uses raw invocation-clock waits and must use the shared activity-aware observation
owner. `provider-agent-model-sync` and `chat-bubble-disclosure-button-browser` swallow `browser.close()` failures
and close their servers separately, hiding collector, handler, lock and termination failures; both must acquire the
browser through the fixture and aggregate body/browser/server failures in order. Three mechanically edited files
also place every `bodyFailures` declaration in the first test: file-explorer accessibility (2 owners), file-
explorer search errors (11 owners) and titlebar menubar (5 owners). Each declaration must live in its actual test
scope, and every changed browser test must pass a Node/tsx parse inventory before selective real execution.

Two coverage/residue gaps remain. The Provider headed fixture covers only a stable global scope, so it does not
prove the fixed global-to-project or project-to-global captured-owner race; a real component/browser chronology
must switch active scope while the form is open and assert the original writer and seed remain authoritative.
`neutral-chrome-wash-browser` still hand-builds the retired sidebar search control even though production search is
owned by App's context bar. It must use the current real surface or remove that obsolete oracle; renaming the class
would preserve the legacy fixture.

After these corrections, acceptance requires focused Rust/transport/settings/navigation/Provider/helper tests, a
Node/tsx parse inventory for every changed browser file, the affected Node browser tests with headed execution for
visual artifacts and manual screenshot review, the complete Overlay unit runner, root typecheck/routes/docs/dead-
code/document-health/transport checks, and three new exact-tree reviews. Only then may the local candidate be
committed. The 38 remote commits overlap 16 staged paths, so that commit must be merged into the latest
`myhexin/v0.0.8beta`, conflicts resolved semantically, and the complete validation plus exact-tree review repeated
on the merged tree before final commit and push.

### Exact staged-tree rejection correction replay

The rejected Settings split is now corrected around one strict persisted document. TypeScript and Rust enumerate
the same required and optional fields, reject unknown keys and invalid enum/range/nonblank values, and no longer
read or write the retired `workspaceTaskId` spelling. Rust returns no defaults when the file is absent, leaving the
TypeScript settings store as the sole default owner, and writes through a same-directory `tempfile` replacement.
Focused transport/settings coverage passes 111 assertions; Rust Settings coverage passes 6/6 including injected
partial-write preservation, and Rust Browser Preview label/i18n coverage passes 2/2. Overlay and transport
typechecks pass on this corrected local tree.

Browser Preview now has one Panel navigation owner for back, forward, reload and address submission. That owner
clears the Solid selection signal and awaits the native selection-disable command before issuing navigation.
Transport and Rust both require the exact nine localized labels, while the selection result parser rejects
non-finite coordinates, non-positive dimensions, blank labels, invalid optional fields and overlong Unicode text.
The explicitly headed Node replay of `browser-preview-live-input-batch.test.ts` passes 1/1 and proves all four
navigation entry points remain blocked while selection-disable is deliberately delayed, then navigate only after
release. Manual layout review ACCEPTs `browser-preview-native-surface.png` SHA-256
`71e34d078c0b92e750e06cce649752242ac884f1c147ae04049b12038682c2e7`: the navigation toolbar, address field and
tall native-surface boundary do not overlap or clip. Its blank native content area is only a Playwright screenshot
composition limitation and is not claimed as real target-page visual evidence; this replay accepts navigation
chronology and Overlay layout only.

The real Provider chronology now opens Add in global scope, switches to a project before Save, and proves only the
captured global writer receives the explicit empty Add seed. It then opens Edit in project scope, switches to global
before Save, and proves only the captured project writer receives the captured project options. The first replay
exposed a stale oracle rather than a product failure: after adding the global `cross-scope` provider and connecting
Hexin, production correctly reports two configured providers because its single owner is the set union of config
provider IDs and connected catalog IDs. The assertion now requires 2, and the explicitly headed replay passes 1/1.
Manual review ACCEPTs `provider-advanced-disclosure.png` SHA-256
`f1c64611a9e70d063e3a32b3345279d9fcac3764d225a91423c59a4eaf808b1e` and
`mac-first-launch-global-settings.png` SHA-256
`bb6b33d00861ac37dad0bda610f8e44bba67fea2a02daeee9aa0f0f6f2484b1b`: the Provider disclosure, settings
navigation and Skill Market remain readable and non-overlapping.

The browser Settings fixture inventory was split into independent alphabetical corrections. The completed a-c,
d-m and n-z slices remove legacy multi-key settings writes, make browser hosts install the one `oc_settings`
document, and make every fake Tauri `overlay_settings_load` return a complete canonical snapshot. Their Node parse
inventories, Overlay typecheck and representative browser replays pass; one invalid `directory: ""` fixture was
removed because an optional directory, when present, must be nonblank. `task-dirbar-keyboard.test.ts` remains the
only large excluded owner still being migrated. Final residue scan, full runner, exact-tree review, remote merge,
post-merge replay and push remain open, so this evidence does not yet freeze or advance the accepted delivery.

The final task-dirbar inventory is also migrated: all fifteen page initializers use the canonical fixture, all
eleven fake Tauri loads return a complete snapshot, and the only retained browser key is the unrelated recent-
directories feature owner. Its first real replay exposed three historical fixture failures. Production's compact
Icon token is canonically 12px, so the old 14px remove-icon oracle was corrected. The Page proxy does not implement
Puppeteer's `waitForResponse`; an attempted local `page.on("response")` helper made the real tests pass but was
correctly rejected by the central collector audit because it created a second response owner. The final tests
resolve existing deferred Promises inside the exact archive/rename backend handlers, then observe the row action's
busy lifecycle returning to enabled. No response listener, runner extension, sleep or fallback remains. The full
explicitly headed task-dirbar replay passes 15/15 in 59.5 seconds and the central collector ownership test passes.

Complete unit replays then exposed two further stale contracts. `pane-config.test.ts` still required the retired
`oc_sidebar_collapsed` and `oc_right_dock_width` keys as positive behavior; it now requires the canonical
`BROWSER_OVERLAY_SETTINGS_KEY` get/set plus strict parser and negatively asserts the retired keys. Its focused
settings/pane matrix passes 16/16. `config-panel-sizing.test.ts` still required Provider `onMount`, contradicting
the scope-reactive Provider load needed to prevent stale cross-directory projection; it now requires the owning
`createEffect`, captured directory and provider load, and the Provider/config focused matrix passes 34/34.

The strict Settings parser also exposed an actual VS Code first-launch regression. The old test used a partial `{}`
document to obtain the injected host theme, which is no longer a valid persisted payload. Returning the canonical
absence value `null` showed `loadSettings` applying the literal light default and bypassing its existing
`settingsTheme({})` host-default owner. The absent-file branch now constructs explicit defaults through that owner;
persisted documents remain strict and complete. Host theme, executor settings and theme scope coverage passes
25/25. A fresh complete Overlay unit replay is still required after these corrections.

The next complete unit replay exposed only test-host persistence ownership. Eight task-selection service tests ran
with the implicit browser transport but had no browser `localStorage`; the prior storage owner silently accepted
that impossible host. Production now correctly throws. Those pure service tests install an explicit Tauri test
transport that acknowledges only `settings.save` and fails every unused request/native path. The focused selection
matrix passes 13/13, and the subsequent complete Overlay unit suite passes with no fail/error in 110.6 seconds.

The final browser residue scan found one diagnostic-only read of `oc_workspace_task` and `oc_directory` in the
message-card chronology fixture. It now reads the canonical Settings document through
`OVERLAY_SETTINGS_STORAGE_KEY`; no browser fixture retains a legacy Settings key. `oc_recent_directories` remains
because it is an independent recent-project feature, while explicit malformed/retired-key rejection tests remain
as negative coverage. The Node native TypeScript parse inventory passes for all 79 changed browser test files.

The corrected local tree also passes repository typecheck across all scoped workspaces, API route inventory (31
files), generated API documentation (272 operations), Overlay i18n, production dead-code scan, and 81 document-
health, historical-link and product-doc single-source tests. The local tree is now eligible to freeze for exact-
tree review. Staging/hash capture, three independent exact-tree reviews, commit, remote merge, post-merge replay
and push remain open; none of the pre-freeze commands may be reused as post-merge evidence.

### Exact tree `0cc4392b` rejection and protocol correction

The next candidate was frozen at tree `0cc4392bc063720b433bbcab165cb55a05f36ff2`, stable patch ID
`a5629e757b2d470ced6ec79202d4f60a4ab9be33`, spanning 157 files with 11,961 insertions and 5,675 deletions.
One independent Overlay UI review ACCEPTed that exact tree, but the native/runtime and test/spec reviews REJECTed
it. The tree is therefore not an accepted delivery and must never be cited as one.

The native/runtime review proved four strictness splits. TypeScript accepted pane widths above Rust's unsigned
32-bit range; persisted theme accepted any nonblank string and the runtime silently replaced invalid values with
light; Browser Preview current-page and selection results accepted unknown outer fields while optional selection
fields accepted explicit null; and the `host:theme` type guard accepted missing, invalid and unknown fields. The
correction makes the transport protocol the only theme enumeration, limits pane widths to
`1..=4_294_967_295`, rejects invalid themes without substitution, and requires exact Browser Preview and host-theme
documents in TypeScript and Rust. A focused Rust replay exposed that the JSON5 deserializer did not reliably reject
the first out-of-range integer representation merely because the destination field was `u32`; Rust therefore
parses the input as `u64` and enforces the same explicit unsigned 32-bit range in the single settings validator.
Transport and Overlay service coverage passes 55/55, Rust settings passes 6/6, Rust Browser Preview passes 19/19,
and Overlay typecheck passes after the correction.

The test/spec review also found benchmark and architecture-document residue plus browser teardown false greens.
The benchmark now writes, resumes and diagnoses only one complete `oc_settings` document validated by the
transport protocol; old per-field settings keys and `directoryMode` are removed, with its focused matrix passing
32/32 and package typecheck passing. `specs/current/architecture/05-config.md` now documents the same strict
document across Browser, VS Code and Tauri, including Tauri atomic replacement and the actual persisted versus
runtime-only fields; 81 document-health tests pass. Browser fixture teardown corrections and their real runner
replay are still in progress, so these local results do not yet create a new frozen tree. After that bounded work,
the complete validation matrix and three fresh exact-tree reviews remain mandatory before commit. The remote line
is now 59 commits ahead and overlaps this delivery; only a locally accepted commit may be merged into it, followed
by a complete post-merge replay, exact-tree review and push to `myhexin/v0.0.8beta`.

The operator subsequently issued an explicit instruction to push regardless of test outcome. The current tree is
therefore permitted to create a clearly labelled WIP checkpoint before final acceptance. This changes only the
push timing, not the acceptance claim: the connection-badge browser fixture currently fails because its oracle
expects an outline while the canonical Button primitive intentionally uses a focus-visible box shadow, and its
deliberate unsafe-port backend also produces visible request/404 errors now that teardown no longer swallows the
collector. Those known failures remain mandatory follow-up work, and the pushed checkpoint must not be described
as a completed or accepted delivery.

The WIP checkpoint `c66c39f72e` was merged with the then-current remote line in `f239052612` and pushed to
`myhexin/v0.0.8beta` at the operator's explicit request. The pre-push hook passed repository typecheck, the
31-file route inventory, 272-operation generated documentation check, Overlay i18n and the tracked-source secret
scan. Nine merge conflicts were resolved semantically: the retired `SideActivityToolbar` stayed deleted in favor
of the single Right Dock owner, the remote transparent text-disclosure design was preserved, and browser tests
retained both remote behavior additions and the canonical Settings/cleanup owners. Focused merge tests passed.

The connection fixture failure then proved a real startup chronology defect rather than only stale test data.
Always-mounted Mailbox and Worktree projections reacted to the restored directory before the API client was
configured, issuing requests against the page origin; configuring auth then closed the premature mailbox stream
and its consumer reported the intentional `auth-changed` closure as an error. Both projections now derive server
availability from the existing canonical `appStore.connected` fact: while disconnected they clear their local
projection and own no request or stream, and a successful health check naturally re-runs their Solid effects.
The fixtures use their own random server origin and express the intended offline health result as invalid JSON over
a successful HTTP response, avoiding an unsafe-port request failure or error allowlist. The badge oracle now
verifies the shared Button primitive's box-shadow focus ring instead of requiring an outline that the primitive
explicitly does not paint. Unit/collector coverage passes 62/62; real Node browser replays pass 2/2. Manual review
ACCEPTs `connection-badge-button-focus.png`: the Offline badge has a clear unclipped keyboard ring. It also ACCEPTs
`connection-banner-button-primitive.png`: status text and both actions are readable and do not overlap. This
correction still requires commit/push and does not by itself complete the broader exact-tree review.

The startup correction was committed as `9e950d486c` and pushed to `myhexin/v0.0.8beta`, but an independent review
REJECTed its test evidence. Both connection fixtures express offline state as HTTP 200 with a malformed JSON body,
which tests protocol corruption rather than a valid health failure. They also never prove offline-to-online,
disconnect and reconnect behavior, the existing Mailbox source assertion matches the wrong branch, and the nearest
Mailbox concurrency browser replay exposes unaggregated aborted requests. These are open acceptance blockers even
though the production `appStore.connected` projection has no currently proven reconnect defect; the fixtures and
lifecycle coverage must be corrected without an error allowlist or fallback.

The first complete Overlay unit replay after the remote merge exposed two independent merge residues. The role
typography oracle still required only `.msg-text` although production intentionally applies the same scale to
inline `.msg-reasoning`; the oracle now binds the combined production selector. The next test exposed two composer
separators using undefined retired token `--border-subtle`; both now use the existing canonical `--divider-soft`
separator token rather than adding an alias. Their focused role and token-closure matrix passes 4/4. A new complete
unit replay and the rejected connection lifecycle correction remain required, so this checkpoint is not final
acceptance.

Commit `d6f2eb731c` pushed the role and separator correction; an independent exact-commit review ACCEPTed its
canonical token semantics and strengthened role oracle. The next complete unit replay exposed a raw `100vw` clamp
on the Composer mention menu even though every surface must derive legal width from the Overlay shell. That clamp
now uses the existing `--ui-overlay-shell-width`; the window, mention and token matrix passes 19/19. The following
first failure was a stale density oracle that required already-retired `--ui-left-rail-search-action-size` while
the canonical source and another negative test require `--oc-density-icon-button`. The oracle now requires the
canonical token, with the density matrix passing 13/13. Neither correction changes the still-open connection
lifecycle REJECT, and another complete unit replay remains required.

Commit `4df2d492bc` pushed the legal shell-width and density-oracle correction. The next complete unit replay reached
the sidebar continuity contract and found its sole navigation-row radius assertion still required `soft`, while
the shared primitive and three dedicated primitive/single-source tests require canonical `large`. The stale
continuity oracle now binds `large`; the focused navigation-row matrix passes 11/11. The complete unit runner must
still be replayed past this first-failure boundary, and the connection lifecycle REJECT remains independent.

Independent exact-commit review ACCEPTed both `4df2d492bc` and `2e99a04e9e`: shell width is the legal container
owner, the icon-density and navigation-radius changes remove lone stale oracles, and the recorded focused matrices
replayed exactly. The connection evidence correction now replaces malformed-success health fixtures with valid
JSON HTTP 503 responses and central collector expectations restricted to exact `503 /global/health`. A new Node
browser chronology covers offline, online, disconnect and reconnect, proving Mailbox and Worktree perform no
offline request and reload after both reconnects; its online response uses the complete real health document.
Offline logs remain visible in local AppLog but no longer create backend upload work, with explicit zero-transport
coverage. The false-green Mailbox and source-string tests are removed, and the initialization effect uses Solid's
`on` dependency owner so indirect synchronous reads inside `refresh()` cannot become hidden dependencies. Focused
units pass 14/14, and the lifecycle, badge and banner Node browser cases pass.

Mailbox concurrency remains REJECTed and must not be described as accepted. Its delayed old cursor behavior and
exact old-append/SSE cancellation allowance remain intact. After removing all wider allowances, the central
collector proves `NEW refresh(false) -> NEW ERR_ABORTED -> NEW refresh(false)` and the same sequence for FAILED,
each before the next scope transition or teardown. The direct trigger is two initialization-effect invocations for
the same final active directory; the deeper producer that emits those two effective directory projections remains
unproven. This WIP slice may be pushed only because the operator explicitly required push regardless of test
outcome; the failed Node mailbox replay and complete Overlay unit replay remain mandatory follow-up.

The connection WIP was committed as `fd4ca90542`, merged with nineteen concurrent remote commits in
`8cf6b00467`, and pushed to `myhexin/v0.0.8beta`. The pre-push hook passed repository typecheck, the 31-file route
inventory, generated documentation, Overlay i18n and secret scanning. Post-merge focused units pass 27/27 and the
lifecycle, badge and banner Node browser cases pass 3/3. Independent WIP review still REJECTed final acceptance:
Mailbox concurrency duplicated same-directory base requests; the exact failure chronology in this Recall was
stale; its HTTP 503 allowance was wider than the failed directory query; lifecycle coverage did not yet prove the
Mailbox event stream closes offline or that manual refresh works after reconnect; its blanket acceleration of all
10-second browser intervals needed either narrowing or proof that the monitor is the only such owner; and a fresh
complete Overlay unit replay remained open.

Read-only full-chain audit then proved the Mailbox duplicate was not an active-directory dual source. A single
Work Ledger selection synchronously publishes the selected task and its new directory, creating the first Mailbox
projection. The subsequent cross-directory `selectTask` branch calls `applyDirectory`; that function used a
foreground `checkConnection()`, which changed an already-online connection to `connecting` and therefore changed
`appStore.connected` from true to false. The successful health response changed it back to true, tearing down and
recreating the same directory projection. FAILED followed the identical sequence. `applyDirectory` now performs
its health preflight with `checkConnection({ background: true })`: an online session remains online while the
probe is pending, a real failure still becomes offline, and an initially offline session still enters connecting.
No Mailbox deduplication, error allowance, fallback or route-specific gate was added. The failed-response allowance
is exact to HTTP 503 plus the FAILED directory/view/limit query, and the browser chronology asserts exactly one
base request for both NEW and FAILED. A service regression keeps the connection online while the `applyDirectory`
health response is deliberately pending. Focused service tests pass 20/20 with 88 assertions, and the real Node
Mailbox concurrency replay passes 1/1. Independent exact-diff review, stream-close/manual-refresh lifecycle
coverage, the 10-second owner proof and the complete Overlay unit replay remain open before final acceptance.

Independent exact-diff review ACCEPTed the directory-preflight correction after both missing regressions were
added. Commit `b0bea18355` was merged with the concurrent Darwin artifact delivery and pushed as merge head
`b45fec490f` to `myhexin/v0.0.8beta`. The first two fetch attempts failed after the remote returned HTTP 504; a
protocol-v0 branch-only fetch completed without changing source semantics. The push hook passed repository
typecheck, the 31-file route inventory, 274 generated API operations, Overlay i18n and secret scanning.

The final lifecycle evidence initially exposed a browser-fixture ownership defect. Closing EventSource ended the
HTTP client but `http-fixture.ts` merely resolved its response wait and left the `Readable.fromWeb` owner alive, so
the fixture could not observe `ReadableStream.cancel()`. Destroying the Node response stream only from
`ServerResponse.close` still left the dedicated helper test waiting; binding cancellation to the request's real
`aborted` event, while retaining response close cleanup, makes an early client disconnect cancel the upstream body.
The activity-aware helper regression passes 9/9. The lifecycle test then correctly rejected attempts to click a
hidden Mailbox refresh control and a hidden no-task Right Dock toggle. Its final chronology provides a real task,
selects it through Work Ledger, opens the visible Right Dock and Mailbox through their user controls, then clicks
the visible refresh button. It proves initial offline ownership has no Mailbox/Worktree request, first reconnect
creates one Mailbox stream, disconnect cancels it, second reconnect creates exactly one replacement, and manual
refresh adds exactly one base request before re-enabling. It also counts exactly one 10-second interval registration
on the real page; the production scan shows the connection monitor is the only runtime owner that supplies that
interval, while other interval owners use 1, 4, 30 or 600 seconds. The lifecycle and Mailbox concurrency Node
browser replay passes 2/2; focused fixture/token/Work Ledger units pass 18/18.

The next complete Overlay unit replay reached `css-token-closure.test.ts` and stopped on two new Work Ledger hover
rules that referenced undefined `--ui-line-height-normal`. The full style and history scan found only the canonical
`--ui-line-height-tight` definition and no legitimate normal owner. Both description and path now use that existing
token; focused Work Ledger tests require it and negatively assert the undefined spelling. This correction is green
in the focused matrix, but independent exact-diff review, commit/push and a new complete Overlay unit replay remain
open, so the overall connection/platform delivery is not yet accepted.

Independent review ACCEPTed that lifecycle/fixture/token correction, which was committed and pushed as
`17a3a33af3`; its push hook again passed all repository checks. The next complete Overlay unit replay advanced to
`flat-redesign-important-policy.test.ts` and stopped because the same new Work Ledger summary tooltip used
`pointer-events: none !important`. Two attempted replacements were explicitly REJECTed rather than accepted. Native
`inert` removed the `role=tooltip` subtree from the accessibility tree, while positioner-only
`pointer-events: none` still let Kobalte's inline `pointer-events: auto` Content win hit testing; the latter failed
the real Node browser with `elementFromPoint` inside both tooltip and positioner. Patching Kobalte's layer stack was
also abandoned before commit because pointer transparency would violate the tooltip contract that hovering either
the trigger or Content keeps it open and would broaden the change to every dismissable layer.

The root cause is the Popper anchor geometry. The summary Trigger was the row's main button; when hover reveals the
action rail, that button becomes narrower, so `right-start` places the tooltip directly over the adjacent actions.
The existing row keyboard helper now exposes the bounding rectangle of its already-owned row ref, and Kobalte's
public `getAnchorRect` positions the same accessible Tooltip from the complete row. All tooltip/positioner
pointer-event rules are deleted. The real Node desktop replay proves Content and positioner remain `auto`, the
tooltip begins at least the configured gutter beyond the row, hovering Content keeps it open, the Trigger's
`aria-describedby` names the visible `role=tooltip` and is removed on close, `ArrowRight` moves focus into the
action rail and closes the tooltip, and the real pin PATCH persists and reorders the row. Focused policy/Work
Ledger tests pass 9/9, Overlay typecheck passes, and the browser replay passes 1/1 after a forced frozen dependency
reinstall restored unmodified Kobalte runtime code. Manual review ACCEPTs `work-ledger-row-time-tooltip.png`
SHA-256 `5f03a6ebbc483f2916fbcfbf828f2a73d5ff0bca9c3d435672decce52dc4f4832` and
`work-ledger-pin-click-result.png` SHA-256
`4cdbd6ffaec80d0d2c6ba5ac664fdeaf9da6980ffd8f5818744ae5f53949f8d3`. Independent final diff review ACCEPTed the
seven-file candidate. Commit `22225bc296` was merged with the concurrent sidecar lease-GC delivery and pushed as
merge head `6ad7cd65eb` to `myhexin/v0.0.8beta`; the pre-push repository typecheck, route inventory, generated API
documentation, Overlay internationalization and secret scan all passed. Another complete Overlay unit replay
remains open, so this push does not by itself finalize the broader platform delivery.

That complete Overlay unit replay next reached `flat-redesign-opacity-coverage.test.ts` and stopped on the
environment menu selectors added by `a7c38dcccf`: the read-only current-directory row and the Git load-error row
used literal `opacity: 1`. The shared DropdownMenu primitive intentionally dims every disabled item with
`--ui-opacity-disabled`, while these two disabled rows convey non-actionable context and diagnostics that must
remain fully readable. The local override is therefore intentional, but its literal value bypasses the existing
canonical `--ui-opacity-full` token and violates the repository-wide opacity contract. The bounded correction
must preserve the disabled interaction semantics and visual result, replace only the literal with that canonical
token, add a focused ownership assertion, replay the existing real Node menu browser evidence, obtain an
independent exact-diff review, and push before continuing the complete unit runner.

The bounded correction now uses `--ui-opacity-full`, and the token-source comment has been corrected to match
the policy test's actual rejection of every literal opacity outside the token source. The focused opacity and
environment ownership matrix passes 8/8; Overlay typecheck passes; and the real Node task-dirbar browser file
passes 15/15 while proving the Kobalte current-directory row remains `data-disabled` with computed opacity `1`.
Manual review ACCEPTs `task-dirbar-runtime-local-menu.png` SHA-256
`11fd584459005fb23a9239e7c233d02877eb5658c949599aae8220b64b459e51`: the directory context and both actions are
clear with no clipping or overlap. It also ACCEPTs `task-dirbar-runtime-branch-menu.png` SHA-256
`0ac6b2de1a610d747c7d5082cb4b753b225e6b6cabbc8fd133ffc2cf6839a03e`: the current and selectable branches retain
the intended hierarchy. Document health passes 81/81. Independent exact-diff review ACCEPTed the five-file
candidate with no fallback, alias, gate, double source or new specialization; another complete Overlay unit
replay remains mandatory after this bounded push.

Commit `02c5cb850a` pushed the accepted environment opacity correction to `myhexin/v0.0.8beta`; the pre-push
repository typecheck, route inventory, generated API documentation, Overlay internationalization and secret scan
passed. The next complete Overlay unit replay advanced to `sse-parse-error.test.ts`, where three backend-upload
assertions fail even in an isolated replay. The visible SSE dispatch diagnostics are present in `AppLog`, but the
test transport receives no `/log` request. This is not missing production diagnostic construction:
`AppLog.persist` deliberately keeps logs local while `appStore.connected` is false, the application default is
offline, and the test never establishes an online connection before asserting backend persistence. The dedicated
log-flush suite already expresses the canonical contract by setting the connection online for upload cases and
restoring offline state in teardown. The bounded correction must make the SSE upload tests declare and clean up
that same precondition, retain the zero-upload offline production behavior, replay the focused SSE/log matrices,
obtain independent exact-diff review, and push before resuming the complete unit suite. Increasing the waits or
making offline logging upload would hide the missing precondition and is explicitly rejected.

The all-caller replay found the same missing precondition in one neighboring assertion:
`sse-reconnect.test.ts` passes 20/21 in isolation, and its sole failure is the reconnect case that explicitly
expects an uploaded `overlay:sse` log without setting the connection online. That case belongs in the same
bounded correction; its other diagnostic-only cases must remain independent of upload state. The scan also found
that `waitForLogDrain` and the reconnect test's `waitForUploadedLogs` use fixed wall-clock deadlines and return
silently when work remains. This violates the required activity-aware timeout contract and can leak queued logs
between tests, but it is not the trigger for the zero-request failures because the offline `persist` branch never
queues work. It is recorded as the next independent helper slice rather than being mixed into this precondition
correction.

The connection preconditions are now explicit only in the four upload-asserting cases, and both files restore
offline state after draining while leaving their local-diagnostic cases offline. The SSE parse, reconnect and
log-flush matrix passes 30/30 with 114 assertions; Overlay typecheck passes; document health passes 81/81; and
`git diff --check` is clean. Independent exact-diff review ACCEPTed the three-file candidate and independently
replayed the same 30/30 matrix. This acceptance is limited to test connection ownership: the activity-aware log
drain correction remains the next mandatory slice, and the complete Overlay unit suite remains open.

Commit `8965222fc8` pushed the accepted SSE upload-precondition correction to `myhexin/v0.0.8beta`; its pre-push
repository checks passed. The mandatory adjacent audit enumerated every `waitForLogDrain` caller: the sole
production caller is `main.tsx` in `initApp` finalization, and the three test families are
`log-flush-diagnostic.test.ts`, `sse-parse-error.test.ts` and `sse-reconnect.test.ts`. The helper currently
measures from invocation, silently returns while timer/queue/in-flight work remains, and exposes no evidence that
teardown may replace the transport safely. The reconnect file adds a second fixed-deadline polling helper that
can wait 2.5 seconds even when no log was ever queued. The single correction is an activity-aware drain: enqueue,
timer execution, request settlement, retry scheduling and in-flight transitions advance one monotonic activity
revision; while work remains, observed activity renews the inactivity window, and no activity produces an
explicit error containing the pending queue snapshot. Invalid inactivity durations must fail immediately. The
reconnect upload assertion will wait on that drain directly, and the diagnostic-only case will not wait for an
upload it does not require. The production caller remains in place: inactivity rejection follows its existing
explicit `console.error` path before init is marked settled instead of silently hiding pending logs. Focused tests
must prove immediate empty/offline drain, retry activity that carries the total drain beyond one inactivity
window, explicit stalled-request failure, subsequent release and clean drain, and every existing SSE/log caller
before independent review and push. No queue clearing, timeout extension, silent result or second polling helper
is permitted.

The first independent exact-diff review REJECTed one teardown fallback missed by the initial plan:
`log-flush-diagnostic.test.ts` replaced the test's transport with an always-successful transport before draining.
That lets a retry created by the test finish under a different owner and can hide the original transport failure.
The teardown must instead drain the original transport first and only then release the transport, clear local
entries and restore offline state. The other SSE teardowns already preserve that ownership order. This REJECT is
binding before acceptance.

The teardown fallback is removed, and the final helper has one pending predicate (`timer || queue || inFlight`)
plus one monotonic activity revision covering enqueue, timer fire, batch/request start, settlement, retry and
final in-flight release. Pending work without revision movement now rejects with its queue snapshot; the stalled
request regression proves that failure and then releases the same request before a successful drain. The existing
failure/retry case uses a 750-millisecond inactivity window while the complete successful retry chain runs for
about one second, proving that activity renews the window. The secondary reconnect polling helper is deleted and
its diagnostic-only case no longer waits for an upload. Focused log/SSE coverage passes 32/32 with 117 assertions,
Overlay typecheck passes, and independent exact-diff review ACCEPTed after independently replaying the same
32/32 matrix. Another complete Overlay unit replay remains mandatory after this push.

Commit `2406ac3a56` pushed the accepted activity-aware drain correction. The next complete Overlay unit replay
advanced to `work-details-muted-label.test.ts`, whose only assertion requires the work-details label itself to
own `color: var(--text-muted)`. The complete call-point and history audit proves this file is a stale duplicate
oracle introduced by `afb457319bf`: the later `3e923cf359` disclosure refactor makes the shared
`text-disclosure` Button primitive the color owner (muted at rest and soft on hover/focus) and requires the child
label to inherit that state. `message-embed.test.ts` binds the complete source contract, while the real Node
`message-part-chronology-browser.test.ts` and `chat-bubble-disclosure-button-browser.test.ts` both assert that the
computed label color follows the Button across interaction state. The standalone test has no unique requirement
or consumer and directly contradicts those stronger sources. It must be deleted rather than rewritten into a
second identical oracle; production CSS and browser behavior remain unchanged. Focused replacement coverage,
independent exact-tree review and another complete unit replay remain required.

The stale standalone oracle is now deleted. The retained `message-embed` and Button primitive matrix passes 8/8
with 73 assertions, document health passes 21/21, and the real Node message-chronology browser replay passes 1/1
while exercising the inherited rest/hover label color. Independent read-only exact-tree review ACCEPTed the
deletion after enumerating the sole DOM emitter, every collapse caller and both browser consumers; no production
CSS or rendered pixels changed. Another complete Overlay unit replay remains mandatory after this bounded push.

Commit `49d489d19f` pushed the stale-oracle deletion. A fresh complete `bun run test:unit` replay from
`packages/overlay` then passed with exit code 0 in about 121 seconds, including the connection, recovery, SSE,
log-drain, disclosure, Work Ledger and workspace families that had formed the successive first-failure boundary.
The first attempted replay is intentionally excluded from evidence because an erroneous outer 10-second
PowerShell wall-clock timeout terminated it before the repository inactivity-aware runner could own timeout
semantics; the successful replay used no such outer deadline. Overlay's complete unit matrix is now closed for
this tree. The broader concurrency, cancellation, cache, package-isolation, generated-freshness and residue
verification remains open and is not implied by this result.

Commit `ec13dfc570` recorded that Overlay unit result, then merge commit `03db7cc5fb` incorporated three concurrent
remote slices: terminal-tool scoping retirement, Overlay conversation/Goal density repair and generated native
artifact removal. The merge and push hooks passed. Merge-head focused source replay passes 162/162 for the Overlay
slice, 128/128 for the terminal-tool slice and 79/79 for residue/docs. The first concurrent Node browser replay
timed out once while build and two large Bun matrices were also running; its Goal and Work Ledger cases passed,
and the Conversation Agent Rail case then passed 1/1 in an isolated 5.8-second replay. The timeout's cause is
unproven and the failure is not reproducible, so it is retained as evidence without inventing a product patch.

Independent review found a deterministic false-green in `repository-intermediate-residue.test.ts`. Both the
existing Web QA screenshot assertion and the newly added Overlay installer assertion filtered `git ls-files`
results through filesystem existence before asserting an empty list. A path deleted from the working tree but
still tracked in the Git index would therefore be hidden. Both generated roots must use one strict helper that
asserts the unfiltered Git index result is empty; current `git ls-files` output is already empty for the Overlay
root and its ignore rule resolves correctly. Focused residue/docs replay, exact-diff review and push remain
required. The same independent review also found three terminal-readiness helpers with only test callers; that
dead-code cleanup remains a separate next slice and is not closed here.

Both generated-root assertions now use the single strict `trackedFiles(pathspec)` helper and no longer inspect
working-tree existence. The inactivity-runner residue and document matrix passes 83/83 with 1,286 assertions;
`git diff --check` passes. Independent exact-diff review ACCEPTed the helper and confirmed both current pathspecs
have empty Git-index results and exact ignore-rule ownership, with no fallback or second predicate. The
terminal-readiness dead-code slice and all broader Cleanup Order items remain open after this push.

The terminal-scoping follow-up call-point audit found five, not three, dead readiness exports. Architect exposes
both a standalone `isArchitectReadyToFinalize` function and a kit `isReadyToFinalize` property, Goal Workload
Analyst exposes `isReadyToFinalize`, Research exposes `isReadyToSubmit`, and Visual QA exposes an always-true
`isReadyToFinalize`; none has a production caller after `ce8c042aa9`, and only three kit properties are called by
tests. Architect and Goal Workload Analyst also retain comments that explicitly describe the deleted terminal
predicate, while one Architect test still names readiness despite exercising submit. All five exports and the
stale wording must be removed. Validation behavior remains owned by the real submit tools, collector finalization
and public Architect findings; Research's focused readiness assertions must move to the real
`inspect_research_result_status` tool so coverage is preserved without a tests-only API. The four output-tool
suites, the terminal/runner matrix, dead-code scan, residue scan, typecheck, independent exact-diff review and
push remain required.

All five readiness exports and stale wording are now removed. Research's tests use the real status-inspection
tool, while the other deleted assertions remain covered by submit results, collector terminal state and public
Architect findings. The complete 15-file output-tool/terminal/runner matrix passes 244/244 with 1,347 assertions
through the inactivity runner with Bun elapsed timeout disabled. OpenCorvus typecheck, the production dead-code
scan, `git diff --check`, and the exact readiness/terminal wording residue scan pass; document health passes
77/77 with 1,257 assertions. Independent exact-diff review ACCEPTed after enumerating every former assertion and
its behavioral replacement, with no fallback, host gate or second validation source. The separate Work Ledger
archive-icon browser-fixture false-green and broader Cleanup Order remain open after this push.

Independent review of the concurrent Overlay density slice found its Work Ledger geometry fixture asserted the
wrong icon. Production `WorkLedger.tsx` renders the shared `<Icon name="archive" size="compact" />`, but
`hover-action-geometry.test.ts` hand-authored a Trash/delete SVG and asserted `data-icon="delete"`. The fixture
therefore proved action-rail geometry but could not support its claimed archive/shared-Icon alignment. The
correction must replace that opposite markup with the current Lucide Archive/`oc-icon` structure and, to avoid
self-proving fixture strings, extend the existing real-app `archive-lifecycle-browser.test.ts` to assert the
rendered WorkLedger button uses `lucide-archive`, `data-oc-icon` and the compact tier. Both Node browser tests,
focused Work Ledger source contracts, screenshots with manual review, independent exact-diff review and push
remain required; production UI code is unchanged.

The first real-app replay reached and passed the new archive-icon assertions but failed final browser diagnostics:
the fixture had no handlers for the current mailbox list and stream requests, and `/config` reported a 404 even
though the fixture already owns an exact GET handler. The missing mailbox ownership must use the canonical empty
mailbox and event-stream fixtures. Because an exact GET cannot fall through that handler, the config error signals
a different request method; archive lifecycle must not mutate project configuration, so the fixture must assert
that its complete `/config` request set is exactly one GET instead of accepting another method. The next replay
must expose that method deterministically if it remains and drive the root-cause investigation.

That interim inference was wrong and is corrected by the complete call path plus independent read-only audit:
`loadInitialData` intentionally PATCHes `{ locale: settingsStore.locale }` before its parallel config GET and
other project loads. The fixture recorded the PATCH as a generic mutation, had no PATCH handler, and therefore
returned the observed 404; its old `mutations.length === 0` archive wait was also already satisfied by that
startup write. The fixture must keep one config object, accept only the exact initial `{ locale: "en-US" }`
patch, merge it into that object, return the same object from GET, and wait specifically for the active Task's
archive PATCH. Its final request oracle must prove PATCH precedes GET. This is a fixture-contract correction,
not authorization for archive UI actions to write config.

The corrected real Node browser pair passes 2/2. The retained Work Ledger source-contract matrix passes 13/13
with 333 assertions, Overlay typecheck passes, `git diff --check` passes, and the obsolete delete-icon residue
scan is empty. Manual visual review ACCEPTs `work-ledger-archive-action.png` SHA-256
`6926c8daa70fc032cfd005ab4abe9efc89e39190b53b5079a407b475156e58b6`: the real compact Archive action remains
inside its row rail with no title or status overlap. It ACCEPTs `archive-settings-lifecycle.png` SHA-256
`820db16eb90be9f629b35d730e52392defa3526c93809c81836dfa96ee827240`: the three archived rows, Restore actions
and destructive controls are aligned and unclipped. The focused geometry screenshots also remain visually clean:
`work-ledger-action-geometry.png` SHA-256 `dbd9f58ae2a5ed0929343949455b349daff5df9e82f92661aa945a4719999dd2`
and `work-ledger-action-rail-alignment.png` SHA-256
`32c1f3da465e3ff248e709211dda97ce856ad2900a3f645cc7aa353486b1e4f1`. Final independent exact-diff review and
document-health replay remain required before the bounded push.

Document health and historical-link coverage passes 77/77 with 1,257 assertions. Independent final exact-diff
review ACCEPTed the corrected config PATCH/GET ownership and order, target-specific archive wait, canonical GET
mailbox fixtures, non-self-referential icon assertions and real production Icon-chain binding. It found no
fallback, wildcard method, error allowlist, gate, compatibility alias, second configuration source or production
specialization. This bounded false-green correction is ready to push; the broader Cleanup Order remains open.

Cleanup Order item 4 began with a fresh qualified call-point scan. An initial broad `createInstance()` grep
incorrectly classified `scheduler/index.ts` as an `ExecutorRegistry.createInstance` caller; that function is a
Scheduler-local project-instance constructor and has no Executor import. The corrected search for
`ExecutorRegistry.createInstance` and `ExecutorRegistry.list` returns no source, script or test caller. The live
registry consumers in Build, Task API, execution abort, executor routes and tests use `registerCoding`,
`requireCoding`, `register`, `require`, `has` and `reset`; those APIs and the provider registry remain in this
slice. `executor/codex.ts` and `executor/claude-code.ts` are imported only by `request-mapping.test.ts`, five
managed-runtime fixtures and one Claude request-boundary assertion in `runtime-env.test.ts`. The unreferenced
`executor/index.ts` barrel only re-exports the executor directory and has no package consumer. No package export
maps these files individually beyond the generic source wildcard.

The bounded removal must therefore delete the two unused provider implementations, the unused barrel, the
provider-specific request-mapping suite, the zero-caller registry `createInstance`/`list` methods and the
implicit `OpencorvusExecutor` return in private `get` after the registry map misses. `managed.test.ts` must use
one explicit generic `CodingProvider` fixture so it continues to prove option forwarding, completion, abort and
planning behavior without making a dead vendor mapper look live; tool forwarding must assert the canonical
`CodingToolInfo` shape rather than the deleted OpenAI Responses conversion. `runtime-env.test.ts` retains the
live environment and Claude Agent SDK checks but drops the dead ClaudeCode request-mapper assertion. A document
health regression must bind the deleted files/tests, absent registry symbols and generic managed fixture.
Codex app-server/client/CLI, Claude Agent SDK, bootstrap, discovery, managed adapter, protocol, public routes and
generated surfaces remain until Cleanup Order item 12 removes the external Executor chain atomically.

Adjacent audit also reconfirmed existing catch-and-continue paths in `managed.ts` for snapshot/session-ref
persistence and provider interrupt. They are not caused by the dead providers and are recorded for the later
external Executor ownership slice; changing their lifecycle semantics inside this deletion would mix behavior
with dead-code removal and invalidate bounded review.

Independent call-point review corrected one omitted item from that boundary: `createTaskInner` swallowed
`ExecutorBootstrap.autoRegister(true)` rejection before `ExecutorRegistry.require` replaced it with a secondary
not-configured error. The Cleanup Order explicitly requires the bootstrap cause to propagate, so this catch is
part of item 4 rather than the later full external Executor removal. The correction removes the catch and adds a
Task API regression that rejects with the exact bootstrap Error object and proves no Engine Task row is written.
The unrelated managed snapshot/session-ref/interrupt catches remain recorded for item 12.

The first independent exact-diff review REJECTed a current-architecture double source: `04-extensions.md` still
listed the deleted `codex.ts` and `claude-code.ts` as current implementations and assigned `autoRegister` to
`ExecutorRegistry` instead of `ExecutorBootstrap`. The bounded correction removes only those dead mapper cells,
keeps the live Codex CLI/app-server and Claude Agent SDK entries, and assigns registry methods to their actual
owner. Document health now rejects both retired filenames and the false method owner in current architecture.

The first focused external-executor matrix passes 93/93 with 1,312 assertions, including the exact bootstrap
Error/no-Task-row regression. OpenCorvus typecheck and production Knip pass. A concurrent full
`managed-worktree-runtime.test.ts` replay passed its first 24 cases, then the repository inactivity runner stopped
the command after 120 seconds without stdout/stderr activity. This is a real incomplete test result, not a pass;
no product failure was emitted and the timeout occurred beyond the item-4 managed adapter cases already covered
by the focused matrix. It remains recorded for final verification rather than being hidden or converted into a
wall-clock timeout exception.

After the architecture correction, the executor/runtime/docs matrix passes 114/114 with 1,387 assertions. Three
direct BuildAgent external-runtime cases pass 3/3 with 47 assertions, proving distinct runtime/worktree paths,
exact dynamic projected identity persistence and one package-tool callback. Dynamic resolver, runner base-template
and executor-route coverage passes 42/42 with 229 assertions. The exact source-symbol residue scan is empty and
`git diff --check` passes. Independent final exact-diff review ACCEPTed the deletion boundary, strict registry
lookup, original bootstrap Error propagation with zero Task rows, generic managed test provider, current
architecture ownership and unchanged dynamic-agent projection path. It found no known blocker; the incomplete
full-file replay remains explicit evidence for final verification, not an item-4 rejection.

The final audit also found a structural risk for Cleanup Order item 12: dynamic workers do not execute through
the broad `OpencorvusExecutor` submit/status/resume/acceptance/events surface. Current production registry use is
concentrated in lifecycle abort and the frozen external-protocol resolve path, while dynamic execution goes
through `PromptProfileResolver`, runtime templates, dispatch adapters and `agent/runner.ts`. The later atomic
Executor removal must narrow the surviving internal contract to the proven lifecycle/cancellation call surface
instead of mechanically preserving a wide adapter with no consumers.

Cleanup Order item 5 starts from an exhaustive qualified call-point scan. `ToolRegistry.tools` has nine current
non-record call sites: the sole production caller is the agentless `/experimental/tool` introspection route;
`tool/registry.test.ts` has one agentless package-isolation assertion; `provider/schema-stress.test.ts` has two
agentless calls that currently place batch config in the third parameter through an explicit `undefined`; and
the remaining five calls pass Native agent definitions in `orchestrator/wait-tool.test.ts` and the two
`web-clone-*` suites. Those five fixed-host assertions must convert the definition to a frozen
`SessionAgentRuntime` and call `runtimeTools` with the exact fixed identity. The schema assertions must move config
to the new second parameter. `ToolRegistry.tools` then becomes agentless core-registry materialization, deletes
its `NativeAgentInfo` and `sessionRuntimeFromNativeAgent` imports, and retains optional config only for exact
provider introspection. The real route test in `server/overlay-contract.test.ts` remains the authoritative proof
that core introspection does not scan active or inactive package tools.

The full `runtimeTools` call scan found a second old-test semantic adjacent to that API removal: six suites pass
`projectedRuntimeFixture(...)` to the fixed/native materializer (`agent/context-tools`, Integrity preview,
Orchestrator wait, browser preview and both web-clone suites). Production projected workers never do this:
SessionLoop and external Build execution use `projectedWorkerTools` with the resolved dynamic agent ID, runtime
template ID and exact final built-in IDs. Every test that claims a projected worker surface must therefore use
that same projected materializer; direct runtime-template seed tests may derive the requested IDs from the
template fixture, but must still pass them explicitly through projected closure. Fixed mission, orchestrator,
coding and chat identities remain `runtimeTools` callers. No package/default/MCP or Skill provider may be moved
into the flat registry as compensation.

Two independent read-only audits agree on this boundary and independently found two adjacent debts. First,
`AgentToolPool.privateRegistryTools` owns a loader table with no registration entry anywhere in the repository,
so it is permanently empty and its append inside `materialize` is dead abstraction; this can be deleted in the
5a exact-projection cleanup because retained fixed/private visibility is already expressed by the one tool-pool
assignment and core-provider filtering. Second, and more importantly, a resolved projected runtime still carries
the broad base-template `runtime.tools` into `Tool.init` even when final `builtInToolIDs` exclude `read`.
`Truncate.hasRecoveryPath` can consequently promise file recovery through an unavailable read tool. This is an
existing hidden fallback, not a consequence of deleting the Native entry, and is the immediate independent 5b
behavior slice: materialization must expose the exact final projected tool pool to initialization/recovery, with
regressions for `inherit_base_tools: false`, explicit read projection and permission denial. It must not be
silently folded into 5a or deferred beyond item 5.

Item 5a acceptance is the focused registry, fixed wait, context-tool, preview, web-clone, schema-stress,
experimental-route and runtime-contract matrix through the inactivity runner; OpenCorvus typecheck; production
Knip; exact residue scans for the Native signature/conversion and projected-fixture `runtimeTools` calls;
`git diff --check`; then independent exact-diff review. The bounded slice is committed and pushed regardless of
test outcome, with every failure retained here. Item 5b begins only after that push.

The first 5a focused replay was invalid because an erroneous outer ten-second shell timeout stopped the command
before the inactivity runner could own timeout semantics. The corrected replay ran 108 tests and passed 106. One
failure was an intermittent Windows process-supervisor readiness exit while a browser-preview test's Git-backed
temporary project initialized after many prior helper processes; it emitted no product assertion failure and
must be isolated before classification, consistent with the operator's instruction not to spend the project on
non-reproducible Windows resource behavior. The other failure exposed a deterministic stale fixture:
`tool/registry.test.ts` configured `../legacy-tool-plugin.ts`, while the current strict Plugin protocol treats
every non-`file://` specifier as a package to install. The fixture therefore failed before its core-registry
isolation assertion. It must use `pathToFileURL` for its exact temporary module, matching every current strict
local-plugin fixture, without adding relative-path compatibility to production. Both failed cases and the full
focused matrix must be replayed after this fixture correction.

An attempted parallel isolation replay produced transient SessionLoop/SendMailbox initialization errors, so the
tests were immediately switched back to serial execution. Serial `tool/registry.test.ts` reproduced the same
errors deterministically, proving a real import-order defect rather than a parallel-runner artifact. The strict
control-plane provider is configured correctly by test preload, but its request-decision and mailbox loaders
import tools that top-level import the `SessionPrompt` facade. That facade immediately destructures
`SessionLoop`, while SessionLoop itself imports the ToolRegistry that is currently materializing those tools.
Full matrices happened to pre-initialize the facade and hid this cycle; isolated registry execution exposed it.
The bounded root correction makes both control-plane tools import their actual runtime-contract owner
`SessionLoop` directly and call validation only during tool execution. A dependency-boundary regression rejects
future reintroduction of the prompt-facade edge. The dedicated request-decision/mailbox suites, isolated registry
suite and full focused matrix must all pass before review; no eager preload, alternate loader or retry is allowed.

Independent exact-diff review REJECTed that first cycle correction. Although direct `SessionLoop` imports avoid
the facade's eager destructuring, they still create Tool -> 2800-line SessionLoop -> ToolRegistry -> Tool reverse
dependencies and rely on dynamic loader timing to avoid the original cycle; the new boundary assertion would
have frozen that inversion. The review requires one narrow `session/runtime-contract-validation` owner with no
ToolRegistry or SessionLoop dependency. The existing validator moves there unchanged, SessionLoop re-exports the
same function so all current callers retain one implementation, and the two control-plane tools depend directly
on the narrow owner. The boundary test must reject imports of both `session/loop` and `session/prompt` from those
tools. This REJECT is binding; all prior green evidence must be replayed after the corrected dependency graph.

The REJECT correction is complete. `runtime-contract-validation.ts` now owns the sole validator and runtime-kind
predicate implementation; SessionLoop exposes const references to those exact functions, while the request and
mailbox tools import only the narrow module. The boundary regression requires that module and rejects both loop
and prompt-facade imports. Isolated registry/dependency/request/mailbox coverage passes 34/34 with 138 assertions;
OpenCorvus typecheck and production Knip pass; `git diff --check` and the exact Native/private-loader/projected-
fixture residue scans are clean. Independent final review ACCEPTed the dependency graph and independently ran
the runtime-contract/extra-tools deep branches 53/53 with 248 assertions.

The final 13-file focused replay passes 134/135 with 1,180 assertions. Its sole failure is another Windows helper
readiness exit while a Git-backed browser-preview fixture initializes after the long process-heavy matrix; the
specific test changed from the previous long replay and passed 1/1 immediately in isolation. No product
assertion failed, and the operator explicitly excluded Windows-specific memory/resource management work, so this
non-deterministic helper exhaustion remains recorded rather than receiving a retry, fallback or product patch.
The prior two specific helper failures also passed in isolation. Item 5a is accepted with that explicit platform
test limitation and must now be committed/pushed before the separate 5b exact projected recovery-surface fix.

## Item 5b recall: exact execution tool surface

The 5b call-point audit used `rg -uuu` because the repository ignore rules hide `src/build/agent.ts` from an
ordinary search. `ToolRegistry.projectedWorkerTools` has two production callers (`session/loop.ts` and
`build/agent.ts`), one fixture caller, one runtime-contract caller and three registry-test callers. Every call
must move together. The complete `Truncate.output` production surface is `tool/tool.ts`, the SessionLoop MCP
wrapper and three package/default-MCP wrappers in `prompt-profile-resolver.ts`; the latter wrappers currently
provide no recovery runtime and therefore fail explicitly rather than promise an unavailable recovery path.

Two independent read-only audits confirmed the root chain. `sessionRuntimeFromProjectedTemplate` correctly
retains the base-role template seed, while `projectedWorkerTools` correctly filters the providers returned to a
dynamic identity. The defect is that every `Tool.init` still receives the broad template runtime and
`Tool.define` closes over it for later truncation. Session permission, turn tool switches and the LLM permission
filter can shrink the real executable set further. Batch is also constructed before that later filtering, so it
can retain denied providers in its internal schema and closure. Finally, `Truncate` evaluates `read` against
`"*"`, even though the actual recovery read is authorized against the saved output filepath.

The first bounded correction is intentionally an execution-boundary replacement, not a second projection
oracle. `Tool.Context` gains one required execution surface containing the final callable tool names and the
effective runtime/session permission rules. `Tool.define` and the SessionLoop MCP wrapper pass that surface to
`Truncate`; `Tool.InitContext.agent` is deleted so no initialized tool can retain the base-role runtime as an
execution identity. `Truncate` first rejects a missing `read`, then resolves the real task-scoped output path and
rejects a path-specific deny before writing. `projectedWorkerTools` receives the session permission and turn
switches explicitly, validates the full capability declaration first, filters global denies/switches before
provider and batch construction, and returns both materialized providers and the frozen visible built-in ID
set. The runtime contract continues to store the complete capability IDs; session policy never rewrites the
manifest projection fact. Fixed `runtimeTools` keeps its existing visibility behavior.

SessionLoop will read the live final `tools` object when a tool executes, after its own filtering and the LLM's
agent/user filtering have mutated that same object. External Build will bind its context to the final projected
and stage tool maps and use the same merged permission rules. Skill exposure will use the registry-returned
visible set instead of independently repeating the projected-worker session permission/switch predicate.

Acceptance for 5b.1 is deterministic registry/Truncate/runtime-contract/external-projection coverage for: no
projected read, explicit read, runtime allow overridden by session deny, turn-switch deny, exact-path deny with
no file write, ask/allow recovery, batch schema exclusion and all-target batch removal; fixed runtime regression;
typecheck; exact residue scans; `git diff --check`; and independent exact-diff review. The package/default-MCP
wrappers and fixed/static direct adapters still lack a finalized execution-surface owner and remain explicit
5b.2 work after this push. They must not be called complete by 5b.1 evidence.

The first 5b.1 registry/Truncate/runtime-contract replay passed 46/46 after one test correction: the synthetic
`Tool.define` output initially contained only 100 lines and therefore never crossed the production truncation
threshold; the corrected 2,100-line result exercises the intended branch. The next eight-file replay passed
65/70. All five failures were deterministic pre-existing Windows fixture debt in
`external-directory.test.ts`: the suite hard-coded `/tmp` and `/tmp/project`, which the current strict Windows
path contract correctly rejects. The tests now use repository `tmpdir()` fixtures and real sibling paths; the
isolated suite passes 5/5 and the corrected eight-file replay passes 71/71. No production path compatibility was
added.

Independent exact-diff review then REJECTed a real permission bypass. SessionLoop filtered projected registry
providers first, but runtime-contract projected/stage tools were merged afterward and could restore the same
globally denied ID. The final LLM filter owns agent permission only, so session permission did not remove that
restored provider; the execution surface would consequently advertise it as callable. External Build already
filtered after its final merge, so the two execution paths also disagreed. The correction adds one generic
`applyToolExecutionPolicy` next to the execution-surface visibility predicate. SessionLoop applies it once after
all registry, MCP, projected and stage tools are merged, with the merged runtime/session permission and exact
turn switches. External Build calls the same function after its projected/stage merge. Registry still applies
the same predicate before batch construction because a later filter cannot remove denied providers from the
batch schema or captured target closures.

Regression coverage now supplies a projected built-in override and a private stage tool, denies both through
session permission and proves neither survives the final SessionLoop surface. An ordinary MCP provider is also
globally denied through the same final filter. The corrected extra/runtime/registry/Truncate matrix passes 87/87
with 340 assertions. OpenCorvus typecheck, production Knip and `git diff --check` pass after the REJECT fix. The
prior document-health/historical-link replay passed 78/78 with 1,273 assertions; it must be replayed after this
record update. Two attempts to reuse the first reviewer after its REJECT failed because the selected model was
at capacity; a fresh independent reviewer is running against the final tree. Capacity failures are not review
acceptance and are retained here rather than called green.

The direct recovery regression initially invoked the real ReadTool after leaving `Instance.provide`, so it failed
because the task-scoped project instance no longer existed. The test now performs the real recovery read inside
the owning project instance and proves the emitted path can be consumed by the actual provider; the isolated
Truncate suite then passed 22/22. This was a test-scope defect, not a production fallback.

A second independent review REJECTed the first final-policy correction because batch captured registry providers
before projected and private-stage overrides were merged. An allowed projected provider with the same name as a
registry provider could therefore be callable directly while batch retained the stale registry closure. Batch
remains intentionally registry-only: projected/default/package/MCP and private-stage providers are not added to
its closure. Both execution callers now pass the IDs they will override as explicit registry batch-target
exclusions, and projected materialization removes batch when no registry target remains. The registry regression
proves `read` is still returned at top level while a batch call targeting it is rejected; the SessionLoop
integration proves the later projected `read` override remains top level and is likewise rejected by batch.

The first SessionLoop integration assertion searched every JSON Schema `const` value for `read` and produced a
false failure: unrelated registry tools legitimately use `read` as an operation discriminator in their own
parameter schemas. It was replaced with the real behavioral assertion that parses a batch call targeting
`read`. The final four-file 5b.1 matrix passes 89/89 with 349 assertions, including exact projected overrides,
permission and switch filtering, batch closure/all-target removal, Truncate recovery, and runtime-contract
surfaces. The early return for an empty batch target list was also removed so projected materialization always
reaches its exact-provider consistency check.

The first replay of all eleven directly modified test suites passed 184/187 and exposed three deterministic
stale Bash truncation fixtures. Their task contexts advertised no execution tools while still expecting large
output to be saved and recoverable. Production correctly rejected those calls. The task fixture now declares
the exact `bash` and `read` execution surface; the four Bash truncation cases pass 4/4. The broader replay also
ran for 228 seconds because the conversation-route suite is process-heavy, but it continued emitting activity
and therefore exercised the required inactivity-based timeout semantics rather than a wall-clock cutoff.

Independent final review ACCEPTed 5b.1 after verifying the corrected registry batch closure, both execution
callers, final permission/switch policy, exact materialization, execution-time Truncate surface and explicit
5b.2 deferral. Its own focused replay passed 88/89; the sole Windows `git ls-files failed` helper case passed 1/1
in immediate isolation and emitted no product assertion failure. The reviewer records the missing dedicated
External Build allowed-override batch integration as non-blocking residual coverage for 5b.2; production Build
uses the same exclusion protocol and common final policy already covered by Registry and SessionLoop tests.

## Item 5b.2 recall: projected and direct-adapter recovery ownership

### Recall

- The user requires the platform runtime to remain generic: dynamic projected identity is the execution identity,
  base roles are template seeds only, and expert-squad package/default-MCP providers must use the same protocol as
  every other projected provider. No package-specific core rule, fallback, compatibility path, gate or second
  projection source is permitted.
- 5b.1 deliberately left three `Truncate.output` wrappers in `prompt-profile-resolver.ts` without a surface:
  package tools, package MCP tools and default MCP tools. Their current small outputs work, but any large result
  fails because recovery ownership is unknown. The SessionLoop ordinary-MCP wrapper and every `Tool.define`
  provider already consume the execution-time `Tool.Context.executionSurface` and are not alternate owners.
- The exhaustive `rg -uuu` call scan finds exactly five production `Truncate.output` call sites: the three
  projected wrappers above, SessionLoop MCP and `Tool.define`. The projected wrapper constructors have six
  materialization callers: scheduler/worker package tools, scheduler/worker package MCP tools, and the shared
  default-MCP materializer used by scheduler and worker projection. Prompts and resources do not truncate and
  are outside this behavior slice.
- Projected wrappers execute only after `resolveProjectedTaskToolExecutionScope` validates the persisted task,
  project, session, message, running part, projected identity, descriptor, runtime binding and current
  invocation authority. The two production authorities are SessionLoop `wrapExtraTool` and External Build
  `ExternalProjectedToolLedger.execute`; the only direct test authority is
  `test/fixture/projected-package-tool.ts`. These three `withTaskToolInvocation` callers must move together.
- Passing a surface in AI-SDK `options.opencorvus`, or rebuilding one from `SessionRuntimeContract`, is rejected.
  Options are transport metadata rather than the authority source, and the runtime contract stores capability
  projection facts rather than the final session permission/switch-filtered executable set. Either design would
  create a forgeable or second projection source.
- The minimal owner is the existing task-tool invocation `AsyncLocalStorage`: its trusted execution owner binds
  the immutable `ToolExecutionSurface` alongside identity and authority. Scope resolution returns that exact
  surface after the existing authority/identity checks. SessionLoop creates it from its live final `tools` map
  and merged runtime/session permission. External Build creates it after projected/stage materialization from
  the final tool IDs and `registryProjection.permission`, stores it in the shared ledger closure and reuses it
  for resumed callbacks. The test fixture must provide an explicit surface; no default is allowed.
- Each of the three projected wrappers passes `scope.executionSurface` to Truncate. Acceptance covers large
  package/default-MCP output with projected read, missing read rejection without a recovery file, path-specific
  deny before write, SessionLoop and External Build surface binding, exact authority lifetime, typecheck,
  production Knip, residue scans, document health, independent review, commit and push.
- The separate fixed/static `createAiSdkToolFromInfo` path currently advertises only the invoked tool, while
  `MCPServe.executeLocal` advertises one local tool. Their complete toolkit owner requires a separate 5b.2
  sub-slice after the projected-wrapper push; it must not be called complete by projected package evidence.

The 5b.2a implementation follows that boundary. `withTaskToolInvocation` now requires the immutable surface as
a separate argument and stores it beside, not inside, identity. `currentTaskToolInvocationSurface` returns it
only after authority, lifetime and every identity field match. Scope resolution carries the result; no options
metadata, runtime contract, capability or base-role lookup supplies execution policy. SessionLoop passes a
callback that reads the live final tool map at invocation time. External Build constructs one surface only after
the final projected/stage maps exist and stores it in the shared ledger closure used by fresh and resumed calls.
The three Resolver wrappers consume only `scope.executionSurface`.

The first generated large package-tool fixture failed compilation because its description property omitted an
object-literal comma. After correcting the fixture, both tests initially failed again because the fixture passed
an optional template permission as though it were a required ruleset; it now explicitly supplies the empty
ruleset when the template declares none. These were test-construction failures before or outside product
behavior, and no production fallback was added.

Behavior coverage now proves all three projected wrapper kinds. Package tool, default MCP tool and package MCP
tool each save a 2,101-line result only when the exact projected invocation surface contains `read`; each rejects
the same large result before creating its output directory when `read` is absent. Package tool additionally
rejects a `*tool-output*` path-specific read deny before writing. The External ledger test proves its callback
authority returns the exact final frozen IDs and permission object. Replay, rematerialized closure, SessionLoop,
TaskArtifact and plugin-host coverage passes in a 108/108 matrix with 439 assertions. An earlier combined replay
passed the first 24 managed-worktree cases and then ended at the inactivity runner's 120-second no-output limit;
the three pre-existing ledger cases and the new exact-surface case pass directly, with no product assertion
failure emitted by the incomplete full-file replay.

Independent review REJECTed that evidence for three concrete reasons. First, the invocation boundary retained
the caller's surface object rather than taking its own immutable snapshot. Second, the SessionLoop callback
factory had no behavioral proof that it observes the final tool map after permission and switch filtering.
Third, the External assertion manually constructed a ledger, so it did not exercise
`materializeExternalProjectedWorkerTools`, its final projected/stage maps or its batch exclusions. The review
also required the earlier allowed-override/batch concern to be covered through a real execution owner. This
REJECT is binding and supersedes the earlier 108-test evidence as acceptance for 5b.2a.

The corrections keep one owner rather than adding metadata or reconstruction. `withTaskToolInvocation`
recreates the supplied surface at the AsyncLocalStorage boundary, so later mutations of caller arrays or rule
objects cannot alter current authority. A dedicated unit test proves the snapshot, nested freeze and authority
expiry. The SessionLoop stage-tool integration now executes a real callback and observes that its surface keeps
the stage terminal tool while excluding a switch-disabled `read` and permission-denied `bash`, with the merged
deny rule retained.

The manual External surface test is replaced by a real external Build run. Its test package declares
`inherit_base_tools: false` and exactly `batch`, `read` and `bash`; the materialized provider surface contains
those tools, the package tool and `report_build_result`, with the terminal tool isolated in the stage map. An
Ajv JSON Schema validator proves the real batch schema accepts `read` while rejecting the stage terminal tool,
and the package callback emits 2,101 lines that are recovered through the invocation surface before the real
terminal callback completes. The first assertion incorrectly left base-tool inheritance enabled and therefore
received the full Build template seed; the corrected fixture explicitly disables inheritance, which is the
semantic under test. The next attempt incorrectly treated the AI SDK input schema as a Zod object; validation
now uses its public JSON Schema through Ajv. Neither correction changed production behavior.

After these corrections the six-file projected-wrapper matrix passes 109/109 with 448 assertions, OpenCorvus
typecheck passes, and the dedicated real External materializer test passes 1/1 with ten assertions. Exact scans
still find only the three production invocation owners and the five intended production `Truncate.output`
sites. Final dead-code, document-health and independent exact-diff review remain required before this slice can
be committed and pushed; fixed/static adapter ownership remains separate 5b.2b work.

Production Knip passes, and document-health plus historical-link coverage passes 78/78 with 1,273 assertions.
Independent final review ACCEPTed 5b.2a and verified all three prior rejection items against the final tree. It
also confirmed that an External stage/global same-name override is not a valid current protocol state: the Build
stage ABI contains only `report_build_result` and `merge_back`, neither is a global registry provider, and
package/default/MCP provider-name collisions are rejected before materialization. The real External test covers
the stage batch exclusion that can occur, while the SessionLoop integration covers the valid projected `read`
override. Fresh and resumed External runs also share the same materialization owner before their execution
branch, and existing resume coverage observes the exact projected surface and terminal stage tool; inventing a
second protocol-invalid fixture is neither required nor acceptable. The review's additional long Build replay
passed the new case and the following 24 cases before the suite's later half reached the 120-second inactivity
limit without a product assertion failure. 5b.2a is accepted for commit and push; 5b.2b remains open.

## Item 5b.2b recall: static adapter and host pre-expansion recovery ownership

### Recall

- The user requires one generic execution protocol with no base-role identity, global-registry guess, caller
  fallback, options-carried surface, compatibility branch or host gate. A large result may advertise a recovery
  path only when the final execution owner proves that the current callable surface includes `read` and permits
  the real output filepath.
- The exhaustive `rg -uuu` scan finds one `createAiSdkToolFromInfo` implementation and four production owner
  modules: `agent/coordination-runtime-tools.ts`, `frontend-design/agent.ts`, `visual-qa/agent.ts` and
  `integrity/team-agent.ts`. Coordination is assembled by Architect, Goal Workload Analyst, Intent Analysis,
  Fact Check, Research and Requirements. Every production result enters that agent's
  `runAgentSession.toolKit.tools`, is projected into the runtime contract, and executes only through
  `SessionLoop.wrapExtraTool`. No production caller directly executes the returned AI SDK tool and no external
  executor uses this adapter. The only direct adapter-tool test asserts that missing real execution identity is
  rejected; static-surface and collector tests do not execute these adapted providers.
- `SessionLoop.wrapExtraTool` already owns the final live tool map after registry, MCP, projected/stage merges and
  final execution-policy filtering. Item 5b.2a binds its exact `Object.keys(tools)` and merged permission to a
  current invocation authority. The adapter must construct the complete expected invocation identity from the
  existing `opencorvus` fields, validate that authority through `currentTaskToolInvocationSurface`, and pass the
  returned surface to the initialized Tool provider. It must delete the current singleton
  `createToolExecutionSurface([info.id], [])`; toolkit factories, static ID duplication, base-role lookup and
  options-provided surfaces are rejected as second sources.
- `MCPServe.executeLocal` is a distinct fixed executor boundary and keeps its singleton surface. That MCP
  executor exposes only its explicitly selected OpenCorvus tool; an external executor's native filesystem
  feature is not an OpenCorvus `read` provider and cannot satisfy Truncate recovery.
- The complete direct `Tool.Context.executionSurface` scan also finds two host file/directory pre-expansion
  calls in `session/prompt/parts.ts`. They run before final model-tool materialization and label their content as
  not a model tool call, so `Tool.executionSurface(["read"], [])` falsely promises that the later model can read
  the saved output. Both must use an explicit empty surface, causing oversized pre-expansion to fail before a
  recovery file is written. Small host file/directory expansion remains unchanged. The other direct contexts
  (`orchestrator/runtime-repair-tools`, `orchestrator/webpage-evidence`, an orchestrator read, gateway and MCP
  serve) state their actual fixed callable boundary and are not changed by this slice.
- Independent read-only audit confirms the call inventory and accepts invocation authority as the smallest
  single-source design. Acceptance requires adapter tests for exact frozen surface, deny rules and missing,
  mismatched or expired authority; SessionLoop integration demonstrating final denied/switched IDs; prompt-part
  tests proving large text/directory expansion rejects without creating a recovery file and small expansion
  still works; exact residue scans, focused tests, typecheck, production Knip, document health, independent
  final review, commit and push.

Implementation uses that exact owner. `createAiSdkToolFromInfo` now requires the complete invocation metadata,
checks the AI SDK call ID against the persisted call ID, and obtains its surface only from
`currentTaskToolInvocationSurface` before any trace hook or provider execution. The runtime provider name is
intentionally read from the validated invocation rather than equated to `Tool.Info.id`, because a projected map
may expose the same initialized provider under a different canonical name. The real SessionLoop integration
proves an underlying `Tool.Info` exposed as `report_build_result` sees the final aliased stage name, not its
initialization ID, and does not regain switch-disabled `read` or permission-denied `bash`.

The first host pre-expansion test exposed a deeper existing defect than the initial Recall described. ReadTool
sets `metadata.truncated` for its own pagination, so `Tool.define` deliberately skips generic Truncate; changing
the two synthetic surfaces to empty is necessary but cannot by itself prevent an unrecoverable `use offset`
hint. The host owner now rejects paginated text unless the user explicitly requested a bounded `start/end`
range, and rejects every paginated directory expansion. Tests prove oversized text and directory inputs create
neither a message nor a tool-output recovery file, while an explicit ten-line range and a small directory still
materialize normally. This is a completeness invariant at the owner of the pre-expansion, not a workflow gate.

Two test-input corrections were required: the new prompt fixtures initially lacked a model and did not reach
ReadTool, and the adapter mismatch assertion used wording narrower than the existing identity validator. A
combined seven-suite replay passed 89/99. All new adapter, aliased SessionLoop, host expansion, Frontend Design,
Integrity and coordination assertions passed. Eight unrelated prompt tests failed earlier at stale shared
runtime-contract/primary-assistant fixtures, one existing prompt cleanup hit Windows `EBUSY`, and the Visual QA
surface fixture deterministically omitted the browser MCP config required by the current general/replica
manifests. The operator has excluded Windows resource cleanup work. The Visual QA fixture now reuses
`BrowserMCPBuiltin.localConfig` and derives projected default-MCP provider names from the resolved capability
instead of duplicating a 17-name list; its isolated suite passes 3/3 with 114 assertions. Frontend Research
passes 4/4 and Integrity preview passes 5/5 in isolation. The two new prompt cases pass 2/2 with nine assertions,
the adapter suite passes 2/2, and the aliased SessionLoop test passes 1/1.

Independent final review REJECTed the first host text condition. Merely having an explicit `end` does not prove
the requested slice was complete: ReadTool can hit its 50KB byte cap inside that range, return fewer lines than
the requested limit and still mark the result truncated. The corrected owner accepts a truncated explicit range
only when `metadata.lines` exactly equals the calculated range limit; an early EOF remains accepted because it
is not truncated. A 100-line explicit range whose line width crosses the byte cap now rejects without persisting
a message or recovery output, while the complete ten-line range still succeeds. The corrected prompt tests pass
2/2 with twelve assertions and OpenCorvus typecheck passes. The same reviewer must recheck this exact correction
before acceptance.

Independent correction review ACCEPTed the final tree and independently replayed the prompt cases 2/2 with
twelve assertions. It confirmed complete explicit ranges, byte-capped incomplete ranges and early EOF are
distinguished correctly; the empty execution surface and unconditional directory-pagination rejection remain
intact. No further known 5b.2b defect was found. This slice is ready for final document/diff checks, commit and
push.

After the concurrent branch merge, the restored exact 5b.2b tree was verified again rather than relying on the
pre-merge review. The adapter and complete SessionLoop extra-tool files pass 44/44, the two focused host
pre-expansion cases pass with twelve assertions, OpenCorvus typecheck passes, the canonical production
dead-code command has zero findings, and document-health plus historical-link coverage passes 78/78 with 1,273
assertions. A combined replay's only failure was the Browser MCP bundle rename returning Windows `EPERM`; this
is the operator-excluded Windows resource-management class and did not affect the independently replayed 6/6
behavior matrix. A fresh independent exact-tree review ACCEPTed the restored diff and found no singleton,
base-role, options-surface or direct-execution residue. 5b.2b is accepted for commit and push.

## Item 6 recall: retire PromptProfile schema forwarding aliases

### Recall

- The user requires the platform cleanup to continue in the recorded order, with no compatibility alias,
  fallback, double source or unrelated public-contract rename. This slice deletes only obsolete forwarding
  symbols; `prompt_profile.active` remains the sole active expert-squad selection field and its serialized shape
  must not change.
- Sources reread before implementation are this canonical cleanup record, `agent/prompt-profile.ts`,
  `expert-squad/protocol-schema.ts`, `expert-squad/catalog.ts`, `expert-squad/catalog-profile.ts`,
  `config/prompt-catalog.ts`, `skill/mounts.ts`, the prompt-profile and Registry tests, and the repository
  document-health test. Exact `rg -uuu` symbol scans covered OpenCorvus source/tests, Overlay source/tests and
  SDK source while excluding generated and dependency output.
- `PROMPT_PROFILE_ID_PATTERN` has only one test consumer. `PromptProfileSchedulerProjectionSchema` and
  `PromptProfileVirtualWorkflowNodeSchema` have no consumer. `PromptProfileAgentProjectionSchema` and
  `PromptProfileVirtualWorkflowSchema` are consumed only by Registry object-identity assertions that prove the
  forwarding alias exists rather than proving behavior. All five symbols are deleted.
- The complete projection-forwarding inventory contains six, not five, aliases.
  `PromptProfileVirtualWorkflowsSchema` has two real consumers in catalog and skill mounts; both move directly to
  `ExpertSquadVirtualWorkflowsSchema`. `PromptProfileCapabilityProjectionSchema` is consumed by the catalog
  profile schema in the same file; that field moves directly to `ExpertSquadCapabilityProjectionSchema`. Both
  forwarding symbols are then deleted. Registry behavior tests parse the canonical capability schema directly
  and continue to prove duplicate projection refs are rejected.
- `PromptProfileIDSchema`, the Config and Overlay schemas, `PromptProfileConfig`, the catalog profile schema/type,
  `DEFAULT_PROMPT_PROFILE_ID` and `PromptProfile.activeID` all have production consumers and remain. The unused
  derived `PromptProfileOverlay` type is not a forwarding alias and is deferred to a separately inventoried
  dead-export slice rather than broadening this one. The still-live PromptProfile catalog terminology also stays
  unchanged; Cleanup Order requires any public terminology decision to be a separate reviewed slice.
- Independent read-only review ACCEPTed this exact disposition and independently found the sixth Scheduler
  alias. It requires direct canonical schema tests, a negative source-health regression, typecheck, production
  dead-code, generated API/SDK freshness with zero generated diff, focused tests, exact residue scans,
  independent final review, commit and push.

The first focused replay passed 161/162 and initially appeared to expose a Mirror Watch prompt defect because the
report analyst says a local verification error is not "fallback output". Replacing that phrase made the next
replay fail on a valid two-line MirrorTest Integrity prompt. The complete test then proved the real defect: one
generic test imposed at least three lines, at least 220 characters and a keyword blacklist on every external
package overlay. That is a host-side prompt gate, rejects semantically valid packages, and conflicts with the
strict manifest/Registry ownership already responsible for nonempty prompt content. The attempted Mirror Watch
wording change is reverted. The arbitrary length/keyword gate and its single-use line helper are deleted; package
schema behavior remains covered by Registry, while domain prompt semantics remain in each package's dedicated
tests. A document-health regression prevents the host gate from being reintroduced.

After removing the gate, the focused prompt-profile, Registry, payload-generation, catalog, skill-mount and
document matrix passes 169/169 with 1,735 assertions. OpenCorvus typecheck, the canonical production dead-code
command, API route inventory and 274-operation documentation check pass. The repository's formal generator then
rebuilt expert-squad and Skill payloads, OpenAPI, the JavaScript SDK and both API documentation locales with zero
generated-file diff. Exact retired-symbol scans find only the document-health prohibition list, and
`git diff --check` passes. Independent final exact-diff review remains required before commit and push.

Independent final exact-diff review ACCEPTed the seven-file slice and independently replayed prompt-profile,
Registry and document health 130/130 with 1,603 assertions. It confirmed Registry still rejects blank declared
prompts, package-specific behavior remains under dedicated tests, and short or shared valid overlays are legal
generic protocol data rather than a reason for a host quality gate. It also confirmed no config, OpenAPI, SDK or
generated diff and no retired symbol outside the intentional prohibition list. Item 6 is accepted for commit and
push with no known issue.

## Item 6b recall: move catalog profile ownership to ExpertSquad

### Recall

- Item 6a removed forwarding aliases without renaming live catalog types. This separately reviewed slice now
  decides the remaining ownership boundary. The user requires platform terminology without compatibility names,
  but the serialized `prompt_profile.active` selection field and real fixed-agent Prompt Catalog must remain
  unchanged.
- Exact `rg -uuu` over OpenCorvus source/tests, Overlay source/tests and SDK source finds only three live sites.
  `PromptProfileCatalogProfileSchema` is defined in `agent/prompt-profile.ts` and consumed only by
  `expert-squad/catalog.ts`; its derived type is consumed only twice by `expert-squad/catalog-profile.ts`. No test,
  Overlay, OpenAPI or SDK source imports either name.
- The schema and type move atomically to `expert-squad/catalog.ts` as `ExpertSquadCatalogProfileSchema` and
  `ExpertSquadCatalogProfile`. `ExpertSquadCatalogSummarySchema` extends that local schema, while
  `catalog-profile.ts` imports the type from the same catalog owner. The fields, strictness and canonical
  `ExpertSquadCapabilityProjectionSchema` remain byte-for-behavior identical.
- The resulting dependency direction has no cycle: catalog depends only on protocol schemas and locations;
  catalog-profile depends on catalog and Registry; Resolver may depend on both. Catalog never imports
  catalog-profile or Registry. The type-only catalog import is erased at runtime.
- `PromptProfileIDSchema`, Config/Overlay schemas and types, `DEFAULT_PROMPT_PROFILE_ID`,
  `PromptProfile.activeID`, `config/prompt-catalog.ts`, `prompt_profile.active` and catalog response field
  `prompt_profile_active` all remain. No response or generated SDK field is renamed.
- Independent read-only review ACCEPTed the complete call-point disposition and requires focused catalog,
  Resolver, route and config tests; negative old-symbol health coverage; typecheck; production dead-code; API and
  docs checks; formal generation with zero generated diff; final independent review; commit and push.

The first combined replay completed 139/140. Prompt profile, catalog, Resolver, real config/catalog routes and the
isolated expert-squad route process all passed; the sole failure was the new health test still looking for the
capability field in the old PromptProfile owner. That assertion now reads the new ExpertSquad catalog owner and
passes 58/58 with 1,220 assertions. OpenCorvus typecheck, production dead-code, API route inventory and the
274-operation docs check pass. Formal generation rebuilds payloads, OpenAPI, SDK and API docs with zero generated
diff, retired-name scans hit only the prohibition list, and `git diff --check` passes. Final independent exact-diff
review remains required before commit and push.

Independent final exact-diff review ACCEPTed item 6b and independently replayed catalog display plus document
health 62/62 with 1,229 assertions. It verified the base schema's fields and strictness are identical, the catalog
profile import is type-only, the dependency graph remains acyclic, old names exist only in the prohibition list,
and no serialized or generated field changed. No known issue remains; item 6b is accepted for commit and push.

## Item 7 recall: remove retired tool-ID replacement semantics

### Recall

- The user requires unknown values to fail uniformly without compatibility aliases or replacement advice. Exact
  `rg -uuu` scans cover tool catalog, Skill parsing, all tests, Overlay and SDK source. This slice changes only
  internal Skill frontmatter validation; canonical tool IDs and all serialized shapes remain unchanged.
- `tool/tool-id-catalog.ts` owns the complete compatibility chain:
  `LEGACY_DUPLICATE_TOOL_ID_REPLACEMENTS` maps five retired names to current IDs, its derived Set classifies those
  names, and `legacyDuplicateToolMessage` emits replacement-specific advice. None has another production, test,
  Overlay or SDK consumer.
- `skill/required-tools.ts` is the only production consumer. It deletes the legacy import and branch and keeps one
  validation path against `reservedCoreToolIDs()`: every missing ID receives
  `<id> is not a canonical OpenCorvus tool ID`. The canonical set remains the union owned by
  `agent/tool-pool-data.ts`; current `read`, `glob`, `list`, `memory`, scheduler, stage and package-projectable host
  IDs are not changed.
- `test/skill/skill.test.ts` deletes the five-case legacy-to-canonical suggestion table. A representative arbitrary
  unknown ID proves the uniform error without legacy or replacement wording. Existing positive Skill tests still
  prove canonical IDs load.
- `test/session/dependency-boundaries.test.ts` currently requires `required-tools.ts` to import the tool-ID catalog,
  freezing the compatibility dependency. It must instead require only `tool-pool-data`, reject the catalog import,
  and retain its bans on runtime tool registry/global-tool dependencies. Document health prohibits the three
  compatibility symbols and five retired literals from returning to production.
- Independent read-only review ACCEPTed this complete call-point disposition. Acceptance requires focused Skill,
  dependency and tool-pool tests; exact residue scans; typecheck; production dead-code; API/docs checks; formal
  generation with zero diff; independent final review; commit and push.

The first focused replay passed 157/159. The new uniform unknown-ID behavior and dependency boundary both passed.
One failure was a stale assertion in the touched Skill suite: the Multica Skill now says an ID exists in the
combined user-global/current-project catalog rather than the older, less exact word "installed"; the assertion is
updated to the current bundled contract. The other failure is outside this slice: the homogeneity suite still
requires the retired `discoverProjectPackages(projectDirectory)` spelling after selector discovery moved to
`discoverExternalPackages(projectDirectory)`. That deterministic selector-test debt is recorded for the next
relevant expert-squad verification slice and is not hidden as an item 7 result.

The bounded Skill, dependency, tool-pool, mount and document matrix passes 129/129 with 1,498 assertions after
the touched Multica assertion is synchronized to its current exact contract. OpenCorvus typecheck, production
dead-code, API route inventory and the 274-operation docs check pass. Formal generation rebuilds payloads,
OpenAPI, SDK and API docs with zero generated diff. Compatibility-symbol scans hit only the document-health
prohibition list, the five retired IDs are absent from the implementation and focused tests, and
`git diff --check` passes. Final independent exact-diff review remains required before commit and push.

Independent final exact-diff review ACCEPTed item 7 and independently replayed Skill, dependency and document
health 99/99 with 1,384 assertions. It confirmed `reservedCoreToolIDs()` is the only validation source, the
unknown-ID fixture carries no historical replacement meaning, and unrelated same-name external protocol text is
not a Skill compatibility path. No known item 7 issue remains; the slice is accepted for commit and push.

## Item 8 recall: make Skill frontmatter uniformly strict

### Recall

- The user requires unknown frontmatter keys to fail through one general schema, without key-specific migration
  advice, stripping or compatibility behavior. Exact `rg -uuu` scans cover Skill source/manager, Skill and route
  tests, expert-squad package parsing, Overlay and SDK source.
- `skill/skill.ts` currently defines non-strict `Definition = Info.pick(...)`, then
  `assertNoRetiredFrontmatter` detects only `agents` and `mounted_agents` and emits a dedicated expert-squad
  migration message. Built-in install/state and `parseDefinition` call that special checker; bundle and ordinary
  filesystem paths rely on `parseDefinition`.
- `Definition` becomes `.strict()`. `parseDefinition` keeps its path/cause-preserving `Skill.InvalidError` wrapper
  but performs no precheck. The exported special checker and its duplicate built-in calls are deleted.
  `PackageDefinition` remains strict and continues to own package Skill parsing.
- A separate import bypass exists in `skill/manager.ts`: `parseSkillRoots` calls the special checker, then parses
  through another non-strict `Skill.Info.pick(...)`. It must call `Skill.parseDefinition` and explicitly project
  only the four imported fields. Managed directory validation already uses `parseDefinition` and needs no second
  path.
- Skill unit tests replace the dedicated retired-key function/text assertions with one table containing
  `agents`, `mounted_agents` and an arbitrary unknown key. Every case must produce the same strict Zod
  `unrecognized_keys` issue inside `Skill.InvalidError`. Manager tests use the same three-key table and prove
  rejection occurs before global config changes. The real skill-mount route retains its `mounted_agents` fixture
  but asserts a generic unrecognized-key error, not retired migration semantics.
- `Skill.Info` is the enriched runtime object containing location/content/bundle and remains non-strict; the
  frontmatter boundary is `Definition`/`PackageDefinition`. Declared-field value validators are not unknown-key
  special cases. API/SDK/Overlay response shapes do not change.
- Independent read-only review ACCEPTed this disposition and identified the manager import bypass as mandatory.
  Acceptance requires Skill, manager, dynamic Registry and real route tests; source-health/residue scans;
  typecheck; production dead-code; API/docs checks; formal generation with zero diff; independent final review;
  commit and push.

### Item 8 implementation and verification

`Skill.Definition` is now the single strict ordinary frontmatter boundary. The dedicated
`assertNoRetiredFrontmatter` function and all duplicate calls are deleted. `SkillManager.parseSkillRoots` now
uses `Skill.parseDefinition` before projecting the four import fields, so folder and ZIP imports cannot silently
strip any unknown key. `Skill.Info` remains the enriched runtime shape and is not a frontmatter parser.

The inactivity-governed focused matrix passed 168/168 tests with 1,780 assertions across Skill parsing and
discovery, managed imports, the real skill routes, dynamic expert-squad Registry, document health and historical
link health. It proves `agents`, `mounted_agents` and an arbitrary unknown key all produce the same strict Zod
`unrecognized_keys` issue inside `Skill.InvalidError`, and managed import failure leaves global configuration
unchanged. The real route proves both folder-file and ZIP archive imports reject an arbitrary unknown key before
writing the target directory or changing global policy, and that invalid projected package metadata remains
visible as a generic unknown-key failure.

`packages/opencorvus` typecheck, production `check:dead-code`, `docs:check` and `api:routes-check` all passed.
The first dead-code invocation exposed a broken transient `bunx` package: published `formatly@0.3.0` exports the
type-only `types.js` path but omitted that runtime-empty file. Repairing only the bunx temporary cache allowed the
unchanged repository command to enter and pass Knip; no repository contract or checker was relaxed. Formal
`bun script/generate.ts` passed and left generated expert-squad payloads, built-in Skill payloads, SDK clients and
API documentation at zero diff. `git diff --check` passed. Exact residue scanning finds the removed special
function/message and manager-side `Skill.Info.pick` only in document-health negative assertions, never in
production or behavior tests.

The first final independent review REJECTed the slice because its initial manager negative test exercised
`validateSkillDirectory`, not the changed `readImportSkillRoots -> parseSkillRoots` branch. This was a real
changed-path coverage gap even though production implementation was correct. Two table-driven real
`POST /skill/import-file` regressions now enter the folder-file and ZIP branches with
`arbitrary_unknown_key`; both assert the generic strict-schema error, absent target directory and unchanged
global config. The initial project-config equality assertion was also corrected after it exposed normal first
request default materialization: import policy is owned by global config, so the final assertion snapshots the
actual `applyPolicyToNames` owner rather than an unrelated project surface.

The second independent final review ACCEPTed the exact revised diff. It independently traced the folder and ZIP
route fixtures through `readImportSkillRoots -> normalizeBundleFiles -> parseSkillRoots -> Skill.parseDefinition`,
replayed both new cases at 2/2 with 10 assertions, and confirmed the aggregate 168/168 and 1,780-assertion record.
It also verified failure precedes every filesystem write and global policy mutation, `git diff --check` is clean,
and no known item 8 issue remains.

## Item 9 recall: delete the dead Build-default compaction export

### Recall

- The user requires projected dynamic agent identity to remain exact; `baseRole` is only the frozen runtime
  template. A Build-default public schema value creates the opposite semantic even when unused.
- Whole-repository tracked search finds `CompactionHandoff.JSON_SCHEMA_DESCRIPTION` only at its definition in
  `session/compaction-handoff.ts`; there is no production, test, Overlay, SDK, OpenAPI, docs or generated consumer.
- `jsonSchemaDescriptionForIdentity` has one production consumer: `SessionCompaction.buildPrompt` calls it with
  the required `sourceIdentity`. The prompt execution path derives that identity from the frozen runtime contract.
  The existing dynamic compaction test directly checks the renderer but does not yet pass the identity through
  the real `buildPrompt` composition.
- Delete only the `JSON_SCHEMA_DESCRIPTION` export. Retain private `COMMON_JSON_SCHEMA_DESCRIPTION`, the dynamic
  renderer, every role-specific schema and all compaction behavior. Add a real `buildPrompt` positive assertion
  for the projected dynamic agent ID plus Build template, an explicit property-absence regression, and a
  document-health source guard that does not confuse the valid private common schema with the removed export.
- Independent read-only audit ACCEPTed this exact disposition. It confirmed the default export has zero consumer,
  the renderer has one production call with exact frozen identity, and no API/SDK/generated surface changes.
  Acceptance requires focused dynamic compaction and compaction suites; exact symbol scans; typecheck;
  production dead-code; API/docs checks; formal generation with zero diff; independent final exact-diff review;
  commit and push.

### Item 9 implementation and verification

The Build-default `CompactionHandoff.JSON_SCHEMA_DESCRIPTION` export is deleted. The private common JSON shape,
role-specific schemas and `jsonSchemaDescriptionForIdentity` remain unchanged. The dynamic identity regression
now passes its frozen `{ agentID, baseRole }` through the real `SessionCompaction.buildPrompt` path and proves the
prompt names the projected dynamic agent with the Build runtime template, never Build as the source identity. It
also proves the namespace no longer owns the default export. Document health pins the same production boundary.

The inactivity-governed focused matrix passed 164/164 tests with 1,558 assertions across dynamic compaction,
the complete compaction suite, document health and historical link health. OpenCorvus typecheck, production
dead-code, `docs:check` and `api:routes-check` passed. Formal generation rebuilt expert-squad and Skill payloads,
OpenAPI, SDK clients and API docs with zero generated diff. `git diff --check` passed. Exact symbol scanning finds
the removed name only in behavior/source negative assertions, while the dynamic renderer remains at one
definition, one production call, positive tests and the retained historical disposition record.

Independent final exact-diff review ACCEPTed item 9. It independently reproduced the aggregate 164/164 and
1,558 assertions, all static checks, generated zero diff and exact symbol disposition. Its single combined Bun
invocation intermittently hit an existing shared-fixture `GIT_TEMPLATE_ROOT` temporal-dead-zone initialization
failure, while the same tests split into two inactivity-governed invocations passed at the exact aggregate count;
the primary combined invocation also passed. This nondeterministic test-concurrency debt remains explicit for
Cleanup Order item 21 and is not attributed to the two-line production deletion. The reviewer confirmed the
runtime property and source guards do not ban the valid private common schema, and no known item 9 issue remains.

## Item 10 recall: make active projection and current scheduler tools the single source

### Recall

- The user requires expert squads to declare immutable virtual workflow guidance while the Orchestrator remains
  the only natural dispatch decision owner. A workflow does not execute, own specialist responsibility, choose an
  agent, or persist lifecycle state. Exact agent IDs and capabilities come from the active expert-squad projection.
- The original inventory of three core prompts was incomplete. Current source has five ownership errors:
  `deep-research-core` says specialist roles belong to an active workflow; `frontend-design-core` and
  `frontend-research-core` make current workflow the projection owner; `requirements-core` lets a current
  scheduler workflow choose the next owner; `intent-analysis-core` says projected workflows own specialist
  responsibilities. Its separate reference to visible workflow guidance is valid manifest-v1 guidance and stays.
- EN/ZH `tools.mdx` documents nonexistent `task`/`task-report` IDs and removed `dispatch_goal`/`retry_goal` tools.
  The actual built-in worker-facing IDs are `delegate_agent`, `task_report` and `goal_report`. Scheduler-only
  `dispatch_agent` selects one exact active projected agent ID; `manage_task` owns task/goal lifecycle. The docs
  must distinguish these surfaces rather than pretending scheduler tools are global ToolRegistry entries.
- EN/ZH `troubleshooting.mdx` retains an entire fixed-stage scheduler model: a requirements/architect/build/
  integrity tool list, integrity-driven repair prose and nonexistent `max_runs`. Replace it with persisted
  `dispatch_agent` result/session evidence, exact active-projection target checks, `manage_task`
  `query_failed_goals`/`modify_goal`, and current task/goal contract evidence.
- Production comment/string residue of the five deleted public tool IDs remains in `build/types.ts`,
  `engine/describe.ts`, `session/loop.ts`, `orchestrator/tools.ts`, `workbench/board.ts` and
  `orchestrator/build-tool.ts`. Replace comments and persisted run summaries with current dispatch/engine-run
  language; internal camelCase `createRun` remains the real writer and is not a public-tool alias.
- `final-system-prompt-audit` currently positively freezes the wrong projected-workflow ownership. It must load
  all five prompts, reject every ownership phrase and pin active-projection/capability wording. Document health
  rejects the five retired IDs in current production/docs while pinning current EN/ZH tools. Product-doc
  single-source coverage pins EN/ZH tool and troubleshooting parity, including absence of fixed stages and
  `max_runs`.
- Independent read-only audit ACCEPTed this expanded disposition. Reference/evaluator EN/ZH and enterprise
  architecture still describe Integrity as a workflow tool; those surfaces belong atomically to item 11's dual
  Build/Integrity ownership removal and remain explicit next-slice debt, not an item 10 acceptance claim.
- Acceptance requires prompt audit, role-contract, document-health, product-doc single-source, active-plan graph
  and board tests; OpenCorvus typecheck and Web Astro check; production dead-code; API/docs checks; formal
  generation with zero diff; exact residue scans; independent final review; commit and push.

### Item 10 implementation and verification

Five core prompts now assign specialist capabilities through the active expert-squad projection and exact
projected agents. The valid visible virtual-workflow guidance remains advisory input to the Orchestrator; no
workflow is described as an execution or responsibility owner. EN/ZH tool docs now distinguish real built-in
`delegate_agent`, `task_report` and `goal_report` IDs from task-Orchestrator-only `dispatch_agent` and
`manage_task`. EN/ZH troubleshooting now diagnoses persisted dispatch results, child-session terminal state,
exact projected targets, work scope and goal-contract evidence without a fixed stage list or `max_runs`.
Production comments and persisted engine-run summaries no longer publish any of the five deleted tool IDs.

The first focused matrix found a deterministic pre-existing fixture defect: `role-contract.test.ts` projected the
repository frontend-replica package, which explicitly requires `default/mcp/browser`, but manually constructed a
Config without the browser MCP server. Strict Resolver failure was correct. The fixture now supplies the existing
`BrowserMCPBuiltin.localConfig()` just like other repository-package tests; no production fallback or relaxed
validation was added. The repaired inactivity-governed matrix passed 112/112 tests with 2,942 assertions across
final prompt audit, role contract, product/document single-source health, active-plan graph scope and board
projection.

OpenCorvus typecheck, Web Astro check, production dead-code, `docs:check` and `api:routes-check` passed. Astro
diagnostics reported zero errors/warnings and three existing unused-value hints in `qa/dedupe-lead.cjs` and
`Lander.astro`; toolbeam-docs-theme also emitted existing Head/Header/Footer override warnings. Those remain
explicit general cleanup debt rather than item 10 failures. Formal generation rebuilt payloads,
OpenAPI, SDK clients and API docs with zero generated diff. Exact word-boundary scanning finds none of
`dispatch_goal`, `submit_execution`, `exec_goal`, `retry_goal` or `create_run` in current production source or
public website docs; prompt ownership phrase scans and `git diff --check` are also clean. The separate Integrity
workflow-tool claims remain assigned to item 11 as recorded in Recall.

The first independent final review REJECTed item 10 because the updated tools page falsely described
`task_report` as terminal task completion and because string-presence tests failed to notice five other fake IDs
still published by the same table. EN/ZH now describe `task_report` as projected worker-session progress or
terminal session outcome; the table uses current `search_code`, `external_code_search`, `list`,
`todoread`/`todowrite` and omits the nonexistent `external-directory` tool. Role-contract tests now bind stable
built-ins directly to `ToolRegistry.ids()`, prove `dispatch_agent`/`manage_task` belong to the Host Orchestrator
and remain absent from the global Registry, and pin both scheduler IDs. Document-health scanning now also covers
tracked project expert-squad package text plus JSON/JSONC under production/docs/package roots, closing the
manifest residue blind spot. The revised matrix and all static/generated checks passed at the counts above;
second independent final review remains required.

The second independent final review ACCEPTed the exact revised item 10 diff. It independently reproduced
112/112 tests and 2,942 assertions, Web Astro's exact warning/diagnostic split, generated zero diff and clean
residue/diff scans. It confirmed the EN/ZH tool tables match the current global catalog, `task_report` is limited
to worker-session reporting, `manage_task` owns engine task/goal lifecycle, Registry and Host scheduler tools are
behaviorally separated, project-package manifests are included in the negative guard, valid virtual-workflow
guidance remains, and item 11 ownership surfaces were not changed. No known item 10 issue remains.

## Item 11 recall: one enriched dispatch owner and one dispatch execution path

### Recall

- The user requires dynamic `capability_projection.agents.<agentID>` to be the scheduling identity and rejects a
  second workflow/dispatch engine, base-role policy branches, fallback parsing and agent-specific host routing.
  One `dispatch_agent` execution must own every projected worker lifecycle from dispatch through true terminal
  settlement, including background adapters and Agent-to-Agent redispatch.
- Current `dispatch-agent-tool.ts` opens a root `dispatch_agent` ownership before child creation but completes it
  when the adapter tool call returns. Goal Build transfers real work to a background terminal promise, so this
  root owner becomes terminal too early. `build-tool.ts` creates a second `build` owner and
  `integrity-review-stage.ts` creates a second `integrity` owner to compensate for the lost lifecycle.
- `engine/tool-ownership.ts` consequently accepts `dispatch_agent | build | integrity`, singular/plural session
  fields, missing-owner tolerant live rows and a Build default. It exports Build-only finders by goal, session and
  goal run. Invalid persisted payloads can be skipped instead of failing at the strict persistence boundary.
- Build-only ownership assumptions propagate through `orchestrator/goal-mutation-guard.ts`, `engine/persist.ts`,
  subagent cancellation tool/runtime, queue/task cancellation/settlement and coordination paths. Runtime template
  metadata exposes `liveOrchestratorToolOwnershipControl`, making Build base role a host cancellation policy.
- `respond_agent_coordination` redispatch owns a second execution engine in `orchestrator/tools.ts`: it acquires a
  lease, selects one of thirteen adapter-specific strategies, validates/reconstructs inputs and directly invokes
  hidden adapter tools without the public `dispatch_agent` owner. This contradicts the architecture's claimed
  unified dispatch entry and recreates specialization in host code.
- Replace ownership schema with strict `tool_name=dispatch_agent`, required exact `target_agent_id`, plural
  `child_session_ids` and exact work scope; `goal_run_id` and `coordination_action_id` are optional projections on
  that same owner. Remove default Build, singular child, Build/Integrity variants and Build-only finders. Invalid
  rows fail immediately; only exact same-terminal replay may be idempotent.
- Extract one `DispatchAgentExecution` core used by the public dynamic-schema wrapper. It owns projection/binding
  validation, lease, root ownership, child/worktree attachment, adapter execution and terminal settlement. The
  adapter execution context carries the current ownership identity so Build can atomically bind its goal run and
  transfer both execution lease and ownership to the real terminal promise. Resolved terminal promises map their
  actual outcome; they are not blindly marked completed.
- Build and Integrity delete their inner ownership creation/closure. Goal attempt creation binds the same root
  owner to child session and goal run in the same transaction, excluding itself when checking concurrent live
  goal dispatch. External goal mutation blocks on any live goal-scoped dispatch owner, not a Build owner.
- Delete `liveOrchestratorToolOwnershipControl`; cancellation, queue drain, task settle and recovery use exact
  live owner/session/goal-run facts uniformly for every dynamic agent. No missing-owner inference may invent a
  child terminal result.
- A2A `redispatch` records a visible pending coordination action but does not invoke an adapter. The Orchestrator
  must make the subsequent explicit `dispatch_agent` call with `coordination_action_id`; the single execution
  core validates target/scope/binding, creates one owner and attaches action/session/descriptor evidence. Delete
  all thirteen strategy/validator/recovery direct-execution branches.
- Current EN/ZH evaluator and enterprise-architecture Integrity workflow-tool claims plus architecture chapters
  03/08/13/16 must be synchronized to the single-owner/A2A-explicit-dispatch behavior in this same atomic slice.
- Independent read-only audit REJECTed the current implementation and ACCEPTed this required atomic direction.
  It proved item 11 production files were untouched by concurrent work. Acceptance requires strict ownership
  schema and transaction tests; synchronous/background adapter lifecycle tests; Build, Integrity and ordinary
  dynamic-agent single-owner integration; Goal mutation and cancel/settle/queue race matrices; A2A visible-action
  then explicit-dispatch tests including restart; exact residue scans; docs/typecheck/dead-code/generation; a
  fresh independent final exact-tree review; commit and push.

### Item 11 implementation in progress (2026-07-18)

The production path now persists one strict `dispatch_agent` ownership shape with required dynamic target,
plural child sessions and exact task/goal scope. Build and Integrity no longer create nested owners; background
Build transfers the root ownership to its true terminal. Runtime-template Build ownership policy is deleted.
Malformed persisted ownership fails at load, exact terminal replay alone is idempotent, and goal mutation scans
all live goal owners before excluding only the current exact ownership ID.

Agent-to-Agent redispatch no longer executes any adapter. It records one visible pending action containing the
frozen projected-worker binding and instructs the Orchestrator to call `dispatch_agent` explicitly. The explicit
call validates the full projected identity, expert-squad ID, source worker-turn descriptor ID/hash and work
scope. Action binding and ownership creation are one transaction; the action is marked
`dispatch_bound=true` and `awaiting_explicit_dispatch=false`, and a second binding is rejected before a second
owner can be inserted. The 23 adapter-specific direct-redispatch tests were removed with the 13 production
strategy/validator/recovery implementations. Generic integration now covers visible pending action with zero
owner, explicit dispatch binding with session/descriptor evidence, in-process Instance reload, and a true
cross-process boundary where a seed process persists the action and exits before the main process dispatches it.

Ownership terminal and linked coordination-action terminal are now one database transaction. Explicit
cancellation writes `dispatch_outcome=cancelled`; a late background completion observes that authoritative
cancelled owner and is an idempotent no-op. Goal-run creation accepts the exact root ownership ID and re-reads
its latest artifact inside the same transaction before writing the goal-run binding, so cancellation cannot be
overwritten by a stale closure. Dispatch admission checks AbortSignal before and after ownership open, and owner
creation atomically refuses a terminal task. Cancellation no longer synthesizes `SessionStatus`, republishes an
old in-memory status or polls for self-created evidence; missing durable aborted-session evidence fails visibly.

The focused ownership/coordination/goal-run/dispatch/MirrorTest matrix passes 45/45 tests with 531 assertions,
including duplicate action binding, cancel-before-goal-run, foreign-owner-after-self-exclusion, cancelled late
terminal and deferred-open cancellation. Selected A2A and Integrity integration passes 6/6 with 37 assertions;
task cancellation passes 1/1 with 23 assertions; the true server restart target passes 1/1 with 33 assertions.
The obsolete projected-adapter recovery test that mocked a nested `tool_name=build` owner was discovered by the
final residue scan and deleted; its still-valid delegated-worker error aggregation now runs under an explicit
root dispatch ownership context and passes 1/1 with 6 assertions. The server coordination fixture now uses the
exact dynamic target and explicit child-session attachment instead of retired `toolName`/`childSessionID` input.

Single-owner Integrity success and failure integration both assert exactly one raw root ownership. Architecture
chapters 03/08/13/16 and EN/ZH evaluator/enterprise-architecture docs now describe explicit A2A dispatch,
single-owner cancellation/terminal semantics, and Integrity as an adapter evidence source rather than a workflow
tool or completion gate.

Queue ownership-drain fixtures now complete project initialization before launching an independent project
identity, preventing their own first-initialization write lease from blocking the loop's read lease. The same-cwd
serialization fixture also has real root-session lineage and the production termination composition. Every one
of its seven behaviors passes in isolation or a combined run; combined execution reaches 6/7 before Bun kills a
temporary Git helper in the in-flight fixture, with changing failures at `git reset`, `git read-tree` or
`git ls-files`. The failing test passes by itself (5 assertions), and the user explicitly excluded Windows-only
helper/resource failures from production repair. This is recorded as environment debt, not represented as a
green full-file run and not hidden by a product fallback.

Document health, historical links and product-doc single-source pass 88/88 with 1,385 assertions.
`docs:check` passes all 274 operations in 24 groups; `api:routes-check`, OpenCorvus typecheck and production
dead-code pass. Formal `bun script/generate.ts` rebuilt expert-squad and Skill payloads, OpenAPI, the JavaScript
SDK and both API-doc locales; the complete binary diff hash was identical before and after generation
(`2768b2ffa46b6f47b9994c1ad779314311311d7b`). Exact source/test scans find no retired Build/Integrity ownership
schema values, `live-owned build` text, old cancellation name or deleted redispatch strategy; the removed runtime
template field remains only in explicit negative regression assertions. Item 11 implementation and primary
verification are complete; acceptance still requires the mandated independent final exact-tree review.

### Item 11 independent final exact-tree review

The independent benchmark reviewer ACCEPTED the stable Item 11 tree after first rejecting and removing one
proposed recovery branch. That branch would have republished an old process-local terminal status when durable
`session.status` evidence was missing. The accepted implementation instead publishes the cancellation fact only
at the first authoritative transition inside the worker session's owning directory; an already aborted worker
without durable evidence fails visibly, while a genuinely persisted prior cancellation remains idempotently
recoverable.

The reviewer independently reproduced the complete `tools.test.ts` matrix at 127/127 with 998 assertions under
the repository inactivity runner with Bun's elapsed timeout disabled. The previously suspicious background Build
test completed naturally and proved that the root ownership remains live through the real terminal promise. A
combined queued-wake and session extra-tools run passed 49/49 with 217 assertions, including all seven queue
behaviors in one process; the earlier changing Windows Git-helper failure did not recur. The corrected fixture
uses real root-session lineage and the production termination composition rather than bypassing queue behavior.

The changed server A2A conversation path passed 1/1 with 39 assertions and the remaining projected-adapter
failure boundary passed 1/1 with 6 assertions. The exact cancellation subset passed 5/5. Historical links passed
21/21; OpenCorvus typecheck, production dead-code, API routes and the 274-operation docs check passed. Stable-tree
formal generation completed with identical whole binary-diff hashes before and after
(`1259f8b3e60d3f40a46d592c56f1da24a936ba4d`), and `git diff --check` passed.

Final exact production scans find none of the deleted Build/Integrity ownership finders or schema values, runtime
template ownership policy, adapter-specific redispatch executors/validators/recovery functions, synthetic
cancellation-status polling, or process-local status republishing. The reviewer inspected the atomic action-owner
binding, strict ownership parser, projection/lease binding, background terminal transfer, cancellation terminal
authority and queue completion consumers. No fallback, second dispatch engine, Build-specific host policy, or
known Item 11 defect remains. Item 11 is ACCEPTED for commit, push and benchmark-backend reload.

### Item 11 Codex final-review correction (2026-07-18)

The subsequent independent exact-tree review REJECTed the preceding acceptance. That acceptance is superseded:

- `beginBuildAttempt.dispatchOwnershipID` remained optional. Its prior-tip read, retry derivation and supersede
  plan were computed before the transaction; only the owner reread and new artifacts were transactional. A
  cancellation, competing attempt or concurrent tip change could therefore bind stale evidence, and invalid
  owner/CAS/extra-artifact failures were not proven to leave every prior row untouched.
- `completeDispatchOwnershipLifecycle` treated every later completion as idempotent when the stored outcome was
  `cancelled`. Exact terminal replay must instead compare requested outcome and normalized error. Background
  completion must observe cancellation before it calls terminal persistence; persistence cannot silently convert
  a conflicting replay into success.
- Public legacy ownership-append and ownership-completion APIs still exposed parallel
  write paths. Whole-repository grep found the insert in `tool-ownership.ts`, six focused engine/fixture groups,
  queue/server/task-api tests and `tools.test.ts`; completion remained in `tool-ownership.ts`, queue/server,
  mirror-watch and strict ownership tests. Valid live setup must use `insertLiveDispatchOwnership`; terminal writes
  must use `completeDispatchOwnershipLifecycle`. Malformed raw rows may exist only behind a test-fixture helper.
- `attachOrchestratorToolOwnershipSession` read the latest owner outside its append transaction. Concurrent A/B
  attachments could overwrite each other, and a terminal append racing the session append could be revived by a
  stale live payload. The attach operation must reread latest state and merge/append inside one transaction, with
  exact live-owner CAS semantics.

The exhaustive `beginBuildAttempt` grep found the single production call in `build-tool.ts` plus callers in
`begin-build-attempt-supersede`, queue/queued-wake, start-new-attempt, task-message routes, `tools.test.ts` and
no-decision-stop-process. Every caller must provide a real live goal-scoped dispatch owner; no optional path,
test-only default or fabricated fallback remains. Acceptance now additionally requires concurrency tests proving
one attempt winner, zero side effects on invalid/cancelled/CAS/extra-artifact failure, exact terminal replay,
lossless concurrent A/B session merge and terminal/attach non-revival; final symbol scans must find zero old
public insert/complete names across production and tests. No implementation below this correction may be called
accepted until a fresh independent review approves the final tree.

### Item 11 Codex correction implementation evidence (2026-07-18)

`beginBuildAttempt` now requires `dispatchOwnershipID` and performs its authoritative owner reread, goal/task
validation, prior-attempt retirement, retry evidence, implementation-version supersession, new goal-run creation,
extra-artifact append and owner binding in one database transaction. Invalid, cancelled, already-bound and
competing owners fail before commit. The focused matrix passes 15/15 tests with 69 assertions, including exact
rollback after extra-artifact failure and a concurrent same-owner single winner. A whole-source/test multiline
scan finds 56 calls and zero call missing `dispatchOwnershipID`.

The public raw ownership append and legacy completion entry points have been deleted. Production and valid test
fixtures use strict `insertLiveDispatchOwnership` plus `completeDispatchOwnershipLifecycle`; the only malformed
row writer is a test-only raw fixture helper. Whole-repository exact-symbol scanning finds zero references to the
two deleted public APIs. Lifecycle replay now accepts only the same normalized terminal outcome and error. A late
background completion must first read the stored cancelled outcome rather than ask persistence to accept a
conflicting replay. Ownership parsing, exact replay, concurrent A/B child-session merge and terminal non-revival
pass 4/4 tests with 20 assertions; coordination passes 15/15 with 117 assertions and the completion runtime has one
handler. Session attachment rereads, validates, merges and appends inside one transaction and returns the
authoritative merged row to its caller.

All migrated build-attempt fixtures now create a real live goal-scoped dispatch owner. Fixtures that finalize an
attempt also terminalize that exact owner; this correction found and removed stale live-owner residue in completed,
failed, dependency, shell and sibling build fixtures. The affected orchestrator groups pass 11/11 with 69
assertions, cancellation passes 9/9 with 50 assertions, and the three formerly default-timeout-bound background
Build cases pass together 3/3 with 17 assertions after adopting the repository's elapsed-time-disabled test form.
The complete `tools.test.ts` run reached 123/127; three background cases exceeded Bun's default five-second
elapsed timeout and then passed focused, while the fourth failure was the explicitly excluded Windows process
supervisor/Git-helper resource issue. This record does not represent that full-file run as green.

OpenCorvus typecheck, production Knip, the 31-file API route inventory, generated documentation freshness at 274
operations in 24 groups, document health/historical links/product-doc single-source at 88/88 with 1,385 assertions,
and `git diff --check` pass. Formal `bun script/generate.ts` rebuilt expert-squad and Skill payloads, OpenAPI, the
JavaScript SDK and both API-doc locales. A concurrent Registry edit changed a non-generated file during the first
whole-tree hash window, so that window is deliberately not reported as generation evidence. A second hash limited
to all eight paths declared by `script/generated-artifacts.ts` was the Git empty-diff hash before and after
generation (`e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`), proving zero generated drift without attributing another
agent's edit to the generator. One supplemental homogeneity test still reflects that concurrent Registry
refactor's old selector-loader source string; its owner must synchronize that assertion. Item 11 remains
REJECT-corrected and not accepted until a fresh independent reviewer approves this exact final tree.

### Item 11 fresh independent final acceptance (2026-07-18)

A fresh independent reviewer ACCEPTED the stopped final Item 11 tree. It reproduced the complete
`tools.test.ts` matrix at 127/127 with 999 assertions and the ownership, `beginBuildAttempt`, coordination and
dispatch matrix at 43/43 with 233 assertions. OpenCorvus typecheck, production Knip, API route inventory and
`git diff --check` passed. The full tools run did not reproduce the excluded Windows helper failure.

The reviewer verified that the four correction blockers are closed: `beginBuildAttempt` requires a dispatch
ownership ID and commits prior retirement, retry/supersession evidence, the new run, extra artifacts and owner
binding atomically; terminal replay accepts only the exact normalized outcome and error; the legacy raw insert and
completion APIs are absent from production and tests; and child-session attachment rereads and merges inside one
transaction without reviving a terminal owner. It also rechecked the earlier eleven findings: one public dispatch
owner spans Build, Integrity and ordinary projected agents; A2A redispatch is a visible pending action followed by
explicit dispatch; owner/action terminal state is atomic; cancellation does not synthesize evidence; descriptor
and frozen identity evidence are bound; and ordinary continue, ask-user, fail-task and cancel-worker behavior
remains intact. No fallback, second dispatch engine, Build-specific host policy, new gate or state machine was
found. Item 11 is ACCEPTED for commit and push.

### Item 11 post-acceptance timeout audit and superseding final evidence (2026-07-18)

The benchmark's post-acceptance audit found that several long integration files still inherited Bun's five-second
elapsed timeout. Legitimately active ownership, cross-process seed, Server-Sent Events, managed-worktree and
background Build tests were terminated at the elapsed boundary. Their unfinished cleanup then produced secondary
`Instance.disposeAll`, Git isolated-index and Windows process-supervisor failures in later tests. This was test
infrastructure debt, not dispatch ownership or expert-squad behavior. The preceding acceptance remains correct
about the product implementation, but this section supersedes it as the final verification record because the
earlier invocation did not close the repository-wide elapsed-time requirement.

The affected integration files and the timeout-architecture test itself now use `setDefaultTimeout(0)`. Three
mailbox route registrations and two active-plan Build registrations that still declared non-zero elapsed budgets
were migrated to the same file-level form. Operation-specific inactivity evidence remains authoritative: the A2A
seed watches its durable activity file and fails after 10 seconds without change; Server-Sent Events tests retain
their explicit abort/stream diagnostics; no product retry, fallback, scheduler branch or serial-only assertion was
added. The repository acceptance scanner now runs to completion and proves both that no non-zero Bun default is
installed and that no test registration uses a positive elapsed timeout.

A fresh process passed `tools.test.ts` 127/127 with 999 assertions. Task conversation and task message routes
passed 63/63 with 545 assertions, including the cross-process A2A restart and same-millisecond database watermark.
The strict ownership/coordination/attempt/dispatch/Mirror Watch matrix passed 44/44 with 246 assertions. The
timeout architecture plus affected mailbox/active-plan files passed 22/22 with 66 assertions. OpenCorvus typecheck,
production Knip, the 31-file API route inventory, generated documentation freshness at 274 operations in 24 groups,
historical links at 21/21, and `git diff --check` pass. Formal generation left the complete binary diff hash
unchanged at `ae8f71f4923ea3129cd2a20f77d4fad5e3d9bf4f`. Exact scans find 56 `beginBuildAttempt` calls and 56 explicit
`dispatchOwnershipID` fields, with zero retired raw ownership insert/completion names, Build/Integrity owner
finders, adapter-specific redispatch executors or process-local status republisher. Item 11 is ACCEPTED on this
superseding evidence.

## Item 12 recall: remove user-selectable external Task executors

### Recall

- The user requires a platform runtime whose active expert-squad projection selects exact dynamic agents. Codex
  and Claude Code must not remain selectable Task/Build runtime identities. The sole retained execution boundary
  is the internal OpenCorvus projected-worker lifecycle; this slice must not remove unrelated interoperability.
- The refreshed whole-repository audit covers `executor/**`, Build and retry/session contracts, Task/Run/DB
  propagation, cancellation and interactions, control/channel/panel inputs, server routes, MCP stdio bridging,
  Overlay/Tauri settings and selectors, transport, scripts, dependencies, current architecture, EN/ZH docs,
  OpenAPI, the JavaScript SDK and every matching test family.
- Delete the external runtime implementation and polymorphic registry: bootstrap/discovery/runtime-env/session-ref,
  managed/external process, Codex CLI/app-server, Claude Agent, projected external contract and `executor/protocol/**`.
  Replace `executor/opencorvus.ts` with one directly used internal projected-worker cancellation lifecycle; do not
  preserve zero-caller submit/status/resume/acceptance/events or a one-value executor registry.
- Delete the external branch from `build/agent.ts`, provider resume refs from build retry, and `external-coding`
  from the session runtime contract. Retain the session loop, AgentRunner, projected tools, Skill mounts and exact
  active-projection identity.
- Remove `executor` and `executor_ref` fields atomically from Task creation, engine tables/models/store/state,
  run/artifact payloads, Build dispatch and board/API projections. Do not replace the public union with a literal
  `opencorvus` field. The unreleased database must be reset from current DDL; no migration or compatibility parser
  is allowed.
- Remove executor input and `set_executor` from control messages, channel ingress, panel capability/tool and Task
  APIs. Delete `/executor` routes and generated operations. Cancellation and interaction resolution use the one
  internal lifecycle directly; zero-caller external protocol interaction paths are removed.
- Delete the external-only `mcp serve --toolset executor` stdio bridge while retaining `mcp browser`, generic MCP
  clients, package-scoped MCP projection and still-live server tool calls. Delete bridge-only server prompt/resource
  helpers only after the refreshed call graph proves they are zero-consumer.
- Overlay removes external executor services/store/settings, Task body selection, local action, Tauri persisted
  setting and transport union. `ExecutorSelector.tsx` contains the live generic `ComposerModelSelector`; extract
  and retain that provider/model/Hexin-budget control while deleting the unmounted external selector UI, CSS,
  i18n and tests. Old `overlay.jsonc` executor keys fail the strict schema by design; no migration or fallback.
- Delete external selector verification scripts, remove benchmark `--executor` injection without deleting the
  benchmark, remove the Anthropic Agent SDK dependency, update current architecture and EN/ZH docs, then regenerate
  lock/OpenAPI/SDK/API docs from the single contract.
- Explicitly retain `coding-cli/**` and `/coding/cli/*` human-launched terminals; Codex provider-auth integration;
  `.claude`, `.agents`, `.codex` Skill/instruction discovery and disable flags; generic package MCP; generic coding
  terminology; `max_executor_groups`; and command-execution metrics. These are not Task runtime identities.
- Independent read-only audit REJECTed the current external surface and ACCEPTed this disposition. It additionally
  found the executor MCP stdio bridge and embedded live model selector, preventing both incomplete removal and an
  over-broad UI deletion.
- Acceptance requires strict negative contract tests, one internal cancellation lifecycle with timeout/failure
  coverage, fresh DB/API/OpenAPI/SDK absence, MCP browser/package-MCP positives, Overlay strict settings negatives
  plus live model selection, coding-cli/auth/Skill-discovery positives, full generation with zero diff, exact
  residue scans, a fresh independent final review, commit and push.

### Implementation evidence (2026-07-18)

- The external Task runtime implementation is deleted, including the complete `packages/opencorvus/src/executor/**`
  tree. Exact import scans find no production or executable-test import of the deleted tree; the only remaining path
  strings are document-health absence assertions. The old protocol-interaction bridge test is deleted. BuildAgent,
  SessionLoop projected-worker contracts and internal cancellation are the sole Task execution path.
- Task/config/control/channel/Tauri/Overlay executor selection, `/executor`, `executorResumed`, generated
  `ExecutorSetModel`, external MCP serve and external selector fixture routes are absent. The approximately eighty
  copied Overlay `/executor` fixture branches were removed rather than retained as dead compatibility servers.
  `git diff --check`, OpenCorvus typecheck, Overlay typecheck and production Knip all pass.
- The live composer provider/model control was retained as `ComposerModelSelector`. Explicitly headed Node-sidecar
  verification passes 1/1 for provider/model/budget/focus/settings and 2/2 for per-task model context and retry.
  Manual screenshot review found and corrected Provider-row clipping. A stale 960px browser fixture was below the
  product's 1120px minimum window contract; the corrected headed fixture now asserts non-negative shell, brand,
  wordmark and sidebar geometry plus no horizontal document overflow.
- Fresh independent Cargo output uses random target
  `opencorvus-cargo-52e79eab6305477b8e0ade6808ee680b` and passes 55/55 Rust tests after a full cold build.
  Repository deletion of that target was not required; a later exact TEMP cleanup command was rejected by the tool
  policy and was not bypassed.
- The final focused runtime matrix passes 61/61 with 261 assertions: internal Build runtime 3, internal execution
  abort 3, retained human Coding CLI 4, retained Codex provider auth 15, browser MCP stdio 4, remote MCP transport 4,
  Overlay model-selector contracts 2, strict settings 14 and Overlay MCP service 12. Additional focused evidence
  includes SDK/route contracts 18 passing plus the single CLI generation case passing independently, document health
  3/3, orchestrator internal cancel 1/1 and Task inject 1/1.
- Official generation completed successfully after one Windows `EUNKNOWN` file-write retry. The eight generated
  artifact roots then remained byte-stable across a later generation attempt with aggregate SHA-256
  `6B01431FEF581EE2A1491D3A0FA1FE9C7371F5A34C66F3D96CBA3710DB6CD4FF`; that later attempt again hit the same
  Windows-only docs write error after producing unchanged bytes. `api:routes-check` passes across 30 route files and
  six rules, and `docs:check` passes at 271 operations in 23 groups. Per the user instruction, no product workaround
  was added for the intermittent Windows helper/resource failure.
- The user removed the three business E2E scenarios from this goal's acceptance. Their absence is not represented as
  E2E success. The retained `full-pipeline.test.ts` was not deleted: its real Planner -> internal Build -> checks ->
  Evaluator contract was migrated off ExecutorBootstrap, Task executor selection and executor-event diagnostics, and
  its module loads without deleted imports.
- Shared-worktree exclusions were respected: this slice did not modify the parallel-owned inactivity-timeout process
  test, mailbox-routes test or crypto benchmark record. Other unrelated dirty files and known document-health failures
  (`bun.lock` private repository residue, benchmark gate wording and a parallel untracked monthly record) are not
  claimed as Item 12 results.
- This implementation evidence is not final acceptance. A fresh read-only independent review must bind to the exact
  final worktree/commit, then the owner must commit and push through the normal hooks.

### Item 12 final verification addendum (2026-07-18)

- A second test-payload audit removed 76 copied `executor` values and 31 `executor_ref: null` producers that had
  kept obsolete runtime identity in otherwise current fixtures. A later independent review proved the initial
  line-oriented scan incomplete: twelve multiline Overlay `run` fixtures still carried `executor: "opencorvus"`,
  and the Provider Auth harness still published an unused `executors` field. Those positive fixtures are now
  removed and document health uses cross-line property scans to prevent recurrence. Strict negative tests still
  construct retired fields at explicit schema and API rejection boundaries; they are rejection evidence, not
  runtime producers. `executor_ref` has zero source or test producer. The schema snapshot was regenerated from the
  current strict contract rather than hand-edited.
- The first broad OpenCorvus rerun exposed 88 failures because those `executor_ref` fixture fields now correctly
  failed strict persistence. After removal, the focused behavior families passed. A later combined matrix exposed
  one additional single-file false-green: the Panel session-deletion fixture represented its linked Task as active,
  so a background terminal-lineage notification could race physical deletion. The fixture now creates a completed
  Task, which matches the tested stop-before-delete contract. The combined channel, interaction, abort, hard-error,
  Task route, panel and workbench matrix passes 68/68 with 298 assertions.
- The hard-error fixture failure was also data-contract drift rather than runtime behavior: its assistant message
  omitted required `info.author`, and its terminal tool part used equal start/end timestamps. The corrected artifact
  uses author `orchestrator` and an end timestamp after start; the normal/stamped/duplicate funnel test passes 1/1.
  Panel's complete file passes 14/14, including exact Multica project selection and linked-session deletion.
- Overlay static contracts pass 187/187 in the focused files after replacing retired selector DOM with the current
  model-selector surface. Headed composer and popup tests pass, as do the browser controls and Provider OAuth
  fixtures. Manual review of the headed composer and popup screenshots found no clipping, overlap or stale external
  selector surface.
- Root typecheck passes all 10 participating Turbo tasks. Production Knip, the 30-file/six-rule route inventory and
  generated docs freshness at 271 operations in 23 groups pass. Formal `bun script/generate.ts` completed and the
  binary diff of all eight paths declared by `script/generated-artifacts.ts` was identical before and after at
  `d9b60490a340013e6c3b8f1f24bc64709bd796d1`. `git diff --check` passes.
- Full document health initially found two real closure defects. Its benchmark contract still positively required
  the deleted `parseExecutor(--executor)` path; that assertion is now a strict absence contract. Separately, the
  user-level `C:\\Users\\chuan\\.npmrc` forced the private `repositories.myhexin.com` registry while regenerating
  `bun.lock`. Passing `--registry` over the already polluted lock did not remove resolved URLs in Bun 1.3.13. The
  lock was therefore regenerated from its proven baseline by Bun under an isolated HOME whose formal registry is
  `https://registry.npmjs.org/`; its diff is now only the seven lines made unreachable by removal of
  `@anthropic-ai/claude-agent-sdk`, with zero private registry URL. Full document health passes 62/62 with 1,242
  assertions; historical links and the remaining SDK/OpenAPI contract tests passed in the preceding 118-pass run.
- Final production/API/Overlay/SDK/public-doc scans have zero match for executor auto-discovery, external-coding,
  deleted selector classes and fixtures, `src/executor`, `protocol:executor`, `executor.progress`, the Claude Agent
  SDK, retired full-pipeline variants, `/executor`, `set_executor`, `executorResumed` or `ExecutorSetModel`. The sole
  broad `/executor`-pattern production match is `metrics/index.ts` exporting `metrics/executor`, the explicitly
  retained generic command-execution metric. Historical records and negative source guards remain evidence, not
  executable compatibility paths.
- The final independent review also found deterministic tests reading deleted `executor/external-process.ts` and
  `mcp/serve.ts`, a stale `mcp serve --help` assertion, a stale Mission benchmark executor assertion, and a dead
  `Ownership.Process` contract. The deleted-source assertions now target current internal completion ports, the CLI
  test proves retired `mcp serve` absence while retaining `mcp browser`, and `Ownership.Process`, its zero-caller
  cleanup driver, public `processOrphans` response, generated API/SDK fields and tests are removed. Worktree
  ownership and read-only worktree garbage-collection inspection remain. The corrected focused OpenCorvus matrix
  passes 155/155 before the one document-health path typo; after fixing that test path, document health passes 62/62
  with 1,307 assertions. Overlay i18n, message-token, composer-density and theme contracts pass 116/116.
- This addendum supersedes the earlier shared-worktree exclusion/failure note: the stale inactivity test that read a
  deleted live-executor test was removed, and both document-health defects above are closed. Item 12 still requires
  a fresh independent exact-tree review bound to the final diff before the owner commits and pushes.

### Item 12 fresh independent final acceptance

The fresh independent exact-tree reviewer ACCEPTED the frozen Item 12 tree at tracked-diff fingerprint
`f1565c96b6e2d7396997e33fa93fcf2859696a97`. It independently passed 176/176 focused runtime, UI and document
tests plus 25/25 internal-runtime, CLI, SDK and route tests. `git diff --check` passed. Strict production and
generated scans found none of the removed Task/Run selector fields, external runtime routes, process-orphan API,
external MCP bridge or generated SDK/Tauri executor fields; remaining terminology is an explicit negative guard
or an unrelated generic metric/planner concept.

The reviewer also inspected the headed screenshots and confirmed the final UI exposes one provider/model selector,
not an external runtime selector, with readable provider actions, keyboard/focus states and budget details and no
clipping or overlap. It verified that the internal worker/Build chain, coding CLI, Codex provider authentication,
Skill discovery and package-scoped MCP remain live. No one-value registry, compatibility alias, fallback, gate or
second execution path was found. Item 12 is ACCEPTED for commit, remote integration and push.

## Item 13 Recall Refresh: Remove the Tracked AInvest Application

### User requirement and acceptance

- Continue the platform and infrastructure cleanup after the external Task executor removal. The repository must
  provide the generic OpenCorvus development runtime and extension protocols, not retain a concrete AMD website
  replica as a first-party workspace package.
- Delete every tracked file under `packages/ainvest-amd-replica`, remove the package from release/version and lock
  bookkeeping, and add a negative repository-hygiene regression proving the domain application cannot return.
- Preserve historical records that mention the former package. Delete the retired AInvest capture helper and stale
  PNG with the application: the refreshed audit proves both have no runtime consumer and contradict the current
  task-scoped source-evidence protocol.

### Constraints and sources recalled

- No fallback package, compatibility alias, replacement demo application or second workspace list is permitted.
- The deletion is justified by call-point and ownership evidence, not by the package name. `AGENTS.md`, this
  record's Recall, tracked/generated disposition, production call-point table and Cleanup Order were reread before
  implementation.
- The current branch and remote were synchronized at `3a17e82d57`; Item 12 tests, typecheck, dead-code, routes,
  docs, generation freshness and two independent residue reviews passed before this slice began.

### Whole-repository call-point refresh

The qualified searches for `ainvest-amd-replica`, `packages/ainvest-amd-replica` and
`@opencorvus-ai/ainvest-amd-replica` found only:

- the package's own 24 tracked application/source/test/config files;
- its workspace entries in `bun.lock`;
- `script/sync-version.ts` and the exact release-family assertion in
  `packages/opencorvus/test/script/sync-version.test.ts`;
- this cleanup record and the historical hidden-runtime record.

No production import, route, runtime registration, expert-squad manifest, generated API, SDK surface, CI workflow
or packaging entry consumes the application. The broad `ainvest` search also found one old one-shot capture helper
and its tracked `assets/ainvest.png`. Git history shows they were introduced for an AInvest-default unattended
benchmark whose wiring was later removed. Their only current readers are three source-string tests checking headed
launch, inactivity navigation and retired terminology; no benchmark executes them. A prior July record already
classifies the helper and PNG as consumerless, stale and source-identity contradictory, but deferred deletion behind
a Replica E2E that the user later explicitly abandoned. That obsolete precondition is not a live gate. Item 13
therefore deletes the self-contained application, helper and PNG; updates bookkeeping; removes the three false-green
positive readers; and adds exact tracked-path negatives. Generic Browser Preview capture, Node Playwright launch,
inactivity navigation, visual comparison and external expert-squad evidence remain. `bun.lock` must be regenerated
through Bun with the public registry, then the negative tracked-path test, version tests, root typecheck and dead-code
checks must pass.

The first expanded focused run found one adjacent stale oracle: `browser-helper-navigation.test.ts` still read the
Item 12-deleted `verify-executor-selector.ts`. That positive reader is removed with the AInvest helper references;
the test continues to enumerate every live screenshot helper and verify the shared inactivity-navigation contract.

### Item 13 implementation and verification

- All 24 tracked files under `packages/ainvest-amd-replica` are deleted. The release-family source and exact test no
  longer list it. Bun formally regenerated `bun.lock`; frozen offline regeneration passes with 1,515 packages and
  leaves no unstaged change. The lock contains no AInvest workspace node, private registry or authentication data.
- The independent capture-history audit proved the one-shot helper's only real consumer was deleted in June. Its
  tracked PNG is a `chart.ainvest.com/NASDAQ-NVDA` capture while the helper defaults to the AInvest homepage and
  `fullPage`, so the helper cannot reproduce its own named artifact. Its Bun usage also violates the current
  Node-launched Playwright rule. Both files and the three static positive readers are deleted; the current generic
  explicit-reference and task-scoped evidence paths remain.
- The repository-intermediate regression now requires the retired application path, capture helper and PNG to have
  zero tracked files. The expanded focused matrix passes 95/95 tests with 1,449 assertions, including document
  health and historical links. Root typecheck passes with 11 workspace packages, production Knip passes, release
  versions align, API route inventory and generated API docs checks pass, and `git diff --cached --check` is clean.

### Item 13 independent final acceptance

The independent exact-tree reviewer returned FINAL ACCEPT for staged binary fingerprint
`61cb6e575463d3d878fb5f1ead91927375a2cd2c`. It independently confirmed the 24 application files, capture helper
and 223,544-byte PNG are deleted; release/lock bookkeeping and false-positive readers are removed; the three exact
negative tracked-path assertions are present; and generic explicit-reference, task-scoped evidence and real local
HTTP capture paths remain. Its focused matrix passed 41/41 with 250 assertions, document health passed 62/62 with
1,309 assertions, frozen lock validation produced no change, and cached diff check passed.

The review's broader benchmark probe found one pre-existing failure in
`html-skeleton-workflow-check.test.ts`: `rejects an ambiguous runtime task fanout parent`. Item 13 does not modify
that implementation or test. The failure is retained as an explicit Cleanup Order item 21 benchmark debt for a
separate root-cause slice after this bounded deletion is committed and pushed; it is not relabeled as passing.

## Item 14 Recall Refresh: Remove the Tracked Scratch File

- The continuing user requirement is to remove legacy and intermediate files after each bounded platform cleanup
  slice. The exact tracked inventory contains one `.scratch/**` path:
  `.scratch/pin-visual/project/.gitignore`.
- Full-tree search finds no production, test, script, documentation index or package caller for that path. Commit
  `ed84cfb7bf` introduced it as a new tracked path during the baseline import; content similarity lets
  `git log --follow` trace the project fixture ignore, but Git did not record a rename. It contains a copied project
  ignore file rather than a platform source artifact. Root `.gitignore` already owns `.scratch/` as the single rule.
- Delete the file without creating a replacement fixture, alias or alternate scratch index. Extend the existing
  repository-intermediate regression to require root scratch ignore ownership and zero tracked `.scratch` path
  segments at any repository depth. The test enumerates Git's tracked inventory and filters explicit `.scratch/`
  directory segments; it does not infer temporary content from names outside that boundary.
  Historical records that discuss ignored scratch evidence remain unchanged.
- The slice must pass the focused repository-intermediate and historical-link tests, tracked-path residue scan,
  root typecheck, production Knip and independent exact-tree review before commit and push. Concurrent Mission route,
  wake-route, model-persistence and crypto benchmark changes are outside this slice and must remain unstaged.

### Item 14 verification

- The copied `.scratch/pin-visual/project/.gitignore` is deleted. Git's staged inventory has zero path matching an
  explicit `.scratch/` directory segment at any depth, while root `.gitignore` remains the sole ignore owner.
- Repository-intermediate plus historical-link coverage passes 25/25 with 81 assertions through the inactivity-aware
  runner. Root typecheck passes across 11 workspace packages, production Knip passes, and cached diff check is clean.
- The independent reviewer accepted the deletion and caught two audit-quality issues before finalization: the first
  test checked only root scratch, and the first history wording treated content-similarity follow as a recorded
  rename. The final test scans the complete tracked inventory and the final record distinguishes Git's added path
  from similarity-based history. No replacement fixture, keyword inference or scratch compatibility path exists.

## Items 15-17 Status Reconciliation

The Cleanup Order was rechecked against the exact tree at `1f29a26bfb` before Item 18. These items are already
implemented and pushed; they must not be repeated as empty or competing cleanup slices.

- Item 15 is complete in `0d2a868f4b`. The eight tracked Overlay installer/application outputs, including the stale
  Windows MSI (Microsoft Software Installer) file, left the Git index. `.gitignore` now owns the single generated
  root `packages/overlay/dist-artifacts/`; packaging and CI (Continuous Integration) still create and upload that
  same path. The focused artifact, release-matrix and residue matrix passes 46/46 tests with 151 assertions. The
  single-source implementation record is `2026-07-17-overlay-generated-artifact-ignore.md`.
- Items 16 and 17 are complete in `c66c39f72e`. Exact current-tree review proves the unused
  `SideActivityToolbar.tsx`, its private CSS selectors and `right-activity-fixture.ts` are absent, with `RightDock`
  as the sole panel owner. It also proves `center-workbench-size.ts`, its separator/weight model and its tests are
  absent, with `rightDockWidth` as the sole current sizing source. The headed evidence and visual inspection are
  recorded in Slice 4 above. An independent read-only audit accepted both deletion semantics and rejected deleting
  the still-live left-sidebar `side-activity` contract.
- The audit's focused replay passed 75 tests and failed three adjacent current-tree assertions: two tests still
  expect a `MailboxPanel` mount without its current notification callback, and the window-size contract rejects two
  current `100vw` declarations in Work Ledger CSS. These failures are retained as Item 21 debts; they are not
  described as Item 16/17 regressions or passing tests.

## Item 18 Recall: Make RightDock the Only Live Right-Panel Terminology

### User requirement and acceptance

Continue the ordered platform cleanup without fallback, aliases, compatibility selectors or special-case rules.
All live Overlay identities that still call the Right Dock a `rightToolbar` or `RightActivity` must be replaced in
one atomic slice. Runtime behavior, panel selection, automatic Browser/Mailbox reveal, Mission reset, width and
resizer behavior must remain unchanged. Historical records remain evidence and are not rewritten.

Acceptance requires an exact source/current-document residue scan, synchronized unit and browser contracts,
Overlay typecheck, i18n freshness, a headed Node-launched Playwright run with screenshots inspected by the
implementer, and independent review of the exact candidate tree before commit and push.

### Sources, exhaustive search and independent feedback

Before implementation, this Recall reread the root and project AGENTS rules, this cleanup record, Slice 4 evidence,
`specs/current/architecture/07-panel.md`, the Right Dock store/component/main/App/Board implementations, their CSS
and all exact repository matches for `rightToolbar`, `RightToolbar`, `right_toolbar`, `right-toolbar`,
`rightActivity`, `RightActivity`, `right_activity`, `right-activity`, `side-activity` and `SideActivity`.

The independent read-only audit found old live terminology in 11 production/current-document files and 27 test
files. Tauri, backend, transport, OpenAPI and generated SDK surfaces have zero old match. Eighty-one historical
record files contain historical wording and must not be altered. The disposition is:

| Call-point family                                                                                                      | Atomic disposition                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/store/right-toolbar.ts`                                                                                           | Rename to `right-dock.ts`; rename its signal, setter and toggle to `rightDock*`; retain no re-export or alias.                                                                                                                                                                                                                            |
| `ChatHeaderRightToolbarToggle.tsx` and App mount                                                                       | Rename component/file, mount ID and `data-ui` selector to RightDock. Retain `data-chrome="chat-header-toolbar-toggle"` because it describes the actual header-toolbar styling role.                                                                                                                                                       |
| `main.tsx`                                                                                                             | Rename `openRightActivity` to `openRightDockPanel` and every store caller/effect. Preserve Browser/Mailbox reveal, Mission reset and menu-close semantics.                                                                                                                                                                                |
| `Board.tsx` and `inspector.css`                                                                                        | Rename the Board-owned `.right-activity-body` and `data-side-activity` identity to Right Dock panel terms. Do not rename App's live left Work Ledger `.side-activity-body` or its CSS/container identity.                                                                                                                                 |
| `conversation.css`, locale JSON and current panel architecture                                                         | Rename the live DOM ID, replace `chat.right_toolbar_open/close` with `chat.right_dock_open/close`, update human copy, and replace current-document wording. No locale alias remains.                                                                                                                                                      |
| `services/meta.ts`                                                                                                     | Call the actual `ProjectRuntimeToolbarActions` mount chat-header runtime actions; do not falsely call it RightDock.                                                                                                                                                                                                                       |
| Twenty-seven tests and browser fixtures                                                                                | Rename every positive live selector/source assertion, description and local variable. Preserve negative assertions for the already removed `solidRightActivityToolbar`; update the titlebar-only negative name to RightDock. Rename only the dedicated composer/right-panel test file; retain the broader titlebar-toolbar test filename. |
| Existing `RightDockPanel`, `rightDockTabPanels`, `selectRightDockPanel`, `rightDockWidth` and Tauri `right_dock_width` | Retain; they are already canonical and prove no native/API rename is needed.                                                                                                                                                                                                                                                              |

The independent audit identifies atomic selector synchronization, automatic reveal, reset-close behavior and open
Dock menu suspension as the primary regression risks. Headed validation must cover closed/open Dock, empty Dock,
multiple tabs/overflow and a narrow desktop viewport, including toggle title/ARIA (Accessible Rich Internet
Applications), resizer/width behavior and absence of clipping or overlap.

### Headed validation root-cause correction

The first three headed tests all failed before any Right Dock action because no fixture Work Ledger task rendered.
The same failure reproduced in the independent connection-projection browser test while the shared Work Ledger
payload unit test passed. Full call-point tracing proved the root cause: `browserSettingsFixture()` still emitted the
Item 12-retired `executor: "opencorvus"` key. `isOverlayPersistedSettings()` rejects every unknown key and already
has a protocol test that explicitly rejects `executor`; therefore the complete stored fixture payload was invalid,
its fixture server URL was never hydrated, and the page queried the wrong backend. This is a deterministic shared
fixture defect, not a network failure and not a Right Dock selector failure.

Remove the retired key without adding a compatibility parser. Add a focused contract test that passes the exact
shared browser fixture through `isOverlayPersistedSettings()` and requires the `executor` property to be absent.
Then rerun the original headed tests. This correction belongs to the same validation slice because the stale helper
otherwise makes real GUI acceptance impossible and represents an Item 12 legacy residue found by the required
headed check.

The full 14-file affected browser matrix then passed 31 of 33 tests and exposed two adjacent stale fixture oracles.
The Browser Preview evidence test's exact one-request assertion predates inactive-panel target preloading and
`boardUpdatedAt`-keyed refresh. The current product intentionally reloads the task-scoped target when the board
projection changes; the durable contract is that every request uses the exact task/directory target route, reaches
a settled evidence surface, and never calls capture or retired live-PNG routes. The test must stop asserting an
internal hydration request count while retaining those externally observable invariants.

The loading-spinner test held all concurrent target requests on one `Promise<Response>`. Releasing it returned the
same body-bearing `Response` instance to multiple HTTP handlers even though its `ReadableStream` can be consumed
only once, then the fixture immediately closed the browser. Independent audit confirmed this response-ownership
defect caused the two ordinary `ERR_ABORTED` failures. Change the hold to a `Promise<void>` release signal, create a
fresh response in each handler after release, and wait for the preview to leave loading before close. Do not permit
ordinary request aborts and do not change the product panel for this fixture defect.

That correction proved all three responses completed and the page reached the missing-target state, but the two
older requests were still classified as failures only after browser close. The authoritative call-point scan covers
`closeOverlayBrowser`, its single sidecar caller and every focused close-lifecycle test in
`browser-error-collector.test.ts`. Current code closes and terminates the browser before calling
`assertNoUnexpectedBrowserErrors()`, contradicting this record's Slice 4 claim that runtime errors are snapshotted
before teardown. Restore that ordering without swallowing close, termination, exit or pending-handler failures:
first settle already queued event handlers, then snapshot collector failures, then close/terminate/wait/settle
teardown handlers without reclassifying teardown-generated aborts. Extend the lifecycle tests to pin call order and
aggregation of a pre-close collector failure with a close failure. This is a test-runner root-cause repair required
by the project rule to fix broken debugging tools before continuing product acceptance.

Codex replay rejected both the shared-response correction and a later "latest request owns the hold" model. Even
after fresh responses reached `responseEnd`, the product's resource owner legitimately superseded older target
loads while Board and Conversation hydration were still changing `refreshKey`; keeping any initialization request
pending therefore manufactured two pre-close `requestfailed` events. The loading requirement is about the current
panel load, not initialization concurrency. The final chronology probe showed that merely returning an immediate
response is insufficient: Board or Conversation can cause the next resource owner before Chromium has consumed the
previous body. The fixture therefore starts both hydration requests but releases both only after Chromium finishes
the initial target response. Their applied projection produces one subsequent target, which is the sole held owner;
any additional request while held fails the fixture.
This ordinal sequencing is local test setup, not an externally asserted product request count. After visual inspection,
the held owner receives its own missing response; its body and the panel must both settle before
teardown. This changes no product API and permits no ordinary abort. The close-lifecycle order repair remains
independently covered because current code contradicted its recorded pre-teardown snapshot contract; it is not used to
hide a pre-close request failure.

The Node browser sidecar exposed only response headers (`url/status/statusText`) and stringified Playwright's
`requestfinished` event, so a fixture could not distinguish response arrival from body completion. Extend the shared
event projection with structured `requestfinished` URL and method fields and cover that protocol in the runner tests.
The spinner fixture uses this mature Playwright completion event to release hydration responses; it does not poll,
sleep or weaken the shared error collector.

### Item 18 merge replay findings

During the 14-file GUI replay, a concurrent yr-0718 work-line merge temporarily wrote conflict markers into six
files. The matrix passed its first eight files, then six files failed to build against that transient tree. The merge
owner resolved and committed the conflicts; three-way review confirmed the final files preserve both RightDock naming
and the incoming Mailbox attention, Expert Squad update/install-scope, control primitive and spec-index semantics.

Independent review rejected the post-merge candidate on three concrete issues: two new
`ProjectRuntimeStatusPanel` counters were not supplied at both wrapper call points, an empty Conversation `Portal`
remained after its child was removed, and two Expert Squad update buttons retained `sm` while their Settings action
peers are `md`. A mixed-case `Right-toolbar` Board comment also escaped the earlier residue expression. Fix these
without reverting the concurrent environment changes, add the mixed-case spelling to the strict scan, and rerun
typecheck plus the affected GUI matrix. The replay's only other failure is the user-exempt Windows sidecar taskkill
race; it is recorded but not treated as product work. A Titlebar test also observed transparent left-shell background
after the incoming single-material underlay change and must be resolved from the visual ownership contract rather than
by restoring a second painted surface.

## 2026-07-18 Item 20 Slice C Finalization Evidence

- The implementation is bound to branch `v0.0.9beta` at parent `6012197cdf`. Frontend Replica now owns one
  `prepare-source-context` package tool under the exact projected
  `frontend-replica-source-researcher` identity. The tool requires explicit project-relative evidence and output
  paths plus explicit replacement permission; it performs no capture, path guessing, install-root discovery or
  environment inference.
- Replica-only handoff, source-skeleton, context and evidence-integrity code moved into the package closure.
  Generic HTML compilation and layout merge moved to `browser/webpage`. Their shared compiled Page/Node/Layout/
  Asset Graph contract is exported once by `@opencorvus-ai/plugin` as
  `CompiledWebpageStructureSchema` and `CompiledWebpageAssetGraphSchema`; host and package consumers import that
  same Application Binary Interface (ABI).
- The package tool preflights output before mutation, copies input evidence into same-parent staging, prepares the
  complete source package there and publishes by rename. Success and failure tests prove the original evidence bytes
  remain unchanged. Existing output, overlap and symbolic-link/junction targets fail explicitly; generated manifests,
  context and README files contain project-relative references rather than machine-absolute paths.
- The redundant `webCloneSource` packet field is removed from producer, parser, Architect and Build consumers.
  Existing `projectMode`, `visualReference` and region bindings retain the complete semantics. A strict negative
  parser test proves the retired field is rejected rather than accepted through an alias.
- Host `webpage_analyze`, `web_clone_prepare_context`, the complete `src/web-clone` tree and their obsolete host
  tests are removed. Generated payload freshness, tracked payload inputs and the absence of the former core directory
  are tested. Production/current-source residue is zero; only explicit negative tests name the retired packet field
  or core directory.
- Independent reviews first established the atomic migration boundary and then found five defects: mutation before
  output rejection, broad error swallowing, invalid cross-runtime Zod type inference, absolute-path leakage and
  deletion through a linked output. All five are corrected. A final exact staged-tree review remains required before
  commit; this paragraph is not an ACCEPT claim.
- Verification before final review: Registry/Resolver/Manager/package-tool matrix 160 pass and one pre-existing skip;
  compiled webpage and package source-context matrix 16 pass; Architect/Build/context/provider matrix 66 pass;
  source-skeleton strict audit replay 9 pass; payload/document-health/history matrix 90 pass; plugin and OpenCorvus
  typechecks pass; production dead-code scan reports no finding; staged and unstaged diff checks pass.
- The validation replay also removed two false document gates exposed by this slice: generated payload descriptors
  are now inspected as runtime objects instead of scanning embedded source text for `manifestText:`, and the Agent
  communication Markdown table is compared by parsed cells rather than formatting-dependent column spaces.
- Item 20 remains open after this slice. The next atomic slice must remove remaining Frontend Design and Browser
  Preview fixed Replica policy/path ownership without moving generic browser capture or task-scoped preview evidence
  into the package.

### Slice C exact-tree review rejection and revised implementation boundary

The first final review was bound to parent `6012197cdf`, staged diff
`bd05d28208e57d9d0d8ec699aa75182c2fe05c54` and index tree
`f3c1be9f5a57852e1da36e33d39f1d1168ac9e71`. All three independent reviewers rejected that candidate; it must
never be cited as accepted.

- Both package wrappers were the only runtime callers of `resolveCreatableProjectPath` /
  `resolveReplaceableProjectPath`. The source-context tool deleted an existing package before rename; the
  interface-modeler wrapper still admitted an in-project linked output, and its generator recursively deleted the
  resolved target. Replacement must have one transaction owner: generators write only a new staging directory, then
  a shared package helper moves the prior target to backup, publishes by rename and restores the prior target if
  publication fails. The target and parent resolution must be revalidated after staging.
- Recursive scans found no link rejection below the source root. Both evidence-consuming tools must reject every
  nested symbolic link/junction before copy or generation. Manifest traversal must reject unsupported/link entries
  rather than silently omitting them. Tests must cover internal and external nested links, unchanged link targets,
  parent-target drift and injected publish failure with the old output preserved.
- `WEB_CLONE_REQUIRED_WEBPAGE_EVIDENCE_ARTIFACTS` is the declared required list, but
  `assertContextInputs` checked a smaller parallel list while the manifest unconditionally named four runtime-state
  screenshots. The smaller list must be deleted; missing or malformed runtime-state evidence must reject publication.
- `inspectWebCloneSourceSkeletonEvidence({ projectDir, citedText })` and
  `inspectWebCloneSourceManifest` have no runtime caller. They survive only for tests, hardcode
  `<projectDir>/web-clone-source` and use a forbidden keyword gate. Delete their production interfaces and rewrite
  tests against explicit paths and actual generator/audit outputs.
- The generic compiler still emitted `__WEB_CLONE_*` wire markers and exported
  `WebCloneExtractedLayoutPage`. Replace the marker protocol with `__COMPILED_WEBPAGE_*`, update its sole package
  consumers/tests and rename the extracted-layout type. This is a direct replacement, not a compatibility parser.
- The remaining broad `exists()` catch in the package source-project generator must return false only for
  `ENOENT`; all permission and I/O errors propagate.

### Slice C rejection correction and verification replay

The rejected candidate above has been replaced, not amended into an ACCEPT claim. One shared package helper now
owns replacement publication: generators create a new same-parent staging directory, the helper verifies the
prepared tree, revalidates the lexical target and its existence state, moves an existing target to a sibling backup,
publishes the prepared directory by rename, and restores the prior target when publication fails. If publication and
restoration both fail, the prior directory remains at the reported sibling backup instead of being deleted by staging
cleanup. Deterministic fault-injection tests cover successful restoration and the double-failure preservation path.

Both projected package tools reject direct and nested symbolic links or junctions in input trees. They also re-resolve
the target after preparation and reject parent-target drift. Manifest traversal rejects links and unsupported entries.
The source-project generator creates only a fresh output directory and no longer owns overwrite or recursive target
deletion. Its existence probe catches only `ENOENT`, and URI parsing catches only `URIError`.

Context preparation now validates the single declared required webpage evidence list. Every required PNG, including
all runtime interaction screenshots, must contain valid PNG evidence before any output is published. The tests-only
`inspectWebCloneSourceSkeletonEvidence` and `inspectWebCloneSourceManifest` production APIs are deleted; tests inspect
explicit evidence paths and real audit output. Generic compiled-page markers are now
`__COMPILED_WEBPAGE_*`, and `CompiledWebpageExtractedLayout` replaces the former Replica-named layout type without an
alias. A repository scan reports no current-source occurrence of the rejected inspector interfaces, old marker/type,
or parallel required-artifact constant.

The post-correction replay on parent `6012197cdf` completed with these exact results: package projection, Registry,
Resolver, Manager and package-tool tests `164 pass / 1 pre-existing skip / 0 fail`; compiled webpage, source-context,
Architect, Build, context packet and provider behavior tests `82 pass / 0 fail`; payload, document-health and history
tests `90 pass / 0 fail`. Plugin and OpenCorvus typechecks, production Knip, API route inventory and generated docs
checks all pass. These results prove the tested behavior but do not replace the required fresh exact-tree review. The
corrected staged fingerprint and index tree must be recorded only after all current edits are staged, and three fresh
independent reviews must bind those exact values before commit and push.

### Slice C second exact-tree review rejection

The next frozen candidate at staged fingerprint `a6cb56e41af4be549e607cb398464bc86f39c6c2` and index tree
`597f8e94c0b1cc89a02249fb9eb4ed0802d10e46` was also rejected by all three reviewers. Its green matrix remains useful
regression evidence but is not acceptance evidence.

- The helper preserved the old directory when both publication and restoration renames failed, but the real package
  wrappers then unconditionally removed staging and lost the prepared replacement. The aggregate error also omitted
  both recovery locations. Publication recovery must expose a typed error containing the backup and prepared paths;
  both real wrappers must retain staging for that error, and the fault-injection regression must execute a real
  package-tool wrapper rather than only the helper.
- Direct input roots were canonicalized before link inspection, so a project-internal input junction could be
  accepted even though nested links and direct output links were rejected. The requested input path must be lstat
  checked before `realpath`, with real tool tests for both source-context evidence and source-project package inputs.
- Required `extracted-page.json` was checked once and later read through an optional JSON helper. The strict reader
  must own that required read so an `ENOENT` race propagates instead of producing a manifest without capture viewport.
- `prepareWebCloneContext` retained a second `replaceExisting` field and recursive deletion branch even though both
  callers fixed it to false. Delete that branch and require a fresh staging output; only
  `publishPreparedDirectory` owns replacement. Delete the zero-caller `evidence-integrity.exists` export left by the
  removed inspector closure.
- The real HTML skeleton benchmark checker still rejected only `__WEB_CLONE_DATA_URI_ASSET__` while the compiler now
  emits `__COMPILED_WEBPAGE_DATA_URI_ASSET__`. This could accept an unresolved current marker. Replace the checker
  token directly, add a checker regression, and retain no dual-marker compatibility expression. The old-token
  occurrence also invalidates the preceding broad residue wording; negative tests may name retired identities, but
  current production checkers must use the current protocol.

The second rejection correction is now implemented. `PublicationRecoveryError` carries the exact backup and prepared
directory paths; both package wrappers preserve their staging root only for that double-failure type, while ordinary
success and restored publication failures still clean staging. A real `prepare-source-context` tool instance with an
injected rename failure proves both old and prepared outputs remain readable through the reported paths after its
wrapper exits. Direct evidence and source-package root links are rejected before canonicalization through the real
package tools. Context generation has no replacement parameter or delete branch, creates only a fresh output
directory, and reads required `extracted-page.json` strictly. The zero-caller evidence helper is deleted. The HTML
skeleton checker and its negative fixture use only the current compiled-page marker.

The complete post-correction replay reports: package projection, Registry, Resolver, Manager and tool bundle
`166 pass / 1 pre-existing skip / 0 fail`; compiled webpage, source-context, Architect, Build, context packet,
provider and HTML skeleton checker behavior `94 pass / 0 fail`; payload, document-health and history
`90 pass / 0 fail`. Plugin and OpenCorvus typechecks, production Knip, API route inventory, generated docs and diff
checks pass. These results still require a new frozen staged fingerprint and three independent reviews; neither
rejected fingerprint above is acceptance evidence.

### Slice C merge-tree review rejection

Slice C was committed as `afb5695fec`, then the non-overlapping remote conversation/Overlay commit `fa5272d859` was
merged as `3217cf18a3`. File-set and blob review proved the 54 Slice paths and 27 remote paths had zero overlap and no
merge drift. Combined Slice tests reported `166 pass / 1 skip` plus `94 pass`; remote OpenCorvus and Overlay tests
reported `74 pass` plus `96 pass`; both typechecks passed. Two reviewers accepted that evidence, but the third
reviewer correctly rejected the merge tree after running the omitted repository-level dynamic package audit.

`repository-dynamic-agent-packages.test.ts` reported `9 pass / 1 fail`: its exact repository package-tool reference
inventory did not include `frontend-replica/frontend-replica-source-researcher/prepare-source-context`. The production
projection was correct, but the authoritative whole-repository oracle and the validation matrix were incomplete.
Add the exact ref to that single strict inventory, retain its observed-versus-declared equality check, and rerun this
repository audit together with package projection, payload freshness and typecheck. The accepted production slice is
not changed by this correction, but `3217cf18a3` is not a final accepted delivery tree.

The repository audit proves that every declared package tool is discovered, resolved, bundled, projected and accepted
by provider schema preparation; it does not call every tool's business `execute` function and must not be described as
doing so. The new source-context tool's business execution is separately covered through the persisted dynamic
source-researcher in `frontend-replica-source-project.test.ts`. The repository audit is intentionally run with
`--timeout=0`, matching the project rule that these real package and cross-process checks must not inherit Bun's
fixed five-second per-test timeout. With that command the corrected repository audit reports `10 pass / 0 fail`; the
combined repository projection, Frontend Replica tool, Registry, Resolver, bundle and payload replay reports
`127 pass / 0 fail`, docs/history reports `82 pass / 0 fail`, and OpenCorvus typecheck passes.

## 2026-07-18 Item 20 Slice D1 Recall: project files are not runtime evidence

### Recall

- User requirement: continue the platformization goal under the revised scope, excluding the three abandoned real
  end-to-end exercises, while preserving strict expert-squad projection semantics and removing legacy or specialized
  Core behavior. Each atomic change must be tested, independently reviewed, committed and pushed to `myhexin`.
- Acceptance: `frontend-design-skeleton/**`, `web-clone-source/**` and `webpage-evidence/**` behave exactly like
  ordinary project-owned files in Git staging, acceptance paths, workspace export, worktree publication and dirty
  primary recovery. Only genuine internal runtime storage such as `.opencorvus/.r/**`, the retired runtime root,
  worktree metadata and `.opencorvus-meta.json` remains excluded. There is no directory-name fallback or alias.
- Hard constraints: no compatibility path, fallback, workflow gate or state machine; do not disturb running
  OpenCorvus/Overlay processes; do not mix Browser Preview or Frontend Design policy migration into this slice; bind
  final review to the exact candidate tree and push with the `dsw-33987` prefix.
- Read before implementation: this record, `specs/current/architecture/04-extensions.md`, the project `AGENTS.md`
  contract supplied by the user, and the expert-squad creator skill. The July 11 architecture record already states
  that these roots are ordinary project files, proving the implementation is incomplete rather than a new policy.
- Full repository call-point scan: `ProjectRuntimePaths.isEvidenceInputRelativePath` is defined in
  `project/runtime-paths.ts` and consumed by `build/agent.ts`, `engine/workspace-export.ts`, `engine/git.ts`, and four
  worktree helpers in `worktree/index.ts`. The only evidence-specific Git pathspec producer is
  `evidenceExcludedAddAllArgs` in `engine/git.ts`; the only fixed workspace-export pathspecs are in
  `engine/workspace-export.ts`. All are removed or replaced in this slice. Replica-specific readers outside this Git
  ownership surface belong to later D2/D3 slices and are not silently changed here.
- Independent agent feedback: three-root special casing is a legacy dual source and must be deleted. Generic browser
  target/capture/persistence remains Core infrastructure. Browser Preview's active-run requirement and implicit
  Replica artifact discovery are separate D2 defects. Frontend Design's heuristic skeleton coverage checker is a
  keyword gate with missing-evidence false-green behavior and must be deleted, not migrated, in D3.

### D1 disposition and verification

| Call point                   | Disposition                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `project/runtime-paths.ts`   | Delete `isEvidenceInputRelativePath`.                                                                                                                    |
| `build/agent.ts`             | Include the three roots in normal goal-contribution diffs.                                                                                               |
| `engine/git.ts`              | Accept their declared paths and use ordinary repository-wide `git add -A`.                                                                               |
| `engine/workspace-export.ts` | Include their names and patch content; retain only internal runtime exclusions.                                                                          |
| `worktree/index.ts`          | Dirty files block publication, committed files merge, and dirty primary files enter the normal recovery commit. Delete the committed-evidence exception. |

Focused tests must reverse the old assertions in worktree publication and workspace export, cover Git acceptance and
staging where applicable, and retain internal-runtime rejection. Verification then runs OpenCorvus typecheck, the
production dead-code scan, strict residue search, and fresh independent review before commit and push.

### D1 implementation verification before exact-tree review

The evidence-name classifier, evidence-specific add pathspec, acceptance filter, workspace-export pathspec, Build
contribution filter and worktree merge/recovery exceptions are deleted as one semantic replacement. Tests now prove
that an untracked file under one of these directories blocks publication, committed files merge, tracked dirty files
enter the primary recovery commit, and all three former special roots enter workspace export. The unchanged internal
runtime tests continue to reject `.opencorvus/.r/**` from durable delivery.

The focused replay reports `26 pass / 0 fail`; the expanded runtime-path, worktree, Engine and Build replay reports
`36 pass / 0 fail`; document health and historical-link verification reports `82 pass / 0 fail`. OpenCorvus typecheck
and the repository production Knip scan pass. A strict current-source/test scan has zero occurrence of the deleted
classifier, merge helpers, add helper and retired rejection wording. These results are implementation evidence only;
acceptance still requires three independent reviews bound to the exact frozen index tree.

### D1 first exact-tree rejection and correction

The first frozen candidate, staged diff `4b8e26c7777e5f9ce9b014500039f3614e3a7ca3` and index tree
`142749129d9a82b6106fe5f795f43b75ffce3440`, is rejected and must not be cited as accepted. One reviewer accepted
the production semantics, but two reviewers found four concrete verification and failure-propagation defects:

- The long worktree integration file inherited Bun's fixed five-second elapsed timeout. Combined execution could
  fail while the same tests passed alone. It now calls `setDefaultTimeout(0)` so the repository's process-level
  inactivity timeout remains the only runtime deadline.
- Stage, Build contribution, merge and recovery tests sampled different individual former names while claiming
  directory-name independence. Each critical Git behavior now exercises all three roots in the same regression.
- Workspace export used two unchecked non-throwing Git diffs, mapping an invalid baseline or patch command failure to
  empty delivery evidence. It now uses the shared inactivity-aware Git runner, checks both results and throws with
  command, exit code, working directory and diagnostic output. Negative tests cover both probes.
- Goal and primary worktree MERGE_HEAD/status probes treated non-zero or thrown Git results as clean state. Exit code
  one is accepted only for an absent MERGE_HEAD; every other probe failure becomes an explicit infrastructure error.
  Fault-injection tests cover goal MERGE_HEAD and primary status failures.

After correction, the combined Build, Engine, runtime-path and worktree matrix reports `40 pass / 0 fail` with 132
assertions and OpenCorvus typecheck passes. The deleted-helper residue scan remains zero. A new exact-tree freeze and
three fresh independent reviews are still required.

The second frozen candidate, staged diff `e8ece0d06b80df236ad305a36e416fca1e6df0a9` and index tree
`fe22f9a9af11264a0c96270526fcbf952d3fd9bc`, is also rejected. Main-agent self-review and two independent reviewers
identified the same typed-outcome regression before acceptance: after a normal `MergeFailedError`, failure of the
secondary blocked-state diagnostic probe was rethrown from inside the catch branch and therefore escaped
`mergeSafely`. The public boundary now returns an explicit `infra_error` containing both the original merge failure
and diagnostic failure. A call-count fault-injection regression proves a first dirty-status probe followed by a
failing diagnostic status probe resolves to that typed outcome rather than rejecting the promise. The corrected
worktree/workspace-export matrix reports `17 pass / 0 fail`; OpenCorvus typecheck passes. A third freeze is required.

## 2026-07-18 Item 20 Slice D2a Recall: task-scoped comparison without an active run gate

### Recall

- User requirement: continue the platformization cleanup in small independently reviewed and pushed slices. Browser
  Preview is generic task-scoped infrastructure and must not require scheduler state that its own evidence contract
  does not require. The three abandoned real end-to-end exercises remain outside the acceptance denominator.
- Acceptance: `POST /task/:taskID/browser-preview/compare` still requires a persisted target and strict comparison
  request, but it executes when the task has no active run and persists task/target-bound evidence with no `run_id`.
  A concurrently running run must not be inferred or associated because the request carries no explicit run identity.
  No parallel route, fallback, synthetic message, manifest field or workflow engine is introduced.
- Hard constraints: preserve task/project/target ownership, real comparison and persistence behavior; do not disturb
  running OpenCorvus/Overlay processes; do not combine explicit artifact-path redesign into this gate-removal slice;
  use real route/database evidence rather than a mocked comparison result; independently review the exact tree.
- Read before implementation: this record, `specs/current/architecture/04-extensions.md`, the supplied project rules,
  and the expert-squad creator skill. Independent D1 reviews identified this route gate as a separate atomic defect.
- Full call-point scan: `server/routes/browser-preview.ts` has the only route-level `findActiveRunForTask` call and
  the file's only `HTTPException` use. `compareBrowserPreviewRegions` and `persistBrowserPreviewEvidence` already
  accept optional `runID`; persistence maps absence to database null. The compare operation has one route test that
  currently locks a 400 response for no active run. OpenAPI and generated SDK expose no run requirement or run input;
  their documented validator errors must include the route's real 400 response. Other `findActiveRunForTask` calls are
  scheduler/orchestrator owners and remain.
- Test disposition: retain missing-targetID and unknown-target 400/404 checks. Replace the active-run 400 assertion
  with a real failed comparison caused by a missing source image, then assert returned evidence belongs to the task
  and target with null `run_id`. Seed a real running run through `createRun` and assert the route still records null
  `run_id`, proving it does not infer lineage. The missing source image is an explicit comparison failure result, not
  a route or test fallback.

### D2a independent-review correction

The initial test disposition above is revised after the full independent call-point review. An HTTP request to this
task-scoped route contains no run identity, so attaching whichever run happens to be active at request time is an
implicit lineage guess and retains the scheduler coupling after deleting only its 400 gate. The route must delete the
`findActiveRunForTask` lookup entirely and pass no `runID`. A real running run may coexist, but route-created evidence
must still store null `run_id`; this is the negative regression proving there is no hidden active/latest inference.
Adding an explicit, strictly validated optional run ID could be a separate API feature, but is not required to remove
this gate and would unnecessarily expand the current slice. Formal run-scoped visual acceptance already validates
its own explicit run association and cannot consume null-run evidence as if it belonged to a run.
The same review found that the route's documented responses omit the validator's real 400 response; change
`errors(404)` to `errors(400, 404)` and regenerate OpenAPI/SDK/docs from the route source rather than hand-editing them.

### D2a implementation evidence before exact-tree review

The compare route no longer imports `HTTPException` or `findActiveRunForTask`, performs no active/latest run lookup,
and passes no implicit `runID` to the generic comparison service. Its persisted-target precheck remains the strict
task/target ownership boundary. The route's existing strict request validator still rejects client-injected `runID`.
OpenAPI now documents that validator's 400 response and the generated SDK plus English/Chinese API references were
regenerated from the route source.

The real route regression covers both a task with no run and a task with a confirmed running run. Both requests enter
the real comparison/persistence path, return readable task/target-bound evidence and store null `run_id`. It also
retains missing/unknown target failures, adds same-project other-task and cross-project target rejection, and verifies
that a direct `runID` field fails strict parsing. A viewport/binding mismatch deliberately produces a deterministic
failed comparison without launching a browser; the returned failure and persisted evidence are inspected rather than
treated as success.

The focused route/SDK replay reports `30 pass / 0 fail`; the expanded route, SDK, route-inventory, live-lifecycle,
strict-schema and formal acceptance-boundary replay reports `62 pass / 0 fail`. OpenCorvus typecheck, generated docs
freshness and API route inventory pass. Current route production source contains no active-run requirement,
`findActiveRunForTask` or `HTTPException`. Exact-tree independent review remains required before commit and push.

The final expanded replay reported `61 pass / 1 fail` when the unrelated Windows background-preview helper exited
immediately after launch. Its isolated rerun passed (`1 pass / 0 fail`), matching the earlier complete `62 pass / 0
fail` replay and classifying it as the explicitly exempted non-deterministic Windows helper/resource condition rather
than a D2a regression. OpenCorvus typecheck, `docs:check` (`273` operations / `23` groups), `api:routes-check` (`6`
rules / `30` files), and historical-doc health (`21 pass / 0 fail`) all pass after the final Recall correction.

The first frozen candidate (`0252bd049ce87ce8c64f44b679c3deceec4e061e`, tree
`c04731b0c2e98f40080beac2032f5bdd0a52e2f2`) is rejected. Two reviewers accepted its route architecture and real
contract coverage, but the residue reviewer found an unused `findActiveRunForTask` import in
`orchestrator/build-feedback.ts`. It did not affect runtime behavior, but contradicted the call-point inventory's
claim that every remaining occurrence had a real owner. Delete that dead import, rerun type/residue checks and bind
all three reviews to a new exact tree; the earlier ACCEPT responses do not transfer.

## 2026-07-18 Item 20 Slice D2b Recall: exact TaskArtifact source identity

### Recall

- User requirement: continue the platformization Goal after pushed D2a without special-case rules, compatibility,
  fallback, hidden source discovery or another workflow engine. Browser Preview must remain reusable visual
  infrastructure; Frontend Replica must own its source-modeling policy through the installed manifest-v1 package.
- Accepted architecture recalled from the 2026-07-14 TaskArtifact cutover records: `TaskArtifactRefSchema` is the only
  platform file-evidence identity. Visual handoff and raster/region comparison consume exact refs and cannot require
  `sourcePackage/reference.png`. The 2026-07-16 Slice A record explicitly says its temporary project-relative package
  handoff remains open until the later generic TaskArtifact publication/consumer cutover. A bare project-relative or
  task-runtime-relative string therefore cannot become a new Browser Preview protocol.
- Acceptance: a source PNG is selected only by one exact ref containing project/task/snapshot/manifest/tree/path,
  media type, byte count and SHA-256 identity. The verified read rejects foreign task/project, missing or changed
  manifest/inventory/ref/bytes, non-PNG media, symlink/junction/reparse or hard-link content and read-time identity
  drift. Historical read is not coupled to the package-tool rule that a Task must be non-terminal. Browser Preview
  evidence persists the consumed ref/digest. Old strings, aliases, defaults and fixed directory reconstruction fail
  strictly; no `string | TaskArtifactRef`, latest/named lookup or automatic conversion is allowed.
- Genericity: keep persisted preview targets, browser capture, bbox/crop/true-size comparison, scroll-slice capture,
  Structural Similarity Index Measure (SSIM), side-by-side/diff output, task evidence and the existing compare route.
  Core comparison accepts explicit source ref plus bbox. Package-owned code chooses the source region and supplies the
  exact ref. Inactive package files and directory names cannot affect selection.
- Scope boundary: D2b removes Browser Preview source ownership and the Core Replica candidate discovery. The larger
  Frontend Design prompt/schema/output/finalizer topology is D2c and must be replaced vertically later; merely deleting
  its prompt or relaxing its schema is forbidden. D2b remains open until package publication and all real consumers
  use exact refs, even if an infrastructure sub-slice is independently accepted and pushed.

### Exhaustive call-point disposition

| Surface                                                        | Current defect                                                                                                                 | D2b disposition                                                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `browser-preview/region-schema.ts`                             | `reference.png` and `web-clone-source/reference.png` are aliases mislabeled as IDs.                                            | Replace with canonical strict `TaskArtifactRefSchema`; delete old enum/type and field.                                                |
| `browser-preview/source-reference.ts`                          | Reconstructs `frontendDesignPaths(...).sourcePackageAbsolute` and performs only lexical containment.                           | Delete; verified TaskArtifact read is the only byte source.                                                                           |
| `browser-preview/region-comparison.ts`                         | Reads the reconstructed mutable path and does not persist exact source identity.                                               | Consume verified immutable bytes and persist the exact ref/digest.                                                                    |
| `browser-preview/scroll-slice-comparison.ts`                   | Same alias enum plus a fixed Replica default.                                                                                  | Require exact ref without default; retain generic capture/crop/SSIM.                                                                  |
| `browser-preview/local-module-source-binding.ts`               | Scans four Replica-specific source/skeleton formats and chooses candidates through fallback ranking.                           | Move source selection to the Frontend Replica package; Core keeps only explicit binding comparison.                                   |
| `tool/browser-preview-reference-regions.ts`                    | Combines domain discovery with comparison, defaults the Replica path and converts every failure to a successful failed result. | Replace with a thin generic explicit-binding tool or delete if the existing route is the single caller surface; no swallowed failure. |
| `tool/browser-preview-compare-scroll-slices.ts`                | Propagates the fixed default and description.                                                                                  | Require exact ref and describe generic source evidence.                                                                               |
| `visual-qa/agent.ts`, tool ID registries and package manifests | Project the specialized wrappers; Frontend Innovate receives tools whose implicit source producer does not exist.              | Project only satisfiable generic tools; Replica projects its package selector; Innovate loses unsatisfied grants.                     |
| Frontend Replica `prepare-source-context` and payload          | Returns mutable project paths/digests but publishes no exact reference image ref.                                              | Publish the reference PNG through `context.host.taskArtifacts` and return the canonical named ref; regenerate payload.                |
| OpenAPI/SDK/docs/tests                                         | Encode the old enum and many path fixtures.                                                                                    | Regenerate from source; use real published snapshots and strict old-shape negative tests.                                             |

Production/test scans covered `BrowserPreviewSourceReferenceArtifactID`, `resolveSourceReferencePath`,
`reference_artifact_id`, `sourceReferenceArtifactID`, `source_reference_artifact_id`, fixed
`web-clone-source/reference.png`, both Browser Preview tool IDs, TaskArtifact ABI/store/host calls, Frontend Replica
package/payload, Frontend Innovate grants, Visual QA construction, route/OpenAPI/SDK and all region/scroll/local-module
tests. Core `frontend-design/{agent,schema,output-tools,handoff}`, `build/prompt-context`, `engine/codebase-tools`,
runtime path helpers and the HTML skeleton benchmark are recorded for D2c rather than silently accepted.

### Independent investigation feedback and implementation order

Three read-only agents agreed that the two aliases, fixed resolver, defaults and Core Replica discovery are invalid,
and that generic comparison must remain. One initially proposed a strict current-task runtime path; two independently
required immutable content identity. The earlier accepted TaskArtifact architecture resolves that disagreement in
favor of the existing exact ref ABI: using a path would recreate the already rejected mutable second authority.

D2b proceeds in independently reviewed and pushed sub-slices without claiming the whole cutover early:

1. Extract one read-only verified TaskArtifact ref service from the existing Store verifier. Package execution keeps
   its non-terminal lifecycle check; generic historical evidence read supplies explicit project/task authority and
   reuses the same manifest/inventory/link/hash verifier. Tests cover terminal read plus all ownership/integrity
   negatives and prove package publication behavior is unchanged.
2. Atomically connect Frontend Replica reference publication, package-owned source binding, explicit generic region
   and scroll comparison, evidence provenance, projections and generated contracts. Delete the old alias resolver,
   Core candidate scanner, specialized wrapper/defaults and stale positive tests in the same accepted tree.
3. Run focused real Registry/Resolver/package execution, TaskArtifact, route/tool/comparison, generated payload,
   OpenAPI/SDK/docs, dead-code and residue matrices; bind every frozen sub-slice and final D2b tree to three independent
   reviews before commit/push.

### D2b1 implementation evidence before exact-tree review

The canonical Store now has one shared verified-ref reader. Both package execution and the exported read-only service
parse the same canonical ref, verify the same committed snapshot manifest and complete inventory, read the same
regular non-linked file with descriptor/path identity checks, validate bytes and SHA-256, and reverify the snapshot
after reading. The only policy difference is explicit: package execution retains its active/non-terminal execution
scope and task-runtime-directory checks, while historical read validates exact task/project/primary-root authority
without reopening a package execution or requiring a non-terminal Task.

The existing publication/read/materialization/integrity suite plus new read-only assertions reports `17 pass / 0
fail`. It proves cross-task, foreign project identity, wrong project root and committed-byte mutation rejection;
terminal historical read succeeds while a package execution read for the same terminal task still fails. OpenCorvus
typecheck and diff checks pass. Browser Preview has not been migrated in D2b1, so D2b remains open. Exact-tree review
is required before this infrastructure sub-slice is committed and pushed.

The first D2b1 frozen candidate (`5a1cb50a4aa90e78846d088b39648262eae1d217`, tree
`a4505ec19507c14e6d023376ff9cfc08b206c687`) is rejected. Two reviewers accepted the shared verifier and tests, but
the final reviewer correctly found that the exported read authority/service had no production caller yet. Production
Knip does not report an intentionally exported symbol as dead, so its green result cannot justify publishing a
preparatory API. D2b1 must merge into the first real Browser Preview exact-ref consumer tree; neither prior ACCEPT
transfers, and the rejected tree must not be committed or cited as a delivered sub-slice.

### D2b implementation review correction

The first producer implementation attempted to publish only `reference.png`, inject its ref into the mutable project
source-package manifest, and then rename that directory into place. Independent review rejected this ordering: a failed
directory publication would leave a committed but unreachable snapshot, while reversing the order would leave a mutable
package without its required immutable identity if TaskArtifact publication failed. Compensating deletion or recovery
would add another transactional protocol and fallback path. The corrected single-source design is therefore:

- `prepare-source-context` builds the complete source-context tree directly in a TaskArtifact stage and publishes one
  complete inventory. Its result is `TaskArtifactSetResultSchema`, with the source-context manifest as the set manifest
  and `named_artifacts.reference_image` as the exact PNG ref.
- The package no longer publishes or replaces a mutable `source_package_path`. Downstream package tools accept the exact
  artifact set, materialize its declared snapshot/tree through the task host, and consume that verified immutable tree.
- Browser Preview consumes only `named_artifacts.reference_image`. Project/runtime paths remain presentation paths for
  Browser Preview's own generated evidence, never source identity.
- Generic Browser Preview path traversal treats a valid `TaskArtifactRefSchema` object as atomic before inspecting keys;
  its internal `path` is not a Browser Preview runtime file. Persisted comparison capture uses strict operation-specific
  schemas and revalidates the pinned TaskArtifact ref when historical evidence is read.

This correction also incorporates independent findings that the generated payload and SDK remain old until regenerated,
that direct package tests still lack a task-artifact host, and that a generic comparison result must not label a passing
task-scoped run as formal acceptance proof. The implementation tree cannot be frozen until these are resolved and real
package publication/materialization plus historical comparison evidence tests pass.

### D2b final implementation evidence before exact-tree review

- The Frontend Replica source researcher now publishes the complete prepared source-context tree as one immutable
  TaskArtifact set. Its exact named identities are `reference_image` and `source_context_manifest`; the interface
  modeler materializes that snapshot through the task host and rejects both equal and descendant output paths before
  writing. The real projected-package integration test proves the snapshot remains readable and byte-identical after
  each rejected overlap.
- Browser Preview region and scroll comparison accept only exact PNG `TaskArtifactRefSchema` values, validate every
  source before creating a job, persist the exact ref in strict operation-specific capture, and revalidate it on
  historical evidence reads. The old path aliases, fixed Replica default, source resolver, 1,425-line Core candidate
  scanner, specialized wrapper and its 2,105-line legacy test are deleted without aliases.
- Generated expert-squad payload, OpenAPI and JavaScript SDK were regenerated from source. The SDK contract explicitly
  rejects the retired `source-binding` operation. Residue scans leave fixed `web-clone-source/reference.png` only in
  the recorded D2c Frontend Design/Build topology and its tests; the two remaining `reference_artifact_id` occurrences
  are strict old-shape negative tests.
- Final focused evidence before freezing: TaskArtifact/package/ABI/path traversal `66/66` with 580 assertions; prompt
  profile `16/16` with 212 assertions using an explicit 30-second runner budget; Browser Preview region/scroll/tool
  matrices `72/74` with both Windows isolated-Git-helper failures passing unchanged in isolation; route/region matrix
  `45/46` with its same helper failure passing unchanged in isolation; Visual QA/orchestrator/SDK matrix `160/161`,
  followed by the corrected SDK contract at `2/2`; payload generation `8/8`; repository package projection's MCP
  process failure passed unchanged in isolation at `1/1` with 157 assertions. OpenCorvus and JavaScript SDK typechecks,
  route inventory, docs single-source check, Overlay i18n, Knip production dead-code scan, historical links and
  `git diff --check` pass. The isolated Windows helper outcomes are recorded evidence, not product fallback logic and
  not silently reported as a clean concurrent run.

### D2b first final-tree review rejection

All three independent reviewers rejected frozen fingerprint `fa78548f2c82c53e36c3cf8b87755e9d57f2ff0e`, tree
`72b54eb8a885efc082b4bd1422293e2a073b17af`. That tree is invalid completion evidence and no earlier ACCEPT transfers.

- Scroll-slice comparison wrote source/crop files into the final job before PNG, bounds and browser capture completed.
  The corrected implementation validates immutable bytes in memory, prepares all files in a task-scoped sibling
  directory, removes that directory on every failure and renames it into the Browser Preview job only after capture,
  evaluation and composition complete. Invalid PNG, out-of-bounds and late-browser-error tests must assert both no
  published job and no preparation directory.
- The interface modeler materialized the declared snapshot but did not read every caller-supplied artifact ref, so a
  forged bytes/hash ref could enter generated provenance. It now reads every set member through the exact TaskArtifact
  host before generation; a forged-ref test must prove rejection before output.
- Comparing output only with a random materialization did not protect the committed snapshot. `ToolHost` now exposes
  the platform's canonical managed runtime directory, and project-output publication must be disjoint from that root.
  Tests target both a real committed snapshot root and its tree, then prove the original exact ref is still readable.
- Generated replacement guidance still contained `web-clone-source/reference.png`; that mutable alias is deleted rather
  than replaced with another string identity. The exact `referenceArtifact` remains the only generated provenance.
- A passing generic comparison was still labelled `referenceComparisonProof: true`. Generic comparison is task-scoped
  evidence for reviewer inspection, not the reviewer report itself, so every Browser Preview tool now returns false for
  that metadata field. Formal acceptance remains in the visible Visual QA report protocol.

### D2b corrected final evidence before second freeze

- The rejected-tree corrections pass their direct matrices: TaskArtifact ABI/store, real projected package execution
  and atomic path traversal `66/66` with 589 assertions; scroll/region schema and failure cleanup `10/10` with 92
  assertions; Browser Preview plus the canonical plugin host `24/24` with 111 assertions; SDK and Visual QA strict
  fidelity `13/13`; payload freshness `8/8`. The package integration now rejects real committed snapshot root/tree
  outputs and forged set-member refs while preserving exact source bytes.
- The broader replay passes Orchestrator/Visual QA `159/159`, Resolver/repository package projection `28/28` with
  1,021 assertions, and historical document health `21/21`. Region/route/browser-server coverage reports `45/46` only
  because one Windows Node sidecar exited with empty stdout; the unchanged failing case passed alone at `1/1` with 17
  assertions. This is retained as an isolated environment observation under the user's Windows-resource exclusion,
  not rewritten as a clean concurrent run.
- Root typecheck, plugin and OpenCorvus typechecks, SDK import/runtime checks, API route inventory, generated API docs,
  Overlay i18n, Knip production dead-code scan, payload regeneration/freshness and `git diff --check` pass. The package
  generator no longer emits the retired reference alias, production comparison tools never claim formal proof, and the
  remaining fixed `web-clone-source/reference.png` references are exactly the recorded D2c Core Frontend Design/Build
  vertical topology rather than hidden D2b residue.

### D2b second freeze withdrawn by Codex review

Fingerprint `e070685d08cba5d9feb7ba9017baeb1eaeae9691`, tree
`8fea0a296f54ce2474380540443d9df9c758e6aa` was withdrawn before reviewer conclusions. The package generator used
`Promise.all(taskArtifacts.read(...))` across every source-context member. Each read performs two full committed
snapshot inventories and returns the file bytes, so an N-file set caused repeated O(N-squared) filesystem work and
held all returned bytes concurrently. Correctness on small fixtures did not make that a stable platform contract.

The corrected generic ABI adds `taskArtifacts.verify({ snapshot, artifacts })`. Store owns one complete committed
snapshot/inventory/link/hash verification and then binds every caller-supplied ref to that exact snapshot manifest;
it returns no business bytes. Package code invokes this once before generation. Store tests cover a valid complete
publication, a forged bytes field and a ref whose snapshot identity differs from the explicitly verified snapshot.
The second frozen tree and any review started against it cannot be completion evidence.

### D2b third freeze rejected: artifact-set completeness and generated identity

The third candidate (fingerprint `6f33d24e672b43030f02af4b2f4b2ec7245624e5`, tree
`5017cda263866f6ac637186fa1782f8c32340764`) is rejected and cannot be cited as accepted. The Browser Preview reviewer
accepted the exact-ref read, atomic job publication, failure cleanup and non-acceptance-proof behavior. Two independent
package/platform reviewers found the same remaining identity split, and the platform reviewer found an additional
generic ABI defect:

- `generate-source-project` manufactured `task-artifact:<snapshot>/<tree>` without project, task or manifest digest;
  the generator persisted it as `sourcePackageRef` while separately persisting the exact reference ref.
- The generator copied the immutable source image into mutable output `reference.png`, stored that path in
  `visualIteration.referenceImage`, and instructed downstream work to compare against it. The package context and
  researcher prompt also described a visible task-runtime/project-root `web-clone-source/` package after that mutable
  publication surface had been removed.
- `TaskArtifactHost.verify({ snapshot, artifacts })` verified one committed snapshot and each supplied ref, but did not
  prove that the supplied array was the complete declared tree inventory. A sorted subset could therefore be accepted
  and then materialized as a larger tree, making the caller's artifact-set claim false.

Full call-point scan before correction found one production `taskArtifacts.verify` caller, one Host ABI declaration,
one Store implementation, and Store/package tests. `sourcePackageRef` exists only in the package generator input,
test driver, generated README/manifest and the interface-modeler wrapper. Output-side `reference.png` is created only
by `copyReferenceImage`; its string identity is consumed by the generated README, manifest visual iteration and one
positive test. Core Frontend Design `web-clone-source` topology remains explicitly assigned to D2c and is not silently
edited in this D2b correction.

The correction is a replacement, not compatibility:

1. `TaskArtifactHost.verify` accepts one parsed `TaskArtifactSet`. Store compares its ordered refs exactly against the
   selected committed manifest tree, including length, path, media type, bytes and SHA-256; omitted, extra, duplicate,
   foreign-tree and forged entries fail before generation.
2. Generator input carries the exact `source_context_manifest` and `reference_image` refs. Generated provenance stores
   those structured refs only. Delete `sourcePackageRef`, the `task-artifact:` string, `copyReferenceImage`, output-side
   `reference.png` and every instruction that treats a local path as comparison authority.
3. Package prompts and source-context prose describe the immutable artifact set and direct runtime comparison through
   `named_artifacts.reference_image`. Relative filenames may describe files inside a verified materialization, but do
   not become a dispatch, comparison or persisted provenance identity.
4. Tests must reject subset/extra/duplicate set members, assert no output `reference.png` or string source identity,
   and assert the two canonical exact refs in generated provenance. Regenerate payload and bind all reviews to a new
   exact tree; no ACCEPT from the rejected tree transfers.

### D2b fourth-candidate evidence before freeze

The correction now replaces the generic Host signature with `verify(artifactSet)`. The Store parses the canonical set,
verifies the committed snapshot once, selects the declared tree and compares every ordered ref plus total length with
that tree's complete manifest inventory before materialization. Store/ABI tests cover omitted, extra, duplicate,
foreign-tree/snapshot and forged metadata. The projected Frontend Replica package test also proves a structurally valid
two-member subset fails before output publication.

The source-project generator no longer accepts or emits `sourcePackageRef`, manufactures no `task-artifact:` string,
copies no output-side reference image and stores no path-valued `visualIteration.referenceImage`. Its one generated
provenance object contains the exact source-context manifest ref and exact reference-image ref. Generated README,
replacement plan and iteration guidance point to that structured ref; package source-context prose and the dynamic
researcher prompt name the immutable artifact set and `named_artifacts.reference_image`, not a task-runtime or
project-root source package. Payload was regenerated from those package sources.

Verification after the correction:

- TaskArtifact/Frontend Replica/payload/plugin matrix: `87 pass / 0 fail`, `778` assertions. The earlier focused runs
  also reported Store/ABI `37/37`, package generator `28/28`, and package/source-context/payload `45/45`.
- Browser exact-ref/region/scroll/tool short matrix: `41 pass / 1 fail`; the only failure was a Windows temporary-repo
  seed `git commit` returning empty output while tests ran concurrently. The exact unchanged case then passed alone
  (`1/1`). This is recorded under the user's Windows helper/resource exclusion, not rewritten as a clean group run.
- Prompt/Visual QA/Build feedback/metrics matrix: `121 pass / 1 fail`; the failure was a stale assertion for the removed
  `reference screenshots` wording. The assertion now requires the exact named ref wording and its isolated replay is
  `1/1`. Historical document health is `21/21` with 70 assertions.
- Root typecheck passes 9 tasks across 11 packages; plugin and OpenCorvus direct typechecks pass. Knip production
  dead-code, API docs freshness (`273` operations / `23` groups), route inventory (`6` rules / `30` files), Overlay
  i18n, payload freshness and `git diff --check` pass.

Two deliberately over-broad combined test invocations reached their outer command limits without returning results;
they are not completion evidence. Their affected behavior was split into the attributable matrices above. The next
step is to stage the exact tree, record its fingerprint/tree and require three new independent reviews; no earlier
candidate review transfers.

### D2b fifth freeze rejected: runner boundary, atomic persistence and false output options

The fifth candidate (fingerprint `8eeae269409045aeb1dd943df4ae3ebff02f9171`, tree
`9289cb1497857a855484a92cb16303be63a3d905`) is rejected and cannot be cited as accepted. The package reviewer
accepted the complete TaskArtifact set and generated provenance correction. The Browser Preview and platform
reviewers found three independent remaining contract defects:

- The exported region capture runner resolved and created an arbitrary caller-provided `outDir` without proving that
  it was the current Task's preparation directory. Its only current production caller was safe, but the runner ABI
  itself permitted a future caller to write screenshots outside the project runtime boundary.
- Region publication renamed the prepared directory first, then persisted evidence rows one at a time, and only then
  wrote the manifest. A later row or manifest failure could therefore leave committed rows pointing to a deleted job.
- `include_fullpage_overview` and `include_side_by_side` survived from the deleted specialized wrapper as public
  request/OpenAPI/SDK options, but neither controlled behavior. The former had no producer or sidecar reader; the
  latter was propagated into a materializer that always generated `side-by-side.png`.

Full call-point enumeration before correction found one production region-runner caller; runner/result type and
sidecar payload/result declarations in `evidence-runner.ts`; request/input/materializer propagation in
`region-comparison.ts`; route and tool adapters; two browser-tool fixtures; one strict-schema fixture; and generated
OpenAPI plus JavaScript SDK surfaces. `persistBrowserPreviewEvidence` remains a valid generic single-evidence API with
callers across Browser Preview routes, metrics, orchestrator, Visual QA and tests; the region comparison loop is the
only production multi-row publication that must use a new transactional batch call. `recordEngineArtifact` already
participates in the active `Database.transaction` context, so no parallel persistence implementation is needed.

The replacement plan is:

1. Validate the runner's explicit preparation path as a direct `.browser-preview-region-preparing-*` child of
   `ProjectRuntimePaths.taskRoot(projectRoot, taskID)` before any filesystem or sidecar work. Add a negative runner
   test for a project-external directory.
2. Write the complete public manifest after atomic directory rename but before database publication. Persist the
   complete evidence array through one synchronous `Database.transaction`; a validation failure in a later member
   must roll back every earlier row. With no fallible operation after commit, catch cleanup cannot create dangling DB
   references. Add a real rollback test and retain success/readability plus aborted-runner cleanup coverage.
3. Delete both false output options from the strict request schema, internal input, runner payload/result, route/tool
   adapters, fixtures and generated contracts. Side-by-side remains the required canonical comparison artifact;
   `include_diff` remains the only optional generated comparison output. Add schema negatives proving the removed
   options are rejected, then regenerate OpenAPI/SDK from the sole source.
4. Re-run focused region/runner/persistence/tool/route/generated-contract tests, root typecheck, dead-code and residue
   scans, refreeze a new exact tree and require three new independent reviews. No prior ACCEPT transfers.

### D2b sixth-candidate evidence before freeze

The rejected fifth-tree findings are now replaced in production and contract surfaces. The region runner validates its
explicit output as a direct `.browser-preview-region-preparing-*` child of the current Task runtime root before any
directory or sidecar operation. Region publication allocates the final evidence IDs, writes the manifest containing
those identities, then commits the full evidence array through one synchronous database transaction; there is no
fallible operation after the commit. A real two-entry test makes the second input fail validation and proves the first
insert rolls back. The existing late-runner test still proves no published job or preparation residue, and successful
region tests re-read the persisted evidence and final rebased artifacts.

The two false output options are deleted from source schema, internal runner/materializer inputs, route/tool adapters,
sidecar/result declarations and regenerated OpenAPI/JavaScript SDK. Strict schema tests now reject both retired keys;
the generated-contract test proves `include_diff` is the sole output property and both retired names are absent from
SDK types. Residue scans find the names only in those negative tests.

Verification before the sixth freeze: focused runner/region/schema/SDK/history coverage passes `55/55` with 363
assertions; the broader runner/region/schema/route/tool/SDK matrix passes `79/80` with 517 assertions, with its sole
Windows temporary-Git-helper failure passing unchanged alone at `1/1`. Root typecheck passes nine tasks across eleven
packages. Knip production dead-code, API route inventory (`6` rules / `30` files), docs freshness (`273` operations /
`23` groups), SDK generation, historical links and `git diff --check` pass. The Windows helper result remains an
environment observation under the user's exclusion, not a product fallback or a claimed clean concurrent run.

### D2b fourth freeze rejected: region late-failure publication

Fingerprint `140970401bb77791f0a7d8b49dcc70e571a1d07d`, tree
`a5bc6ecae3f4b34297681e1b33ae209dbfefefec` is rejected and cannot be cited as accepted. The platform reviewer
accepted the complete artifact-set ABI. The package reviewer confirmed the prior identity split was removed but found
one unused `sameTaskArtifactSnapshotIdentity` Store import. The Browser reviewer found the substantive defect:

- Region comparison prevalidated all exact refs, but then wrote source images into the final `bp/<jobID>` directory
  before invoking the Node sidecar. The runner also created that final directory. An aborted launch, non-zero exit or
  `{ok:false}` result threw without deleting source/implementation files, leaving a partial published job.
- Full call-point scan finds one production caller of `runBrowserPreviewRegionComparisonCapture`; it can be replaced
  directly without compatibility. Region comparison job roots are consumed by result/persistence paths and tests;
  the Scroll implementation already demonstrates the required sibling preparation and atomic rename pattern.

The fifth candidate must remove the unused import and apply the existing Scroll publication model to Region: validate
all source refs and PNG bounds before preparation, require the runner to write into an explicit preparation directory,
materialize every crop/diff there, rename to the final job only after all filesystem work succeeds, then rebase known
structured artifact/screenshot paths to the final root. Any pre-rename failure removes the preparation directory; any
post-rename failure removes the final job. A real aborted-runner regression must assert no `bp` job and no
`.browser-preview-region-preparing-*` residue. Earlier ACCEPT responses do not transfer.

### D2b fifth-candidate evidence before freeze

Region comparison now resolves and decodes every exact source ref before creating a preparation directory. Its sole
runner caller passes that explicit sibling directory; source images, implementation screenshots, crops, side-by-side
images and diffs are completed there. Only then is the directory renamed to the final Browser Preview job. Known
structured screenshot/artifact paths are rebased to that final root before persistence and manifest serialization.
Pre-rename failures remove preparation; post-rename failures remove the final job. The Store's unused import is gone.

The new real aborted-runner test passes and observes neither a `bp` job nor a
`.browser-preview-region-preparing-*` directory. Full region comparison passes `14/14` with 202 assertions, including
real successful screenshots and persisted comparisons; runner contract passes `13/13` with 57 assertions. Route,
state, bbox and visible-locator replay reported `19/20` only because its source assertion still named the already
removed `region-comparison` type import; after correcting that stale assertion to the existing `region-schema` source,
the runner contract passed completely. Scroll/strict-schema/atomic-ref replay passes `10/10` with 78 assertions.
Root typecheck passes 9 tasks, Knip production dead-code passes, the Store import residue scan is zero and
`git diff --check` passes. A fifth exact tree and three new reviews are still required; no fourth-tree conclusion
transfers.

### D2b sixth freeze rejected: remaining evidence publication call points

The sixth candidate (fingerprint `846e8c40cd3b8cf0271dfa43bcc5236436ff720a`, tree
`354579a74f9e62ee06c6c576e95d7883f06ee2b1`) is rejected and cannot be cited as accepted. The independent package
review accepted the TaskArtifact and Frontend Replica package surfaces, but both Browser Preview and platform reviews
independently found that the atomic publication correction had not covered all production call points:

- `scroll-slice-comparison.ts` committed its one evidence row before writing the manifest. A manifest failure then
  removed the published job but retained a row pointing to deleted files, exactly the Region defect already removed.
- `verification-core.ts` persisted multi-viewport capture evidence one row at a time. A later-row failure retained the
  earlier prefix even though the capture operation rejected. Its files and manifest already existed, so this was not
  a dangling-file variant, but it was still a partial database publication.
- The earlier Recall statement that Region was the only production multi-row publisher was false. Full production
  enumeration shows Region, Scroll and multi-viewport Verification as the three publication workflows; Layout
  Geometry writes its manifest before one valid single-row persist and does not delete that file after a DB failure.
  Test/helper direct single-row calls remain valid consumers and do not define a multi-artifact publication workflow.

The correction must reuse the existing batch transaction rather than add another persistence path. Scroll preallocates
its evidence ID, constructs and writes the complete public manifest, then commits the one-entry batch; its catch removes
the final job on either manifest or DB failure. Verification preallocates every viewport evidence ID and commits the
complete array once after capture artifacts and manifest exist; on batch failure it removes that unpublished job.
Tests must prove the generic second-entry rollback, assert production Region and Verification use the batch API, and
retain real Scroll/Verification success plus Scroll pre-publication cleanup. After correction, rerun the complete
Browser Preview publication matrix and bind three new reviews to a new exact tree; no sixth-tree ACCEPT transfers.

### D2b seventh-candidate evidence before freeze

All three production Browser Preview publication workflows now share one evidence transaction contract. Region and
multi-viewport Verification preallocate the complete ID set and commit one batch; Scroll preallocates its single ID and
uses the same batch surface. Region and Scroll write their public manifest before database commit and have no fallible
operation after commit. Verification receives the completed capture manifest from its runner before committing all
viewport rows together, and removes the unpublished job when the batch fails. Layout Geometry remains the enumerated
single-row case whose manifest is written before persistence.

The real Scroll fault-injection test forces only `manifest.json` writing to fail after browser capture and atomic job
rename. It proves the call rejects, no evidence row exists, no final job leaf or preparation directory remains, and only
the empty concurrency-safe fanout parent may remain. The generic two-entry rollback test proves a later validation
failure leaves zero rows; Verification's real two-viewport success test plus its source contract bind production to the
batch API rather than the retired per-viewport call.

Verification before the seventh freeze: runner/Region/Scroll/Verification/schema coverage passes `49/49` with 439
assertions. Route/tool/SDK/exact-ref/history coverage reports `69/70` with 317 assertions; the only failure is the same
Windows process-supervisor Git helper exiting before readiness, and the unchanged case passes alone at `1/1`. Root
typecheck passes nine tasks across eleven packages. Knip production dead-code, API route inventory (`6` rules / `30`
files), docs freshness (`273` operations / `23` groups), Overlay i18n, SDK generated residue, historical links and
`git diff --check` pass. The next step is a new exact freeze and three independent reviews; no earlier conclusion
transfers.

### D2b seventh freeze rejected: incomplete job publication coverage

The seventh candidate (fingerprint `f433c8a890b3fa355532c5289b7cefacbf0b4f9e`, tree
`a1cba57ca6010d16d4a744ee3c426dd40e9902c7`) is rejected and cannot be cited as accepted. The package reviewer again
accepted the unchanged TaskArtifact/Frontend Replica surfaces. The Browser and platform reviewers independently found
that two Browser Preview producers still wrote directly into their final public job:

- Verification passed its final `bp/<jobID>` directory to the evidence runner. That runner created it before starting
  the sidecar, so a launch/result/exit/finalization/manifest failure left an empty or partial public job. Core cleanup
  covered only the later batch persistence failure.
- Layout Geometry created its final job before capture. Capture or manifest failure left a partial job; database
  failure left an unreferenced manifest. Being a single-row producer avoids prefix DB commits but does not exempt its
  filesystem publication from the same contract.

The prior Recall claim that all production workflows shared one contract and that Layout was an acceptable single-row
exception was false. The complete correction is now four producers: Region, Scroll, Verification and Layout Geometry.
Verification's runner must prepare screenshots, diagnostics and manifest in a task-scoped sibling, atomically rename
only after completion, and rebase every structured capture/manifest path to the final root. Core retains responsibility
for deleting that final job if its later evidence batch fails. Layout must capture before creating output, write its
manifest in a sibling preparation directory, rename atomically, then commit its preallocated one-entry batch; every
failure removes preparation or final output. Real aborted-runner and Layout capture/manifest failure tests must assert
no job leaf, no preparation residue and no evidence row. A new exact tree and three fresh reviews are mandatory.

### D2b eighth-candidate evidence before freeze

The complete production call-point scan now finds exactly four Browser Preview job producers: Region, Scroll,
Verification and Layout Geometry. Each creates a task-scoped sibling preparation directory, completes its filesystem
work there, atomically renames to the final fanout job, then commits its preallocated one- or multi-entry evidence
batch. Any pre-rename failure removes preparation; manifest rebase/write or database failure after rename removes the
final job. The capture runner accepts only the Verification preparation directory, while Core owns rename, structured
capture/manifest path rebasing and the final evidence transaction.

New real failures prove an aborted production Verification sidecar leaves no public job, preparation directory or
evidence row; Layout capture failure creates no runtime output; Layout manifest failure leaves no job, preparation or
evidence. The existing Scroll manifest fault and Region aborted-runner/batch rollback tests remain green. The successful
production East Asian glyph capture now runs through `verifyBrowserPreview`, re-reads persisted final evidence and
proves no preparation path survives in its capture payload.

Verification before the eighth freeze: the four-producer Browser Preview/route/tool/SDK matrix reports `103/104` with
707 assertions. Its sole failure is the unchanged Windows Git helper readiness failure, and that exact case passes
alone at `1/1`. TaskArtifact/Frontend Replica/plugin host/exact-ref/history passes `72/72` with 589 assertions. Focused
Verification/Layout/runner/routes passes `56/56` with 299 assertions. Root typecheck passes nine tasks across eleven
packages. Knip production dead-code, API route inventory (`6` rules / `30` files), docs freshness (`273` operations /
`23` groups), Overlay i18n, generated SDK residue and `git diff --check` pass. A new exact freeze and three independent
reviews remain required; no seventh-tree conclusion transfers.

### D2b eighth freeze rejected: screenshot rename fallback

The eighth candidate (fingerprint `ae76d62cd89ba943d15e39e683858295e7ac5e3d`, tree
`ac525af6612a4274123d73db7131f1d4edaae7d3`) is rejected and cannot be cited as accepted. The package reviewer
accepted the TaskArtifact/Frontend Replica surfaces, and both Browser/platform reviewers accepted the four-producer
publication structure, but independently found one explicit fallback inside Verification finalization:

- `finalizeBrowserPreviewSidecarCapture` attempted a same-directory rename from the viewport filename to the
  content-addressed filename, then caught any rename error and copied instead. This hid the real filesystem failure,
  retained the original file, created a second undeclared file and allowed publication to continue with dual output.
- Source and destination are in the same validated preparation directory, so there is no cross-device case to support.
  The only valid contract is a successful rename or a visible failure handled by the existing preparation cleanup.

The correction deletes `catch(copyFile)` without replacement. A filesystem fault-injection test must make rename fail,
prove `copyFile` is never called and the hashed target is absent, while the existing aborted production Verification
test continues to prove upstream preparation cleanup. Re-run the focused runner/Verification matrix, refreeze and
require three new reviews; no eighth-tree conclusion transfers.

The post-rejection success-fallback scan also found three sibling violations in the same changed producer set:
Layout converted `locator.isVisible` errors into a normal invisible result; Scroll converted network-idle inactivity into
continued capture; and Layout/Scroll sidecars swallowed context/browser close failures. These are deleted rather than
documented as exceptions. Locator, readiness and cleanup failures must remain visible and flow into the same preparation
cleanup. The navigation inactivity contract test must reject the retired continue-on-timeout branch.

### D2b ninth-candidate evidence before freeze

The screenshot finalizer now performs one same-directory rename and exposes any filesystem failure. Its fault-injection
test proves `copyFile` is never called, the content-addressed destination is absent and the original preparation file is
the only remaining file for upstream cleanup. The sibling success-fallback scan is also resolved: Layout exposes
locator and close errors, Scroll exposes network-idle inactivity and browser close errors, and the source contract test
rejects the retired inactivity-error continuation branch. The removed output option names remain only in strict
negative schema tests; no production or generated SDK surface contains them.

Verification on the current working tree passes the complete Browser Preview directory at `83/83` with 647 assertions,
including all four production publishers and the real Playwright East Asian glyph capture. The initial concurrent
focused run reported `38/39` because that glyph sidecar produced empty stdout while Bun removed a dangling process; the
exact test passed alone and then passed again inside the complete directory run, so the failed aggregate is retained as
an observed concurrent-runner event rather than cited as product acceptance. Root typecheck passes nine tasks across
eleven packages; Knip production dead-code, API route inventory (`6` rules / `30` files), docs freshness (`273`
operations / `23` groups), Overlay i18n and residue scans pass.

Related package and contract coverage was rerun in bounded responsibility groups. Agent/profile/package/plugin/history
coverage passes `106/106` when the one provisioning case is run with the repository-required Bun elapsed timeout
disabled; its 6.3-second duration demonstrates why the default 5-second Bun timeout is not valid evidence. Metrics,
build-feedback, Browser Preview routes/SDK and TaskArtifact pass `69/69`; the two changed orchestrator-tool cases pass
`2/2`; browser tool and Visual QA pass `66/66`. A broad combined command exceeded the shell tool's elapsed limit and
left its Bun child alive without a retrievable result; only those exact test PIDs were stopped, and no OpenCorvus or
Overlay process was touched. That aggregate is not claimed as a pass. The ninth exact tree still requires three fresh
independent reviews; no eighth-tree conclusion transfers.

### D2b ninth freeze rejected: Region request/result set integrity

The ninth candidate (fingerprint `52de4c95712093074efc4e83d702cdf7e08759b5`, tree
`ea373394881e4b9d14e11678c36fafa5adc4dae7`) is rejected and cannot be cited as accepted. The package reviewer accepted
the Frontend Replica package, TaskArtifact and generated contract surfaces. The platform and Browser reviewers found
two related Region comparison integrity defects:

- A request could name multiple viewport IDs while providing bindings for only a subset. The runner still iterated
  every requested viewport and used `/` when no binding supplied a route, producing an undeclared full-page screenshot
  for a viewport absent from the manifest and evidence rows.
- The untrusted sidecar result was not proven to be an exact one-to-one set match for requested bindings. Unknown
  entries were silently skipped; missing entries made partial output look complete; duplicate entries created multiple
  database rows while `Object.fromEntries` exposed only the last ID. Overall status was computed only from the returned
  subset, enabling false-green publication.

Full call-point enumeration finds route and package-tool adapters as the public inputs to
`compareBrowserPreviewRegions`, one production call from that function to
`runBrowserPreviewRegionComparisonCapture`, and the embedded Node sidecar as the only production result producer.
Tests call the comparison and exported runner directly. The correction is one strict contract rather than a second
loading path: before source materialization or preparation, every requested viewport must own at least one selected
binding; the runner passes only binding-derived viewports to the sidecar; and the sidecar boundary must reject any
missing, duplicate or unknown `(regionID, stateID, viewportID)` tuple before returning. The comparison maps validated
results in request order and deletes the silent `continue` branches. Negative tests must prove all four malformed set
shapes fail without a job, preparation residue or evidence row.

The Browser reviewer also found that removal of the Scroll network-idle and Layout close success fallbacks was backed
only by source-string assertions. The next candidate must add real Node sidecar behavior fault injection proving those
errors reach the host and the producer cleanup leaves no public job, preparation directory or evidence. A new exact
tree and three fresh reviews are mandatory; the ninth package ACCEPT does not transfer.

### D2b tenth-candidate evidence before freeze

Region comparison now has one request identity source: selected viewports are derived from `inlineBindings`, and the
public compare request, route adapter, package tool, OpenAPI document and generated JavaScript SDK no longer expose a
second `viewportIDs` field. The runner derives its sidecar viewport list from those same bindings. Before publication,
the sidecar boundary requires an exact one-to-one match between requested and returned canonical
`[viewport_id, state_id, region_id]` tuples and rejects missing, duplicate, unknown, incomplete-completed and
reasonless-failed rows. Comparison consumes the validated Map in binding order; the previous `find + continue` and
malformed-completed downgrade paths are deleted.

Real isolated-process fault tests exercise the complete comparison cleanup path for missing, duplicate, unknown and
incomplete-completed sidecar results. Separate real Node sidecar tests prove Layout context/browser close errors reach
the producer, and a real Playwright page with a never-ending request proves Scroll network-idle inactivity rejects
without a public job, preparation directory or evidence row. Scroll now receives the executor-projected Playwright
module path instead of hardcoding a package resolution path.

Freeze self-review found and corrected a further identity projection defect before review: the embedded Region sidecar
sanitized tuple text without a digest, so distinct tuples could overwrite the same implementation screenshot, while
the main comparison also used raw `state_id` as a filesystem segment. Both filesystem projections now use the same
SHA-256-suffixed tuple naming rule, and raw state identity no longer enters a directory segment. The existing real
multi-state comparison uses `compact:state` and `compact?state`, which collide under the retired sanitizer and contain
Windows-invalid path characters; it now passes with distinct screenshots, artifacts and evidence IDs.

Final verification on this working tree: the complete Browser Preview directory passes `89/89` with 669 assertions
after the filesystem identity correction. Focused strict-set, Scroll inactivity and Layout close coverage passes
`31/31` with 166 assertions; Browser Preview route/tool/generated-SDK contracts pass `48/48` with 247 assertions.
OpenCorvus and root typecheck pass, the latter with nine tasks across eleven packages. Knip production dead-code, API
route inventory (`6` rules / `30` files), docs freshness (`273` operations / `23` groups), Overlay i18n, historical
links (`21/21`) and `git diff --check` pass. Residue scans confirm compare-request `viewportIDs` survives only in strict
negative assertions, while remaining production `viewportIDs` belong to the distinct capture/verification operation.
This evidence is not acceptance: the exact staged tree and fingerprint must remain unchanged through three fresh
independent platform, Browser Preview and package reviews.

### D2b tenth freeze rejected: sidecar authority and failure causality

The tenth candidate (fingerprint `76622febdc17473da8570d69878b2000608b8480`, tree
`740f99bc1b51b5350120c6925eb71219ddccca78`) is rejected and cannot be cited as accepted. The package reviewer accepted
the external package, Registry/Resolver, TaskArtifact, plugin ABI and generated SDK surfaces with `81/81` tests. The
Browser and platform reviewers independently rejected the Browser Preview boundary:

- Filesystem names still hashed an ambiguous colon-joined tuple instead of the canonical JSON tuple. For example,
  `(state='a:b', region='c')` and `(state='a', region='b:c')` projected to the same screenshot and region directory.
- `runBrowserNodeSidecar<T>` only cast parsed JSON to a TypeScript generic. Region exact-set checks accepted an unknown
  status and malformed field types; comparison treated every non-`failed` status as completed and could republish it.
- The sidecar remained authoritative for `screenshotPath`. The host read that path before containment validation, and
  even a preparation-contained source PNG could be presented as the implementation image to manufacture passing SSIM.
- Region, Scroll, Verification and Layout cleanup awaited `fs.rm` directly from their failure handlers. A cleanup
  failure replaced the primary failure rather than preserving both causes and the residual path.
- Evidence readability did not always require the separately persisted manifest path, so a Scroll evidence row could
  remain readable after its manifest was deleted.
- Scroll introduced `OPENCORVUS_PLAYWRIGHT_REQUIRE_PATH || 'playwright'` even though the Node executor always projects
  the sole module path; that second resolution source is a forbidden fallback.

The eleventh candidate must make the host derive the one expected screenshot path from the canonical tuple and pass it
to the sidecar, strictly parse the top-level discriminated sidecar response and every returned field before any file
read, and require each returned path to equal its binding's expected path. A shared cleanup helper must preserve the
primary and cleanup failures in an `AggregateError` and identify the residual path. Evidence readability must require
the persisted manifest itself. Playwright module resolution must fail if its projected environment path is absent.
Tests must cover delimiter collisions, unknown status, malformed bbox, forged source-as-implementation path, manifest
deletion and cleanup failure causality across all four producers. After correction, rerun the complete Browser Preview
directory and three new exact-tree reviews; the tenth package ACCEPT does not transfer.

### D2b eleventh-candidate evidence before freeze

Region now has one canonical identity and one host-owned file projection. The JSON tuple is hashed in full with SHA-256
for both the implementation screenshot and region artifact directory; the host passes the unique expected screenshot
path in each sidecar binding, rejects duplicate projected paths, and requires the returned capture and route-diagnostic
paths to equal that binding before any file read. It then requires a regular non-symlink file. The sidecar no longer
derives names or leaves the former undeclared `full.png`; navigation diagnostics write directly to the current binding's
declared screenshot. A real comparison uses the delimiter-ambiguous pairs `(state='a:b', region='c')` and
`(state='a', region='b:c')`, proves independent evidence/artifacts, and asserts the public implementation directory
contains exactly two declared 64-hex PNG files.

The Region sidecar envelope and rows are parsed with one strict Zod discriminated-union schema before exact-set
validation. The schema covers status, identity, viewport, bbox, reason and route diagnostics. The complete comparison
cleanup test now covers seven malformed shapes: missing, duplicate, unknown, incomplete completed, unknown status,
malformed bbox and a preparation-contained source PNG forged as the implementation path. Every case rejects without a
public job, preparation directory or database evidence.

All four publishers call one `throwAfterBrowserPreviewPublicationCleanup` implementation. Successful removal rethrows
the original failure; failed removal throws an `AggregateError` whose ordered causes retain both the primary and cleanup
failures and whose message names the residual path. The helper has behavioral fault injection, while the producer
contract test proves Region, Scroll, Verification and Layout contain no direct cleanup `fs.rm` path. Evidence
readability now treats persisted `manifestPath` as a first-class artifact; the real Scroll success test deletes its
manifest and observes an explicit corruption error. This stricter contract also exposed an invalid Layout test fixture
that declared but never created a preview manifest; the fixture now creates its claimed file instead of weakening
readability.

The Browser Preview evidence, Region, Layout and Scroll sidecars now require the executor-projected Playwright module
path and contain no package-resolution fallback. Freeze self-review also removed the redundant Region `full.png`
capture. Residue scans find the retired Playwright fallback only in a negative assertion, no colon tuple projection, no
producer-local cleanup call, and no Region `full.png`.

The first complete post-correction Browser Preview run reported `91/92`: the newly strict manifest read exposed the
invalid Layout fixture above. After correcting that fixture and removing the redundant Region screenshot, the complete
directory passes `92/92` with 690 assertions. Focused strict sidecar/cleanup coverage passes `18/18`; Region, Scroll and
Layout real behavior passes `26/26`; route/tool/generated-SDK contracts pass `48/48`. Root typecheck passes nine tasks
across eleven packages. Knip production dead-code, API route inventory (`6` rules / `30` files), docs freshness (`273`
operations / `23` groups), Overlay i18n, historical links (`21/21`) and `git diff --check` pass. This evidence is not
acceptance: the exact eleventh staged tree and fingerprint require three fresh independent reviews.

### D2b eleventh freeze rejected: sibling sidecar and materialization authority

The eleventh candidate (fingerprint `6bc40465e487c2893cbae9b2bfaa187a7d0f5245`, tree
`668a79004eb6791719cdd13dd59d421a1d993846`) is rejected and cannot be cited as accepted. The package reviewer accepted
the external package/TaskArtifact/projection surfaces with `137/137` core tests. Browser and platform reviews found the
strictness correction had not covered sibling producer boundaries:

- The ordinary Verification sidecar still returned unchecked JSON. Host finalization read `capture.path`, used
  unvalidated `capture.id` in a destination and renamed before matching either to requested host-owned viewport/path;
  malformed output could read or move a file outside the preparation directory.
- Scroll and Layout sidecar results also remained generic casts without strict runtime schemas, leaving Region as the
  only corrected boundary.
- Region runner retained unused optional `viewportByID` and selected it with `??` before the persisted target viewport,
  creating an alternate viewport authority and fallback.
- Region and Scroll sidecars retained `route || '/'` after upstream schemas had already required and defaulted route.
- Region caught every crop/write/Sharp/evaluator materialization exception, converted infrastructure failure into a
  normal failed region, and published the partial job instead of invoking failure cleanup.
- Cleanup failure behavior was tested only at the shared helper; the four producer wiring assertions were source
  strings and could not catch a wrong primary failure, residual path or `published` branch.
- The regular/non-symlink screenshot requirement lacked missing-file, directory and symlink negative tests.

The twelfth candidate must give Verification, Scroll and Layout strict result schemas; bind Verification viewport IDs
and screenshot paths to the host request before any read or rename; remove Region `viewportByID` and both route
fallbacks; let Region materialization infrastructure errors reach shared cleanup; exercise primary-plus-cleanup failure
through each real producer; and test regular-file rejection for missing files, directories and symlinks. A new exact
tree and three independent reviews are mandatory; the eleventh package ACCEPT does not transfer.

### D2b twelfth-candidate evidence before freeze

Verification, Region, Scroll and Layout now parse every Node sidecar result as `unknown` through strict discriminated
Zod schemas before consuming fields. Verification matches the exact requested viewport set, host-owned screenshot
path, dimensions, uncapped projection and target URL, then emits captures in request order. Scroll matches its
host-owned screenshot path and viewport. Layout matches the exact sample and region sets plus both sample and page
viewport dimensions. Region no longer accepts a second `viewportByID` authority. The two route default expressions
are deleted; the required route is passed unchanged.

The shared screenshot boundary rejects missing files, directories and symbolic links. An isolated real-producer test
mocks only the Node executor and feeds eight hostile sibling results through Verification, Scroll and Layout: forged
paths, mismatched viewport or target URL, unknown or mismatched Layout samples and mismatched Layout page viewport.
Every case rejects without a public job, preparation residue or Browser Preview evidence row. Direct finalizer tests
also reject captured results with missing structured layers instead of downgrading malformed protocol output.

Each real publisher now has behavioral primary-plus-cleanup fault injection. Verification and Layout preserve their
capture/manifest failure, Region preserves a materialization `mkdir` failure after a real sidecar capture, and Scroll
preserves a post-rename manifest failure; all four expose an ordered `AggregateError`, retain the primary as `cause`,
name the exact residual preparation or published path and persist no evidence. Region distinguishes only the explicit
`BrowserPreviewRegionGeometryError` as a normal failed comparison. Filesystem, Sharp, evaluator and other
materialization failures propagate to publication cleanup. The existing authored out-of-bounds source bbox test
continues to publish a failed region under that narrow domain contract.

The complete Browser Preview directory passes `101/101` with `721` assertions, including real Playwright glyph,
Region, Scroll and Layout execution. The related dynamic expert-squad, Frontend Replica, TaskArtifact, plugin ABI,
route/OpenAPI/SDK, orchestrator/tool and Visual QA matrix reports `345/346` with `2,604` assertions; its sole failure is
the unchanged Windows isolated Git-helper readiness error while seeding a temporary `GIT_INDEX_FILE`, which the user
explicitly excluded from this goal. Root typecheck passes nine tasks across eleven packages. Production Knip dead-code,
API route inventory (`6` rules / `30` files), docs freshness (`273` operations / `23` groups), Overlay i18n, historical
links (`21/21`) and `git diff --check` pass. This evidence is not acceptance: the exact staged tree must remain unchanged
through three fresh independent platform, Browser Preview and package reviews.

### D2b twelfth freeze rejected: semantic sidecar echo and Verification manifest integrity

The twelfth candidate (fingerprint `ecddaa7aa971c425bef68e4fe9a1cf15020b2c98`, tree
`e034e0672633192dc977329c628adda04df151e5`) is rejected and cannot be cited as accepted. Platform and Browser
reviewers independently verified the unchanged 81-file freeze, but found that path and set authority had not yet been
extended to every request-owned semantic field:

- Region exact-set validation bound the canonical tuple and screenshot paths but not the persisted target viewport or
  binding route. Comparison then preferred the returned viewport through a schema-unreachable `??` fallback and
  persisted returned route diagnostics. A structure-valid sidecar could attach a 1x1 viewport or forged route to a
  correct tuple and PNG.
- Scroll bound screenshot path and viewport but not the expected route URL or requested scroll position. It could crop
  the source at the requested offset while comparing an implementation capture declared at another offset or route.
- Layout bound sample/region IDs and viewport sizes but did not bind returned locator, source bbox or source refs to
  their host request, nor page URL to target and route. Its region schema also used a plain status enum with optional
  geometry, so `status: captured` without border/viewport boxes, spacing, offsets or computed style could publish an
  overall passed diagnostic. Failed rows did not require a reason.
- Verification wrote and embedded a manifest but omitted `manifestPath` from persisted evidence. The generic path
  collector does not treat nested `manifestPath` or `diagnosticsPath` keys as artifacts, so deleting the manifest while
  retaining the screenshot did not make historical evidence unreadable.

The thirteenth candidate must bind Region viewport and route to host projections and delete the unreachable viewport
fallback; bind Scroll URL and actual scroll position; bind every Layout request-owned region descriptor and page URL;
model Layout captured/failed rows as a strict discriminated union with complete captured geometry and a non-empty
failure reason; and persist Verification `manifestPath` with a real deletion regression. Host-derived URL comparison
must use the same URL constructor as the sidecar rather than a second route parser. Isolated hostile tests must cover
each semantic mutation and prove no publication. After correction, rerun the complete Browser Preview and related
package matrices, create a new exact freeze and require three new independent reviews; no twelfth-tree evidence is
acceptance.

### D2b thirteenth pre-freeze audit rejected: derived facts still trusted sidecar echoes

The thirteenth worktree is not a freeze and is rejected before exact-tree review. A focused run first exposed a required
`route_diagnostics.screenshot_path` being widened to optional during publication rebasing and a route fixture whose
nominally invalid diagnostics were otherwise healthy. After correcting those two local inconsistencies, the focused
matrix passed Region hostile-set, sibling authority, Verification and Layout tests, but the real compare route exposed
that failed navigation reports `page.url()` rather than the requested URL. One diagnostics field cannot simultaneously
be the host-owned navigation request and the observed final page URL.

A fresh read-only sidecar audit then found four broader false-green paths. Verification still accepted each sidecar
layer's `passed` boolean even when its raw HTTP, asset, DOM, JavaScript, glyph or expected-result fields proved failure.
Scroll compared the viewport echo but did not bind the expected PNG's actual dimensions, while visual evaluation can
resize mismatched inputs and the producer did not require `dimensions_match` for passed status. Region compared
`fullpageSize` with `routeDiagnostics.page_size`, but both were sidecar echoes and neither was bound to the full-page
PNG metadata. Finally, the persisted evidence schema and readability path still treated `manifest_path` as optional,
although all four production publishers create a manifest; deleting that payload field could bypass the manifest
readability invariant. The same audit found retired defaults in the embedded sidecars: Region `settleMs ?? 500` and
Scroll/Layout `launchArgs || []`, even though host payload schemas require those fields.

Full call-point enumeration shows four production persistence callers: Verification, Region comparison, Scroll-slice
comparison and Layout geometry. Direct `persistBrowserPreviewEvidence` calls outside `persist.ts` are tests only
(Browser Preview, routes, Visual QA, metrics, orchestrator and tool suites). Therefore `manifestPath` becomes required
at the persistence input, persisted payload and public parsed evidence contract, and those direct fixtures must declare
their manifest rather than retain a test-only optional production path. Region diagnostics will separate host-bound
`url` (the requested URL constructed with `new URL(route, targetURL)`) from observed `final_url`; the host validates the
former and persists both. Verification will reject semantic disagreement between every returned layer boolean and its
raw fields before publication. Scroll and Region will compare actual PNG metadata with the host viewport / reported
page size before visual evaluation or persistence. Hostile isolated tests must cover contradictory Verification layers,
wrong-size Scroll PNG, jointly forged Region size echoes and missing persisted manifest fields. All embedded fallback
expressions named above are deleted. The complete Browser Preview and related matrices plus three new exact-tree
reviews remain mandatory; no prior ACCEPT transfers.

The parallel projection audit confirms the dynamic projection identity and active-package tool isolation paths are
working, but D2b cannot be described as platform finalization. The `frontend-design` and `build` base-role templates,
their schema/output tools and `engine/codebase-tools` still inject task-runtime `web-clone-source/**/reference.png`
contracts. Those paths conflict with the external Frontend Replica package's immutable TaskArtifact set and remain a
D2c deletion blocker immediately after this Browser Preview slice. The audit also identified an SDK/ABI freeze blocker:
`TaskArtifactSet` currently transports both a committed manifest reference and the complete `artifacts[]` inventory
through two agents and a tool argument. That duplicates the manifest authority and makes messages grow linearly with
large captured sites. Before declaring the SDK finalized, the ABI must become a compact snapshot handle containing
identity, tree/manifest reference and named references, with the host recovering and verifying inventory from the
committed manifest. This is recorded as required work, not accepted technical debt.

The same audit found current generated SDK/OpenAPI output stale relative to the evolving Region diagnostics schema and
the checked-in expert-squad payload stale relative to concurrent Frontend Innovate package edits. Generation must run
only after the source contracts settle, then payload byte-parity, OpenAPI/SDK and docs freshness tests must pass on the
same frozen tree.

### D2b thirteenth-candidate evidence before freeze

The host now derives every decision-bearing Browser Preview fact. Verification rejects disagreement between sidecar
`passed` flags and the raw HTTP, asset, DOM, JavaScript, glyph and expected-result fields; six isolated hostile cases
exercise each layer independently. Pixel health remains host-derived from decoded PNG bytes. Scroll requires the
expected screenshot to be a regular file whose decoded dimensions equal the host viewport before visual evaluation.
Region requires each regular full-page PNG's decoded dimensions to equal the returned page size, so two coordinated
size echoes cannot manufacture evidence. Region route diagnostics now separate host-bound navigation `url` from
observed `final_url`; a real 302 browser test proves the requested URL remains stable while the final URL records the
redirect destination. Region and Scroll no longer carry the retired settle/launch defaults.

All four production evidence publishers now require `manifestPath`. The persisted payload and parsed public evidence
schemas require `manifest_path`, and readability always checks that file. A database fault test deletes the payload
field and observes schema corruption, then restores it, deletes the actual manifest, and observes artifact corruption.
All direct persistence fixtures across Browser Preview, routes, Metrics, Visual QA, Orchestrator and browser tools now
declare real task-runtime manifests; no test-only optional production path remains.

The official `bun script/generate.ts` regenerated expert-squad payloads (including concurrent Frontend Innovate source
changes), built-in Skill payloads, OpenAPI, the JavaScript SDK and API docs. Generated Region diagnostics expose required
`final_url`, `navigation_error`, request URL, screenshot path and all health fields. Payload byte parity and package
contract tests pass after updating the Frontend Innovate designer assertion from the retired always-required evidence
wording to its actual `update_frontend_competitor_reference` tool protocol; downstream implementer/reviewer contracts
continue to require the structured evidence when cited.

Verification on the candidate worktree: the complete Browser Preview directory passes `103/103` with 732 assertions
before the final expansion of the Verification hostile matrix; the expanded isolated sibling boundary then passes with
21 internal cases. The complete package-manager/payload-generation/Frontend Replica/TaskArtifact/plugin/SDK-contract
group passes `117` with one explicitly skipped pre-existing folder-import case and 1,496 assertions. Full routes,
Metrics and Visual QA output tools pass `80/80`; the targeted Orchestrator evidence path and browser-tool writer
contracts pass. Root typecheck passes nine tasks across eleven packages; production Knip dead-code, API route inventory
(`6` rules / `30` files), docs freshness (`273` operations / `23` groups), historical links (`21/21`), non-browser
Overlay internationalization (`98/98`), secret scan and both staged/unstaged diff checks pass. One direct Bun invocation
incorrectly included a Node-runner-only Overlay browser test and failed its required environment marker; it is retained
as invalid command evidence, not a product result. No running OpenCorvus or Overlay process was touched.

The exact staged tree must still rerun the complete Browser Preview directory after the six-layer expansion and remain
unchanged through three fresh independent platform, Browser Preview and package reviews. This section is candidate
evidence, not acceptance. The D2c base-role legacy deletion and compact TaskArtifact ABI remain required after this
slice is pushed.

### D2b thirteenth freeze rejected: execution semantics, image geometry, generated contract and readable bytes

The thirteenth candidate (fingerprint `36f8048017058af76cfff1308dcdbb3096b9a8c7`, tree
`6ef13a14070ae9cebbdccd595ab76fd01a5be1f9`) is rejected and cannot be cited as accepted. Independent platform and
Browser Preview reviewers verified the unchanged 93-file freeze before and after review, then found four blockers:

- `greenfield_original` was added to the dispatch schema and agent prompt, but the real `frontend_design` adapter still
  rejected every invocation without attachments, Figma or material paths before calling the agent. This made textual
  product/system/API/interaction contracts unusable even though the declared mode treats them as the original-design
  authority. Existing tests exercised schema and prompt construction, not the real adapter execution path.
- Verification decoded its PNG and overwrote the returned size but never bound decoded geometry to an observed page
  size or required it to cover the host viewport. A hostile sidecar could write an undersized high-variance PNG at the
  exact host-owned path, return internally consistent healthy layers and publish passed evidence. One existing test
  incorrectly accepted a 12x96 image for a 1440x1080 viewport.
- Capture-target uniqueness was enforced by the route and tested as HTTP 400, but the route description omitted the
  400 response and the generated OpenAPI/JavaScript SDK exposed neither `uniqueItems` nor a typed 400 error.
- Persisted evidence readability used a lexical scope check followed by ordinary `readFile`. It followed a replaced
  symbolic-link artifact outside the task scope, and artifact routes validated first then reopened the path, leaving a
  validation/read substitution window. Producer-time regular-file validation did not protect later evidence reads.

The next candidate must remove the old no-visual-input host gate rather than add a mode branch, let greenfield textual
authority reach the projected agent, and prove through real adapter execution that reference-parity without evidence
still reports an explicit missing-evidence failure. Verification must bind decoded full-page geometry to trustworthy
host/request facts and reject the impossible small image. The capture route schema/description, OpenAPI and generated
SDK must expose duplicate rejection as one contract. Historical evidence and artifact delivery must consume bytes from
one no-follow, scoped read boundary instead of validating a path and reopening it. Hostile symlink/substitution tests,
focused behavior tests, regeneration, the complete Browser Preview suite and three new exact-tree reviews are required;
no thirteenth-tree evidence transfers.

### D2b fourteenth-candidate evidence before freeze

The `frontend_design` adapter no longer contains either retired no-resource guard. A no-resource
`greenfield_original` invocation and a no-resource `reference_parity` invocation now both reach the exact projected
dynamic agent through the real `dispatch_agent` execution path. The greenfield mock completes from its task request;
the reference-parity mock reports the prompt-owned missing projected screenshot/source-page evidence failure. Explicit
Figma/material inputs retain strict materialization: a declared missing material still fails before analysis, because
that is input integrity rather than workflow policy. The dispatch schema reason now describes textual greenfield
authority and supplied reference-parity evidence separately. Tests that encoded `abort_no_visual_input`,
`no_visual_input_provided` or `materialization_failed_all_sources` were removed or rewritten around the sole remaining
explicit-resource failure; production and test residue scans are clean.

Verification now requires decoded PNG dimensions to equal the sidecar's observed page size and to cover the host-bound
viewport. The former 12x96 image paired with a 1440x1080 viewport is a negative regression rather than accepted
evidence. The capture request schema exposes `uniqueItems` on the final refined array schema, the route declares HTTP
400, and official generation projects both into OpenAPI, the JavaScript SDK error union and API docs. The SDK contract
test reads the generated files and asserts all three surfaces.

Persisted evidence now has one byte-returning read boundary. It lexically scopes the artifact to the task Browser
Preview root, rejects every symbolic-link/junction component below the project authority, checks realpath containment,
opens one file handle, reads bytes through that handle, and compares handle/path identity and timestamps before
returning. Routes and Build visual-feedback forwarding consume those validated bytes directly; the former path-return
APIs and every validate-then-reopen call are deleted. One hostile route case replaces an internal artifact directory
with an external junction at `open`, while another redirects the whole task Browser Preview root before the request;
both return evidence corruption without external bytes.

Verification on this candidate: the complete Browser Preview directory passes `104/104` with 733 assertions, and
Browser Preview routes plus generated SDK contracts pass `33/33` with 156 assertions. The no-resource real adapter and
explicit-material failure tests pass `2/2`; frontend prompt tests pass `17/17`; updated durable handoff/decision-log
tests pass `8/8`; Build feedback context passes `4/4`. The external package, Registry/Resolver, Frontend Replica,
TaskArtifact, plugin and Browser tool matrix passes `438` with one existing explicit folder-import skip and 5,345
assertions. Routes/Metrics/Visual QA reported `134` passes and one non-repeatable isolated Windows Git-helper seed
commit failure, which is inside the user-excluded Windows helper class and had passed in the preceding package matrix.
Root typecheck passes nine tasks, and production Knip, route inventory (`6` rules / `30` files), docs freshness (`273`
operations / `23` groups), historical links (`21/21`) and diff checks pass. Official generation refreshed payloads,
OpenAPI, SDK and both API docs. This remains candidate evidence until a frozen staged tree receives three fresh
independent ACCEPT reviews.

Before freeze, a concurrent worker advanced and pushed `v0.0.9beta` from `2c10adb6d2` to `95b9591390`. The shared index
initially presented ten exact old-blob inversions plus two overlapping files. Blob comparison proved the ten inversions,
which were restored path-by-path from the new HEAD; `tools.test.ts` was manually merged so the new continuation-effect
assertions coexist with the Browser Preview manifest/TaskArtifact fixtures and no-resource frontend regression. The
crypto benchmark record differed only by omission of the new HEAD's macOS continuation and was restored intact.
Post-merge no-decision/continuation coverage passes `37/37` with 144 assertions, the three intersecting real tool tests
pass with 21 assertions, and root typecheck again passes nine tasks. No parallel production, test or record change is
reverted by the candidate tree.

### D2b fourteenth freeze rejected: report authority and incomplete scoped-byte migration

The fourteenth candidate (fingerprint `914b7dcdb941dcf15afe11e816ba5fe2792d18c6`, tree
`2d2c7c51a14a7bb65ad1a64f8e1fff87b7b6ae3d`) is rejected and cannot be cited as accepted. Package review accepted the
external package, dynamic projection, TaskArtifact, payload and generated SDK surfaces with 234 passes and one existing
skip. Platform and Browser Preview reviewers verified the unchanged 84-file freeze but found five blockers:

- `FrontendDesignAgent.analyze` did not pass the explicit design mode into its output collector. The collector inferred
  reference-parity semantics from `frontend_project.role=visual_baseline_input`, so a greenfield report could falsely
  say it was verified against original reference artifacts and cite `web-clone-source/source-ir/*` plus
  `web-clone-source/reference.png`. The real adapter test mocked the final agent result and therefore proved only that
  the host gate was removed, not that the terminal report remained greenfield-clean.
- Generic `engine/codebase-tools.ts` and `build/prompt-context.ts` still classified and instructed hard-coded
  Frontend Replica directories, while `visual-skeleton-coverage.ts` guessed a missing source package as
  `web-clone-source`. These are package policy in core runtime and block a platform-final claim.
- The scoped artifact reader checked lexical components, then resolved the Browser Preview root and file together. If
  the entire `bp` root was replaced after `lstat` but before both `realpath` calls, root and file moved outside the
  project as one self-consistent pair. The reader did not bind canonical `bp` root to canonical project authority.
- Build layout feedback discarded the already validated manifest bytes and reopened `manifestPath` through
  `AttachmentStore.writeFromPath`, retaining a validate/read substitution window.
- Visual QA annotation similarly returned absolute Browser Preview paths after validation, then reopened scroll
  manifests and screenshots through `readFile`/Sharp. The new byte authority was not propagated through these consumers.

The fifteenth candidate must carry explicit design authority through the collector/report renderer, prove a real
greenfield terminal report contains no replica/reference claims, and keep reference-parity claims anchored to declared
evidence rather than role inference. Frontend Replica directory/workflow policy must move to its package-owned prompt or
be represented by generic evidence contracts; core code may not guess missing source packages. The scoped reader must
bind canonical task Browser Preview root beneath the canonical project root and test replacement before `realpath`.
Build layout and every Visual QA Browser Preview image/manifest consumer must use bytes returned by the same verified
read, with hostile substitution tests. A new exact tree and three new independent reviews are mandatory; the package
ACCEPT does not transfer.

### D2b fifteenth implementation Recall: explicit authority and verified bytes

The fourteenth rejection was re-read before modification. Full-repository call-point enumeration found that the
authority defect begins in `frontend-design/schema.ts`, not only in the report renderer: every
`visual_validation_evidence` row requires `source_reference_artifact` and its digest, and the accepted path is restricted
to `web-clone-source/reference.png` or `reference-mobile.png`. A no-reference `greenfield_original` task therefore cannot
honestly submit the screenshot review required for `frontend_project.role=visual_baseline_input`. The output collector
factory is called by the production frontend-design agent and by agent-report, prompt, incremental-output and
cache-stability tests; every caller must now supply an explicit mode. The schema, update tool, submit validation and
terminal renderer must share one discriminated evidence contract: greenfield records rendered-original review without
a source-reference comparison, while reference parity records the declared reference artifact, hashes and optional
diff. Role is project-output shape only and cannot infer design authority.

The core-policy grep found hard-coded Frontend Replica behavior in `engine/codebase-tools.ts` prompt-excerpt
classification, `build/prompt-context.ts`'s webpage-clone overlay, frontend-design agent/report strings, and the
`visual-skeleton-coverage.ts` call's `sourcePackage || "web-clone-source"`. The external Frontend Replica package is the
owner of its source-package paths and workflow guidance. Generic runtime may transport typed context packets and
arbitrary declared refs, but may not manufacture clone paths or a missing package name. Tests that expect the core
overlay or hard-coded path policy must be replaced with active-package ownership and generic packet rendering checks.

The Browser Preview consumer grep found two remaining reopen paths after validated evidence loading. Build layout
feedback calls the readable-evidence API, discards its byte map, then resolves/stats and sends the manifest through
`AttachmentStore.writeFromPath`. Visual QA annotation resolves Browser Preview paths, rereads a scroll manifest with
`fs.readFile`, and opens screenshots twice through Sharp. These consumers must retain the byte map returned by the
single scoped reader and pass Buffer values downstream. Attachment-origin images remain governed by AttachmentStore's
own authority. The reader must additionally resolve the project authority independently, require the canonical task
Browser Preview root to remain below it, and compare the scoped-root canonical identity again after the file-handle
read. Tests must inject whole-root replacement between component `lstat` and scoped-root `realpath`, plus substitution
attempts at both downstream consumers.

The first post-cleanup focused run exposed two stale sibling assertions that the delegated prompt cleanup did not
enumerate. `frontend-design/agent-process.test.ts` still required the removed package-consumer wording, while
`frontend-design/output-incremental-tools.test.ts` still required an older quality-contract sentence even though the
new report preserves the same generic explicit-handoff semantics. These are test-contract residue rather than product
failures: update them to assert the new package-neutral evidence boundary, then rerun the exact four-file frontend
group. This failed run is retained as correction evidence and is not acceptance.

After the concurrent prompt edit became visible, `agent-process.test.ts` advanced to the real terminal contract and
failed because its process-persistence fixture declared `reference_parity` without registering any
`reference_comparison` evidence. That is a correctly rejected invalid fixture, not a collector defect. The test owns
process/iteration persistence rather than reference comparison, so its authority is changed explicitly to
`greenfield_original`; no fake reference evidence is added. The visual-baseline fixture's separate empty Node sidecar
output is an intermittent Windows helper/resource failure under the user's exclusion and will be retried in isolation,
not patched around in production.

### D2b fifteenth pre-freeze audit: webpage evidence relay is not yet a real protocol

An independent read-only call-point audit found that the three `webpage_*` tools are generic host browser-evidence
primitives and must remain available for exact dynamic-agent projection; the external Frontend Replica package owns
their sequencing and its Replica-specific conversion, not the browser capture implementation. However, their current
path ABI is broken. `resolveWebpageEvidenceOutputDir` returns an absolute task-runtime path, while the package
`prepare-source-context` argument uses `TaskArtifactRelativePathSchema` and rejects that absolute value. Passing the
same lexical `webpage-evidence` string does not solve this: the host silently aliases it to `fd/webpage-evidence`, while
the package resolves it under the project root. The existing package integration fixture manually seeds the runtime
directory and therefore does not prove the actual tool-result relay.

The same audit enumerated an unrelated automatic behavior: `TaskRuntimeMaterializer.materializeFrontendDesign()` only
creates `fd/webpage-evidence`, its `worktreeDir` input is unused, and ordinary Build plus worktree create/recover/reset
call it even when no webpage evidence capability was projected. This violates package-controlled lifecycle and leaves
frontend-domain storage policy in generic worktree setup.

The correction is one strict protocol, without aliases or compatibility readers: task-session calls reject
`outputDir` overrides and write only the canonical task evidence directory on first tool use; their result exposes the
canonical project-relative path for the package tool; no-session overrides remain solely for direct benchmark/test
invocation. `webpage_extract`, `webpage_compile`, and `webpage_runtime_state` share that resolver result. The external
source-researcher consumes the exact returned relative path. Delete `materializeFrontendDesign` and every Build /
worktree lifecycle caller, and add negative tests proving those paths do not create evidence. Add a real projected-tool
relay test from local HTTP extraction through compile/runtime-state into `prepare-source-context`; the existing seeded
fixture is insufficient. The output resolver comment must list only host-produced artifacts, not package-owned
`source-skeleton` output. Moving the three generic primitives into a neutral source namespace is desirable cleanup but
does not substitute for this semantic repair and is not required before proving the strict relay.

### D2b webpage-evidence path authority Recall

The strict relay correction is incomplete while its canonical host output remains nested under the Frontend Design
runtime namespace. A full call-point grep before this edit found the path fields in `ProjectRuntimePaths`,
`TaskRuntimeMaterializer`, the shared webpage-tool output resolver, the Frontend Replica package fixture, visual-region
binding fixtures, and Build/worktree negative lifecycle tests. The broader `frontendDesignPaths` grep also found
Browser Preview region fixtures and the Orchestrator Visual QA fixture using `fd/web-clone-source` only as scratch input
for publishing a TaskArtifact; those are webpage evidence consumers, not Frontend Design template/manifest consumers.

This atomic migration adds `ProjectRuntimePaths.webpageEvidencePaths(projectDir, taskID)` as the sole authority for
`taskRelative/taskAbsolute(taskID, "webpage-evidence")`, deletes both webpage-evidence fields from
`frontendDesignPaths`, and moves every identified evidence caller to the neutral helper. There is no reader for the old
`fd/webpage-evidence` path, no alias, and no compatibility copy. Frontend Design template/manifest paths remain under
`fd`. The concurrently authored projected-tool relay test is excluded from this edit and must consume the tool result's
metadata rather than reconstruct either runtime path.

A post-ABI production residue scan found another package-policy leak missed by the earlier call-point list. The generic
frontend-design region trace tools use generic fields (`replacementPlanFile`, `iterationStateFile`) but their schema
descriptions still name Frontend Replica generator files `sourceDomReplacementPlan` and `sourceDomIterationState`;
the generic research blueprint repeats those file names as if every active package used them. Replace only those
descriptions with declared region-plan / iteration-evidence language. The package remains free to pass its concrete
filenames through the generic fields, while no other dynamic agent is prompted toward Replica-specific artifacts.

Review of the automatic-materialization test diff found that production fallback removal was paired with retained core
worktree fixtures named `web-clone-source` and `frontend-design-skeleton`. Two tests existed only to prove those retired
directories were not copied or used as a project-root fallback; keeping them would preserve package policy in the core
test contract after the production path was deleted. Delete those legacy tests. Keep one generic canonical-runtime
non-copy test and the create/reuse/recover/reset negative tests that prove no neutral webpage-evidence directory is
created without an actual projected tool call.

### D2b fifteenth candidate verification before freeze

The strict webpage-evidence relay is now exercised through the real dynamic projection. A local HTTP page is acquired
by projected `webpage_extract`, compiled by projected `webpage_compile`, and observed by projected
`webpage_runtime_state` in one persisted source-researcher session. All three results expose the same canonical
`projectRelativeEvidencePath`; that exact string is passed unchanged to the projected package
`prepare-source-context` tool. The test reads the published manifest and reference image through TaskArtifact authority,
checks provenance and digests, mutates the original runtime evidence, and proves the committed artifact bytes remain
unchanged. The full Frontend Replica source-project file passes 29 tests with 475 assertions.

`ProjectRuntimePaths.webpageEvidencePaths` is now the sole neutral path authority and no longer nests browser evidence
under `fd`. Task sessions reject every output-directory override; direct no-session benchmark/test resolver use remains
explicit. Build and worktree create/reuse/recover/reset no longer materialize the directory. The reduced lifecycle
matrix passes 12 tests with 33 assertions. Residue scans find no `fd/webpage-evidence`, retired webpage path fields,
automatic materializer, core `sourceDomReplacementPlan` / `sourceDomIterationState`, or core Frontend Replica directory
policy outside the generated expert-squad payload.

The official generator refreshed expert-squad payloads, built-in Skills, OpenAPI, JavaScript SDK and API docs. Root
typecheck passes nine tasks. Production Knip, route inventory (6 rules / 30 files), docs freshness (273 operations / 23
groups), historical-doc links, core prompt hygiene and Browser Preview SDK contracts pass. Frontend/package combined
execution records 197 passes and one skip; failures are only hard five-second isolated-process timeouts or empty Node
sidecar output in the user-excluded Windows helper/resource class. The visual-baseline test that hit empty sidecar JSON
passes when run alone. A complete Browser Preview directory run produced no output for five minutes and was terminated
after that no-activity interval; it is not cited as pass. Focused hostile scoped-root replacement, downstream
verified-byte substitution, region comparison and real relay tests pass. These Windows-excluded failures do not receive
production fallback patches.

Unstaged concurrent CMS Expert Squad documentation (`specs/README.md`, the July index and the new CMS record) is not
part of this candidate and must remain outside its staged freeze. The freeze must include only the existing rejected
staged Browser/TaskArtifact/package base plus this fifteenth correction and Recall, then receive three new exact-tree
reviews; no prior ACCEPT transfers.

### D2b fifteenth freeze rejection Recall: authority, public bytes and legacy benchmark

The attempted fifteenth freeze cannot be accepted. Concurrent commits advanced its parent from `01ea00f01c` to
`e5601f7b5d` while the staged fingerprint remained unchanged, so all three exact-tree reviews were invalidated. The
previously unstaged CMS Expert Squad documentation is now part of the committed parent and is no longer excluded from
the staged candidate. No review evidence transfers to the next tree.

The three independent reviews found six concrete blockers that must be corrected as one bounded slice before another
freeze:

- `design_authority` is persisted only in the decision log, while `visual_handoff.v1` and its consumers reconstruct a
  second `visualReference` authority from reference artifacts, region bindings or project role. Greenfield work may
  legitimately include material or competitor references, so authority must be carried explicitly through the handoff
  and must never be inferred from the presence of references.
- the external Frontend Replica `prepare-source-context` tool accepts any project-relative evidence directory. Its
  input must resolve to exactly the current task's host-owned `managedRuntimeDirectory/webpage-evidence`; project-root,
  sibling-task and guessed paths must be rejected by production code and negative tests.
- generic Frontend Design runtime schema/output descriptions still prescribe webpage-replica, Frontend Innovate,
  desktop-only and horizontal-band package policy, and the greenfield failure text still requires a source reference.
  These descriptions must become authority-neutral and the hygiene test must cover runtime schema descriptions.
- the Browser Preview GET route advertises the internal persisted schema with required `manifestPath`, then strips that
  field from the actual response. A separate public DTO schema must describe and validate the real response, and the
  generated OpenAPI/SDK contract must match it.
- the scoped Browser Preview byte reader rejects symbolic links but not multi-link files. It must reject `nlink !== 1`
  at the same pre/post-read identity boundary and include a hostile hard-link regression.
- `html-skeleton-workflow-check.ts` and its tests remain an executable core-owned reader for `task/fd`,
  `fd/web-clone-source`, mutable `reference.png` and the retired skeleton protocol. This legacy benchmark path and its
  maintenance assertions must be deleted rather than adapted into a second Frontend Replica implementation.

The next implementation must first enumerate every call point for these six surfaces, then replace the double sources
without aliases, fallback readers or prompt-only enforcement. Official generation, focused positive and negative
tests, typecheck/static checks, and three fresh reviews over one unchanged HEAD/tree/fingerprint are required before
commit and git-cc push. The three user-abandoned product E2E runs remain outside this goal; no running OpenCorvus or
Overlay process may be touched.

The required pre-edit repository grep produced this complete implementation map:

| Surface                         | Production call points                                                                                                                                                 | Test/document call points                                                                  | Disposition                                                                                                                                       |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Design authority handoff        | `context-packets/visual-handoff.ts`, `orchestrator/tools.ts`, `orchestrator/build-tool.ts`, `architect/agent.ts`, `build/prompt-context.ts`, `frontend-design-tool.ts` | agent context-packet, Architect/Build prompt and Orchestrator tool tests                   | Replace `visualReference` inference with one explicit authority field end to end; keep project mode and declared bindings as data, not authority. |
| Generic Frontend Design wording | `frontend-design/schema.ts`, `frontend-design/output-tools.ts`, generated tool descriptions                                                                            | schema/output/prompt/core-hygiene tests                                                    | Remove package-specific policy and make greenfield/reference evidence requirements follow the discriminated authority contract.                   |
| Webpage evidence relay          | package `prepare-source-context.ts`, plugin `tool.ts` host ABI, projected Frontend Replica source-project test                                                         | package payload byte-parity and projected relay tests                                      | Bind exactly to `managedRuntimeDirectory/webpage-evidence`; reject project-root, sibling-task and arbitrary directories.                          |
| Browser Preview public response | `browser-preview/persist.ts`, `server/routes/browser-preview.ts`, generated OpenAPI/JavaScript SDK/API docs                                                            | Browser Preview route and SDK contract tests                                               | Separate internal persisted evidence from its path-free public DTO and parse the real response through that DTO.                                  |
| Browser Preview scoped bytes    | `readScopedBrowserPreviewArtifact` and its API/Build/Visual QA consumers                                                                                               | Browser Preview hostile artifact/route tests                                               | Reject multi-link identities before and after the handle read and prove an external hard-link cannot be consumed.                                 |
| Retired skeleton benchmark      | `script/benchmark/html-skeleton-workflow-check.ts`                                                                                                                     | its dedicated test, cleanup/document-health assertions, English and Chinese benchmark docs | Delete the executable legacy reader and every maintenance reference; retain only generic maintained probes.                                       |

During this correction the user changed the delivery branch. The shared worktree was switched in place from
`v0.0.9beta` to local `v0.0.10beta` without stash, reset or file replacement, and its upstream is now
`myhexin/v0.0.10beta`. All staged and unstaged changes were retained. At switch time the local line was three commits
ahead and the remote line nine commits ahead from their common base; the 66 remote-changed paths had no exact overlap
with the then-current dirty path set. The correction must be committed on `v0.0.10beta`, then the fetched remote line
must be merged and the combined branch verified and pushed to git-cc.

### D2b sixteenth candidate verification before freeze

The six review blockers are now replaced at their source. `visual_handoff.v1` carries the explicit
`designAuthority` enum and rejects the retired `visualReference` field; Frontend Design handoff construction requires
the canonical `design_authority` decision and never infers authority from project role, reference material or region
bindings. Architect and Build activate reference obligations only for `reference_parity`. Generic Frontend Design
schema, output-tool and crop descriptions no longer prescribe Replica, Innovate, desktop-only or horizontal-band
policy, and greenfield missing-evidence diagnostics require rendered-original evidence rather than a source reference.

The plugin host now exposes the exact current task runtime directory as `managedRuntimeDirectory`. Frontend Replica's
package-owned source-context tool accepts only that directory's `webpage-evidence` child and rejects real project-root
and sibling-task evidence directories. The retired HTML skeleton workflow benchmark, its dedicated tests, implicit
Overlay benchmark dispatch, reference-image flags and public documentation have been deleted. Browser Preview now has
one path-free public evidence DTO distinct from its internal persisted model; the route parses the actual stripped
response through that DTO. Its scoped byte reader rejects multi-link files before and after the handle read, and the
route hostile test proves a hard-linked capture cannot be served.

Official generation refreshed expert-squad payloads, built-in Skills, OpenAPI, the JavaScript SDK and both API docs.
Focused verification passes: package source preparation `1/1` with 17 assertions; the real projected three-tool relay
`1/1` with 10 assertions; benchmark/plugin/document health `95/95`; Architect explicit authority `1/1`; prompt hygiene,
Frontend Design prompt and historical links `47/47`; root typecheck nine tasks; route inventory six rules across 30
files; docs freshness 273 operations in 23 groups; and production dead-code analysis. The broader schema/context group
passes 76 of 77 and Browser route/SDK group passes 35 of 36. Each sole failure is an empty-stdout Node/Playwright
sidecar JSON result already demonstrated to be the user-excluded Windows helper/resource class; the new hard-link,
public DTO and SDK assertions pass in that run. No fallback or production workaround was added.

This remains candidate evidence. The complete intended tree must be staged, fingerprinted and reviewed by three fresh
independent agents without any HEAD/tree/index drift. Only three ACCEPT results permit the slice commit; no previous
review transfers.

### D2b sixteenth freeze rejected: downstream authority and pre-open identity

The sixteenth freeze (HEAD `e5601f7b5d`, tree `b379fc94f9a8`, fingerprint `19afc5109561`) is rejected by all three
independent reviews and cannot be cited as accepted. The exact tree remained unchanged through review. Two reviewers
independently identified the remaining model-visible evidence contradiction, while the platform and Browser reviewers
found separate runtime blockers:

- Frontend Design persists `design_specs` for both authorities, but the scheduler task visual-contract packet marks any
  non-empty specs as `reference_parity`. Architect fidelity and Build fidelity also treat any visual spec as proof that
  reference coverage is required. A greenfield layout spec therefore becomes a reference task despite its explicit
  `greenfield_original` decision.
- `visual-qa/reference-parity-context.ts`, used by both Visual QA and Integrity, ignores `design_authority` and infers
  parity from `final_acceptance_mode` or any `reference_artifacts` entry. A greenfield task with a competitor/material
  reference is consequently upgraded to parity by another independent source.
- the generic `visual_validation_evidence` array description still says every row binds a source screenshot, hashes
  and optional diff even though the `render_review` union member deliberately contains no source reference. This is a
  model-visible schema contradiction that the existing named-token hygiene scan misses.
- the scoped Browser Preview reader verifies path components before `open`, but discards the target file's pre-open
  identity. Replacing one ordinary single-link file with another at the `fs.open` boundary keeps the same canonical
  path, and all later handle/path checks describe only the replacement. The reader can therefore return substituted
  bytes despite the symlink, hard-link and post-open defenses.

The complete pre-edit call-point grep for the next correction is: Frontend Design spec persistence in
`orchestrator/frontend-design-tool.ts`; task visual packets in `orchestrator/tools.ts`; reference obligations in
`architect/agent.ts`, `architect/fidelity.ts` and `orchestrator/build-fidelity.ts`; shared downstream parsing in
`visual-qa/reference-parity-context.ts` and its Visual QA/Integrity stage callers; the evidence description in
`frontend-design/schema.ts` and its schema/prompt hygiene tests; and the scoped reader plus route hostile tests in
`browser-preview/persist.ts` and `test/server/browser-preview-routes.test.ts`. The next tree must make explicit
`design_authority` the only parity authority across all these consumers, keep ordinary visual specs authority-neutral,
replace the schema description with per-union semantics, retain the pre-open target identity through handle open, and
test greenfield specs, greenfield competitor refs, and ordinary-file substitution. No sixteenth-tree result transfers.

The main-agent post-edit call-point review found one further authority source before refreeze. Visual QA output
validation currently computes parity as `context.referenceParityRequired || report.reference_parity.required`, and the
Orchestrator has a test in which direct comparison refs plus the worker's own report turn a task with no Frontend
Design authority into required parity. The worker report is evidence about work performed, not authority to change the
task contract. `visual-qa/output-tools.ts`, `acceptance-semantics.ts`, `visual-qa-stage.ts`, `build-feedback.ts` and the
direct-reference Orchestrator/Visual QA tests must therefore be audited as one chain. The strict behavior is: context
derived from canonical `design_authority` decides whether parity is required; an accepted report must match that
authority exactly; submitted refs cannot upgrade greenfield/no-authority work, and a parity context cannot be downgraded
by the report. This additional source must be removed before the seventeenth freeze.

Review of the corrected output chain exposed a required companion projection: once report-authored regions stop being
authority, `deriveVisualQaReferenceParityContext` cannot keep returning an empty region set for every parity task.
The canonical `visual_region_bindings` Frontend Design decision is already the structured region source used by the
Build handoff. Visual QA and Integrity must parse that same decision and project its `reference_region_key` values;
they must not merge regions invented by the report. The shared-stage Orchestrator test that formerly obtained parity
from a visual-feedback scorer must instead seed an explicit `reference_parity` authority plus structured region binding,
while the direct-comparison/no-authority test must prove refs and scorer metadata do not upgrade the context.

### D2b seventeenth candidate verification before freeze

All four sixteenth-freeze blockers and the main-agent report-authority follow-up are now corrected. Visual specs remain
ordinary acceptance data and no longer create a parity handoff or make Architect/Build reference coverage mandatory.
Build fidelity, Visual QA and Integrity derive parity only from the strict Frontend Design `design_authority` decision;
Frontend Design evidence without that decision fails immediately. For explicit reference parity, Visual QA/Integrity
project required region keys only from the canonical `visual_region_bindings` decision, with deterministic de-duplication
and ordering. Greenfield competitor refs, final acceptance metadata, goal visual scorers, direct comparison evidence and
the worker report cannot upgrade authority. Visual QA output rejects both attempted upgrade and downgrade, and visual
feedback persistence uses the canonical authority and regions rather than report-authored values.

The model-visible visual evidence list and both union branches now share one description contract: `render_review`
records rendered-original inspection without source-reference fields, while only `reference_comparison` binds source
reference bytes/digest and optional diff. A provider JSON Schema regression checks the actual tool schema. The Browser
Preview reader retains the target file's full pre-open identity from component traversal and compares it with the opened
handle before reading, then repeats the full identity/length checks after reading. A hostile test replaces the target
with another single-link ordinary file containing identical bytes and the expected digest at the `fs.open` boundary;
the route rejects it as corrupted.

Main-line focused verification passes: authority Architect/fidelity/Visual QA `22/22`; schema/prompt `21/21`; ordinary
pre-open replacement, hard-link and generated SDK contracts `5/5`; the shared Visual QA stage and scorer/direct-ref
negative paths `2/2` with 34 assertions; and root typecheck nine tasks. Delegated runs additionally pass the complete
strict-reference set `11/11`, the authority Visual QA/Build subset `19/19`, and all new hostile Browser cases. Broader
runs contain only the already excluded Windows process-supervisor/Node-sidecar failures and received no fallback patch.
The next staged tree requires three new independent reviews; no sixteenth-freeze review or earlier test result is an
ACCEPT decision.

### D2b seventeenth freeze rejected: report regions, core overlays and remaining Browser readers

The seventeenth freeze (HEAD `e5601f7b5d`, tree `b22dd3319a4d`, fingerprint `6b4d7cb75d75`) is rejected by all three
independent reviews. The frozen tree did not drift and cannot be cited as accepted. The next correction has seven
bounded blockers:

- Visual QA validates only the report's parity boolean. It does not require report `required_regions` to equal canonical
  context regions or `missing_regions` to be a subset, and Build feedback persists arbitrary report regions as blocker
  IDs. Canonical context must be the only region authority.
- the generic Frontend Design adapter unconditionally mounts region selection/replacement tools whose schemas prescribe
  rawproject, source DOM and serial static HTML/CSS skeleton replacement. These are Replica package workflow tools, not
  general runtime capabilities; remove them from core and from generic/Innovate projection rather than rename them.
- generic Frontend Design prompt text still describes every VisualSpec as coming from references and injects financial,
  chart/table/realtime policy into all greenfield work. Remove those domain/source assumptions. The broader fixed HTML
  skeleton adapter remains explicit uncompleted platformization debt and cannot be called finalized.
- Overlay benchmark attachment input replaces the authoritative task brief with a synthetic fixed
  requirements/architect/planner/executor/acceptance pipeline and falsely claims automatic fixed-agent forwarding.
  Preserve only the attachment authority without workflow injection.
- Overlay benchmark `stop-after-architect` waits for at least two goals although the production Architect contract
  allows one. Wait on actual architect completion/board evidence, with a one-goal regression, not copied cardinality.
- Browser Preview public evidence still exposes `capture: unknown` and uses recursive key-name scrubbing. Define a strict
  public capture DTO or omit capture entirely; unknown future fields must not enter OpenAPI/SDK or the response.
- `artifact-file.ts` validates by path then returns void; Evidence Runner and Scroll Slice Comparison reopen paths through
  readFile/Sharp, accept multi-link files and retain ordinary replacement races. Replace these consumers with one shared
  handle-bound verified Buffer read, with hard-link and open-boundary substitution tests.

The complete call-point map is the files named above plus `frontend-design/agent.ts`, `tool/non-base-tool-ids.ts`, both
Frontend Innovate/Replica manifests and payload generation tests; `benchmark/overlay-web-benchmark.ts`, cleanup and
document-health tests; `browser-preview/persist.ts`, `artifact-file.ts`, `evidence-runner.ts`,
`scroll-slice-comparison.ts` and their hostile tests; and Visual QA output/build-feedback tests. Fixes must delete the
old sources, not add compatibility aliases. A new generated SDK/payload, focused tests, static checks and three new
exact-tree reviews are mandatory.

Official regeneration exposed the expected strict-contract consumer break rather than a generator defect: Overlay's
Browser Preview panel and service fixture still read the removed public `capture` object. The only stable capture
availability contract is now `operationKind=preview-capture` plus `status=passed`, followed by the dedicated binary
capture endpoint. Overlay must use those fields, delete its ad-hoc unknown-capture parser and stale URL rendering, and
update the service fixture to the exact public DTO. Reintroducing `capture` would restore the rejected unknown-field
leak and is forbidden. Root typecheck must pass after this consumer migration.

The final system-prompt audit then exposed one stale exact-wording assertion. The generic Frontend Design output source
still states the correct active-package boundary as “Active-package consumers may plan, implement, or review this design
only through its explicit handoff and evidence refs,” while the test requires an older sentence no longer present in
either staged or working source. Update the assertion to the actual generic boundary; do not add duplicate prose solely
to satisfy the obsolete string.

The resumed final audit exposed a second stale assertion in the same test: it still requires
`The persisted design evidence contains`, while the authority-neutral renderer now says
`The persisted design handoff contains the following visual constraints declared for this task`. A full-repository grep
found the old phrase only in this assertion and the new phrase only at the production renderer; the active-package
boundary has separate matching production and test occurrences. The correction is therefore test-only: bind the audit
to the current handoff wording and do not restore duplicate or obsolete production prose.

#### Recall addendum: freeze17 platform-residue correction

The platform-residue correction is bounded to three sources and must not modify Browser Preview or benchmark code.
The complete pre-edit grep found the following call points:

- Visual QA region authority: `visual-qa/output-tools.ts` accepts `required_regions` and `missing_regions`, while
  `orchestrator/build-feedback.ts` turns report-authored missing regions into persisted blocker IDs. The canonical
  `requiredReferenceRegions` context must exactly determine the report's required region set; missing regions may only
  be members of that set, and persistence must reject any mismatch before constructing the artifact.
- Generic Frontend Design region tools: `frontend-design/agent.ts` creates and mounts
  `record_frontend_region_selection` / `record_frontend_replacement_result`; their events are the sole source of the
  rawproject-specific iteration-state artifact. `tool/non-base-tool-ids.ts`, `frontend-design/static-tools.ts`, both
  Frontend Innovate and Frontend Replica manifests, and frontend-design prompt/process tests project or assert this
  surface. Delete the two tools and the rawproject iteration-state schema/artifact chain, retain only the generic
  process trace, and do not create a core alias. Frontend Replica may later own a package tool if its package contract
  actually needs one.
- Generic prompt assumptions: `FrontendDesignAgent.renderForAcceptance` describes every VisualSpec as derived from
  references, and the greenfield core contract prescribes API/realtime and financial/chart/table implementation
  choices. Replace these with authority-neutral acceptance constraints and task-declared product/interaction/data and
  implementation requirements. Package-specific Replica prompts remain package-owned; generated payload is refreshed
  by the main agent after this source slice.

Focused tests must prove exact/subset region enforcement and rejection before visual-feedback persistence, absence of
the deleted tool IDs from generic/Innovate/Replica projection, absence of rawproject iteration artifacts, and neutral
core prompt wording. This subtask does not generate payloads, commit, or touch the running application.

### D2b eighteenth candidate verification before freeze

The seven seventeenth-freeze blockers and both subsequently exposed stale prompt-audit assertions are now corrected in
the working candidate. Visual QA report regions must equal the canonical context and missing regions must be a subset
before persistence. The two Replica-shaped region/replacement tools and rawproject iteration artifact chain are absent
from core, built-in package manifests and regenerated payloads. Generic Frontend Design no longer injects financial,
chart/table or realtime policy. The Overlay benchmark preserves attachment authority without a fixed agent pipeline and
uses one shared Architect completion predicate that accepts one materialized goal. Browser Preview exposes no public
`capture`; Overlay uses operation kind/status plus the dedicated binary endpoint. Evidence Runner and Scroll Slice use
the shared handle-bound, single-link verified Buffer reader rather than reopening validated paths.

Final candidate verification passes: prompt/core hygiene `16/16` with 254 assertions, historical document links
`21/21` with 70 assertions, production dead-code analysis, route inventory (six rules across 30 files), generated docs
freshness (273 operations across 23 groups), root typecheck (`9/9` workspaces), and `git diff --check`. A
production/generated residue scan finds retired
Frontend Design tool IDs and HTML benchmark/fixed-pipeline/two-goal text only in negative regression assertions. Public
Browser Preview `capture` patterns are absent from its route DTO, SDK and Overlay consumer; remaining `capture` fields
belong to internal persisted evidence and acceptance consumers. The generic source-editable HTML design adapter remains
explicit later platformization debt and is not claimed complete by this slice. The three abandoned product E2Es and
user-excluded Windows helper/resource failures remain outside this freeze.

One concurrently edited CMS Expert Squad record remains unstaged and untouched. It is not part of this candidate; its
working-tree bytes are preserved. The next freeze must stage every other candidate path, leave only that concurrent
record outside the index, and obtain three fresh exact-tree reviews over one unchanged HEAD/tree/fingerprint.

### D2b eighteenth freeze rejected: fidelity authority, verified-byte consumers and Replica ownership

The eighteenth freeze (HEAD `e5601f7b5d`, tree `6131a2bb9177`, fingerprint `b7cc70b5cd1c`) is rejected by all three
independent reviewers. The index did not drift and the excluded CMS record remained the only unstaged path. No test or
review result from this tree is an ACCEPT decision. Five concrete blockers remain:

- Architect exposes and persists `reference_coverage` even when the canonical Frontend Design authority is
  `greenfield_original`. Build Context then relays it without authority, Build calls it an authoritative reference
  surface, and Build Feedback turns crop rows into 1:1 target references. A read-only runtime proof produced
  `{visualOverlay:false,referenceCoverage:true,authoritative:true}` for a greenfield handoff with surplus coverage.
- Region Evidence Runner reads and validates the screenshot Buffer, discards it, and passes a path to Region Comparison;
  crop operations reopen that path through Sharp after the verified read.
- Scroll Slice similarly validates screenshot bytes, then reopens prepared paths for similarity evaluation and
  side-by-side generation. Both paths retain a replacement window after the shared reader returns.
- Overlay treats `preview-capture` plus `status=passed` as capture availability. Persisted failed evidence may still have
  `captured=true` bytes and the binary endpoint serves them, so the new consumer hides the most useful failure image.
  The strict public DTO needs a path-free availability fact derived from internal evidence, not a status inference.
- Frontend Replica declares its sole, exactly-once task-scoped interface-modeler owner as `disjoint_goals` and as a
  goal-scoped node in the `interface-modeling` workflow, while delivery and package prompts declare the same identity
  task-scoped. Resolver and execution leases make this contradiction executable, and generated payload preserves it.

The required pre-edit full-repository call-point map is:

| Surface               | Production call points                                                                                                                                                                                                                                                                   | Test/package call points                                                                                                                 | Disposition                                                                                                                                                                                                                                                                      |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reference authority   | `architect/output-tools.ts`, `architect/agent.ts`, `architect/fidelity.ts`, `orchestrator/architect-stage.ts`, `orchestrator/build-context.ts`, `build/agent.ts`, `orchestrator/build-feedback.ts`, `build/evidence-pack.ts`, `build/evidence-manifest.ts`, `frontend-design/handoff.ts` | Architect fidelity/output, Build prompt/context, Orchestrator fidelity/tools/build-context tests and Replica selector/architect overlays | Make explicit authority govern whether coverage can be submitted, persisted, relayed, rendered or converted to target refs; reject surplus greenfield coverage rather than silently accepting or calling it authoritative. Preserve reference coverage only for explicit parity. |
| Region verified bytes | `browser-preview/evidence-runner.ts`, `region-comparison.ts`, `artifact-file.ts`, region tool wrapper                                                                                                                                                                                    | Evidence Runner, artifact-file and region comparison hostile tests                                                                       | Carry verified Buffer into every crop/size/composite consumer; do not reopen the screenshot path after verification. Test replacement after reader return.                                                                                                                       |
| Scroll verified bytes | `browser-preview/scroll-slice-comparison.ts`, `artifact-file.ts`, scroll tool wrapper                                                                                                                                                                                                    | Scroll-slice hostile tests                                                                                                               | Evaluate similarity and generate side-by-side output from verified Buffers. Test ordinary replacement and hard-link changes at the consumer boundary.                                                                                                                            |
| Capture availability  | `browser-preview/persist.ts`, `server/routes/browser-preview.ts`, binary capture route                                                                                                                                                                                                   | Browser route/SDK tests, `overlay/BrowserPreviewPanel.tsx`, Overlay service tests, generated OpenAPI/SDK                                 | Add one strict path-free availability boolean derived from actual captured artifact identity; Overlay loads both passed and failed available captures and does not infer availability from status. Regenerate contracts centrally.                                               |
| Replica owner scope   | Frontend Replica manifest and package Orchestrator/selector/interface-modeler prompts                                                                                                                                                                                                    | repository dynamic-package/source-project/virtual-workflow tests and generated payload                                                   | Declare the unique interface-modeler `single` and task-scoped in every workflow; add an exact consistency regression, then regenerate payload centrally.                                                                                                                         |

These corrections must not add aliases, compatibility fields, status gates or fallback paths. The authority correction
owns Build Feedback; the Browser correction must not edit it. Package and Browser subtasks must not regenerate shared
payload/OpenAPI/SDK files; the main agent performs one official generation after all source corrections converge.

### D2b nineteenth candidate implementation evidence before generation

The five eighteenth-freeze blockers are corrected at their owning boundaries. A strict
`visualDesignAuthorityFromPackets` parser rejects conflicting authority packets. Architect exposes
`register_reference_coverage` only for `reference_parity`; surplus coverage is rejected at submit validation and again
before any Architect-stage persistence. Persisted goal fidelity, Build scoped context, Build prompt rendering and
Build Feedback crop-to-target projection all require that same authority. Greenfield/no-authority coverage is not
silently discarded. Reference-parity coverage still produces the declared target reference. This subtask passes
authority/prompt/context/build-feedback tests `144/144`, a real goal-build integration `1/1`, dedicated greenfield
submission defenses `2/2`, root typecheck `9/9`, formatting and diff checks, with no old
`requireReferenceCoverage`/implicit `.some` authority residue.

Region Evidence Runner now passes its verified screenshot Buffer through every crop, similarity, content and composite
consumer. Scroll Slice likewise consumes verified Buffers, uses an isolated transient capture path, and removes that
path before publication. A Region hostile test replaces the ordinary capture after the reader closes; a Scroll hostile
test replaces it with an external hard link at the same boundary. Both are rejected/pinned to verified bytes. Artifact,
Scroll and Overlay tests pass `22/22`; Evidence Runner/region sidecar `17/17`; public route availability `2/2`; root
typecheck `9/9`; and diff check. The wider Region group still encounters the user-excluded Windows sidecar empty-output
and SIGTERM class; no fallback was added.

The strict public Browser evidence DTO now includes required path-free `captureAvailable`, derived from the internal
capture artifact and verified byte map rather than `status`. Overlay loads failed and passed captures when available
and does not request failed evidence without capture bytes. Frontend Replica declares its unique interface-modeler as
`goal_concurrency=single` and task-scoped in both workflows; a 26-assertion regression binds projection, workflow,
tool ownership, selector and prompt semantics. Source subtasks deliberately did not edit generated payload/OpenAPI/SDK.
The main agent must now run official generation once, remove the temporary Overlay type intersection against the old
generated SDK, and rerun generated-contract, Overlay, package, typecheck and residue verification before refreezing.

Official generation succeeded and made `captureAvailable` a required native SDK field; the temporary Overlay type
intersection was removed. The first combined final-tree run then exposed three deterministic Orchestrator test-fixture
failures and resource-sensitive runs. Two manually seeded Build fixtures persisted Frontend Design report keys without
the now-required `design_authority`; they must declare `greenfield_original` because material/retry screenshots are not
parity authority. The Frontend Innovate integration still expected the complete materialized public report to be
duplicated inline in a text context packet. The current single-source contract deliberately supplies the canonical
report path plus a separate `visual_handoff.v1` structured authority; the test must assert those two facts and must not
restore an inline report copy. Full grep located these three fixtures in `orchestrator/tools.test.ts` and the existing
structured-data helper in that file. A Browser compare route failure from the same parallel run passes alone `1/1` in
16 seconds, so it is resource contention rather than a response-contract defect and receives no patch. Region and
repository package tests that exceeded their default five-second case timeout must be rerun serially with an explicit
case timeout after the deterministic fixtures are corrected; timeout extension changes the test runner allowance, not
production behavior.

The corrected Frontend Innovate test then reached Visual QA and exposed a deeper fixture contradiction: the operator
asked for a redesigned direction with multiple brainstorm drafts, not source-page pixel parity, but the dispatch used
`reference_parity` while its Visual QA report and design evidence had no canonical parity regions/comparisons. The
Frontend Innovate selector already distinguishes greenfield original work from explicit reference parity and states
that competitor/reference rows are not a fabricated greenfield prerequisite. This fixture must therefore use
`greenfield_original` and `render_review`; the existing HTML and competitor pages remain declared design materials, not
authority. It must not fabricate parity evidence merely to satisfy the newly strict downstream contract.

The main-agent final residue scan found one more production call point omitted by all three eighteenth-freeze reviews:
task-scoped direct Build still called `targetEvidenceForBuild(task)` without authority and converted every manifest
visual reference into a target reference. The goal branch was strict, but the sibling task branch remained a second
authority source. Full grep shows the only production caller is `composeBuildEvidencePack`, invoked by both branches of
`orchestrator/build-tool.ts`; tests call it directly in `build-feedback-context.test.ts`. The task branch must first
construct the same canonical context packets, derive authority through `visualDesignAuthorityFromPackets`, and pass it
to evidence composition. Task visual material projects as a target only for explicit `reference_parity`; greenfield or
missing authority keeps the material available through its ordinary declared channels but does not silently upgrade it
to a 1:1 target. Positive parity and negative greenfield/no-authority cases are required.

### D2b nineteenth candidate verification before freeze

Official generation refreshed built-in Expert Squad payloads, OpenAPI, JavaScript SDK and API documents. Overlay now
uses the generated `BrowserPreviewReadTaskEvidenceResponses[200]` directly, with no temporary intersection or alias.
The final source tree passes the Authority/context/fidelity/build-feedback group `100/100` with 275 assertions; the
Frontend Innovate end-to-end fixture `1/1` with 76 assertions; both manually seeded Build authority fixtures; the real
task-scoped direct Build integration; Browser Region ordinary-replacement, Scroll hard-link replacement, capture
availability and compare-route isolated cases; Replica unique task-owner `1/1` with 26 assertions; SDK/Overlay/Replica
contract group `41/41` with 788 assertions; prompt/core hygiene `16/16`; historical links `21/21`; root typecheck `9/9`;
production dead-code analysis; route inventory; docs freshness; and diff checks.

The task-scoped Build sibling now derives authority from the same structured context packets as goal Build. Explicit
parity projects task visual references; greenfield and missing authority keep those attachments out of targetReferences.
The Frontend Innovate fixture uses greenfield authority and `render_review` for an operator-requested redesign with
multiple directions, while retaining source HTML and competitor pages as materials. Residue review confirms remaining
reference-coverage rendering is guarded by explicit parity and surplus coverage fails at Architect, persistence, goal
context and target projection. Region/Scroll Sharp calls consume verified or derived Buffers; the only status-based
Overlay evidence branch is presentation state/icon selection, not image availability. Retired Frontend Design tools,
HTML benchmark, fixed pipeline and two-goal assumptions are absent from production/generated sources.

The complete Region directory remains unable to provide a clean aggregate result in the user-excluded Windows
sidecar/resource environment: affected cases hit empty helper output/SIGTERM near the historical five-second helper
window. The exact new hostile consumers pass serially and no fallback was added. Full repository package runs likewise
contain known default five-second MCP/resource-sensitive cases; the new owner regression passes with an explicit
20-second case allowance. These environment results are not cited as aggregate passes. The abandoned product E2Es
remain outside scope. A new exact-tree review is mandatory; no prior ACCEPT transfers.

### D2b nineteenth freeze rejected: capture guessing, greenfield authority and specialized Replica rules

The nineteenth freeze (HEAD `e5601f7b5d`, tree `ecb04c0322c2`, fingerprint `beff1bfea97e`) is rejected by all three
independent reviewers. The frozen index did not drift. A concurrently edited package-manager test appeared beside the
already excluded CMS record after freezing; neither belongs to the reviewed candidate and both must remain untouched.
No nineteenth-freeze review or test result is an ACCEPT decision.

Six blockers remain:

- persisted Browser evidence still stores `capture: unknown`; preview availability recursively guesses arbitrary nested
  path keys. A malformed `{captured:false,path:<readable file>}` can therefore become publicly available capture bytes.
- Frontend Design materialization rewrites all `materials` and Figma inputs as `visual_reference`, and generic prompt
  text then calls those refs visual truth even for explicit `greenfield_original`.
- the Frontend Design public handoff renders every visual-region binding as an Architect reference-coverage obligation
  without reading design authority, creating an impossible greenfield prompt/tool contract.
- generic Build prompt text prescribes page chunks, universal props/data conversion, source IR, source ids, region
  geometry and pixel consistency for all packages. These are Replica package strategies, not platform invariants.
- the Frontend Replica source-project generator injects a TradingView label and uses Reuters/Dow Jones/dpa-afx/GDP,
  inflation, news/event/ideas/map/chart and similar English/business keywords to decide component types. The full grep
  shows this pattern across metric-ranking, chart-card, list/grid replacement, map/chart and event-grid classifiers, not
  just the lines sampled by the reviewer. Display text must never decide structural component identity.
- Replica selector and Orchestrator overlays impose a usual minimum of ten goals. That fixed cardinality is a gate
  unrelated to source complexity and contradicts the newly generic one-goal Architect contract.

The complete pre-edit call-point map is:

| Surface                | Production call points                                                                                                         | Tests/package surfaces                                                                   | Disposition                                                                                                                                                                                                                                                                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preview capture schema | `browser-preview/persist.ts` persisted/public schemas, capture artifact extraction, read/availability and binary route         | evidence-runner, verification, layout, server route/SDK, Visual QA/metrics/tool fixtures | Define strict operation-specific preview capture branches. Only `captured=true` may own exact path/digest fields; `captured=false` forbids them. Delete recursive preview path guessing and reject malformed persisted/written payloads. Keep comparison/layout schemas explicit.                                                     |
| Greenfield materials   | `orchestrator/frontend-design-tool.ts` Figma/material materialization and `frontend-design/agent.ts` manifest prompt rendering | Frontend Design prompt/material/orchestrator integration tests                           | Preserve mode-explicit material identity. Greenfield inputs are materials/context, not visual authority; parity inputs may be visual references. Prompt headings/instructions must follow explicit manifest intent and authority.                                                                                                     |
| Region handoff         | `frontend-design/handoff.ts` decision-log renderer and downstream Architect packet consumers                                   | handoff/Architect/Build context tests                                                    | Render reference-coverage obligations only for explicit parity. Greenfield bindings remain implementation/render evidence and cannot instruct planning to create reference coverage.                                                                                                                                                  |
| Generic Build leakage  | `build/agent.ts` requirements/content rules                                                                                    | Build prompt tests and Frontend Replica implementer overlay                              | Remove Replica/source-IR/page-chunk/pixel prescriptions from core; keep task/project/library-neutral requirements. Put any still-needed Replica strategy only in the active package overlay and test core absence/package presence.                                                                                                   |
| Specialized generator  | package `source-project-generator.ts` semantic ranking/chart/list/grid/map/event classifiers and injected logo label           | `frontend-replica-source-project.test.ts` fixed BBC/TradingView/economic fixtures        | Remove all brand, domain, English business and visible-copy keyword decisions. Classify from tag/role/attributes, explicit source IR, child topology, repeated structure and media geometry. Preserve text only as output data. Add non-English/non-financial structurally equivalent regressions and neutral missing-label behavior. |
| Goal cardinality       | Replica `selector.md` and package Orchestrator overlay, generated payload                                                      | package prompt/payload tests                                                             | Delete fixed ten-goal and justification policy. Decomposition follows real ownership/dependency/acceptance boundaries; concurrency remains manifest-declared guidance.                                                                                                                                                                |

The three corrections may proceed independently as Browser schema, platform authority/core prompt, and Replica package
generator/policy. No subtask may edit generated payload/OpenAPI/SDK; the main agent runs official generation once after
all source changes converge. No fallback aliases, keyword replacement tables, cardinality gates or compatibility
schemas are allowed.

### D2b twentieth candidate implementation evidence before generation

The six nineteenth-freeze blockers are replaced at their owning sources. Browser Preview uses an operation-specific
capture contract. Preview success requires `captured=true`, `passed=true`, one top-level path and a 16-character digest;
preview failure requires `captured=false`, `passed=false` and rejects path, digest, nested path or unknown fields. Both
write and database read parse the operation/capture pair, availability and the binary endpoint read only the strict
success branch, and recursive preview path discovery is deleted. Browser non-sidecar routes pass `35/35`,
verification/layout `19/19`, SDK `3/3`, and dedicated malformed-record security cases `3/3`; the excluded Windows
sidecar case remains the only full-route failure.

Frontend Design now carries dispatch mode through Figma and local material preparation. Explicit parity material uses
visual-reference intent; greenfield material uses non-authoritative design-reference/source intent and its prompt calls
the resource context rather than truth. The manifest is an index and cannot grant parity. Public handoff rendering
requires design authority: parity region rows instruct reference coverage, while greenfield rows expose implementation
region identity/locator and render-review evidence without reference keys or raw binding duplication. Generic Build no
longer prescribes page chunks, universal props/data conversion, source IR/ids/geometry/pixels or chart/map/heatmap
strategy. Platform prompt/handoff/Build/core tests pass `65/65` with 573 assertions, real Figma dual-mode dispatch
`1/1` with 24 assertions, Frontend Innovate through three Builds/Visual QA/Integrity `1/1` with 79 assertions, handoff
`7/7`, and root typecheck `9/9`.

Frontend Replica no longer imposes ten goals or a below-ten proof gate. The source-project generator no longer injects
TradingView/BBC/business labels or uses visible English/financial/news/map/chart strings to classify components.
Classification follows explicit source-IR replacement kind, DOM tag/role/attributes, child/repetition/table topology,
media/SVG geometry and time-node structure; an untyped replacement-plan row defers to the baseline rather than guessing.
Component code identity comes from structural node/role evidence and visible text remains render data. An English and
Japanese non-financial structural-equivalence regression produces the same component set. Package tests pass `33/33`
with 504 assertions, OpenCorvus typecheck and diff check, with zero production residue for the removed brand,
visible-text classifier and fixed-cardinality patterns.

The source subtasks did not modify generated payload/OpenAPI/SDK. The main agent must run official generation once,
then audit the exact manifest-intent vocabulary, capture discriminated union, package payload and all keyword/cardinality
residue before testing and refreezing.

### D2b twentieth candidate post-generation recall and unresolved audit

Official generation completed successfully, but the required post-generation residue review found one vocabulary
boundary that must be resolved before the tree can be frozen. The persisted design-resource manifest has the canonical
intent `design_source`, while Orchestrator materialization and task attachment/system-artifact rows use
`design_reference`; `createDesignResourceManifest` maps the latter to the former and
`designResourceManifestFileRefs` maps it back. Full-repository grep found the production mapping only in
`frontend-design/design-resource-manifest.ts` and the producers in `orchestrator/frontend-design-tool.ts`; tests in
`frontend-design/design-resource-manifest.test.ts`, `frontend-design/prompt.test.ts`, and
`orchestrator/tools.test.ts` currently assert both words. This may be a boundary translation, but it may also be a
forbidden compatibility alias and cannot be accepted without proving why two names are required. A read-only
independent agent is auditing the contract. If no distinct domain meaning exists, one canonical word must replace both
directions and the tests must be updated; no alias may remain.

The independent intent audit rejected the boundary as an actual double source: the two words have no distinct domain
meaning, `inferIntent` translates `design_reference` to `design_source`, and `fileRefIntent` translates it back while
Orchestrator producers emit the former. The correction therefore keeps only `design_source`, which is already the
strict persisted schema term and accurately describes non-authoritative greenfield input. All greenfield/Figma/local
material producers and task rows must emit it directly, both translation branches must be deleted, and tests must
prove that the removed alias is rejected rather than accepted for compatibility.

The same full-repository intent grep exposed separate later platform debt in `task-api/index.ts`: task creation paths
still infer a missing attachment intent from MIME (`image/*` becomes `visual_reference`, other files become
`spec_artifact`). That implicit default is not the `design_reference` alias fixed by this candidate and changing the
public task contract requires its own complete route/SDK/Overlay/caller map. It remains a known no-fallback violation
after this slice and must be removed before claiming final platformization; the current slice must not silently expand
the alias patch into an unreviewed public API change.

The capture scan confirms preview capture is no longer stored as an unparsed shape: the persisted envelope retains a
generic `capture: unknown` field only so the operation discriminator can parse it immediately against
`BrowserPreviewOperationCapture` during write/read. Preview capture itself is strict and discriminated by `captured`.
`captured=true, passed=false` is intentionally possible because screenshot bytes can exist even when page verification
fails, and the public capture must remain observable; `captured=false` forbids path/digest and requires `passed=false`.
The exact write, DB-read, availability and binary-route behavior remains under independent read-only review before an
ACCEPT decision.

The independent Browser audit rejected one cross-field integrity gap. `captured=true, passed=false` is valid only with
evidence `status=failed`, but the current operation schema parses `status` and `capture.passed` independently. Both
write and DB-read paths therefore accept `status=passed` with an uncaptured/failed capture and `status=failed` with a
passed capture. The shared operation/status/capture schema must model exactly three preview cases: passed evidence with
captured/passed bytes, failed evidence with captured/failed bytes, and failed evidence with no captured bytes. Both
write and DB-read must parse that same schema, and tests must reject all three contradictory pairs while retaining
failed-but-captured availability and binary access. This is a Zod data-integrity constraint, not scheduler/process
control. The same operation envelope must bind the outer and embedded status for layout-geometry evidence, which is
the only other capture shape that carries its own status; otherwise the operation-specific contract would retain the
same double-source defect under a sibling discriminator.

The Replica residue scan found no removed brand/cardinality strings in the package and no rejected Replica strategy in
generic Build. One `visibleText(node)` call remains solely in `findFirstHeadingText`, which supplies rendered heading
content rather than component classification; an independent review must verify that no downstream identity decision
uses it. Generated payload matches for TradingView/Reuters/Dow Jones are from a different bundled research package,
not Frontend Replica, so payload review must scope findings to the Replica package entry rather than treating all
built-in package content as one policy surface.

The independent Replica review rejected that residue conclusion because the scan covered brand text but not private
DOM/CSS identities. `source-project-generator.ts` still branches on `tv-lightweight-charts`, `tv-footer`, the full
`tv-header*` family, `tv-main`, `ideaCard-*`, `ui-lib-card-link-title`, `tickerBox-*`, `core-map-content` and fixed hash
classes. These values participate in chart/header/footer/card/map/page-shell extraction and therefore determine
component identity. The same generator also injects source-specific defaults (`lang=en`, `dir=ltr`, authentication,
theme/touch/search/index classes) when source attributes are absent, unconditionally adds theme/touch classes, and
guesses missing images from fixed hashed class names. This is one systemic source-site adapter embedded in a supposedly
generic generator, not a list of isolated forbidden words. It must be replaced with HTML semantics, role/ARIA,
explicit source-IR attributes, DOM topology and geometry; no replacement keyword table is allowed.

The call-point review also found `source-context/source-skeleton.ts` passes visible text into
`inferInteractionKind`, whose English `tab`/`accordion`/`dropdown`/`menu`/`search` substring checks decide interaction
identity. The only caller is the skeleton interaction extraction loop. It must infer from tag, input type, href,
role/ARIA and structural control relationships only; visible text and arbitrary CSS class names remain evidence/render
data and cannot decide identity. Tests must use structurally equivalent controls with unrelated classes and non-English
labels. Generic Build and the fixed-goal policy remain clean. A bounded subtask owns generator cleanup and its tests;
the main agent owns source-skeleton cleanup and the shared Recall/generated payload lifecycle.

#### Recall addendum: freeze17 Overlay benchmark residue correction

This correction is limited to the Overlay web benchmark, its public documentation and its static regression tests. It
does not modify platform runtime or Browser Preview code. The complete pre-edit grep found two duplicated policies in
`benchmark/overlay-web-benchmark.ts`: attachment mode replaces the task brief with a fixed
requirements/architect/planner/executor/acceptance sequence and promises automatic fixed-agent forwarding; and
`stop-after-architect` plus the report assertion both require at least two goals. The corresponding maintenance
surfaces are `test/benchmark/bench-script-cleanup.test.ts`, `test/script/document-health.test.ts`, and the English and
Chinese benchmark operation docs.

The attachment request must only identify the attached file as authoritative task input and leave workflow, dynamic
agent identity and delegation to the active runtime protocol. Architect completion must have one benchmark-local data
predicate backed by the board's persisted Architect graph projection and at least one materialized goal; it must not
require a graph contract or a second goal because both are validly absent for an independent one-goal task. Focused
tests must reject the fixed pipeline and auto-forwarding claims, prove the one-goal predicate is used by both waiting
and report acceptance, and retain terminal-task exit plus inactivity-timeout behavior. No fallback, gate, scheduler or
state machine is introduced.

### D2b twentieth candidate lossless Replica generator correction

The post-generation Replica audits rejected the automatic semantic DTO layer itself, not only its private selectors.
`renderDomChildJsx` replaced complete source subtrees with hand-shaped news/event/table/ranking/chart/header/footer/map/
link-grid/idea/FAQ/section DTOs. Unknown attributes, wrappers, controls, SVG nodes and rich table/list content were
therefore silently discarded even after brand and class classifiers were removed. The same generator emitted a static
replacement plan and iteration state that prescribed a workflow inside the package tool. This contradicted the
platform boundary: source generation must provide a faithful editable runtime seed and evidence, while the external
team decides how to refactor it through ordinary agent reasoning and tools.

The correction deletes the entire automatic semantic replacement layer, its specialized renderers/data models, FAQ
and SVG aggregation adapters, replacement plan, iteration state, source-specific tests and fixed component identities.
The only runtime projection is now lossless `page.ir.json` DOM-to-React compilation with optional lossless file
partitioning. `sourceComponentPatterns` can mark a structural file boundary but cannot select or prescribe a component
replacement. Image placeholders bind by the explicit `page.ir.json` attribute `assetId` to the uniquely matching
`assets/images/<assetId>.<extension>` file; missing and duplicate identities fail instead of consuming an ordinal image
list. SVG path sidecars remain individual `AssetPath` nodes so source order and attributes are preserved. Legal custom
hyphenated attributes are retained, event handlers remain excluded, and no guessed visible content or default SVG fill
is injected.

The source-project contract was reduced from 30 source-shape tests to 15 platform tests. New hostile evidence covers
image/logo identity, SVG `defs`/gradient/rect content, standard `dl`/`dt`/`dd`, an icon-only button, unknown nested
wrappers and custom attributes. A paired English/Japanese fixture with unrelated classes and no replacement hint
proves equal structural output. The focused generator passes `15/15` with 220 assertions; source-skeleton, package
policy and real dynamic package projection pass `23/23` with 1,038 assertions; root typecheck passes `9/9`; production
dead-code analysis and diff check pass. Two fresh read-only reviewers are auditing the lossless/runtime and asset
projection boundaries. Official payload generation must wait for those decisions, and no earlier freeze ACCEPT applies.

### D2c twentieth candidate canonical compiled-webpage correction

Both exact-tree reviewers rejected the 15/15 result as false-green. The generator parsed `page.ir.json` and the asset
manifest as untyped optional JSON, scanned `assets/images` and `assets/svg`, required numeric `asset_\d+` filenames,
reused `src` for `srcset`, rendered a missing SVG path as an empty string, ignored long text and general attribute
sidecars, collapsed whitespace, stripped `!important`, replaced the source head, and silently removed source code and
unknown attributes. The compiler also created implicit paths for embedded data URIs without putting the corresponding
`assetId` on the owning attribute. Those paths could not be recovered without consumer guessing.

The owning correction is one strict compiled-webpage contract. `CompiledWebpageStructureSchema` and
`CompiledWebpageAssetGraphSchema` parse the two required inputs. The loader validates unique node, asset and path
identity, `sourceIr`, asset count, safe paths, declared inventory, fatal UTF-8, SHA-256 digest, byte/character counts,
kind, non-empty SVG geometry and exact IR-to-`usedBy` ownership/role edges. Every sidecar restores its complete node or
attribute value through explicit `assetId`; the compiler now externalizes an entire embedded-data-URI attribute rather
than manufacturing an implicit path. Asset directory scanning, numeric-ID assumptions, SVG empty fallback, src/srcset
coupling and viewport fallback to `extracted-page.json` are deleted.

The editable React baseline now mounts directly to `document.body` and returns a Fragment, so file partitioning adds no
DOM wrapper. Text and inline style remain exact; the latter is applied through one generic ref helper so CSS priority is
not parsed away. Attribute identity and boolean semantics come from the mature `property-information` package exposed
through the plugin contract and bundled into the package-tool runtime. Source script/event/active-URL material is inert
and recorded in the generated manifest rather than executed or silently erased. Safe source title/meta/canonical-link
head metadata is retained. `web-clone-source-manifest.json`, canonical IR/graph and both source CSS evidence files are
required inputs; runtime viewport comes only from the source manifest. Critical CSS is the only generated runtime CSS
import; full-source CSS remains explicit evidence and is not double-applied.

The revised focused suite contains 18 tests, including canonical schema/inventory/digest/size/ownership corruption,
all sidecar kinds, distinct src/srcset identities, long text/attributes, whitespace, head metadata, XML/XLink, boolean
attributes, arbitrary asset IDs and missing/empty SVG rejection. Direct generator tests pass; the remaining package-tool
tests are currently validating the host runtime dependency resolution for `property-information`. Official generation,
payload review and freeze remain prohibited until this group is green and fresh independent reviews ACCEPT the exact
tree.

### D3 Recall: retire the crypto-trading one-off benchmark harness

The operator challenged cryptocurrency-specific work inside the platform repository. The complete pre-edit search found
one real executable specialization rather than only Node.js digest APIs or historical prose:
`packages/opencorvus/script/benchmark/crypto-trading-long-mission.ts`. It hard-codes a host project path, prompt artifact,
server port, benchmark state filename and the `frontend-innovate` / `mirror-watch` / `opentest` package set. Its only code
consumer is `packages/opencorvus/test/benchmark/crypto-trading-long-mission.test.ts`; no package script, production route,
SDK, runtime loader or generic benchmark imports it. The task input is the one-off
`specs/artifacts/crypto-trading-task-c.md`. `specs/README.md` and `specs/records/2026-07/README.md` incorrectly publish the
finished experiment as current/active. The July benchmark record and later investigation references are historical
evidence and must remain readable; the concurrently edited CMS record is outside this slice and must not be modified.

Disposition: delete the executable harness, its specialized unit test and its task-input artifact; remove the current and
active index claims; retain the dated benchmark record as history and replace its artifact-path claim with a natural
statement that the retired one-off input is no longer stored. Add the deleted paths and forbidden crypto benchmark symbols
to the existing benchmark cleanup regression so the harness cannot reappear under another accidental entry point. This is
deletion of a one-case control script, not removal of generic Mission, Mailbox, expert-squad provisioning or inactivity
semantics. Acceptance requires the benchmark cleanup, historical-link and document-health tests, a whole-repository residue
scan, dead-code analysis and an independent exact-tree review.

### D4 Recall: separate payload market declarations from installed runtime loading

Independent payload-boundary review rejected the generated-payload candidate for one real loader ownership defect. The
payload module itself is the exact generated provisioning image of `.opencorvus/expert-squads/**`; it is not an editable
authority, active selector or runtime catalog. Its production importer is the package manager. Release, selected install
and built-in update materialize one chosen source through the ordinary strict installation path, while Registry discovery
and `PromptProfileResolver` continue to derive runtime identity only from `prompt_profile.active` plus installed packages.
The domain bytes in the generated image therefore do not create a crypto/runtime specialization by themselves.

The defect is `payloadMarket() -> validatePayloadPackageSource() -> loadEmbeddedPackage()`. Market inventory reused the
complete embedded runtime loader, so merely listing uninstalled payload packages parsed every scheduler/worker prompt and
could fail on an inactive prompt. This contradicts `specs/current/architecture/04-extensions.md`: inactive declarations
may read only manifest, README and selector declarations. `loadEmbeddedPackage()` is also the one correct full loader for
the built-in `general` source and is directly covered by general/registry/package-manager tests; release, install and
update call sites must retain it. Existing `installSourceDirectory()` already performs source, staging and installed-target
full validation, so no preflight gate or fallback is needed.

Disposition: extract one embedded declaration parser in Registry that validates manifest identity/topology and reads only
README/selector declarations. The full embedded loader composes it and then reads projected prompts. Market alone consumes
the declaration parser and computes capability counts from its manifest; release, selected install and built-in update keep
the full validator. Replace inaccurate `built-in expert squad` errors in the shared embedded boundary with `embedded expert
squad`. Regression must prove a blank inactive prompt is accepted by declaration parsing and rejected by full validation,
and that market listing never calls the full loader. Runtime catalog/projection isolation tests remain required. No second
manifest parser, compatibility alias, fallback or weakened installation validation is allowed.

### D2c independent review rejection: active top-level attributes and incomplete source projection

The first fresh D2c reviewer reproduced five defects that invalidate the 31/31 focused result. Raw `html` and `body`
attributes bypass child-node inerting and can execute event handlers from generated `index.html`. Active URL detection only
matches contiguous `javascript:` text although the browser URL parser accepts embedded ASCII tab/newline/carriage-return.
The compiler preserves source tag spelling while the consumer compares exact lowercase names and emits uppercase HTML tags
as React component identifiers. Comments and directives are omitted without appearing in the inert-source manifest. The
upstream source-skeleton writer also substitutes a synthetic missing-CSS comment instead of rejecting a declared missing
asset. Finally, the `/^on/i` event guess rewrites unrelated attributes such as `once` and `ontology`.

Correction must use canonical HTML ASCII-case normalization for HTML namespace only, one exact event-attribute predicate,
URL parsing semantics that cannot be bypassed by embedded ASCII whitespace/control characters, and the same inert
projection for document and child attributes. Comments/directives must either be represented losslessly by the canonical
compiled schema or explicitly recorded as non-executable source material; silent deletion is forbidden. Declared CSS asset
absence must fail at the source-context producer. Tests must cover html/body event and active-URL attributes, bypass forms,
uppercase HTML with case-sensitive SVG preserved, legitimate `on*`-prefix attributes, comments/directives and missing CSS.

### D5 Recall: remove synthetic Frontend Design review evidence and fixed pass counts

Whole-repository review found one host-owned false-evidence path. `FrontendTemplateFinalSchema` defaults
`template_iteration_notes` to two statements beginning `Host recorded` and defaults `completeness_review` to a third host
acceptance claim. No host review produced those statements. The draft tool schema separately defaults these fields to
empty values, `frontendDraftMissingActions()` and `submitFrontendTemplateDraft()` require two notes, the Frontend Design
agent prompt prescribes two passes for both modes, and the Orchestrator adapter description repeats the fixed count. Report,
handoff and decision-log consumers only serialize the final values; they do not require a count of two. The only direct
behavior test is `frontend-design/prompt.test.ts`; Orchestrator tests assert field presence but not the count.

Disposition: Final schema requires at least one genuine model-authored iteration note and one genuine completeness review,
with no host-authored defaults. Draft fields remain empty until the projected agent writes them through existing update
tools. The single draft completeness check asks for one or more concrete review findings; the duplicate post-parse count
check is deleted because the strict Final schema already owns data validity. Agent and adapter prompts require a complete
self-review covering evidence, visual/state quality, implementation feasibility, gaps and blockers without prescribing a
pass count or creating a workflow. Reports and decision logs retain the actual submitted evidence. Tests must prove an
empty draft cannot submit, one real review note can submit, and the schema/source contains no `Host recorded` synthesis or
fixed two-pass requirement. No host gate, fallback note or automatic evidence injection replaces the removed defaults.

### D2d Recall: standards-compliant HTML/SVG compilation authority

The fresh D2c exact-tree review accepted the generic `sourceAttributesRef` correction but rejected the canonical
compiler upstream. `packages/opencorvus/src/browser/webpage/compiled-html.ts` is the only producer of
`CompiledWebpageStructureSchema` and currently calls `htmlparser2.parseDocument` directly. The complete call-point scan
found production consumers in Frontend Design webpage compilation/extraction, Browser Preview evidence routes, and the
Frontend Replica source-context/project tools; tests cover the compiler, source skeleton, source project and generated
payload. No second HTML-to-IR producer may be introduced.

Direct reproduction proves the parser is not HTML/SVG namespace compliant: source markup under SVG `title` is emitted
as one literal text node instead of the browser-defined HTML integration subtree. The source-project regression then
asserted that escaped literal and created a false green. The correction must replace the compiler's parser with the
mature standards-compliant `parse5` parser, so the existing lossless encoder retains one DOM shape without a hand-written
namespace parser. A direct adapter experiment was rejected before completion because the htmlparser2-shaped adapter keys
namespaced attributes by local name and loses `xlink:href` when an ordinary `href` is present. The accepted boundary is
therefore parse5's typed default tree plus a lossless IR projection that uses the parser's ordered attribute list and
source locations to preserve prefixes and original spelling. `parse5` must be a direct OpenCorvus dependency rather than
relying on transitive installation; the lossy adapter must not be installed directly. Tests must prove `foreignObject`, `desc`, and `title`
integration children remain real elements through compiled IR and generated React, while comments, directives,
attribute spelling, sidecar ownership, digests and inventory remain under the existing strict contract. No source-tag
special case, fallback parser or compatibility branch is allowed.

### D6 Recall: task conversation messages have one durable owner

The independent end-to-end message audit proved that the Overlay request card is not an isolated presentation defect.
Initial task creation stores `engine_task.request` but no root-session message; the first Orchestrator turn persists the
request in its child session, while `tree-writer.rebuildTaskContextCard()` independently creates `ctx:user-request` from
the board. Follow-up `/message` and `/inject` calls persist a real root user message through
`appendTaskSessionMessage()`, then copy the same text into `OrchestratorEvent.operatorMessage` and persist it again in
the child through `SessionPrompt.prompt()`. Retry/replan notes are likewise persisted as `role=user` even though they are
button intents rather than user-authored text. Queued wake artifacts and `TaskMessageRecorded` retain further full-text
copies. `inject_operator_message` reads the event copy and returns a synthetic "No operator message" fallback when it is
missing.

The complete call-point map covers `task-api/index.ts`, `orchestrator/event.ts`, `orchestrator/agent.ts`,
`orchestrator/interaction-tools.ts`, `orchestrator/tools.ts`, `engine/queue.ts`, `engine/model.ts`, the Orchestrator core
prompt, task conversation routes, `overlay/services/tree-writer.ts`, `overlay/store/card-tree.ts`,
`overlay/components/TaskDirBar.tsx`, `specs/current/architecture/07-panel-reactivity.md`, and their session-reuse,
operator-message, queue, task-message route, conversation hydrate, board-order and layout tests. Direct child reply and
operator-steer are separate explicit protocols and must not be changed in this slice.

Disposition: keep the root/child session topology. Delete every `ctx:user-request` projection. The initial dispatch brief
remains the one real first child input. A follow-up operator message remains the one real root message; its wake carries
only the required durable `messageID`. Orchestrator follow-up wakes use `runOnce` plus `SessionPrompt.loop()` and the
visible `inject_operator_message` tool must load exactly that root message ID, validate task/session/role/provenance, and
render its real text/file parts. Missing, foreign, child-owned or ordinary root messages fail immediately. The dynamic
system context may identify the message ID but must not copy its text. Retry/replan and internal lifecycle facts never
create user messages. `TaskMessageRecorded` and queued wake artifacts retain identity/index facts only, not text. Task
attachment controls read `board.task.attachments` as resource projection rather than through a fake message card.

The audit also found an adjacent provenance defect that this slice must not hide: initial dispatches are currently
hard-coded `author: user`, although `panel.create_task` already stamps authenticated `metadata.actor` values such as
`mission` and `control_agent`, and the public task route accepts unstamped input. The post-message correction must either
make the authenticated creator actor an explicit strict task-creation contract for every entry point or leave platform
finalization rejected; it may not infer identity from free-text `source` or default unknown callers to user. Tests must
prove Mission, Control and panel/API creation identities rather than checking labels alone.

Acceptance requires negative whole-repository residue for `ctx:user-request`, event-carried operator text/attachment
summaries, `No operator message is available`, and retry/replan user turns; positive tests must show one root follow-up
row, zero child duplicate rows, strict ID lookup including file parts, queued ordering by ID, and unchanged first-turn
request dispatch. No hidden message, compatibility alias, fallback, process gate or second conversation projection is
allowed.

### D2d independent review correction: React-owned namespace lifecycle

The first namespace runtime correction was rejected because `sourceElementRef` replaced a React-owned host node while
React Fiber retained the detached original. The accepted direction never replaces a host node: canonical child
namespace is compared with the exact React host-context projection, and only a proven mismatch boundary delegates its
children to the browser's inert fragment parser. A Browser MCP Node sidecar must mount the generated component under
StrictMode, rerender it, assert the SVG integration children remain XHTML, and unmount without retained React nodes.

The second exact-tree review confirmed that Fiber defect is removed but rejected two remaining contract gaps. HTML void
element semantics were applied by tag name in every namespace, so a legal SVG or MathML element named `source` loses
its children in both JSX and serialized boundary paths. Void handling must require the HTML namespace and tests must
cover both render paths. The generated package also declared floating `react` and `react-dom` ranges although the
host-context projection and lifecycle test bind one concrete runtime. The shared generated frontend package profile
must declare the exact same locked React and ReactDOM versions used by the test; no range or consumer drift is allowed.
The real browser lifecycle fixture must additionally prove event attributes, active URLs, `srcdoc`, and script source
material inside a namespace boundary remain inert. Payload generation/freshness and a new exact-tree review remain
required before D2d can be accepted.

The same review reproduced a third security gap: restored executable `data:` URLs can reach the runtime through
document/navigation attributes such as iframe `src`, anchor `href`, object `data`, form actions and script/link sources.
The inert projection must be tag/namespace/attribute aware: JavaScript URLs and source-document URLs are always inert;
`data:` remains usable only for explicit image/media resource bindings and ordinary non-URL data attributes. Both JSX
and serialized namespace-boundary paths must call the same predicate, and the real Browser MCP fixture must prove that
source event handlers, `srcdoc`, script content and executable data documents do not set a parent/global marker.

### 2026-07-19 execution-order update: Frontend Replica last

The user explicitly moved Frontend Replica to the final implementation phase. This changes execution order only; it
does not accept, waive, or remove any recorded D2d defect or visual/runtime acceptance criterion. Work now proceeds in
this order: finish D6 task-message single ownership and provenance; complete the platform-wide legacy and projection
audit; freeze the general expert-squad runtime interfaces and deliver the SDK/documentation; integrate and push the
reviewable platform slices; then return to Frontend Replica D2d, regenerate its payload, run its focused Browser MCP
visual/runtime verification, and obtain a fresh exact-tree independent ACCEPT. The three previously cancelled product
E2E runs remain outside scope and are not silently restored by this ordering change.

### D6 implementation checkpoint: strict root-message tests and independent queue leases

The first D6 residue replay found production already exposes `rootMessage.messageID/kind`, but legacy tests still called
the deleted `EngineService.recordOperatorNote`, asserted event-carried operator text/attachment summaries, and tolerated
the deleted Overlay `ctx:user-request` card. Those tests now exercise `handleTaskMessage`, assert one persisted root
message identity, and require the Overlay projection to omit the fake request card. Direct agent-coordination
`operatorMessage` remains a separate operator-steer protocol and is not part of this deletion.

The test replay also exposed a strict queue-fixture defect. `engine/queue.ts` no longer has an implicit TaskLoop fallback,
so tests that dispatch must explicitly configure the instance-owned runner. The runner launches under an independent
project lease; waiting for it inside the caller's still-open `Instance.provide` lease blocks the test itself. The
correct fixture configures the runner inside the instance, verifies synchronous reopen/message facts there, exits the
caller lease, and lets `waitForQueueCompletionHooksForTest` settle the independent launch before database reset. No
production queue behavior or fallback was added. Focused engine verification passes 6/6, and the updated message-route
identity/attachment/cancelled-session/inject cases pass 4/4.

The Overlay history replay initially rejected before card-order assertions. Direct-await error evidence disproved the
first snapshot-version hypothesis: the fixtures already carried a real `board.snapshotVersion`. The actual strict
contract requires transcript info and `view.messages` to carry the same explicit `sessionAgentID` in addition to the
projected message `agentID`; the fixtures still represented the old single-identity shape. After adding both identities
without inference or fallback, the three affected hydrate/history cases pass 3/3 and prove no `ctx:user-request` card is
inserted.

The fresh independent D6 audit remains REJECT. It confirms that direct child operator-steer `operatorMessage` is a
separate valid protocol and that the deleted root aliases remain absent. Its remaining blockers are: make task creator
actor a strict Engine creation contract and prevent REST/global Mission provenance forgery; persist and validate a
discriminated root-message provenance including task ID and message kind; require `TaskMessageRecorded.messageID`;
replace retry/replan legacy note assertions with typed intent plus zero-new-message assertions; clean stale comments;
and complete the whole positive/negative message matrix. The audit's route-test old-shape finding was bound before the
current correction and is superseded by the focused 4/4 root-message route pass; all other findings remain open.

### D6 strict root-message provenance checkpoint

Root conversation messages now persist one strict `task_root_message` provenance object with protocol discriminator,
task ID, `operator|orchestrator` kind and non-empty source. `appendTaskSessionMessage` accepts the message kind rather
than an arbitrary author string and derives the only valid author from that kind. `read_task_message` verifies the
active project, root-session lineage, root message location, role, derived author, exact task ID and exact wake kind
before exposing text/file parts. The scheduler cron classifier uses the same schema and accepts only operator-kind root
messages; no consumer treats an arbitrary object as provenance. Direct child operator-steer payloads remain unchanged.

Focused verification passes: strict read positive/negative matrix 2/2; message routes 3/3; required
`TaskMessageRecorded.messageID` schema 1/1; retry/replan root-message absence 3/3; ordered durable intent drains 2/2;
Overlay history identity fixtures 3/3; and OpenCorvus TypeScript typecheck. The negative matrix covers missing wake
identity, ordinary root messages, foreign task provenance, wrong provenance kind, wrong author and child-owned
messages. Retry/replan tests assert root-session message counts remain unchanged, and queued intent payloads contain no
free-form note.

The remaining D6 platform blocker is creator actor provenance across Engine task creation, public/project/global
routes, panel/Mission/Control callers and the first Orchestrator child input. Two reply-error taxonomy cases also expose
an older status-contract mismatch (`410` actual versus `400` expected) before the no-root-fallback assertion; that
failure is recorded separately and must be resolved from the route error taxonomy rather than by weakening root-message
provenance. Fresh exact-tree independent review remains mandatory after creator identity and stale-comment cleanup.

### D6 creator actor contract Recall

The user requires D6 before the deferred Frontend Replica phase. The preceding independent D6 review proved that task
creation currently trusts caller-controlled `metadata.actor/mission`, while the first Orchestrator child hard-codes
`author: user`. Acceptance requires one explicit creator identity at every task creation entry, no inference from
`source`, no default actor, no public actor field, no forged Mission lineage, and the exact persisted creator projected
into the first child input.

The exhaustive production call scan found four creation classes. Project `POST /task` calls
`EngineService.createTask`; global `POST /global/tasks` calls `GlobalTaskService.create` and then the same Engine method;
`panel.create_task` calls the Engine method after resolving panel/control/Mission/right-sidebar identity; and
`orchestrator/task-proposal-tool.ts` calls `createSchedulerChildTask`. All other direct `createTask` calls are tests.
`CreateTaskInput.metadata` is an arbitrary record and must remain business metadata rather than an authority channel.
The durable consumers are Mission title/terminal notification logic and the first Orchestrator child prompt. Existing
PanelActor values are `panel_ui`, `control_agent`, `mission`, `explore`, and `right_sidebar_chat`; only natural message
authors may become task creators. Panel capability authorization remains separate from task provenance.

Disposition after independent creator-contract review: introduce one strict internal TaskCreator schema. Public project
and global REST creation use the natural `user` author and carry no session. `mission`, `control_agent`,
`right_sidebar_chat`, and `orchestrator` require the real caller session ID; Mission ID is derived inside the Engine from
the same-project Mission session metadata and is never accepted from a caller. Surface-only `panel_ui` and `explore`
labels are not natural authors and cannot create tasks. Both
`createTask(input, creator)` and `createSchedulerChildTask(input, creator)` require this second argument. The Engine
rejects caller-supplied actor, Mission and creator-session metadata, then persists only the parsed creator projection.
Mission creator identity forces the existing Mission source/title semantics; scheduler child identity forces the
existing scheduler-child source/parent lineage. Project/global REST always stamp `user`; panel accepts only the three
real session actors and passes its current session; task-proposal stamps `orchestrator` plus its
real Orchestrator session. The first child author is parsed from durable creator metadata and missing/invalid creator
metadata fails immediately. No compatibility alias or unknown-to-user fallback is allowed.

Tests must cover every production entry, public metadata forgery rejection, Mission missing/mismatched session facts,
Control/Panel/right-sidebar creator persistence, scheduler child creator/parent identity, and first-child authors for
user, Mission and Control Agent tasks. Existing direct Engine test calls must pass an explicit creator rather than gain a
test-only default.

The independent audit rejected the earlier draft in three places: creator provenance must be a mandatory internal
argument rather than part of public `CreateTaskInput`; reserved public metadata must be rejected rather than silently
stripped or overwritten; and Mission identity must be derived from the authenticated same-project session rather than
supplied by the panel caller. It also confirmed that `PanelActor.explore` and `panel_ui` are UI/capability surfaces, not
valid natural authors, so unknown create-task callers fail immediately.

### D6 creator provenance implementation and focused verification checkpoint

The strict creator contract is now implemented at the Engine boundary. `createTask` and
`createSchedulerChildTask` require a separate creator argument; every production caller supplies it. Project and global
REST stamp `user`; Panel supplies only `control_agent`, `mission`, or `right_sidebar_chat` with the authenticated current
session; scheduler proposals supply `orchestrator` with the active Orchestrator session. Caller metadata containing
`actor`, `actor_session_id`, `mission`, or scheduler-owned `parent_task_id` is rejected rather than overwritten.

`resolveTaskCreator` verifies same-project session lineage and actor/session agreement. Mission requires a Mission-kind
session and derives its ID from that session's metadata. Orchestrator requires an Orchestrator-kind session. Right-sidebar
Chat requires the canonical Chat session metadata, while Control Agent requires a non-Chat assistant session. The one
persisted `TaskCreatorMetadata` projection is consumed by Mission title/terminal notification logic and by the first
Orchestrator child prompt; missing, malformed, or contradictory persisted creator metadata fails immediately. `source`
remains a business label and is never an identity input.

The complete production and test call scan reports no one-argument `EngineService.createTask` or
`createSchedulerChildTask` calls. Focused verification passes: creator persistence/rejection/session mismatch 6/6;
Panel actor projection including right-sidebar Chat 11/11; Mission title 2/2; scheduler child ownership 3/3; creator
error status mapping within the complete onError suite 27/27; project REST user identity and forgery rejection 2/2;
global REST user identity, forgery rejection, and implicit-project discard 2/2; and the real first Orchestrator prompt
author assertion 1/1. OpenCorvus TypeScript typecheck passes.

The first combined test run exposed fixture debt rather than creator behavior: strict queue tests had registered a runner
without the required production termination runtime; Panel tests resolved a model before their mocked Engine call but
provided no model; one legacy caller assertion still named `orchestrator/tools.ts`; and a Panel replan test waited for an
independent background launch while retaining the caller's project lease. A shared explicit test runtime now reuses the
production dead-owner convergence/finalization functions while injecting the test runner. Panel replan exits the caller
lease before waiting for the exact typed intent. Retry/replan route and Panel tests now assert `operatorIntent`, absent
free-text note, and zero root-message growth. The focused replan/retry matrix passes 4/4, and the remaining
`User requested retry|replan` residue is zero.

One combined six-file run also produced a transient global-route 500 and Windows temp-repository Git cleanup failures
after another test timed out. The global creation case and the global forgery/discard case both pass when isolated, so
the combined failure is recorded as test-process resource interference, not accepted as a product defect and not hidden
by a fallback. Full-suite/resource cleanup remains part of the later platform audit. Frontend Replica remains deferred.

### D6 fresh exact-tree review rejection and correction

The fresh read-only reviewer returned REJECT despite the focused creator passes. It found five concrete gaps: the
cancelled-continuation route fixture omitted mandatory creator metadata; first-child author projection lacked user and
Mission cases; the missing-Mission-identity test only covered a wrong session kind; right-sidebar Chat lacked Engine-level
acceptance and negative Control-Agent classification; and one comment incorrectly said task creation persisted the first
child input.

All five findings are corrected. The stale fixture carries explicit user creator metadata. Real Orchestrator process
tests now project user, Mission, and Control Agent authors. A Mission-kind session without `metadata.mission.id` fails
independently. The Engine accepts canonical right-sidebar Chat and rejects that session as Control Agent. The comment now
states that each newly constructed Orchestrator child receives the original brief once, including replacement children.

Post-correction verification passes: creator boundary 9/9; user/Mission first-child authors 2/2; Control Agent author and
reuse 1/1; cancelled replacement child 1/1. The prior full message-route run was 23/26: two cross-project cases hit the
recorded Windows/temp-Git five-second cleanup issue, while the deterministic cancelled-continuation failure now passes in
isolation. The prior REJECT cannot be promoted without a new exact-tree review against these contents.

### D6 final exact-tree ACCEPT

The independent reviewer accepted D6 against HEAD `782d78b9bfa973a1ecbdc952850e9aacfdb4ef81` and the exact working blobs for the creator contract, root-message provenance, Engine creation boundary, Orchestrator first-child projection, explicit test runtime, route fixtures, and revive tests. The review confirmed that all five findings from the prior rejection are closed: cancelled replacement children carry creator metadata; user, Mission, and Control Agent first-child authors are covered; Mission-kind sessions without identity fail; right-sidebar Chat cannot impersonate Control Agent; and the child-input persistence comment matches the implementation.

The final bound verification is: creator boundary 9/9; user and Mission author projection 2/2 plus Control Agent reuse; cancelled replacement child 1/1; task-message revive 17/17; queue/runtime dispatcher and lease coverage 22/22; Panel, Mission, scheduler child, and message schema 17/17; strict `read_task_message` 2/2; OpenCorvus typecheck; relevant diff check; and an explicit scan proving every production task-creation call supplies a creator. A combined public task-create run had one Windows Git process-supervisor readiness failure, while that exact case passed 1/1 in isolation. Per the user's explicit scope, this intermittent Windows resource-management failure is recorded but is not a deterministic D6 product blocker. No deterministic D6 blockers remain. Frontend Replica remains deferred to the final phase.

The residue scan also separated two meanings previously conflated as "operator notes". Root task communication now has one durable conversation-message source and the deleted `recordOperatorNote` alias is absent. A distinct Workbench note read projection (`operatorNotesSection`) still scans `operator_note`, `constraint`, and `goal_update`, but exhaustive production-write search found only task-creation `user_request` writes. That Workbench projection is therefore a legacy-removal candidate, not evidence of a second live message source; deletion requires the repository's explicit dead-code confirmation step and is carried into the platform legacy audit.

### Post-merge D6 review rejection and correction

The independent review of the git-cc merge accepted the lockfile, SDK, API projection, documentation, and spec indexes but rejected one deterministic prompt residue. The remote internal-wake provenance addition had named a missing task-level `operatorMessage`, even though D6's only task-message wake identity is `rootMessage { messageID, kind }`. Its tests positively preserved that retired alias and were therefore false-green. The same name remains valid only inside the separate targeted child-coordination protocol.

The task-level notice and all four affected assertions now name `rootMessage` plus `operatorIntent`, and negative assertions reject `operatorMessage` in the notice. The targeted child-coordination implementation and tests remain unchanged. Focused internal-wake, identity-only event, and session-reuse verification passes 7/7, and the production Orchestrator residue scan finds no `current operatorMessage`, `OrchestratorEventNote`, or free-text `User requested retry|replan` protocol.

### Workbench task-note table removal Recall

The user requires platform legacy and double-source removal before the SDK and deferred Frontend Replica phase. D6 established the root conversation message plus typed wake identity as the only task-message source. The full repository scan found that `WorkbenchTaskNoteTable` now has exactly one production writer: task creation writes `kind=user_request` with the same text already stored authoritatively in `EngineTaskTable.request`. `recordNote` has no other production caller and `taskNotes` has no caller. Every other declared kind (`operator_note`, `goal_update`, `constraint`, `decision`, `summary`) is reachable only through test fixtures or type declarations.

The read paths provide no counterexample. `workbench/brief.ts` repeats `task.request` as a recent note and exposes `TaskBrief.notes`, but no Overlay, plugin, SDK test, or production caller consumes that field. `workbench/board.ts` computes `staging` and `history` arrays and never returns them. Its note statistics only perturb the board ETag for the duplicate row. `operatorNotesSection` and `buildOperatorPrompt` have no live writer/input, yet their output is still projected into describe, requirements, research hashes, scheduler evidence, and global prompts. Keeping these paths would retain an unreachable second message model and allow future accidental reactivation.

The independent read-only audit agreed that the whole table can be removed atomically and found no live capability that depends on it. The accepted deletion boundary is: delete `workbench/note-store.ts` and `WorkbenchTaskNoteTable`; remove the creation write and storage export; remove note queries, brief signature/response fields, board ETag input, `operatorNotesSection`, `buildOperatorPrompt`, describe/requirements/research/orchestrator projections and stale prompt wording; remove the obsolete direct-writer and fixture tests; remove the current architecture table entry; and regenerate OpenAPI, SDK, and API documentation. `WorkbenchBriefSnapshotTable` and the independent brief/task/goal/memory behavior remain in scope and are not retired by this slice. Database reset, not migration or compatibility, is the required schema transition.

The independent audit also proved that `TaskMessageResult.kind = "note"` and
`Event.TaskMessageRecorded.kind` are remnants of the same retired model rather than root-message identity. Production
only ever emits the constant `note`, no Overlay consumer reads it, and the authoritative identity is the referenced
`task_root_message.kind` (`operator|orchestrator`). Keeping the constant would preserve an API category with no source
or behavior. Both fields therefore belong to this atomic deletion slice; `messageID` remains the event/result identity.

Acceptance is: zero production/schema/test references to `WorkbenchTaskNoteTable`, `workbench_task_note`, `operatorNotesSection`, `operator_notes`, `operatorNotes`, `recordNote`, `taskNotes`, `buildOperatorPrompt`, or the task-message `kind=note` field; task creation and later operator messages persist only their existing authoritative task/root-conversation facts; research hashes use request plus answered clarification transcript only; TaskBrief/OpenAPI/SDK no longer publish `notes`; focused Workbench, root-message, research, requirements, schema-boundary, document-health, API generation, typecheck, and independent exact-tree review pass.

Focused validation exposed one pre-existing database boundary inventory omission after the CMS interactive-artifact work
landed: `InteractiveArtifactTable` has exactly one production writer,
`packages/opencorvus/src/interactive-artifact/persist.ts`, but the exhaustive writer test did not list it. The repository
scan found no sibling direct writer. This deterministic test failure is included in the current cleanup by registering
that existing single writer; it does not change interactive-artifact behavior or ownership.

The next boundary assertion exposed a second inventory-only drift from the merged session refactor: `TodoTable` writes
moved from `session/todo.ts` to `session/todo-store.ts`, and the full source scan confirms the store is now the sole
writer. The writer inventory is updated to that exact path; no Todo behavior changes in this slice.

The task-message attachment tests then failed before reaching attachment decoding because all three fixtures supplied
fresh identifiers for sessions that did not exist. Since `resolvePanelActor` now correctly resolves identity from the
persisted caller session, these fixtures must create a real right-sidebar Chat session and pass its ID. The tests retain
the production identity check and only mock the downstream task-message service whose attachment input they inspect.
That real identity also authoritatively projects the existing `right-sidebar-chat` source instead of trusting the
caller-supplied `panel` label, so the source assertion is updated to the production contract.

The parallel platform projection audit also found the next post-note blocker: inactive external squad skill-mount
validation currently calls `ExpertSquadRegistry.loadPackage`, which parses package tools, libraries, assets, and MCP
providers even though the architecture promises inactive-package isolation. After this note slice is committed, the
resolver must validate inactive mount references from catalog/manifest data only, reserve full package loading for the
active projection, and add an inactive package-tool failure regression. It also found one stale global prompt sentence
that still names Operator Notes; that residue is included in the current text cleanup.

### Workbench note deletion independent review REJECT

The first exact-tree review rejected the slice on two deterministic grounds. `TaskBrief` declared and generated a
public `{ content, goals[{description, criteria}] }` contract, while `compileBrief` returned internal goal database rows
plus an undeclared `updatedAt`; both public brief routes returned that internal object directly. The full call scan found
only three `compileBrief` consumers: Workbench board keeps the internal `content` and `updatedAt`; task and run brief
routes both share `EngineService.getBrief`; no Overlay consumer reads the public brief result. The correction keeps the
internal snapshot for board use but makes `getBrief` the single public projection: `description` is the durable goal
objective, `criteria` is the canonical rendered acceptance-spec text, and `TaskBrief.parse` proves the response matches
the OpenAPI/SDK contract. A real task brief route test must seed an Engine goal, fetch the route, parse the response with
`TaskBrief`, and reject raw goal fields and `updatedAt`. Existing task-message test annotations that still declare an
unused `kind: string` are also deleted as protocol residue.

The first route-test run returned an empty goal list because its fixture created a task-level goal without an active
plan, while `compileBrief` intentionally projects goals from the active plan. The fixture must create a real active
`EnginePlanVersionTable` row and bind the goal to it; production selection semantics remain unchanged.

The review also corrected a misleading ingress comment: neither `describeTask` nor the Orchestrator system prompt reads
root-session message content as a hidden projection. The durable message is persisted once; the wake carries its
`rootMessage.messageID`, and the Orchestrator reads the exact content through `read_task_message`. The comment must state
that boundary and must not imply a second prompt/describe reader.

### Workbench note deletion final ACCEPT

The corrected exact tree received independent ACCEPT against HEAD `5a3a074dfb43d4ec8775dd9e2287db90dbe36d0a`
and unstaged diff fingerprint `748ee14be966af7d5df2433320ffc16cb2dcda64`. The reviewer confirmed the public
TaskBrief projection is centralized in `EngineService.getBrief`, both task and run routes share it, and the real task
route regression rejects raw goal rows and `updatedAt`. It also confirmed zero task-message fake-kind residue, zero
Workbench note table/read/write/projection residue, accurate `read_task_message` ownership wording, and no fallback or
compatibility path. The independently rerun brief route case passed 1/1.

Main-thread verification is: OpenCorvus and repository TypeScript checks pass; task-message schema plus the full route
suite pass 29/29; Panel attachment forwarding passes 3/3; Workbench board passes 19/19; research persistence/projection
passes 13/13; Requirements passes 6/6; database single-writer boundary passes 22/22; helper cap passes 3/3; API route
inventory and docs generation checks pass; historical/document/product/API checks pass 98/98 after the one
Windows-specific `git init ETIMEDOUT` case is rerun alone, where it passes 1/1. Per the user's scope, that intermittent
Windows process-supervisor behavior is recorded but is not a deterministic product blocker.

### Inactive expert-squad mount isolation Recall

The platform audit proved `PromptProfileResolver.assertSkillMountConfig` is the only configuration-validation path that
full-loads every external package named under `skill_mounts`. Its loop discovers the strict catalog, then calls
`ExpertSquadRegistry.loadPackage`; that full loader validates agent files, collects skills/tools/MCP resources, prepares
tool bundles, and reads reachable lib/assets. Active scheduler/worker resolution separately calls `packageForActiveProfile`
and must retain full loading. Catalog and overlay paths already use `loadCatalogPackage`, which parses strict package
metadata, manifest topology and selector instructions without loading inactive prompts, skills, tools, MCP, lib or
assets.

The correction is therefore narrow: make mount validation accept the manifest-bearing package shape it actually uses,
replace its external full load with `loadCatalogPackage`, keep ID collision/mismatch, dynamic agent, base-role
skill-mountability and default-skill-ref validation unchanged, and leave active resolution untouched. The regression
must install an external package with a syntactically broken projected package tool, prove `assertSkillMountConfig`
succeeds while General is active, then select that package and prove real worker resolution fails immediately during
full package loading. No fallback, deferred active error suppression, or parallel package index is permitted.

The first independent review rejected the implementation because the local `active` variable still declared the full
`ActiveProfilePackage` type while its external branch now returned a catalog package; OpenCorvus typecheck correctly
reported TS2322. It also rejected the regression's unconstrained `.toThrow()` as false-green prone. The correction must
type that variable as the minimal `SkillMountProfilePackage`, first prove the intact package resolves when active, then
corrupt its projected tool and require the specific `Package tool ... failed to compile` error. The test name is narrowed
to package-tool compilation; the catalog-loader boundary itself is what guarantees all inactive prompt/skill/MCP/lib/
asset content remains unread.

The corrected inactive-mount slice received independent ACCEPT against HEAD `b91450ebf9` plus the current resolver and
test diff. OpenCorvus typecheck passes and the focused matrix passes 3/3. The reviewer confirmed the catalog loader is a
single enforceable boundary, so one active/inactive package-tool sentinel is sufficient without duplicating the same
test across prompt, skill, MCP, lib and asset parsers.

### Virtual workflow guidance decoupling Recall

The platform audit found the remaining manifest topology defect in the sole `validateProjectionTopology` implementation.
After correctly validating scheduler base role, every dynamic agent ID/base role, workflow node agent references,
dependency references and DAG cycles, it builds `referencedAgentIDs` and imposes two unrelated gates: every projected
agent must appear in some virtual workflow node, and every `goal_concurrency=disjoint_goals` agent must appear in a
goal-scoped node. The repository-wide residue scan found no sibling implementation or test that depends on either error.
All registry loading modes reach this one validator through `validatePromptProfileManifest`.

These gates contradict the manifest contract: `capability_projection.agents` is the runtime roster and owns independent
concurrency capability; `virtual_workflows` is immutable scheduler guidance and may illustrate only common paths. A
conditional/utility agent must be projectable without inventing a misleading workflow step, and an agent may permit
disjoint-goal concurrency even when a particular guidance graph shows task-scoped dispatch. The correction removes only
the referenced-agent accumulator and the two exhaustiveness/coupling checks. It retains nonempty workflow/node schemas,
known-agent references, known dependency nodes and DAG validation. Positive full-package regressions must prove an
unreferenced utility agent loads and a disjoint-goal agent with a task-scoped guidance node loads; existing negative
unknown-agent and cycle tests remain unchanged.

The first positive regression correctly failed before reaching the decoupling assertion because its proposed utility
agent used `base_role: research`, which is not a registered runtime template. The fixture is corrected to the real
read-oriented `explore` template; fail-fast base-role validation remains unchanged.

The first independent workflow review rejected the otherwise-correct Registry slice because the Multica adapter has a
second `validateMapping` implementation with the same two gates. Its complete `agent_goal_concurrency` roster check,
known source-agent/node/dependency validation and DAG cycle validation are valid; its `referencedAgentIDs` exhaustiveness
and `disjoint_goals`/goal-node coupling must be removed. `preview` and `importSquad` both use this mapping validator before
generating the same manifest v1, so leaving it would create an importer/direct-install double contract.

The repository fixture also derived workflow `dispatch_scope` directly from `goal_concurrency`; it must instead declare
its primary build guidance as `goal` and auxiliary guidance as `task` independently of concurrency. The Multica selector
skill already says both facts come from the visible squad contract; it is clarified to say neither may be derived from
the other, then its generated built-in payload must be regenerated with the canonical script. One end-to-end Multica
regression can cover both removed gates simultaneously: retain a complete two-agent concurrency roster, leave the leader
unreferenced by the guidance graph, keep the disjoint worker as a task-scoped node, then require blocker-free preview,
successful import, both projected agents in the loaded manifest, and the exact single task-scoped guidance node.

The corrected projection slice received independent exact-tree ACCEPT against HEAD `2c1fafadff` plus the current
inactive-isolation/workflow diff. The reviewer confirmed both Registry and Multica preserve strict nonempty schemas,
complete Multica concurrency roster, known agent/dependency references, self-dependency rejection, DAG validation,
dynamic IDs and base roles while removing only the two invalid couplings. The Multica regression crosses real preview,
import, package write and Registry load rather than testing strings or schemas. The generated built-in payload was also
byte-compared with `renderBuiltinSkillPayloadModule` and is exact.

Verification passes: OpenCorvus typecheck; Registry plus skill-mount projection 60/60; Multica import plus canonical
built-in Skill checks 27/27; residue scan finds none of the retired exhaustiveness/coupling errors or derivations; and
`git diff --check`. The review agent's one combined bare Bun invocation used the runner's default five-second per-test
timeout and caused five late cascading timeouts; the same files pass in the project-correct separated invocations with
explicit inactivity-compatible limits, so that audit-command error is recorded and not treated as a product failure.

### Post-push SDK and portable-authoring Recall

The exact pushed tree `7a8c2ab8108df918f24c948617e9f87cd6b7eae3` received a fresh independent platform audit. It
confirmed that manifest v1, `prompt_profile.active`, dynamic `capability_projection.agents.<agentID>` identity,
base-role template seeding, inactive-package isolation and guidance-only virtual workflows are correctly implemented.
It rejected the developer-facing authoring surface for one deterministic semantic double source and one documentation
gap.

The canonical portable template generator still says every projected agent must appear in a virtual workflow. Its only
generated consumers are `specs/artifacts/portable-expert-squad-template/README.md` and
`authoring-skill/SKILL.md`; the freshness test compares every generated byte but did not reject the obsolete sentence.
The correction belongs only in `generate-portable-expert-squad-template.ts`, followed by official artifact generation.
The template must explain that a workflow may cover common guidance paths without exhausting the runtime roster, while
every workflow node must still reference a declared dynamic agent. The generated manifest itself remains a valid full
roster example; adding a fake conditional agent solely to demonstrate omission would bloat the domain sample rather than
improve the protocol. A negative text assertion binds the removed requirement.

The same audit confirmed the existing SDK writer, generated manifest type, read-only Registry validation, explicit
Manager import and active selection API, but found that the short developer documentation does not explain package
Skill/tool/MCP reference grammar. The complete owning implementation is `ExpertSquadRegistry.collectPackageResources`
plus `validateProjection`: shared resources use `<squad-id>/shared/<name>`; agent-local resources use
`<squad-id>/<agent-id>/<name>` and can be projected only by that owner; typed MCP refs append
`/tool|prompt|resource/<capability-name>`; mounting `package_mcp_server_refs` mounts all declared capabilities and must
not be duplicated by typed refs. Default host refs use the separate `default/...` namespace. The correction documents
those existing rules in the English/Chinese Agents guide and portable tutorial without copying validation code or
inventing path helpers. The existing runnable portable package remains the package-tool example; Registry tests remain
the executable authority for Skill/MCP loading.

Acceptance is: zero generated authoring claims that every agent must be represented in a virtual workflow; generated
artifact freshness; concise bilingual canonical ref tables; focused portable, Registry, SDK-authoring and docs tests;
typecheck; exact-tree independent review; commit and push to `myhexin/v0.0.10beta`. The unrelated CMS plan remains
outside this slice. The independent audit separately confirmed that Frontend Replica/reference-parity policy still has
an oversized host ABI and remains the final platformization phase after this authoring correction.

The correction was generated from the single portable-template writer and received independent ACCEPT against HEAD
`7a8c2ab8108df918f24c948617e9f87cd6b7eae3` plus the bounded diff. The reviewer confirmed the generated tutorial and
authoring Skill now allow partial guidance graphs while retaining declared-agent references, the resource-ref grammar
matches Registry shared/local ownership and MCP expansion rules, and no builder DSL, schema, path helper or second
validator was introduced. Its independent portable run passed 9/9 with 212 assertions.

Main verification passes 108/108 across portable generation/integration, SDK authoring, document health, product-doc
single source and historical links. Root TypeScript checks pass all nine scoped tasks; API route inventory, API docs
freshness and `git diff --check` pass. The exact old workflow-exhaustiveness sentences have no positive residue.

### Uniform selector contract Recall

- The continuing platformization Goal requires one manifest v1 protocol for every Expert Squad, with no package-ID
  special case, fallback, alias or UI-only exception. The exact resumed tree is `eccf86c2993e5129e1a2b2c5f894c7d4546f5641`,
  already pushed to `myhexin/v0.0.10beta`; the worktree was clean before this slice.
- Re-read this complete Recall and `specs/current/architecture/04-extensions.md`, then searched Registry, catalog,
  resolver, manager, generated SDK and focused tests for `ManifestSchema`, selector optionality, `selector.md`, `general`
  identity checks and every selector consumer. The sole manifest identity branch is
  `registry.ts` allowing missing selector only for `namespace=builtin,id=general`. The same impossible absence remains
  expressible in `PackageCatalogEntry`, loaded/catalog/embedded package types, catalog profile input and catalog summary.
- General is the sole runtime built-in package and currently has neither selector metadata nor `selector.md`; embedded
  source assembly imports every other General file explicitly. Every external package fixture already supplies the
  canonical selector shape, and Registry tests already reject missing selectors for non-General and project-General.
- Independent platform review classified the General exception as a concrete package-ID policy leak. The correction is
  one direct replacement: General gains ordinary selector metadata/instructions; `ManifestSchema` requires `selector`;
  selector metadata/instructions become required through loaded, embedded and catalog projections; catalog output keeps
  display/activation policy separate from identity. No selector is synthesized and no special display filter is added.
- Acceptance: a generic missing-selector package fails the single manifest schema; embedded General and its filesystem
  copy load through the same Registry path with the exact selector; catalog output contains the canonical selector;
  no `builtin/general` selector exception or optional selector projection remains; focused Registry/catalog/resolver
  tests, OpenCorvus/SDK typechecks, generated API checks, document health, independent exact-tree review, commit and
  push all pass.

Independent exact-tree review rejected the first implementation before commit. It confirmed the required selector
declaration, but found that projecting General's selector while General is already active confuses catalog declaration
with the selection-only runtime surface. The corrected identity-neutral rule projects selectors only for packages whose
ID differs from `prompt_profile.active`: active General sees installed specialists; an active specialist sees General
and other inactive specialists; no package sees a selector that merely re-selects itself. The review also found two
remaining optional residues in the discovery-only `PackageCatalogEntry.selectorInstructions` property and payload
market `selector_summary`. Discovery now omits the unloaded instructions property entirely, while loaded catalog
packages retain required instructions; the market response makes its manifest-derived summary required through route,
OpenAPI and generated SDK. Tests must bind both directions, embedded/filesystem/catalog selector equality, missing and
blank embedded selector bodies, and the required market field before a second independent review.

The corrected exact tree was then preserved while switching to the user-requested `v0.0.11beta` tracking branch. Remote
release-family commits and the three newer local committed changes were combined with an ordinary merge and pushed at
`687ef53060`; no worktree reset, stash or history rewrite was used. A second independent review bound to that HEAD plus
the complete selector diff returned ACCEPT. It confirmed the universal declaration schema, inactive-only runtime
selector projection, discovery/loaded type separation, required market/OpenAPI/SDK fields, embedded/filesystem/catalog
equality, negative embedded selector cases, current architecture wording and absence of optional-selector residue.

Main verification passes: Registry plus General 62/62; resolver plus infrastructure contract 49/49; isolated expert
squad routes 1/1 with 48 assertions; Mirror Watch plus package manager 71/71 with one intentionally skipped existing
case; SDK authoring 12/12; document health and historical links 82/82 with 1,354 assertions; root typecheck 9/9; API
route inventory; generated API docs; SDK generation/typecheck; and `git diff --check`. One earlier combined run exposed
the stale self-selector assertions and one missing default-Skill test input; both were corrected at their contract
source and every separated rerun passed.

### Attachment semantic authority Recall

- User requirement: continue the platformization Goal without specialist host rules, fallbacks or hidden semantic
  inference. The exact clean starting tree is pushed `v0.0.11beta` commit `9e63b5fe5b`; Frontend Replica remains last and
  the three product E2E tasks remain cancelled.
- Re-read this complete Recall, `specs/current/architecture/02-data.md`, `10-worktree-lifecycle.md`,
  `15-agent-facts-and-turns.md`, and the July attachment/request separation records. Full-repository searches covered
  Task attachment input/output schemas, task creation/follow-up ingestion, AttachmentStore, engine persistence,
  IntentBundle, dispatch-adapter schemas, frontend-design resource materialization/manifest/agent prompts, Figma MCP,
  Build evidence, Visual QA, routes, generated SDK/OpenAPI and every test asserting attachment intent.
- Root cause: Task ingress currently promotes a byte container into domain authority by mapping image MIME to
  `visual_reference` and every other MIME to `spec_artifact`. Frontend Design then scans the complete task attachment and
  system-artifact union, rewrites intent by mode, and lets `createDesignResourceManifest` infer another intent from kind,
  source or absence. Build finally falls back from a missing manifest to raw task attachments. These are three semantic
  sources for one visual authority, and Figma screenshots additionally contaminate the user-input column.
- Direct replacement contract: every uploaded task file persists the one neutral `task_input` intent; upload clients do
  not choose a domain role. `frontend_design.attachment_bindings` explicitly maps a current task attachment URL to one
  design intent, and local materials carry the same explicit intent beside their path. Bindings must be unique, belong
  to the current task/current project and resolve to matching AttachmentStore metadata. Figma provider outputs use fixed
  explicit output intents and all generated bytes live in `system_artifacts`. Manifest inputs require intent and never
  default or override it. No second structured attachment role field or role map is added.
- Build consumes Design Resource Manifest as the sole source of visual target-reference semantics. It may still consume
  neutral task inputs through the ordinary request/requirements/context path. A reference-parity Build without a valid
  manifest or without an explicit visual-reference entry fails visibly; it never scans raw attachments. Visual QA keeps
  consuming frontend handoff/manifest evidence and does not gain a raw attachment path.
- Exact owning callpoints: `engine/model.ts`, `engine/engine.sql.ts`, `storage/attachment-store.ts`, `task-api/index.ts`,
  `intent/bundle.ts`, `agent/dispatch-adapter-input.ts`, `orchestrator/frontend-design-tool.ts`,
  `frontend-design/design-resource-manifest.ts`, `frontend-design/agent.ts`, and `orchestrator/build-feedback.ts`.
  Routes/Overlay/panel/channel keep the byte-upload ABI and gain no intent selector; generated SDK/OpenAPI update only
  where the dispatch schema changes. Focused tests cover task create/follow-up MIME neutrality, binding ownership and
  duplicates, explicit manifest intent, Figma system-artifact separation, removal of Build fallback and parity
  fail-fast.
- Independent read-only review ACCEPTED this direction and REJECTED the current tree until all of the above sources are
  replaced together. It warned against optional `task_input`, unchecked same-project blobs, retaining material/manifest
  inference, silently returning no Build evidence, or reusing Build evidence roles as upload roles.
- Acceptance: no MIME-to-domain-intent inference; no optional/free-form user attachment intent; no implicit
  frontend-design attachment scan; no manifest intent inference; no Figma-generated task attachment; no Build raw
  attachment fallback; strict positive/negative tests, generated artifacts, typecheck, docs health, independent exact
  diff review, commit and push to `myhexin/v0.0.11beta`.
- Codex independent-review correction: the preceding statement that the host gives Figma provider outputs fixed intents
  is rejected. Figma acquisition is specialist policy and must live entirely in the installed expert-squad package as a
  scheduler-owned package tool. Core `dispatch_agent`, Frontend Design, task signals, manifests, SDK and OpenAPI accept
  only vendor-neutral attachment bindings and local materials with explicit intents. Core must not recognize Figma
  fields, URL shapes, MCP (Model Context Protocol) tool names, origins or manifest kinds.
- The same review found that continuation validation loaded the persisted Design Resource Manifest and then discarded it
  before invoking the Agent. Acceptance therefore includes a real first-call failure/resume test proving the resumed
  Agent receives the persisted manifest, plus direct initial-create image/text neutrality and a database-polluted
  cross-project attachment-binding rejection test. Static prompt or schema checks do not substitute for these paths.
- Full-repository residue search for this correction covers `figma_url`, `figma_intent`,
  `request_contains_figma_url`, `figma-mcp`, `figma_mcp`, `materializeFigma`, `parseFigma` and `resolveFigma` across core,
  generated SDK/OpenAPI and architecture docs. Occurrences inside the Frontend Innovate package and its generated
  payload copy are intentional package implementation, not core authority.
- Codex exact-tree review correction: goal-scoped Build still projected
  `ArchitectFidelity.referenceCoverage[].source_reference_artifact` crops as a second visual-target authority. That path
  is rejected and removed; goal and task Build now derive reference-parity targets from the same persisted Design
  Resource Manifest. The same review found that a manifest image with `intent=design_source` was incorrectly treated as
  parity authority merely because its kind was visual. Reference-parity authority is therefore determined by explicit
  `visual_reference` intent or an explicitly projected visual context ref, while file kind only distinguishes text-only
  material handling.
- Codex package-runtime review correction: the package materializer previously accepted HTTP-success bytes and a
  present-but-null provider node, and its direct unit test bypassed the projected scheduler package-tool host. Acceptance
  now requires structural node validation, complete PNG (Portable Network Graphics) structure/CRC (Cyclic Redundancy
  Check)/decoded-scanline validation before any artifact write, negative tests for empty/HTML/truncated/provider-failure
  inputs, and execution through the real scheduler projection with task ownership and managed runtime injection. Tests
  retain the repository's activity-aware timeout wrapper; permanent per-test no-timeout markers are rejected.
- Final self-review found a redundant `source ?? "design_resource_manifest"` default in Build target projection even
  though canonical manifest refs always contain a projected source. The fallback is removed by strengthening
  `designResourceManifestFileRefs` to return a required source and passing it through unchanged; origin traceability and
  explicit `visual_reference` authority therefore remain separate, required facts.
- Second exact platform review found that removing Architect crop loading from `composeBuildEvidencePack` was
  insufficient: `scopedFidelityForBuildGoal` still projected `referenceCoverage.reference_regions` into Build and the
  Build prompt rendered each `source_reference_artifact` crop as authoritative. That second prompt authority is removed
  from the Build context type, scoped context composition and prompt renderer. Architect reference coverage remains
  planning/workload/verification traceability; Build receives pixel targets only through the Visual Reference Contract
  materialized from the persisted Design Resource Manifest. The Frontend Replica implementer overlay and residue tests
  are updated to the same contract so no package continues instructing workers to consume the deleted crop path.
  - The next exact review found two additional prompt-reachable paths carrying the same retired authority. Goal-scoped
  Frontend Design handoff text still named persisted `reference_coverage` crop rows as parity targets, and the Build
  workload-brief renderer instructed the worker to deep-read Architect `reference_coverage_ids`. Both are removed from
    the Build-facing contract: goal handoff names only manifest-derived evidence-pack targets and suppresses visual-region
    crop manifests, while build-tool projects a workload brief type that omits reference-coverage IDs. The original
    Architect and Workload Analyst artifacts retain those IDs solely for planning and verification consumers.
  - Final platform review rejected two remaining compatibility paths. Design-resource input provenance still allowed a
    missing `source`, defaulted it to attachment ownership, and accepted the retired `user` alias beside `user-upload`;
    the source contract is now required and closed to `user-upload`, `material`, or `browser-preview`. Direct task Build
    also used the unrestricted Frontend Design handoff while goal Build used a restricted projection. Both now use one
    Build-consumer projection: public reports provide non-pixel implementation context, while source manifests and visual
    region crop paths stay outside Build and pixel targets come only from the manifest-derived evidence pack.
  - Exact Build-context review found that text suppression alone was incomplete: the shared visual-handoff structured
    part still carried full visual-region binding manifests into goal and direct task Build. Context-packet construction
    now requires an explicit consumer projection; Build retains only design authority and project mode, while planning
    consumers retain region bindings. Real direct Build coverage seeds crop, overlay and contact-sheet paths and proves
    none survive in the captured Build context.
  - Follow-up isolation review found the false projection still parsed planning-only region manifests before dropping
    them, so malformed historical planning evidence could block Build. Parsing now occurs only for consumers that request
    region bindings. Both real goal and direct task Build tests persist malformed binding rows and prove Build proceeds
    with unchanged manifest target evidence and no structured region data.
  - Final continuation review found that `frontend_design` froze task/evidence but not its required design mode. Because a
    resumed runner does not replay the complete initial prompt, changing mode would split the original session contract
    from the new terminal-tool schema. Mode is now part of both pre- and post-materialization normalized stage input;
    opposite-mode continuation is rejected as stale without starting an agent, while same-mode continuation restores the
    persisted manifest and session.
  - Merge-after-review verification exposed a deterministic README identity-guard failure: compact package labels such as
    `MirrorWatch` did not match spaced projected labels such as `Mirror Watch Research Lead`, so short dynamic identities
    escaped residue detection. The repository test now tokenizes CamelCase, whitespace, hyphens and underscores through
    one normalization path before removing a package-label prefix; no package-specific alias or exception is introduced.

### Post-merge Overlay legacy message mirror Recall

- User requirement: after platform projection convergence, continue the repository-wide technical-debt and legacy-file
  cleanup before the deferred Frontend Replica phase. The clean pushed baseline is `57037b829b`; concurrent GUI work
  advanced the local baseline to `223a90758a` without touching this slice.
- Re-read the complete platform cleanup Recall and searched every production/test import or property access for
  `messageStore.messages`, `messagesBySession`, `enqueueEvent`, `ingestPersistedMessage`, `clearEventQueue`,
  `setMessages`, `clearMessages`, `syncTask`, store-local `loadConversation`, `mergeLoadedConversationMessages`, and
  `mergeMessages`. The authoritative visible-message path is `services/conversation.ts::loadConversation` through
  `hydrateConversation`, `replayTaskEventToTree`, and `cardTreeStore`; no production renderer reads the old arrays.
- Production call-point disposition: delete the old message types, normalization/sorting/merge code, transcript loaders,
  mirror fields and setters from `store/messages.ts`; delete no-op/throw-only event queue APIs; remove the no-op
  `clearMessages` calls/imports from `main.tsx`, coding-assistant, task and workspace services; remove `clearEventQueue`
  from SSE shutdown; remove unused `chat.ts::mergeMessages`; simplify `task.ts::hasConversationPanelState` to its real
  request, attachment and card-tree sources; correct the stale tree-writer comment. The second audit showed that
  `messageStore.selectedTaskID` and its uncalled message-event helpers duplicated `boardStore.selectedSource`; move the
  only useful conversation-fold persistence effect to the real task/workspace selection boundary and delete that
  duplicate identity. Retain only SSE connection, chat request and chat attachment state in the store.
- Test disposition: delete `delta-doubling.test.ts`, `message-load-fail-loud.test.ts`, `message-store.test.ts`, and
  `messages-bucket-clear.test.ts`, because they only instantiate or positively preserve the retired mirror. Remove old
  array setup/assertions from task/panel tests and use existing card-tree fixtures when a conversation-presence fact is
  required. Retain and strengthen `overlay-refresh-single-source.test.ts` as the negative regression proving production
  hot paths contain none of the retired entry points.
- Two independent read-only audits confirmed the complete mirror has no production message consumer and that keeping
  throw-only APIs plus tests is positive legacy maintenance. Acceptance: zero production/test reference to retired APIs
  or mirror fields; real card-tree hydration and task-switch tests remain green; Overlay typecheck and focused tests;
  exact-diff independent review; commit and push to `myhexin/v0.0.11beta`. Frontend Replica remains untouched.

#### Review amendment

- `packages/overlay/test/load-conversation-race.test.ts` models the deleted `_convQueued` loop without importing
  production code; it is stale simulation coverage and is removed.
- `packages/overlay/test/message-bench.ts`, `packages/overlay/test/sse-doctor.ts`, and
  `packages/overlay/test/sse-doctor-report.md` are unreferenced manual diagnostics for the deleted message mirror. They
  are intermediate artifacts, not current tests or documentation, and are removed with the implementation.
- The full Overlay unit run exposed an existing boundary-contract failure: `setBoardData` accepted a task without the
  backend-issued task-domain `orderKey`, although the persisted task request projection and its test require that field.
  The board boundary already validates interaction order keys through the shared parser, so task validation is restored
  through that same data-integrity function rather than a UI fallback or local ordering rule.
- The next full-suite failure was a stale source-string assertion left behind by `d16968cde3`: the command palette now
  delegates New Chat to the shared `openGlobalChatLauncher`, but its test still required an inline `closeProject` body.
  Update the assertion to the actual shared command contract; no production behavior changes.
- The following full-suite failure found `.workspace-main` rooted in both workspace and conversation styles after the
  latest branch merge. Keep workspace shell ownership in `workspace.css`; scope the conversation rail width token to
  the two conversation children that consume/inherit it, preserving layout while restoring one root-class owner.
- Exact-diff review rejected two lifecycle gaps after the mirror removal. Empty workspace/project close must cancel the
  active conversation replay/request and reset the authoritative writer/card tree, not merely clear the board. Every
  non-task source boundary (Mission, Coding Assistant, empty workspace) must also clear task-owned conversation UI state
  so debounced disclosure changes cannot be persisted under the previous task. Add real store lifecycle assertions for
  project close and Coding Assistant success/failure, plus a Mission boundary contract assertion, then re-review.
- Re-review found the same cleanup still missing from manual same-directory and cross-directory project selection.
  Converge empty-workspace and selected-work-item clearing on one private conversation-runtime cleanup function that
  aborts chat, cancels replay, clears task UI ownership and resets the writer. Extend both manual switch tests with real
  card-tree and AbortController assertions.
- The new lifecycle assertion exposed that `resetWriter()` cleared card nodes and rewind state but did not explicitly
  clear the card-tree screenshot projection. A full transcript replacement cannot retain prior-task screenshot rows;
  reset that derived collection at the same authoritative boundary and keep the regression assertion.
- Third review found Mission was the sole remaining source transition that reset visible state without first aborting
  the active chat request and cancelling replay. Perform both synchronous cancellations before clearing UI/writer state
  and before the asynchronous directory handoff; strengthen the Mission boundary contract to lock the complete order.
- The full Overlay suite next exposed a merged CSS double-owner: the shared navigation-row primitive already applies
  hover/focus feedback to the Project header (including its child action controls), while `sidebar.css` repeated the
  same parent-hover paint. Remove the surface override so the primitive remains the single interaction-style owner.
- Final residue review found one production comment still naming deleted `syncTask`; update it to the real
  `applyDirectory + hydrateTaskConversation + startSSE` selection chain.
- A later full-suite test contradicted the navigation single-owner test by requiring the just-removed sidebar hover
  override. Preserve its valid visual requirement (one full-row hover with transparent child buttons) while binding the
  hover paint to `navigation-row.css`; assert the duplicate surface selector remains absent.
- The next full-suite failure was another stale assertion predating `d16968cde3`: provider discovery now deliberately
  supports both captured project scope and empty-workspace global scope. Update the source contract to require the
  explicit conditional project/global paths instead of matching the retired direct project-only call.
- Strict board validation exposed three old runtime-directory fixtures without backend task order keys; update the
  fixture payloads to the current contract. The same test also exposed a real type/behavior mismatch retained from the
  old message store: `chatRequest` was declared as an `AbortController`, but production stores request metadata whose
  `controller` field owns cancellation. Define that actual store shape and cancel its controller directly; update tests
  to use the real shape instead of `as any` objects.
- Another stale test still required the titlebar to inline `closeProject` and DOM focus after New Chat was centralized
  in `openGlobalChatLauncher`. Bind the menu test to that shared lifecycle owner, matching Command Palette and Work
  Ledger behavior.
- Final type review rejected a documentary-only `ChatRequestState`: production still bypassed it through `any`, while
  an unassigned optional `recovery` hook remained. Move the abort-target shape beside the request state, type the real
  constructor/consumer chain, remove every cast and the dead hook, and let typecheck enforce the contract end to end.
- The next complete Overlay run exposed a May-era positive test that constructed `executor` as both channel and runtime
  agent identity, then required a reasoning delta to make the card visible. This contradicts both current contracts:
  runtime identity belongs to the projected dynamic agent, and commit `192da59584` deliberately retained reasoning only
  as protocol evidence rather than user-facing card content. The adjacent generic shell-visibility test already owns the
  valid behavior. Remove the contradictory test and its private session constant; do not restore an executor special case
  or reasoning visibility path. Re-run the complete Overlay suite to discover the next real failure.
- The complete run then reached a real live/persisted convergence defect: persisted parts are sorted by their required
  server `part` orderKey, while live `message.part.updated` merely appended. Insert every new live part into the same
  canonical order and rebuild that card's part index; reject orderKey drift for an existing part identity. Update the
  source-contract test to require ordered immutable-array replacement rather than arrival-order append.
  The first implementation tried to sort the whole rendered card and was rejected by focused tests: adjacent message
  segments contain explicit boundary projections that intentionally have no part-domain orderKey. Keep immutable live
  insertion local, then run every projectable part update through the existing `regroupTimelineSegments`, which already
  sorts real parts within each message before rebuilding boundaries and indexes. This preserves one timeline authority
  without inventing boundary keys or a second comparator.
- Independent exact-diff review rejected chat cancellation because `chatAbortTargets` combined a request seed with the
  current board selection and retried run/session/task targets after failure. That is an identity fallback and can stop
  an unrelated execution after UI navigation. Replace `ChatAbortTarget` with a discriminated union whose matching ID and
  directory are required, make every active request freeze exactly one target before entering the store, remove the
  current-board target collector, and issue exactly one remote cancellation. A remote failure must reject and must not
  attempt any derived target. Tests bind target/selection drift and single-attempt failure.
  Full call-point enumeration also proved no production request ever owns a run target: panel messages create only task
  or session requests. Remove the unused run variant and route rather than retaining a speculative cancellation ABI.
- The same review's combined focused run exposed order-dependent test state: `tree-writer-hierarchy.test.ts` leaves its
  selected task in the shared board store, while `workspace-active-directory.test.ts` only cleaned after each test and
  therefore its first test inherited foreign state. Initialize that suite's board selection before every test and retain
  cleanup after each test, then rerun the exact combined batch and the full suite.
- Final chat-state review found `aborted` unread, `manualAbort` guarding the same unconditional throw, `stopping` cleared
  before any observer could use it, and the uncalled `remote:false` option allowing a successful local-only stop. The UI
  already owns click re-entry through `composerStopping`. Reduce request state to request ID, controller and exact target;
  make stop unconditional local plus exact remote cancellation; remove the redundant catch and all stale fixtures.
- The next full run exposed another executor-as-runtime residue in the performance suite. Its valid requirement is that
  reasoning deltas remain constant-time with many visible cards, not that reasoning makes an executor card visible.
  Seed a projected `implementation-engineer` build card with ordinary visible text, stream reasoning evidence into that
  card, and use the same dynamic identity in the many-session timing case.
- The full Overlay suite passed after those corrections, but final template-ID residue review found three remaining
  positive fixtures using non-scheduler base roles as runtime `agentID`: tool raw-delta (`executor`), inline artifacts
  (`build`) and chronological child turns (`architect`). Preserve their stage channels and test behavior while replacing
  runtime/session/author identity with General's `implementation-engineer` or `solution-architect` projection ID. The
  scheduler's orchestrator identity is a separate scheduler projection and is not rewritten as a worker agent.
  The two affected Node browser fixtures were then run through the required Node runner. Inline artifacts passed; the
  chronological fixture reached a visible load error because its transcript and view predated required
  `sessionAgentID`. Add the same explicit projected session owner to transcript info and view messages; do not infer it
  in production or relax hydration. Re-run the browser case and inspect its generated screenshot.
  The rerun passed, but manual screenshot review found the fixed historical fixture epoch rendered a nonsensical
  2,369-hour active duration. Anchor the fixture's relative timeline just before the current test run so chronology stays
  stable while elapsed-time UI remains realistic; regenerate and review the screenshots before acceptance.
- Merge recall: concurrent remote validation work independently replaced arrival-order append with
  `insertSessionPartByOrderKey`, which inserts within one message segment, respects rendered message boundaries and shifts
  the session part index. Keep that more precise single-pass projection plus this slice's cross-card ownership and
  orderKey-drift failures. Restore display-triggered regroup only for visible parts; reasoning-only updates retain evidence
  without creating a visible card or forcing full timeline regroup. Convert the remote executor fixtures to the same
  dynamic `implementation-engineer` identity before merge acceptance.

#### Merge validation correction Recall

- Independent review of the frozen merge index found that the earlier dynamic-identity residue scan covered object fields
  but not the first positional `agentID` argument of `stampedInfo`, `stampedPartEvent`, and `stampedLifecycle`. Exhaustive
  call-point search in `tree-writer-hierarchy.test.ts` found template identities `architect`, `integrity`, and
  `frontend-research` in those positions, plus matching explicit `resolvedRole` / `agent` fixture fields and one helper
  loop that passed its stage channel as runtime identity. Replace them with General's projected
  `solution-architect`, `system-integrity-reviewer`, and `interface-investigator` identities while retaining the original
  stage channels. Add a negative repository test that derives the base-role set from the General manifest and inspects
  all three helper call shapes, so future manifest changes cannot escape a hand-maintained keyword list.
- The same review found a fixed `{ timeout: 15_000 }` on the package-manager test that serially starts five Bun child
  processes. Restore the test timeout to zero and keep inactivity supervision exclusively in
  `run-with-inactivity.ts`; elapsed time from process start is not evidence of inactivity.
- A separate performance review reproduced the existing 500-new-session benchmark above its five-second budget while
  multiple heavy Windows test groups were running concurrently and traced the measured path to top-level projection
  rebuilds. This path predates and is independent of the merged part-order insertion. Clean follow-up evidence closed
  the blocking result without changing code or threshold: the same benchmark passed at 4.765s in the focused merge
  batch, then 3.764s, 1.351s, and 2.025s in successively isolated reruns. The 5.7-7.3s observations are therefore
  concurrent host-resource contention, not a reproducible product regression; no Windows-specific workaround is added.
- Exact-index review rejected the first negative residue test because its source regex saw only literal first arguments,
  while the repaired calls use constants and variables. Delete that false-green scanner. Parse the General manifest once
  in the hierarchy fixture, derive its complete base-role set, and reject template identity inside all three stamp helpers
  before they project any event. A manifest-derived negative test exercises every helper, so literal, constant and
  variable callers share the same tested boundary without a hand-maintained identity list.
- Follow-up review found two `agent: "build"` inputs that `stampedInfo` silently overwrote, so positional validation alone
  still allowed test source to preserve a template identity. Derive the valid runtime identity set from General worker
  projection keys plus its scheduler base role, and validate explicit `agent`, `agentID`, `sessionAgentID`, and
  `resolvedRole` inputs at every stamp boundary. A base role that is not itself a declared runtime projection now fails;
  the manifest-declared scheduler identity remains valid. Delete the two ignored Build fields and cover explicit-field
  rejection with the same manifest-derived negative test.
- Final review rejected the first field test because its four-field matrix exercised only `stampedInfo`; deleting field
  validation from `stampedPartEvent` or `stampedLifecycle` would remain false-green. The negative matrix must execute all
  three helpers for each of the four explicit identity fields, in addition to the positional-agent tests.
- Post-matrix merge review found a live chronology defect in `insertSessionPartByOrderKey`: when consecutive same-agent
  blank messages share one card, the earlier message has no part or boundary to mark its segment, so a late reasoning
  part was appended after the later message boundary. Reasoning-only updates do not regroup, making the order durable.
  Use the existing canonical message order keys to locate a missing segment before the first later-message candidate,
  while retaining part-order comparison inside an owned segment. A real two-message live-event regression must prove the
  earlier reasoning part precedes the later boundary without relying on a display-triggered regroup.
